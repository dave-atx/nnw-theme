import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { Args } from "../main.ts";
import { type PlistDict, parsePlist } from "../plist.ts";
import { findRoot, findTheme, readPlist, ThemeError } from "../project.ts";
import { readZip } from "../zip.ts";

export default function releaseCheck({ values }: Args): void {
	const root = findRoot();
	const theme = findTheme(root);
	const current = readPlist(theme);
	const path = String(values["previous-asset"]);
	let content: Buffer;
	try {
		content = readFileSync(path);
	} catch (error) {
		throw new ThemeError(`could not read the previous release: ${(error as Error).message}`);
	}
	let entries: ReturnType<typeof readZip>;
	try {
		entries = readZip(content);
	} catch (error) {
		throw new ThemeError(`previous release is not a valid ZIP: ${(error as Error).message}`);
	}
	const infos = entries.filter((entry) => entry.name.endsWith("/Info.plist"));
	const [info] = infos;
	if (infos.length !== 1 || !info) {
		throw new ThemeError("previous release must contain exactly one Info.plist");
	}
	const previous = parsePlist(new TextDecoder().decode(info.read())) as PlistDict;
	const oldBundle = info.name.split("/", 1)[0];
	const bundle = basename(theme);
	if (oldBundle !== bundle) {
		throw new ThemeError(`bundle filename changed after release: ${oldBundle} -> ${bundle}`);
	}
	if (previous.ThemeIdentifier !== current.ThemeIdentifier) {
		throw new ThemeError("ThemeIdentifier cannot change after the first release");
	}
	const version = current.Version;
	const previousVersion = typeof previous.Version === "number" ? previous.Version : 0;
	if (typeof version !== "number" || !Number.isInteger(version) || version <= previousVersion) {
		throw new ThemeError("Info.plist Version must increase after the previous release");
	}
	console.log(
		`Release identity is stable and Version increases ${previous.Version ?? "None"} -> ${version}.`,
	);
}
