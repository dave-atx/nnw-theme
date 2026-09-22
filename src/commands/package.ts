import { resolve } from "node:path";
import type { Args } from "../main.ts";
import { buildArchive } from "../package.ts";
import { findRoot, findTheme } from "../project.ts";

export function printWarnings(warnings: readonly string[]): void {
	for (const warning of warnings) console.error(`warning: ${warning}`);
}

export default function packageTheme({ values }: Args): void {
	const root = findRoot();
	const theme = findTheme(root);
	const { path, warnings } = buildArchive(theme, resolve(root, String(values["output-dir"])), {
		allowRemoteMedia: values["allow-remote-media"] === true,
	});
	printWarnings(warnings);
	console.log(path);
}
