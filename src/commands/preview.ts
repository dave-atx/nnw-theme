import { type FSWatcher, watch } from "node:fs";
import { relative, sep } from "node:path";
import { serve } from "../browser.ts";
import { openInBrowser } from "../interactive.ts";
import type { Args } from "../main.ts";
import { findRoot, findTheme } from "../project.ts";
import { extraFixtures, normalTargets, renderSite } from "../render.ts";

/** Whether a changed path is theme or fixture content the gallery is built from. */
export function watched(root: string, path: string): boolean {
	const parts = relative(root, path).split(sep);
	if (parts.length !== 2) return false;
	const [directory = "", name = ""] = parts;
	return (
		directory.endsWith(".nnwtheme") || (directory === "fixtures" && name.endsWith(".toml"))
	);
}

export default async function preview({ values }: Args): Promise<void> {
	const root = findRoot();
	const theme = findTheme(root);
	const build = () => renderSite(root, theme, normalTargets(extraFixtures(root)));
	const site = build();
	const server = await serve(site);
	console.log(`Preview: ${server.url}`);
	if (!values["no-open"]) openInBrowser(server.url);
	console.log("Watching theme and fixtures. Press Ctrl-C to stop.");
	let timer: NodeJS.Timeout | undefined;
	const watcher: FSWatcher = watch(root, { recursive: true }, (_event, name) => {
		if (!name || !watched(root, `${root}${sep}${name}`)) return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			try {
				build();
				console.log("Rebuilt preview.");
			} catch (error) {
				console.error(`error: ${(error as Error).message}`);
			}
		}, 200);
	});
	await new Promise<void>((resolve) => {
		process.once("SIGINT", () => {
			console.log("\nPreview stopped.");
			resolve();
		});
	});
	watcher.close();
	clearTimeout(timer);
	await server.close();
}
