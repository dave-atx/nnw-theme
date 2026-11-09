import { join } from "node:path";
import { interactive, promptConfirm } from "../interactive.ts";
import type { Args } from "../main.ts";
import { findRoot, findTheme, readPlist, ThemeError, writePlist } from "../project.ts";

const GET_INFO_VERSION = "CFBundleGetInfoString";
const COPYRIGHT = "NSHumanReadableCopyright";

/** The one asked for, or the current one with its last number increased; none if the theme has none. */
function nextGetInfoVersion(
	current: unknown,
	requested: string | undefined,
): string | undefined {
	if (requested !== undefined) {
		if (!requested.trim()) throw new ThemeError("--get-info-version must not be empty");
		return requested;
	}
	if (current === undefined) return undefined;
	const match = typeof current === "string" ? /^(.*?)(\d+)$/s.exec(current) : null;
	if (!match) {
		throw new ThemeError(
			`Info.plist ${GET_INFO_VERSION} must end in a number to increase; pass --get-info-version`,
		);
	}
	const digits = match[2] ?? "";
	return (match[1] ?? "") + String(Number(digits) + 1).padStart(digits.length, "0");
}

export default async function bump({ values }: Args): Promise<void> {
	const root = findRoot();
	const theme = findTheme(root);
	const metadata = readPlist(theme);
	const current = metadata.Version;
	if (typeof current !== "number" || !Number.isInteger(current)) {
		throw new ThemeError("Info.plist Version must be an integer");
	}
	const proposed = current + 1;
	const getInfo = nextGetInfoVersion(
		metadata[GET_INFO_VERSION],
		values["get-info-version"] as string | undefined,
	);
	const copyright =
		metadata[COPYRIGHT] === undefined && typeof metadata.CreatorName === "string"
			? `Copyright © ${new Date().getFullYear()} ${metadata.CreatorName}`
			: undefined;
	if (!values.yes) {
		if (!interactive())
			throw new ThemeError("pass --yes to increase Version without a terminal");
		const also = [
			getInfo ? ` and set the Get Info version to ${getInfo}` : "",
			copyright ? ` and add "${copyright}"` : "",
		].join("");
		if (!(await promptConfirm(`Increase Version from ${current} to ${proposed}${also}?`))) {
			throw new ThemeError("version bump cancelled");
		}
	}
	metadata.Version = proposed;
	if (getInfo) metadata[GET_INFO_VERSION] = getInfo;
	if (copyright) metadata[COPYRIGHT] = copyright;
	writePlist(join(theme, "Info.plist"), metadata);
	const also = [
		getInfo ? ` Get Info version is now ${getInfo}.` : "",
		copyright ? ` Added "${copyright}" for Get Info.` : "",
	].join("");
	console.log(`Version is now ${proposed}.${also} Commit this change before publishing.`);
}
