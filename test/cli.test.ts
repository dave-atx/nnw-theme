import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMANDS } from "../src/commands.ts";
import { commandHelp, mainHelp } from "../src/main.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");

function run(...args: string[]) {
	return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
}

describe("help", () => {
	test("release-check and update are hidden but still parse", () => {
		assert.ok(!mainHelp().includes("release-check"));
		assert.ok(!mainHelp().includes("update"));
		const result = run("release-check");
		assert.equal(result.status, 2);
		assert.match(result.stderr, /required: --previous-asset/);
	});

	test("every visible command has help", () => {
		for (const command of COMMANDS) {
			assert.ok(
				commandHelp(command, [command.name]).startsWith(`usage: nnw-theme ${command.name}`),
			);
		}
	});

	test("usage errors exit 2, like argparse", () => {
		const result = run("package", "--bogus");
		assert.equal(result.status, 2);
		assert.match(result.stderr, /unrecognized arguments: --bogus/);
		assert.equal(run("screenshot", "--platform", "windows").status, 2);
		assert.equal(run("nonsense").status, 2);
	});

	test("--version prints the package version", () => {
		const result = run("--version");
		assert.equal(result.status, 0);
		assert.match(result.stdout, /^\d+\.\d+\.\d+/);
	});

	test("a theme error exits 1 with its message", () => {
		const result = spawnSync(process.execPath, [CLI, "render"], { encoding: "utf8", cwd: "/" });
		assert.equal(result.status, 1);
		assert.equal(result.stderr, "error: run this command inside the theme repository\n");
	});
});
