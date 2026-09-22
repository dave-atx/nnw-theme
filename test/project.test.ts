import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { parse } from "smol-toml";
import {
	findRoot,
	findTheme,
	fixturePath,
	footnoteExpectations,
	packagePath,
	ThemeError,
} from "../src/project.ts";
import { temporaryDirectory } from "./helpers.ts";

const expectations = (text: string) => footnoteExpectations(parse(text), "fixtures/f.toml");

describe("footnote expectations", () => {
	test("a fixture without expectations expects nothing", () => {
		assert.deepEqual(expectations('title = "T"'), {});
	});

	test("notes map markers to text and plain links are selectors", () => {
		const expected = expectations(
			'body = "<p>x</p>"\n[expect.footnotes]\nplain_links = ["#ordinary"]\n' +
				'keep_with_word = true\n[expect.footnotes.notes]\n"a" = "Second."\n"1" = "First."\n',
		);
		assert.deepEqual(expected.notes, { a: "Second.", 1: "First." });
		assert.deepEqual(expected.plain_links, ["#ordinary"]);
		assert.equal(expected.keep_with_word, true);
	});

	test("typos and wrong types are errors", () => {
		for (const [text, message] of [
			["[expect.footnote]\nnotes = {}", /only a \[expect.footnotes\]/],
			["expect = 1", /only a \[expect.footnotes\]/],
			["[expect.footnotes]\nnote = {}", /unknown .*note/],
			['[expect.footnotes]\nnotes = {"1" = 1}', /map markers to text/],
			['[expect.footnotes]\nplain_links = "#a"', /CSS selectors/],
			['[expect.footnotes]\nkeep_with_word = "yes"', /true or false/],
		] as const) {
			assert.throws(
				() => expectations(text),
				(error: Error) => error instanceof ThemeError && message.test(error.message),
				text,
			);
		}
	});
});

describe("repository discovery", () => {
	test("the root is the nearest directory with a theme bundle", () => {
		const root = temporaryDirectory();
		mkdirSync(join(root, "Reader.nnwtheme"));
		mkdirSync(join(root, "fixtures", "deeper"), { recursive: true });
		assert.equal(findRoot(join(root, "fixtures", "deeper")), root);
		assert.equal(findTheme(root), join(root, "Reader.nnwtheme"));
	});

	test("two bundles are an error that names them", () => {
		const root = temporaryDirectory();
		mkdirSync(join(root, "A.nnwtheme"));
		mkdirSync(join(root, "B.nnwtheme"));
		assert.throws(() => findTheme(root), /found A\.nnwtheme, B\.nnwtheme/);
	});

	test("outside a theme repository", () => {
		assert.throws(() => findRoot(temporaryDirectory()), /inside the theme repository/);
	});

	test("built-in fixtures resolve to the package, others must exist", () => {
		const root = temporaryDirectory();
		assert.equal(
			fixturePath(root, "article"),
			packagePath("assets", "fixtures", "article.toml"),
		);
		assert.throws(() => fixturePath(root, "missing"), /fixture not found/);
	});
});
