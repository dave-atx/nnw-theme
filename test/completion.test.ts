import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { bash, fish, zsh } from "../src/completion.ts";
import { temporaryDirectory, writeFiles } from "./helpers.ts";

function has(shell: string): boolean {
	return spawnSync(shell, ["-c", "exit 0"]).status === 0;
}

/** A theme repository with one extra fixture, and a directory inside it. */
function repository(): string {
	const root = temporaryDirectory();
	writeFiles(root, { "Reader.nnwtheme/Info.plist": "", "fixtures/zebra-notes.toml": "" });
	mkdirSync(join(root, "fixtures", "nested"));
	return join(root, "fixtures", "nested");
}

function shell(command: string, args: string[], script: string, cwd: string, path?: string) {
	const file = join(temporaryDirectory(), "completion");
	writeFileSync(file, script);
	const env = { ...process.env, PATH: path ?? process.env.PATH ?? "" };
	const result = spawnSync(
		command,
		[...args, "-c", `source ${file}\n${command === "fish" ? "" : ""}`],
		{
			cwd,
			env,
		},
	);
	assert.equal(result.status, 0, String(result.stderr));
	return (body: string) => {
		const run = spawnSync(command, [...args, "-c", body.replaceAll("$SCRIPT", file)], {
			cwd,
			encoding: "utf8",
			env,
		});
		assert.equal(run.status, 0, run.stderr);
		return run.stdout;
	};
}

function lines(output: string): string[] {
	return output
		.trim()
		.split("\n")
		.map((line) => line.split("\t")[0] ?? "")
		.filter(Boolean);
}

/** A directory whose nnw-theme is a real executable, as after npm link. */
function installed(): string {
	const bin = temporaryDirectory();
	writeFileSync(join(bin, "nnw-theme"), "#!/bin/sh\n");
	chmodSync(join(bin, "nnw-theme"), 0o755);
	return `${bin}:${process.env.PATH}`;
}

describe("fish", { skip: !has("fish") && "fish is not installed" }, () => {
	const cwd = repository();
	const run = shell("fish", ["--no-config"], fish(), cwd);
	const complete = (line: string) => lines(run(`source $SCRIPT; complete -C '${line}'`));

	test("completes commands, options, choices, and fixtures", () => {
		assert.ok(complete("nnw-theme ").includes("screenshot"));
		assert.ok(!complete("nnw-theme ").includes("release-check"));
		assert.deepEqual(complete("nnw-theme screenshot --platform ").sort(), [
			"ipad",
			"iphone",
			"mac",
		]);
		assert.ok(complete("nnw-theme check --").includes("--no-open"));
		assert.deepEqual(complete("nnw-theme render "), ["article", "kitchen-sink", "zebra-notes"]);
		assert.deepEqual(complete("nnw-theme marketplace "), ["enable"]);
		assert.ok(complete("nnw-theme guide ").includes("theme-format"));
	});

	test("defines the npx wrapper only when nnw-theme is not installed", () => {
		assert.equal(
			run("source $SCRIPT; functions -q nnw-theme; and echo function"),
			"function\n",
		);
		const withReal = shell("fish", ["--no-config"], fish(), cwd, installed());
		assert.equal(withReal("source $SCRIPT; functions -q nnw-theme; or echo none"), "none\n");
	});
});

describe("bash", { skip: !has("bash") && "bash is not installed" }, () => {
	const cwd = repository();
	const run = shell("bash", ["--norc", "--noprofile"], bash(), cwd);
	const complete = (...words: string[]) =>
		run(
			`source $SCRIPT; COMP_WORDS=(${words.map((word) => `'${word}'`).join(" ")}); ` +
				`COMP_CWORD=${words.length - 1}; _nnw_theme; printf '%s\\n' "\${COMPREPLY[@]}"`,
		)
			.split("\n")
			.filter(Boolean);

	test("completes commands, options, choices, and fixtures", () => {
		assert.ok(complete("nnw-theme", "sc").includes("screenshot"));
		assert.deepEqual(complete("nnw-theme", "screenshot", "--appearance", ""), [
			"light",
			"dark",
		]);
		assert.deepEqual(complete("nnw-theme", "screenshot", "--fixture", "z"), ["zebra-notes"]);
		assert.deepEqual(complete("nnw-theme", "render", ""), [
			"article",
			"kitchen-sink",
			"zebra-notes",
		]);
		assert.ok(complete("nnw-theme", "init", "--").includes("--no-install-browser"));
		assert.deepEqual(complete("nnw-theme", "completion", ""), ["fish", "zsh", "bash"]);
		assert.equal(
			run("source $SCRIPT; complete -p nnw-theme"),
			"complete -F _nnw_theme nnw-theme\n",
		);
	});

	test("defines the npx wrapper only when nnw-theme is not installed", () => {
		assert.equal(run("source $SCRIPT; type -t nnw-theme"), "function\n");
		const withReal = shell("bash", ["--norc", "--noprofile"], bash(), cwd, installed());
		assert.equal(withReal("source $SCRIPT; type -t nnw-theme"), "file\n");
	});
});

describe("zsh", { skip: !has("zsh") && "zsh is not installed" }, () => {
	const cwd = repository();
	const run = shell("zsh", ["-f"], zsh(), cwd);
	const load = "autoload -Uz compinit && compinit -u -D; source $SCRIPT;";

	test("registers the completion function and lists fixtures", () => {
		assert.equal(run(`${load} print $_comps[nnw-theme]`), "_nnw_theme\n");
		const fixtures = run(
			`${load} compadd() { print -l -- "\${@[2,-1]}" }; _nnw_theme_fixtures`,
		);
		assert.deepEqual(fixtures.trim().split("\n"), ["article", "kitchen-sink", "zebra-notes"]);
	});

	test("dispatches commands to _describe and a command's options to _arguments", () => {
		const stubs = `${load} _describe() { print -l -- "\${(@P)4}" }; _arguments() { print -l -- "$@" };`;
		const commands = run(`${stubs} words=(nnw-theme ''); CURRENT=2; _nnw_theme`);
		assert.ok(commands.includes("screenshot:check one case in WebKit and save its image"));
		const options = run(`${stubs} words=(nnw-theme screenshot ''); CURRENT=3; _nnw_theme`);
		assert.ok(
			options.includes("--platform[--platform]:platform:(mac iphone ipad)") ||
				options.includes("--platform"),
		);
		assert.ok(options.includes("--fixture[fixture name]:fixture:_nnw_theme_fixtures"));
	});

	test("defines the npx wrapper only when nnw-theme is not installed", () => {
		assert.equal(run(`${load} whence -w nnw-theme`), "nnw-theme: function\n");
		const withReal = shell("zsh", ["-f"], zsh(), cwd, installed());
		assert.equal(withReal(`${load} whence -w nnw-theme`), "nnw-theme: command\n");
	});
});
