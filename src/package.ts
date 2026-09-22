import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ThemeError } from "./project.ts";
import { validateArchive, validateSource } from "./validate.ts";
import { writeZip } from "./zip.ts";

export interface Archive {
	content: Uint8Array;
	warnings: string[];
}

/** Build the deterministic ZIP. The only place package validation runs. */
export function archiveBytes(theme: string, { allowRemoteMedia = false } = {}): Archive {
	const sourceReport = validateSource(theme, { allowRemoteMedia });
	sourceReport.requireOk();
	const name = basename(theme);
	const files = readdirSync(theme)
		.sort()
		.map((file): [string, Uint8Array] => [`${name}/${file}`, readFileSync(join(theme, file))]);
	const content = writeZip(files);
	const archiveReport = validateArchive(content, `${name}.zip`);
	archiveReport.requireOk();
	return { content, warnings: [...sourceReport.warnings, ...archiveReport.warnings] };
}

export function buildArchive(
	theme: string,
	outputDir: string,
	{ allowRemoteMedia = false } = {},
): { path: string; warnings: string[] } {
	const { content, warnings } = archiveBytes(theme, { allowRemoteMedia });
	mkdirSync(outputDir, { recursive: true });
	const path = join(outputDir, `${basename(theme)}.zip`);
	writeFileSync(path, content);
	if (!path.endsWith(".nnwtheme.zip")) {
		throw new ThemeError("internal error: package has an invalid release asset name");
	}
	return { path, warnings };
}
