// The NetNewsWire rendering files the previews use. They ship in the package under
// assets/netnewswire/, fetched and SHA-256-verified at build time from the pin in
// netnewswire.json (see scripts/fetch-netnewswire.ts).
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packagePath, ThemeError } from "./project.ts";

export interface PinnedFile {
	destination: string;
	source: string;
	sha256: string;
}

export interface Pin {
	release: string;
	commit: string;
	files: PinnedFile[];
}

function safeRelativePath(value: unknown, field: string): string {
	if (typeof value !== "string" || !value) {
		throw new ThemeError(`snapshot configuration ${field} must be a non-empty string`);
	}
	const parts = value.split("/").filter((part) => part && part !== ".");
	if (value.startsWith("/") || parts.includes("..") || !parts.length) {
		throw new ThemeError(`snapshot configuration ${field} contains an unsafe path`);
	}
	return parts.join("/");
}

export function readPin(text: string, name = "netnewswire.json"): Pin {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		throw new ThemeError(`${name}: invalid NetNewsWire snapshot configuration: ${error}`);
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new ThemeError(`${name}: NetNewsWire snapshot configuration must be an object`);
	}
	const { release, commit, files } = value as Record<string, unknown>;
	if (typeof release !== "string" || !release) {
		throw new ThemeError(`${name}: release must be a non-empty string`);
	}
	if (typeof commit !== "string" || !/^[0-9a-f]{40}$/.test(commit)) {
		throw new ThemeError(`${name}: commit must be a full lowercase Git SHA`);
	}
	if (!Array.isArray(files) || !files.length) {
		throw new ThemeError(`${name}: files must be a non-empty array`);
	}
	const parsed: PinnedFile[] = [];
	for (const details of files) {
		if (!details || typeof details !== "object") {
			throw new ThemeError(`${name}: each file must be an object`);
		}
		const destination = safeRelativePath(details.destination, "destination");
		if (parsed.some((file) => file.destination === destination)) {
			throw new ThemeError(`${name}: duplicate destination ${destination}`);
		}
		const source = safeRelativePath(details.source, `source for ${destination}`);
		const sha256 = details.sha256;
		if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
			throw new ThemeError(`${name}: sha256 for ${destination} is invalid`);
		}
		parsed.push({ destination, source, sha256 });
	}
	return { release, commit, files: parsed };
}

export interface RenderingInputs {
	path: string;
	release: string;
}

let verified: RenderingInputs | undefined;

/** The bundled rendering files, verified against their pin once per process. */
export function renderingInputs(): RenderingInputs {
	if (verified) return verified;
	const path = packagePath("assets", "netnewswire");
	const manifest = join(path, "netnewswire.json");
	if (!existsSync(manifest)) {
		throw new ThemeError(
			"the NetNewsWire rendering files are missing from this nnw-theme install; " +
				"in a checkout of the tool, run `npm run fetch-netnewswire`",
		);
	}
	const pin = readPin(readFileSync(manifest, "utf8"), manifest);
	for (const file of pin.files) {
		const filePath = join(path, ...file.destination.split("/"));
		let actual = "";
		try {
			actual = createHash("sha256").update(readFileSync(filePath)).digest("hex");
		} catch {
			// Reported below as a failed verification.
		}
		if (actual !== file.sha256) {
			throw new ThemeError(`bundled NetNewsWire file failed SHA-256 verification: ${filePath}`);
		}
	}
	verified = { path, release: pin.release };
	return verified;
}
