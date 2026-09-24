import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { Parser } from "htmlparser2";
import { type PlistDict, PlistReal, parsePlist } from "./plist.ts";
import {
	PLACEHOLDER_MARKER,
	REQUIRED_THEME_FILES,
	readPlist,
	ThemeError,
	themeStem,
} from "./project.ts";
import { pyRepr } from "./pyformat.ts";
import { urlsplit } from "./urlparse.ts";
import { readZip } from "./zip.ts";

const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
const REQUIRED_PLIST_FIELDS = [
	["ThemeIdentifier", "str"],
	["Name", "str"],
	["CreatorHomePage", "str"],
	["CreatorName", "str"],
	["Version", "int"],
] as const;
const PLACEHOLDERS = ["starter", "example.com", "your name", "change me", "todo"];
const SAFE_BUNDLE_NAME = /^[^/\\\0]+$/;
const OPTIONAL_THEME_FILE = /^(?:LICENSE|NOTICE)(?:\.[A-Za-z0-9-]+)?$/;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;
const MACRO = /\[\[[A-Za-z0-9_-]+\]\]/g;

export class ValidationReport {
	errors: string[] = [];
	warnings: string[] = [];

	requireOk(): void {
		if (this.errors.length) {
			throw new ThemeError(`theme validation failed:\n- ${this.errors.join("\n- ")}`);
		}
	}
}

type Reference = [tag: string, attribute: string, value: string];

function resourceReferences(template: string): Reference[] {
	const references: Reference[] = [];
	let attributes = new Map<string, string>();
	const parser = new Parser(
		{
			onattribute(name, value) {
				attributes.set(name.toLowerCase(), value ?? "");
			},
			onopentag(name) {
				const tag = name.toLowerCase();
				if (tag === "link" && (attributes.get("rel") ?? "").toLowerCase() === "stylesheet") {
					references.push(["stylesheet", "href", attributes.get("href") ?? ""]);
				}
				for (const attribute of ["src", "poster"]) {
					const value = attributes.get(attribute);
					if (value !== undefined) references.push([tag, attribute, value]);
				}
				attributes = new Map();
			},
		},
		{ decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
	);
	parser.end(template);
	return references;
}

/** Macros written inside HTML comments, which NetNewsWire substitutes like any other. */
function commentedMacros(template: string): string[] {
	const found = new Set<string>();
	for (const comment of template.matchAll(/<!--[\s\S]*?-->/g)) {
		for (const macro of comment[0].matchAll(MACRO)) found.add(macro[0]);
	}
	return [...found];
}

function isRemote(value: string): boolean {
	return value.startsWith("//") || ["http", "https"].includes(urlsplit(value).scheme);
}

function isAllowedFile(name: string): boolean {
	return (
		(REQUIRED_THEME_FILES as readonly string[]).includes(name) ||
		OPTIONAL_THEME_FILE.test(name.toUpperCase())
	);
}

function isInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value);
}

export function validateMetadata(metadata: PlistDict, bundleStem: string): ValidationReport {
	const report = new ValidationReport();
	for (const [field, type] of REQUIRED_PLIST_FIELDS) {
		const value = metadata[field];
		const valid = type === "int" ? isInt(value) : typeof value === "string";
		if (!valid || (typeof value === "string" && !value.trim())) {
			report.errors.push(`Info.plist: ${field} must be a non-empty ${type}`);
		}
	}
	if (report.errors.length) return report;
	const text = (field: string) => metadata[field] as string;

	if (text("Name") !== bundleStem) {
		report.errors.push(
			`Info.plist Name (${pyRepr(text("Name"))}) must match bundle name (${pyRepr(bundleStem)})`,
		);
	}
	const home = urlsplit(text("CreatorHomePage"));
	if (!["http", "https"].includes(home.scheme) || !home.netloc) {
		report.errors.push("Info.plist CreatorHomePage must be an absolute HTTP(S) URL");
	}
	for (const field of ["ThemeIdentifier", "Name", "CreatorHomePage", "CreatorName"]) {
		const lowered = text(field).trim().toLowerCase();
		if (PLACEHOLDERS.some((token) => lowered.includes(token))) {
			report.errors.push(`Info.plist ${field} still contains placeholder metadata`);
		}
	}
	if ((metadata.Version as number) < 1) {
		report.errors.push("Info.plist Version must be an integer of at least 1");
	}
	return report;
}

function remoteMessage(report: ValidationReport, message: string, allowRemoteMedia: boolean) {
	if (allowRemoteMedia) report.warnings.push(message);
	else report.errors.push(`${message} (pass --allow-remote-media to acknowledge)`);
}

function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

export function validateSource(
	theme: string,
	{ allowRemoteMedia = false } = {},
): ValidationReport {
	const report = new ValidationReport();
	const stem = themeStem(theme);
	if (!SAFE_BUNDLE_NAME.test(stem) || stem === "." || stem === "..") {
		report.errors.push("theme bundle name contains path-unsafe characters");
	}
	if (existsSync(join(dirname(theme), PLACEHOLDER_MARKER))) {
		report.errors.push("run `npx nnw-theme@1 init` before packaging this theme");
	}

	const names = readdirSync(theme);
	for (const required of REQUIRED_THEME_FILES) {
		if (!names.includes(required)) {
			report.errors.push(`theme is missing exact required file ${required}`);
		}
	}
	for (const name of names) {
		const path = join(theme, name);
		if (lstatSync(path).isSymbolicLink()) {
			report.errors.push(`theme contains symbolic link ${name}`);
		} else if (!isRegularFile(path)) {
			report.errors.push(`theme contains unsupported directory ${name}`);
		} else if (!isAllowedFile(name)) {
			report.errors.push(`theme contains unsupported file ${name}`);
		}
	}
	if (report.errors.length && !names.includes("Info.plist")) return report;

	const metadataReport = validateMetadata(readPlist(theme), stem);
	report.errors.push(...metadataReport.errors);
	report.warnings.push(...metadataReport.warnings);

	const templatePath = join(theme, "template.html");
	if (isRegularFile(templatePath)) {
		const template = readFileSync(templatePath, "utf8");
		if (!template.includes("[[")) {
			report.warnings.push("template.html contains no NetNewsWire macros");
		}
		const commented = commentedMacros(template);
		if (commented.length) {
			report.errors.push(
				`template.html has macros inside an HTML comment (${commented[0]}` +
					`${commented.length > 1 ? ` and ${commented.length - 1} more` : ""}). ` +
					"NetNewsWire substitutes them there too, so an article containing --> " +
					"ends the comment early and the rest shows as text; " +
					"write macro names without double brackets",
			);
		}
		const references = resourceReferences(template);
		if (/<style\b[^>]*>[\s\S]*?@import\s/i.test(template)) {
			report.errors.push("CSS @import is not allowed in template.html");
		}
		for (const [tag, attribute, value] of references) {
			if (
				!value ||
				["data:", "#", "mailto:", "tel:"].some((prefix) => value.startsWith(prefix))
			) {
				continue;
			}
			if (tag === "script" || tag === "stylesheet") {
				report.errors.push(`external ${tag} is not allowed: ${value}`);
			} else if (isRemote(value)) {
				remoteMessage(
					report,
					`remote theme-owned ${tag} may not load in NetNewsWire: ${value}`,
					allowRemoteMedia,
				);
			} else if (!value.includes("[[")) {
				report.errors.push(
					"bundle-local resource references do not work in NetNewsWire: " +
						`${attribute}=${pyRepr(value)}`,
				);
			}
		}
	}

	const stylesheetPath = join(theme, "stylesheet.css");
	if (isRegularFile(stylesheetPath)) {
		const css = readFileSync(stylesheetPath, "utf8");
		for (const match of css.matchAll(/url\(\s*['"]?([^)'"]+)/gi)) {
			const value = (match[1] ?? "").trim();
			if (value.startsWith("data:")) continue;
			if (isRemote(value)) {
				remoteMessage(
					report,
					`remote CSS resource may not load in NetNewsWire: ${value}`,
					allowRemoteMedia,
				);
			} else {
				report.errors.push(`bundle-local CSS resource does not work in NetNewsWire: ${value}`);
			}
		}
		if (/@import\s/i.test(css)) report.errors.push("CSS @import is not allowed");
	}
	return report;
}

/** A ZIP member name as PurePosixPath sees it: parts without empty or "." segments. */
function posixParts(name: string): { parts: string[]; absolute: boolean } {
	return {
		parts: name.split("/").filter((part) => part && part !== "."),
		absolute: name.startsWith("/"),
	};
}

export function validateArchive(content: Uint8Array, assetName: string): ValidationReport {
	const report = new ValidationReport();
	if (!assetName.endsWith(".nnwtheme.zip")) {
		// Everything below derives the bundle name from this suffix.
		report.errors.push("release asset name must end in .nnwtheme.zip");
		return report;
	}
	if (content.length > MAX_ASSET_BYTES) {
		report.errors.push("release asset exceeds the 25 MiB compressed limit");
		return report;
	}
	try {
		const infos = readZip(content);
		if (infos.reduce((sum, info) => sum + info.size, 0) > MAX_UNCOMPRESSED_BYTES) {
			report.errors.push("release asset exceeds the 50 MiB expanded limit");
		}
		if (infos.some((info) => (info.mode & S_IFMT) === S_IFLNK)) {
			report.errors.push("release asset contains a symbolic link");
		}
		const files = infos.filter((info) => !info.isDirectory);
		const paths = files.map((info) => posixParts(info.name));
		const keys = paths.map((path) => `${path.absolute ? "/" : ""}${path.parts.join("/")}`);
		if (new Set(keys).size !== keys.length) {
			report.errors.push("release asset contains duplicate paths");
		}
		if (paths.some((path) => path.absolute || path.parts.includes(".."))) {
			report.errors.push("release asset contains an unsafe path");
			return report;
		}
		const roots = new Set(
			paths.map((path) => path.parts[0]).filter((part) => part?.endsWith(".nnwtheme")),
		);
		const expectedStem = assetName.slice(0, -".nnwtheme.zip".length);
		const expectedRoot = `${expectedStem}.nnwtheme`;
		if (roots.size !== 1 || !roots.has(expectedRoot)) {
			report.errors.push(`archive must contain exactly one top-level ${expectedRoot} bundle`);
			return report;
		}
		const names = new Set(keys);
		for (const required of REQUIRED_THEME_FILES) {
			if (!names.has(`${expectedRoot}/${required}`)) {
				report.errors.push(`archive is missing exact required file ${required}`);
			}
		}
		for (const [index, path] of paths.entries()) {
			if (path.parts.length !== 2 || !isAllowedFile(path.parts.at(-1) ?? "")) {
				report.errors.push(`archive contains unsupported path ${keys[index]}`);
			}
		}
		if (!report.errors.length) {
			const info = files.find((entry) => entry.name === `${expectedRoot}/Info.plist`);
			if (!info)
				throw new Error(`There is no item named '${expectedRoot}/Info.plist' in the archive`);
			const metadata = parsePlist(new TextDecoder().decode(info.read()));
			if (
				!metadata ||
				typeof metadata !== "object" ||
				metadata instanceof PlistReal ||
				Array.isArray(metadata)
			) {
				throw new Error("Info.plist must be a dictionary");
			}
			report.errors.push(...validateMetadata(metadata as PlistDict, expectedStem).errors);
		}
	} catch (error) {
		report.errors.push(`invalid theme archive: ${(error as Error).message}`);
	}
	return report;
}
