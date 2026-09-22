// Parity harness: runs the Python tool (netnewswire-theme-template v1.0.3) and this
// port on the same inputs and diffs what they produce. See scripts/parity/README.md.
//
//   node scripts/parity/run.ts [--template DIR] [--ember DIR] [--check] [--only NAME]
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readZip } from "../../src/zip.ts";
import { pixelDifference } from "./png.ts";

const TOOL = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK = join(TOOL, ".cache", "parity");
const TEMPLATE_URL = "https://github.com/dave-atx/netnewswire-theme-template.git";
const TEMPLATE_TAG = "v1.0.3";
const EMBER_URL = "https://github.com/dave-atx/ember-nnw-theme.git";
// What the template's CI installs; it runs the same WebKit build as the pinned
// playwright-core, so screenshots are comparable.
const PLAYWRIGHT_CLI = "@playwright/cli@0.1.20";
// The CI's fixed answers for initializing the untouched template.
const INIT_ARGS = [
	"init",
	"--name",
	"Neutral Reader",
	"--creator",
	"Template Maintainer",
	"--homepage",
	"https://github.com/dave-atx/netnewswire-theme-template",
	"--identifier",
	"io.github.dave-atx.neutral-reader",
	"--confirm-identifier",
	"io.github.dave-atx.neutral-reader",
	"--marketplace",
	"no",
	"--no-install-browser",
];
// Text the port changes on purpose. Applied to the Python side before comparing.
const INTENDED: [RegExp, string][] = [
	[/uv run nnw-theme/g, "npx nnw-theme@1"],
	[/^NetNewsWire .* rendering inputs are (ready|already verified)\.\n/gm, ""],
];

// Output only the port has on purpose. Removed from the port's side before comparing.
const PORT_ONLY: RegExp[] = [
	/^nnw-theme \d\S*\n/gm,
	/^warning: \S+ (is missing; add the current stub|has no nnw-theme-stub marker|is stub ).*\n/gm,
];

const { values } = parseArgs({
	options: {
		template: { type: "string" },
		ember: { type: "string" },
		check: { type: "boolean", default: false },
		only: { type: "string" },
	},
});

interface Run {
	status: number;
	stdout: string;
	stderr: string;
	seconds: number;
}

function run(
	command: string,
	args: string[],
	cwd: string,
	allowFailure = false,
	env: NodeJS.ProcessEnv = {},
): Run {
	const started = performance.now();
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		env: { ...process.env, NO_COLOR: "1", ...env },
	});
	const outcome = {
		status: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		seconds: (performance.now() - started) / 1000,
	};
	if (outcome.status !== 0 && !allowFailure) {
		throw new Error(`${command} ${args.join(" ")} failed in ${cwd}:\n${outcome.stderr}`);
	}
	return outcome;
}

function checkout(url: string, ref: string | undefined, destination: string): string {
	if (!existsSync(destination)) {
		const branch = ref ? ["--branch", ref] : [];
		run("git", ["clone", "--quiet", "--depth", "1", ...branch, url, destination], TOOL);
	}
	return destination;
}

/** A clean copy of a checkout's committed files. */
function exportTree(source: string, destination: string): void {
	rmSync(destination, { recursive: true, force: true });
	mkdirSync(destination, { recursive: true });
	const archive = spawnSync("git", ["-C", source, "archive", "HEAD"], { maxBuffer: 1 << 28 });
	if (archive.status !== 0) throw new Error(`git archive failed in ${source}`);
	const extract = spawnSync("tar", ["-x", "-C", destination], { input: archive.stdout });
	if (extract.status !== 0) throw new Error(`could not extract ${source}`);
}

/** The Python tool's playwright-cli, installed once into the work directory. */
function playwrightCliPath(): string {
	const prefix = join(WORK, "playwright-cli");
	if (!existsSync(join(prefix, "node_modules", ".bin", "playwright-cli"))) {
		run("npm", ["install", "--silent", "--prefix", prefix, PLAYWRIGHT_CLI], TOOL);
	}
	return `${join(prefix, "node_modules", ".bin")}:${process.env.PATH}`;
}

function python(template: string, args: string[], cwd: string, allowFailure = false): Run {
	const browser = args[0] === "check" || args[0] === "screenshot";
	const env = browser ? { PATH: playwrightCliPath() } : {};
	const command = ["run", "--quiet", "--project", template, "nnw-theme", ...args];
	return run("uv", command, cwd, allowFailure, env);
}

function node(args: string[], cwd: string, allowFailure = false): Run {
	return run(process.execPath, [join(TOOL, "src", "cli.ts"), ...args], cwd, allowFailure);
}

function intended(text: string): string {
	return INTENDED.reduce(
		(value, [pattern, replacement]) => value.replace(pattern, replacement),
		text,
	);
}

function files(root: string, directory = root): string[] {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory() ? files(root, path) : [relative(root, path)];
	});
}

function sha256(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

interface Input {
	name: string;
	/** Both copies, prepared and ready to run. */
	py: string;
	node: string;
}

/** Initialize an untouched template copy with each tool and compare the results. */
function compareInit(template: string, differences: Differences): void {
	const base = join(WORK, "init");
	const copies = { py: join(base, "py"), node: join(base, "node") };
	for (const copy of Object.values(copies)) exportTree(template, copy);
	const py = python(template, INIT_ARGS, copies.py, true);
	const port = node(INIT_ARGS, copies.node, true);
	if (py.status !== port.status) differences.add(`init: exit ${py.status} vs ${port.status}`);
	differences.compareText("init stdout", py.stdout, port.stdout);
	differences.compareText("init stderr", py.stderr, port.stderr);
	const tracked = (root: string) => files(root).filter((path) => !path.startsWith(".cache/"));
	const left = tracked(copies.py).sort();
	const right = tracked(copies.node).sort();
	differences.compareText("init: files", left.join("\n"), right.join("\n"));
	for (const path of left.filter((item) => right.includes(item))) {
		const read = (root: string) =>
			lstatSync(join(root, path)).isSymbolicLink()
				? `-> ${readlinkSync(join(root, path))}`
				: readFileSync(join(root, path), "latin1");
		// Byte for byte: the files are the repository's, not the tools' messages.
		if (read(copies.py) !== read(copies.node)) differences.add(`init: ${path} differs`);
	}
	console.log(`init: compared ${left.length} files`);
}

function prepareStarter(template: string): Input {
	const base = join(WORK, "starter");
	const py = join(base, "py");
	exportTree(template, py);
	python(template, INIT_ARGS, py);
	const nodeCopy = join(base, "node");
	rmSync(nodeCopy, { recursive: true, force: true });
	cpSync(py, nodeCopy, { recursive: true });
	return { name: "starter", py, node: nodeCopy };
}

function prepareEmber(template: string, ember: string): Input {
	const base = join(WORK, "ember");
	const nodeCopy = join(base, "node");
	exportTree(ember, nodeCopy);
	// Ember keeps fixtures in test/; the new layout puts them in fixtures/.
	mkdirSync(join(nodeCopy, "fixtures"), { recursive: true });
	for (const name of readdirSync(join(nodeCopy, "test"))) {
		if (name.endsWith(".toml"))
			renameSync(join(nodeCopy, "test", name), join(nodeCopy, "fixtures", name));
	}
	const py = join(base, "py");
	rmSync(py, { recursive: true, force: true });
	cpSync(nodeCopy, py, { recursive: true });
	// The Python tool needs its project file to find the root and the NetNewsWire pin,
	// and the template's fixtures, which the port ships built in.
	cpSync(join(template, "pyproject.toml"), join(py, "pyproject.toml"));
	for (const name of ["article.toml", "kitchen-sink.toml"]) {
		cpSync(join(template, "fixtures", name), join(py, "fixtures", name));
	}
	return { name: "ember", py, node: nodeCopy };
}

/**
 * The starter plus a fixture that fails the browser checks, to compare failures.
 * External requests are covered by test/browser.test.ts: under the preview CSP only a
 * navigation leaves the page, and the Python tool times out on one.
 */
function prepareFailing(starter: Input): Input {
	const base = join(WORK, "failing");
	const copies = { py: join(base, "py"), node: join(base, "node") };
	const fixture = [
		'title = "Failing on purpose"',
		'feed_link_title = "Parity"',
		"body = '''",
		"<p>This fixture trips every browser check the tools share, on purpose.</p>",
		"<p>An unresolved [[macro_name]] stays literal.</p>",
		'<div style="width: 4000px">Too wide for any viewport.</div>',
		'<img src="data:image/png;base64,AAAA" alt="broken">',
		'<script>throw new Error("boom from the fixture")</script>',
		"'''",
		"",
	].join("\n");
	for (const [side, destination] of Object.entries(copies)) {
		rmSync(destination, { recursive: true, force: true });
		cpSync(side === "py" ? starter.py : starter.node, destination, { recursive: true });
		writeFileSync(join(destination, "fixtures", "failing.toml"), fixture);
	}
	return { name: "failing", ...copies };
}

/** The starter with one of each validation problem, to compare error messages. */
function prepareBroken(starter: Input): Input {
	const base = join(WORK, "broken");
	const copies = { py: join(base, "py"), node: join(base, "node") };
	for (const [side, destination] of Object.entries(copies)) {
		rmSync(destination, { recursive: true, force: true });
		cpSync(side === "py" ? starter.py : starter.node, destination, { recursive: true });
		const theme = join(destination, "Neutral Reader.nnwtheme");
		const edit = (name: string, change: (text: string) => string) =>
			writeFileSync(join(theme, name), change(readFileSync(join(theme, name), "utf8")));
		edit("Info.plist", (text) =>
			text
				.replace("<string>Neutral Reader</string>", "<string>Other 'Reader'</string>")
				.replace("https://github.com/dave-atx/netnewswire-theme-template", "ftp://example.com"),
		);
		edit(
			"template.html",
			(text) =>
				`${text}<img src="https://img.test/a.png"><img src="local.png">` +
				'<video poster="//cdn.test/p.jpg"></video><script src="https://js.test/a.js"></script>' +
				'<link rel="stylesheet" href="x.css"><style>@import url(x.css);</style>',
		);
		edit(
			"stylesheet.css",
			(text) =>
				`${text}\nbody { background: url("https://img.test/b.png"), url(local.png); }\n@import "y.css";\n`,
		);
		writeFileSync(join(theme, "notes.txt"), "extra");
		writeFileSync(join(theme, "NOTICE.md"), "allowed");
	}
	return { name: "broken", ...copies };
}

class Differences {
	readonly items: string[] = [];
	add(message: string): void {
		this.items.push(message);
	}
	compareText(label: string, python: string, output: string): void {
		const expected = intended(python);
		const port = PORT_ONLY.reduce((text, pattern) => text.replace(pattern, ""), output);
		if (expected === port) return;
		const a = expected.split("\n");
		const b = port.split("\n");
		const line = a.findIndex((text, index) => text !== b[index]);
		this.add(
			`${label}: first difference at line ${line + 1}\n    python: ${JSON.stringify(a[line])}\n    port:   ${JSON.stringify(b[line])}`,
		);
	}
}

function compareOutputs(
	input: Input,
	command: string[],
	differences: Differences,
	template: string,
) {
	const py = python(template, command, input.py, true);
	const port = node(command, input.node, true);
	const label = `${input.name}: ${command.join(" ")}`;
	if (py.status !== port.status)
		differences.add(`${label}: exit ${py.status} vs ${port.status}`);
	differences.compareText(
		`${label} stderr`,
		py.stderr.replaceAll(input.py, input.node),
		port.stderr,
	);
	return { py, port };
}

function compareTrees(
	label: string,
	python: string,
	port: string,
	differences: Differences,
	screenshots: string[] = [],
) {
	const left = files(python).sort();
	const right = files(port).sort();
	for (const path of left.filter((item) => !right.includes(item)))
		differences.add(`${label}: only python has ${path}`);
	for (const path of right.filter((item) => !left.includes(item)))
		differences.add(`${label}: only the port has ${path}`);
	for (const path of left.filter((item) => right.includes(item))) {
		const a = readFileSync(join(python, path));
		const b = readFileSync(join(port, path));
		if (path.endsWith(".png")) {
			const difference = pixelDifference(a, b);
			if (difference) screenshots.push(`${path}: ${difference}`);
		} else differences.compareText(`${label}: ${path}`, a.toString("utf8"), b.toString("utf8"));
	}
	return left.length;
}

/**
 * The Python check reuses one page for every case, so a case can inherit state from
 * the one before it. Re-shoot each mismatched case alone with the Python tool's
 * screenshot command, which starts from a fresh page, and compare again.
 */
function recheckScreenshots(
	input: Input,
	mismatches: string[],
	differences: Differences,
	template: string,
	notes: string[],
) {
	const copy = join(WORK, input.name, "py-recheck");
	rmSync(copy, { recursive: true, force: true });
	cpSync(input.py, copy, { recursive: true });
	for (const mismatch of mismatches) {
		const path = mismatch.slice(0, mismatch.indexOf(":"));
		const slug = path.replace(/^screenshots\//, "").replace(/\.png$/, "");
		const match = /^(.+)-(mac|iphone|ipad)-(light|dark)$/.exec(slug);
		if (!match) {
			differences.add(`${input.name} check: ${mismatch}`);
			continue;
		}
		const [, fixture = "", platform = "", appearance = ""] = match;
		const args = [
			"screenshot",
			"--fixture",
			fixture,
			"--platform",
			platform,
			"--appearance",
			appearance,
		];
		python(template, args, copy, true);
		const isolated = readFileSync(join(copy, "build", "preview", path));
		const difference = pixelDifference(
			isolated,
			readFileSync(join(input.node, "build", "preview", path)),
		);
		if (difference) differences.add(`${input.name} check: ${mismatch}; alone: ${difference}`);
		else
			notes.push(`${input.name}: ${mismatch} in the Python check, identical when shot alone`);
	}
}

function zipSummary(path: string): string[] {
	return readZip(readFileSync(path)).map(
		(entry) => `${entry.name} mode=${entry.mode.toString(8)} sha256=${sha256(entry.read())}`,
	);
}

function compareZip(input: Input, differences: Differences): void {
	const name = readdirSync(input.py).find((item) => item.endsWith(".nnwtheme"));
	const py = join(input.py, "dist", `${name}.zip`);
	const port = join(input.node, "dist", `${name}.zip`);
	if (!existsSync(py) || !existsSync(port)) {
		differences.add(`${input.name}: package did not produce ${name}.zip in both`);
		return;
	}
	differences.compareText(
		`${input.name}: ZIP entries`,
		zipSummary(py).join("\n"),
		zipSummary(port).join("\n"),
	);
	// Timestamps: every local header's DOS time and date must be 1980-01-01 00:00.
	for (const path of [py, port]) {
		const content = readFileSync(path);
		for (
			let offset = content.indexOf("PK\x03\x04");
			offset >= 0;
			offset = content.indexOf("PK\x03\x04", offset + 4)
		) {
			if (
				content.readUInt16LE(offset + 10) !== 0 ||
				content.readUInt16LE(offset + 12) !== 0x21
			) {
				differences.add(
					`${input.name}: ${relative(WORK, path)} has an entry not dated 1980-01-01`,
				);
				break;
			}
		}
	}
}

function main(): number {
	mkdirSync(WORK, { recursive: true });
	const template =
		values.template ?? checkout(TEMPLATE_URL, TEMPLATE_TAG, join(WORK, "template"));
	const ember = values.ember ?? checkout(EMBER_URL, undefined, join(WORK, "ember-source"));
	const inputs: Input[] = [];
	const wanted = (name: string) => !values.only || values.only === name;
	if (wanted("starter") || wanted("broken") || wanted("failing")) {
		const starter = prepareStarter(template);
		if (wanted("starter")) inputs.push(starter);
		if (wanted("broken")) inputs.push(prepareBroken(starter));
		if (wanted("failing") && values.check) inputs.push(prepareFailing(starter));
	}
	if (wanted("ember")) inputs.push(prepareEmber(template, ember));
	const differences = new Differences();
	if (wanted("init")) compareInit(template, differences);
	const timings: string[] = [];
	const notes: string[] = [];
	for (const input of inputs) {
		compareOutputs(input, ["render"], differences, template);
		const pages = compareTrees(
			`${input.name} render`,
			join(input.py, "build", "preview"),
			join(input.node, "build", "preview"),
			differences,
		);
		console.log(`${input.name}: compared ${pages} rendered files`);
		compareOutputs(input, ["package"], differences, template);
		if (input.name === "broken") {
			compareOutputs(input, ["package", "--allow-remote-media"], differences, template);
			continue;
		}
		compareZip(input, differences);
		if (values.check) {
			const { py, port } = compareOutputs(input, ["check", "--no-open"], differences, template);
			timings.push(
				`${input.name}: check took ${py.seconds.toFixed(1)} s in Python, ${port.seconds.toFixed(1)} s in the port`,
			);
			differences.compareText(
				`${input.name}: check-report.txt`,
				readFileSync(join(input.py, "build", "check-report.txt"), "utf8"),
				readFileSync(join(input.node, "build", "check-report.txt"), "utf8"),
			);
			const mismatches: string[] = [];
			compareTrees(
				`${input.name} check`,
				join(input.py, "build", "preview"),
				join(input.node, "build", "preview"),
				differences,
				mismatches,
			);
			recheckScreenshots(input, mismatches, differences, template, notes);
		}
	}
	for (const line of [...timings, ...notes]) console.log(line);
	if (!differences.items.length) {
		const names = [...(wanted("init") ? ["init"] : []), ...inputs.map((input) => input.name)];
		console.log(`No differences across ${names.join(", ")}.`);
		return 0;
	}
	console.log(`${differences.items.length} difference(s):`);
	for (const item of differences.items) console.log(`- ${item}`);
	return 1;
}

process.exitCode = main();
