import assert from "node:assert/strict";
import { test } from "node:test";
import { formatG, pyRepr, pyReprList, pyStr } from "../src/pyformat.ts";

test("repr quotes like Python", () => {
	assert.equal(pyRepr("plain"), "'plain'");
	assert.equal(pyRepr("it's"), `"it's"`);
	assert.equal(pyRepr(`it's "x"`), `'it\\'s "x"'`);
	assert.equal(pyRepr("a\\b\n\t\x07"), "'a\\\\b\\n\\t\\x07'");
	assert.equal(pyRepr(" é"), "'\\u2028é'");
	assert.equal(pyReprList(["a", "b"]), "['a', 'b']");
	assert.equal(pyReprList([]), "[]");
});

test("str and format g like Python", () => {
	assert.equal(pyStr(true), "True");
	assert.equal(pyStr("x"), "x");
	assert.equal(formatG(17), "17");
	assert.equal(formatG(23.0), "23");
	assert.equal(formatG(16.5), "16.5");
	assert.equal(formatG(100000), "100000");
	assert.equal(formatG(1234567), "1.23457e+06");
	assert.equal(formatG(0.0001), "0.0001");
	assert.equal(formatG(0.00001), "1e-05");
});
