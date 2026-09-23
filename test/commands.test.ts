import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { absoluteHomepage, defaultIdentifier } from "../src/commands/init.ts";
import { CheckProgress } from "../src/commands/progress.ts";
import { archiveBytes } from "../src/package.ts";
import { buildPlist, type PlistDict } from "../src/plist.ts";
import { normalTargets } from "../src/render.ts";
import { readMarker, STUBS, staleStubs } from "../src/stubs.ts";
import { temporaryDirectory, writeFiles } from "./helpers.ts";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(TOOL, "src", "cli.ts");

function run(cwd: string, ...args: string[]) {
	return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
}

function metadata(overrides: PlistDict = {}): PlistDict {
	return {
		ThemeIdentifier: "com.example.starter",
		Name: "Starter",
		CreatorHomePage: "https://example.com",
		CreatorName: "Theme Author",
		Version: 1,
		...overrides,
	};
}

/** An uninitialized template: starter bundle, README markers, marker file. */
function template(): string {
	const root = temporaryDirectory();
	writeFiles(root, {
		"Starter.nnwtheme/Info.plist": buildPlist(metadata()),
		"Starter.nnwtheme/template.html": '<div class="articleBody">[[body]]</div>',
		"Starter.nnwtheme/stylesheet.css": "body {}",
		"README.md":
			"<!-- nnw-theme-identity:start -->\nold\n<!-- nnw-theme-identity:end -->\n\nKept documentation.\n",
		"screenshots/theme-preview.png": "template image",
		".nnw-theme-uninitialized": "",
	});
	return root;
}

const INIT = [
	"init",
	"--name",
	"Quiet Reader",
	"--creator",
	"Theme Author",
	"--homepage",
	"https://github.com/theme-author",
	"--github-user",
	"theme-author",
	"--identifier",
	"io.github.theme-author.quiet-reader",
	"--confirm-identifier",
	"io.github.theme-author.quiet-reader",
	"--marketplace",
	"no",
	"--no-install-browser",
];

describe("init", () => {
	test("rejects a placeholder homepage", () => {
		assert.throws(() => absoluteHomepage("https://example.com"), /placeholder/);
		assert.throws(() => absoluteHomepage("ftp://host.test"), /absolute HTTP\(S\)/);
	});

	test("proposes an identifier from the GitHub user or the homepage", () => {
		assert.equal(
			defaultIdentifier("Quiet Reader!", "", "Theme_Author"),
			"io.github.theme-author.quiet-reader",
		);
		assert.equal(
			defaultIdentifier("Ember", "https://Ember.Marquard.org/x"),
			"org.marquard.ember.ember",
		);
	});

	test("outside a theme, explains how to create one from the template", () => {
		const result = run(temporaryDirectory(), ...INIT);
		assert.equal(result.status, 1);
		assert.match(result.stderr, /^error: no theme repository here/);
		assert.ok(
			result.stderr.includes(
				"gh repo create my-theme --template dave-atx/netnewswire-theme-template --public --clone",
			),
		);
	});

	test("personalizes the template and removes the starter screenshot", () => {
		const root = template();
		const result = run(root, ...INIT);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(!existsSync(join(root, "screenshots", "theme-preview.png")));
		assert.ok(!existsSync(join(root, ".nnw-theme-uninitialized")));
		const plist = readFileSync(join(root, "Quiet Reader.nnwtheme", "Info.plist"), "utf8");
		assert.equal(
			plist,
			buildPlist(
				metadata({
					ThemeIdentifier: "io.github.theme-author.quiet-reader",
					Name: "Quiet Reader",
					CreatorHomePage: "https://github.com/theme-author",
				}),
			),
		);
		const readme = readFileSync(join(root, "README.md"), "utf8");
		assert.ok(
			readme.includes(
				"# Quiet Reader\n\nA NetNewsWire theme by [Theme Author](https://github.com/theme-author).",
			),
		);
		assert.ok(readme.includes("Kept documentation."));
		assert.match(result.stdout, /Initialized Quiet Reader\.nnwtheme with identifier/);
		assert.equal(run(root, ...INIT).status, 1, "a second init is refused");
	});

	test("without a terminal, missing answers are errors rather than prompts", () => {
		const root = template();
		const result = run(root, "init", "--name", "Quiet Reader");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /pass --creator/);
		const unconfirmed = run(root, ...INIT.slice(0, 11), ...INIT.slice(13));
		assert.match(unconfirmed.stderr, /pass --confirm-identifier/);
		assert.ok(existsSync(join(root, ".nnw-theme-uninitialized")));
	});
});

/** An initialized theme repository with a valid bundle. */
function theme(version = 1): string {
	const root = temporaryDirectory();
	writeFiles(root, {
		"Reader.nnwtheme/Info.plist": buildPlist({
			ThemeIdentifier: "org.test.reader",
			Name: "Reader",
			CreatorHomePage: "https://reader.test",
			CreatorName: "A. Reader",
			Version: version,
		}),
		"Reader.nnwtheme/template.html": '<div class="articleBody">[[body]]</div>',
		"Reader.nnwtheme/stylesheet.css": "body {}",
	});
	return root;
}

describe("bump and release-check", () => {
	test("bump increases Version, and needs --yes without a terminal", () => {
		const root = theme(4);
		assert.match(run(root, "bump").stderr, /pass --yes/);
		const result = run(root, "bump", "--yes");
		assert.equal(result.stdout, "Version is now 5. Commit this change before publishing.\n");
		assert.match(
			readFileSync(join(root, "Reader.nnwtheme", "Info.plist"), "utf8"),
			/<integer>5<\/integer>/,
		);
	});

	test("release-check compares identity and Version with the previous release", () => {
		const root = theme(1);
		const previous = join(root, "previous.nnwtheme.zip");
		writeFileSync(previous, archiveBytes(join(root, "Reader.nnwtheme")).content);
		assert.match(
			run(root, "release-check", "--previous-asset", previous).stderr,
			/Version must increase/,
		);
		run(root, "bump", "--yes");
		const result = run(root, "release-check", "--previous-asset", previous);
		assert.equal(result.status, 0, result.stderr);
		assert.equal(result.stdout, "Release identity is stable and Version increases 1 -> 2.\n");
		const plist = join(root, "Reader.nnwtheme", "Info.plist");
		writeFileSync(
			plist,
			readFileSync(plist, "utf8").replace("org.test.reader", "org.test.other"),
		);
		assert.match(
			run(root, "release-check", "--previous-asset", previous).stderr,
			/ThemeIdentifier cannot change/,
		);
	});
});

describe("small commands", () => {
	test("update is removed and says what replaced it", () => {
		const result = run(theme(), "update");
		assert.equal(result.status, 1);
		assert.match(result.stderr, /update was removed.*npx nnw-theme@1/s);
	});

	test("capture points at the bundled nnwdump and an absolute fixture path", () => {
		const root = theme();
		const result = run(root, "capture");
		assert.ok(
			result.stdout.includes(`command script import ${join(TOOL, "lldb", "nnwdump.py")}`),
		);
		assert.ok(result.stdout.includes(`nnwdump ${join(root, "fixtures", "my-article.toml")}`));
		assert.ok(existsSync(join(TOOL, "lldb", "nnwdump.py")));
	});

	test("guide prints each topic, the skill by default", () => {
		const root = theme();
		assert.match(run(root, "guide").stdout, /^# Create NetNewsWire themes/);
		for (const topic of ["theme-format", "fixtures", "design-checklist", "publishing"]) {
			const text = run(root, "guide", topic).stdout;
			assert.ok(text.length > 200, topic);
			assert.ok(!text.includes("uv run"), topic);
		}
		assert.equal(run(root, "guide", "nope").status, 2);
	});
});

describe("stubs", () => {
	test("the shipped stubs carry the current markers", () => {
		for (const stub of STUBS) {
			const text = readFileSync(join(TOOL, "assets", "stubs", stub.path), "utf8");
			assert.deepEqual(readMarker(text), { name: stub.name, version: stub.version }, stub.path);
		}
	});

	test("check warns about missing, unmarked, and old stubs, never about notes below", () => {
		const root = temporaryDirectory();
		for (const stub of STUBS) {
			writeFiles(root, {
				[stub.path]: readFileSync(join(TOOL, "assets", "stubs", stub.path), "utf8"),
			});
		}
		writeFileSync(
			join(root, "AGENTS.md"),
			`${readFileSync(join(root, "AGENTS.md"), "utf8")}\n## Our notes\n`,
		);
		assert.deepEqual(staleStubs(root), []);
		writeFileSync(join(root, "AGENTS.md"), "<!-- nnw-theme-stub: agents v0 -->\n");
		writeFileSync(join(root, ".github/workflows/check.yml"), "name: Theme checks\n");
		writeFileSync(join(root, ".github/workflows/pages.yml"), "# nnw-theme-stub: pages v2\n");
		const warnings = staleStubs(root);
		assert.equal(warnings.length, 2);
		assert.match(
			warnings[0] ?? "",
			/^AGENTS\.md is stub agents v0; v1 is current\. Replace it with https:/,
		);
		assert.match(warnings[1] ?? "", /check\.yml has no nnw-theme-stub marker/);
	});

	test("the skill's marker follows its front matter", () => {
		assert.deepEqual(readMarker("---\nname: x\n---\n<!-- nnw-theme-stub: skill v3 -->\n"), {
			name: "skill",
			version: 3,
		});
		assert.equal(readMarker("# Title\n<!-- nnw-theme-stub: agents v1 -->"), null);
	});
});

class Terminal {
	isTTY = true;
	text = "";
	write(value: string) {
		this.text += value;
	}
}

describe("check output", () => {
	const [first, second] = normalTargets();
	assert.ok(first && second);

	test("plain progress prints one line per case", () => {
		const stream = {
			text: "",
			write(value: string) {
				this.text += value;
			},
		};
		const progress = new CheckProgress(2, stream);
		progress.start(1, first);
		progress.finish(1, first, []);
		progress.start(2, second);
		progress.finish(2, second, ["horizontal document overflow"]);
		progress.done();
		assert.equal(
			stream.text,
			"[1/2] Article · Mac · light … passed\n" +
				"[2/2] Article · Mac · dark … FAILED: horizontal document overflow\n",
		);
	});

	test("terminal progress rewrites one line and keeps failures", () => {
		const stream = new Terminal();
		const progress = new CheckProgress(2, stream);
		progress.start(1, first);
		progress.finish(1, first, []);
		progress.start(2, second);
		progress.finish(2, second, ["page errors"]);
		progress.done();
		assert.ok(stream.text.includes("\r\x1b[KChecking 1/2 · Article · Mac · light"));
		assert.ok(stream.text.includes("\r\x1b[K✗ Article · Mac · dark: page errors\n"));
		assert.ok(stream.text.endsWith("\r\x1b[K"));
		assert.equal(stream.text.split("\n").length - 1, 1);
	});
});
