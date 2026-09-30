import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { checkPages, webkitInstalled } from "../src/browser.ts";
import { catalogVersion } from "../src/commands/fixture.ts";
import { BUILT_IN_FIXTURE_NAMES, CATALOG_FIXTURE_NAMES } from "../src/commands.ts";
import {
	catalogPath,
	footnoteExpectations,
	packagePath,
	parseFixture,
	readFixture,
} from "../src/project.ts";
import { RESERVED_FIXTURE_NAMES, RenderTarget, renderSite } from "../src/render.ts";
import { STARTER, temporaryDirectory, writeFiles } from "./helpers.ts";

describe("catalog", () => {
	test("lists exactly the files in assets/catalog", () => {
		const files = readdirSync(packagePath("assets", "catalog"))
			.map((name) => name.replace(/\.toml$/, ""))
			.sort();
		assert.deepEqual(files, [...CATALOG_FIXTURE_NAMES].sort());
	});

	test("names clash with no built-in fixture or reserved scenario", () => {
		const taken = new Set<string>([...BUILT_IN_FIXTURE_NAMES, ...RESERVED_FIXTURE_NAMES]);
		for (const name of CATALOG_FIXTURE_NAMES) assert.ok(!taken.has(name), name);
	});

	for (const name of CATALOG_FIXTURE_NAMES) {
		test(`${name} parses, records its version, and links only to example.org`, () => {
			const text = readFileSync(catalogPath(name), "utf8");
			assert.ok(text.startsWith(`# nnw-theme catalog fixture: ${name} (catalog version `));
			assert.ok((catalogVersion(text) ?? 0) >= 1);
			assert.match(
				text,
				new RegExp(`^# Refresh: npx nnw-theme@2 fixture add ${name} --force$`, "m"),
			);
			const fixture = parseFixture(text, name);
			footnoteExpectations(fixture, name);
			assert.ok(typeof fixture.body === "string" && fixture.body.length > 1000);
			assert.ok(!(fixture.body as string).includes("[["), "no macro-like text");
			// SVG namespaces are identifiers, not links.
			const hosts = [
				...text.replace(/xmlns="[^"]*"/g, "").matchAll(/https?:\/\/([^/"'\s?#&<)]+)/g),
			].map((match) => match[1]);
			const foreign = hosts.filter((host) => host !== "example.org");
			assert.deepEqual([...new Set(foreign)], []);
		});
	}
});

const webkit = await webkitInstalled();

describe("catalog in WebKit", {
	skip: !webkit && "WebKit is not installed; run node src/cli.ts setup",
}, () => {
	test("every catalog fixture passes check with the starter theme", async () => {
		const root = temporaryDirectory();
		const expected: Record<string, ReturnType<typeof footnoteExpectations>> = {};
		for (const name of CATALOG_FIXTURE_NAMES) {
			writeFiles(root, { [`fixtures/${name}.toml`]: readFileSync(catalogPath(name)) });
			expected[name] = footnoteExpectations(readFixture(catalogPath(name)), name);
		}
		const targets = CATALOG_FIXTURE_NAMES.flatMap((name) =>
			(["mac", "iphone"] as const).flatMap((platform) =>
				(["light", "dark"] as const).map(
					(appearance) => new RenderTarget(name, platform, appearance),
				),
			),
		);
		const site = renderSite(root, STARTER, targets);
		const results = await checkPages(site, targets, undefined, expected);
		const failed = Object.entries(results).filter(([, failures]) => failures.length);
		assert.deepEqual(failed, []);
	});
});
