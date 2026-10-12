import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_FIXTURES } from "../commands.ts";
import type { Args } from "../main.ts";
import { catalogPath, findRoot, ThemeError } from "../project.ts";

const VERSION_RE = /^# nnw-theme catalog fixture: \S+ \(catalog version (\d+)\)$/m;

/** The catalog version a fixture file's header records, if it has one. */
export function catalogVersion(text: string): number | undefined {
	const match = VERSION_RE.exec(text);
	return match ? Number(match[1]) : undefined;
}

/** How a repository's copy of a catalog fixture compares with the catalog's. */
export function catalogStatus(root: string, name: string): string {
	const own = join(root, "fixtures", `${name}.toml`);
	if (!existsSync(own)) return "";
	const ours = readFileSync(own, "utf8");
	const theirs = readFileSync(catalogPath(name), "utf8");
	if (ours === theirs) return "added";
	const [have, latest] = [catalogVersion(ours), catalogVersion(theirs)];
	if (have !== undefined && latest !== undefined && have < latest) {
		return `added (version ${have}; version ${latest} available)`;
	}
	return "added (differs)";
}

export interface AddResult {
	added: string[];
	current: string[];
	skipped: string[];
}

/** Copy catalog fixtures into fixtures/, keeping existing files unless forced. */
export function addCatalogFixtures(
	root: string,
	names: readonly string[],
	force = false,
): AddResult {
	const result: AddResult = { added: [], current: [], skipped: [] };
	mkdirSync(join(root, "fixtures"), { recursive: true });
	for (const name of new Set(names)) {
		const source = catalogPath(name);
		const destination = join(root, "fixtures", `${name}.toml`);
		if (existsSync(destination)) {
			if (readFileSync(destination, "utf8") === readFileSync(source, "utf8")) {
				result.current.push(name);
				continue;
			}
			if (!force) {
				result.skipped.push(name);
				continue;
			}
		}
		copyFileSync(source, destination);
		result.added.push(name);
	}
	return result;
}

export function list(): void {
	let root: string | undefined;
	try {
		root = findRoot();
	} catch (error) {
		if (!(error instanceof ThemeError)) throw error;
	}
	const names = Object.keys(CATALOG_FIXTURES);
	const width = Math.max(...names.map((name) => name.length)) + 2;
	const summaryWidth =
		Math.max(...Object.values(CATALOG_FIXTURES).map((text) => text.length)) + 2;
	for (const [name, summary] of Object.entries(CATALOG_FIXTURES)) {
		const status = root ? catalogStatus(root, name) : "";
		console.log(
			`${name.padEnd(width)}${status ? summary.padEnd(summaryWidth) + status : summary}`,
		);
	}
	console.log(
		"\nAdd one with `npx nnw-theme@2 fixture add NAME`. Each adds four renders to every check.",
	);
}

export function add({ values, positionals }: Args): void {
	const root = findRoot();
	const { added, current, skipped } = addCatalogFixtures(
		root,
		positionals,
		values.force === true,
	);
	for (const name of added) console.log(`Added fixtures/${name}.toml.`);
	for (const name of current) console.log(`fixtures/${name}.toml is already current.`);
	if (added.length) {
		const renders = added.length * 4;
		console.log(
			`Preview with \`npx nnw-theme@2 render ${added.join(" ")}\`, then run ` +
				`\`npx nnw-theme@2 check\` (${renders} more renders).`,
		);
	}
	if (skipped.length) {
		throw new ThemeError(
			`kept existing ${skipped.map((name) => `fixtures/${name}.toml`).join(", ")}; ` +
				"pass --force to replace with the catalog version",
		);
	}
}
