import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { BUILT_IN_FIXTURE_NAMES } from "./commands.ts";
import { buildPlist, type PlistDict, parsePlist } from "./plist.ts";

export const REQUIRED_THEME_FILES = ["Info.plist", "template.html", "stylesheet.css"] as const;
export const PLACEHOLDER_MARKER = ".nnw-theme-uninitialized";
export const IDENTITY_START = "<!-- nnw-theme-identity:start -->";
export const IDENTITY_END = "<!-- nnw-theme-identity:end -->";
/** The fixtures that ship in the package; a repository's own copy of one wins. */
export const BUILT_IN_FIXTURES = BUILT_IN_FIXTURE_NAMES;

/** A user-actionable theme project error. */
export class ThemeError extends Error {
	override name = "ThemeError";
}

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** A path inside the installed package (src/ in a checkout, dist/ when published). */
export function packagePath(...parts: string[]): string {
	return join(PACKAGE_ROOT, ...parts);
}

export type Fixture = Record<string, unknown>;

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function themeDirectories(root: string): string[] {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	return names
		.filter((name) => name.endsWith(".nnwtheme") && isDirectory(join(root, name)))
		.sort()
		.map((name) => join(root, name));
}

/** The nearest directory, from start upward, that holds a root *.nnwtheme bundle. */
export function findRoot(start: string = process.cwd()): string {
	let current = resolve(start);
	if (isFile(current)) current = dirname(current);
	for (;;) {
		if (themeDirectories(current).length) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	throw new ThemeError("run this command inside the theme repository");
}

export function findTheme(root: string): string {
	const themes = themeDirectories(root);
	const [theme] = themes;
	if (themes.length !== 1 || !theme) {
		const names = themes.map((path) => path.slice(root.length + 1)).join(", ") || "none";
		throw new ThemeError(
			`expected one .nnwtheme directory at the repository root; found ${names}`,
		);
	}
	return theme;
}

/** A bundle's name without .nnwtheme, as Python's Path.stem gives it. */
export function themeStem(theme: string): string {
	const name = theme.split("/").at(-1) ?? "";
	return name.slice(0, -".nnwtheme".length);
}

export function readPlistFile(path: string): PlistDict {
	let value: unknown;
	try {
		value = parsePlist(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ThemeError(`${path}: invalid property list: ${(error as Error).message}`);
	}
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		value.constructor !== Object
	) {
		throw new ThemeError(`${path}: the top-level value must be a dictionary`);
	}
	return value as PlistDict;
}

export function readPlist(theme: string): PlistDict {
	return readPlistFile(join(theme, "Info.plist"));
}

export function writePlist(path: string, metadata: PlistDict): void {
	writeFileSync(path, buildPlist(metadata), "utf8");
}

export function parseFixture(text: string, name: string): Fixture {
	let value: unknown;
	try {
		value = parseToml(text);
	} catch (error) {
		throw new ThemeError(`${name}: invalid fixture: ${(error as Error).message}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ThemeError(`${name}: fixture must be a table`);
	}
	return value as Fixture;
}

export function readFixture(path: string): Fixture {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		throw new ThemeError(`${path}: invalid fixture: ${(error as Error).message}`);
	}
	return parseFixture(text, path);
}

/** The repository's fixture names (fixtures/*.toml), sorted. */
export function repositoryFixtures(root: string): string[] {
	let names: string[];
	try {
		names = readdirSync(join(root, "fixtures"));
	} catch {
		return [];
	}
	return names
		.filter((name) => name.endsWith(".toml") && isFile(join(root, "fixtures", name)))
		.map((name) => name.slice(0, -".toml".length))
		.sort();
}

/** Where a fixture lives: the repository's copy, else the package's built-in one. */
export function fixturePath(root: string, name: string): string {
	const own = join(root, "fixtures", `${name}.toml`);
	if (existsSync(own)) return own;
	if ((BUILT_IN_FIXTURES as readonly string[]).includes(name)) {
		return packagePath("assets", "fixtures", `${name}.toml`);
	}
	throw new ThemeError(`fixture not found: ${own}`);
}

export interface FootnoteExpectations {
	notes?: Record<string, string>;
	plain_links?: string[];
	keep_with_word?: boolean;
}

function isTable(value: unknown): value is Record<string, unknown> {
	return (
		!!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
	);
}

/**
 * A fixture's optional [expect.footnotes] table, validated for the browser check.
 *
 * notes maps each footnote marker's rendered text to the note text its popover must
 * show; plain_links lists CSS selectors for links that must not become footnotes;
 * keep_with_word requires markers written against a word to stay on its line.
 */
export function footnoteExpectations(fixture: Fixture, name: string): FootnoteExpectations {
	const expect = fixture.expect ?? {};
	const footnotes = isTable(expect) ? (expect.footnotes ?? {}) : undefined;
	if (
		!isTable(expect) ||
		!isTable(footnotes) ||
		Object.keys(expect).some((key) => key !== "footnotes")
	) {
		throw new ThemeError(`${name}: [expect] may contain only a [expect.footnotes] table`);
	}
	const unknown = Object.keys(footnotes)
		.filter((key) => !["notes", "plain_links", "keep_with_word"].includes(key))
		.sort();
	if (unknown.length) {
		throw new ThemeError(`${name}: unknown [expect.footnotes] key(s): ${unknown.join(", ")}`);
	}
	const result: FootnoteExpectations = {};
	if ("notes" in footnotes) {
		const notes = footnotes.notes;
		if (!isTable(notes) || !Object.values(notes).every((value) => typeof value === "string")) {
			throw new ThemeError(`${name}: [expect.footnotes.notes] must map markers to text`);
		}
		result.notes = notes as Record<string, string>;
	}
	if ("plain_links" in footnotes) {
		const links = footnotes.plain_links;
		if (!Array.isArray(links) || !links.every((link) => typeof link === "string")) {
			throw new ThemeError(`${name}: expect.footnotes.plain_links must be CSS selectors`);
		}
		result.plain_links = links;
	}
	if ("keep_with_word" in footnotes) {
		if (typeof footnotes.keep_with_word !== "boolean") {
			throw new ThemeError(`${name}: expect.footnotes.keep_with_word must be true or false`);
		}
		result.keep_with_word = footnotes.keep_with_word;
	}
	return result;
}
