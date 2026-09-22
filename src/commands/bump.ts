import { join } from "node:path";
import { interactive, promptConfirm } from "../interactive.ts";
import type { Args } from "../main.ts";
import { findRoot, findTheme, readPlist, ThemeError, writePlist } from "../project.ts";

export default async function bump({ values }: Args): Promise<void> {
	const root = findRoot();
	const theme = findTheme(root);
	const metadata = readPlist(theme);
	const current = metadata.Version;
	if (typeof current !== "number" || !Number.isInteger(current)) {
		throw new ThemeError("Info.plist Version must be an integer");
	}
	const proposed = current + 1;
	if (!values.yes) {
		if (!interactive())
			throw new ThemeError("pass --yes to increase Version without a terminal");
		if (!(await promptConfirm(`Increase Version from ${current} to ${proposed}?`))) {
			throw new ThemeError("version bump cancelled");
		}
	}
	metadata.Version = proposed;
	writePlist(join(theme, "Info.plist"), metadata);
	console.log(`Version is now ${proposed}. Commit this change before publishing.`);
}
