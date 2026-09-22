import assert from "node:assert/strict";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { zipSync } from "fflate";
import { archiveBytes } from "../src/package.ts";
import { buildPlist, type PlistDict, PlistReal } from "../src/plist.ts";
import { validateArchive, validateSource } from "../src/validate.ts";
import { readZip } from "../src/zip.ts";
import { temporaryDirectory, writeFiles } from "./helpers.ts";

function metadata(name = "Reader"): PlistDict {
	return {
		ThemeIdentifier: "org.example.reader",
		Name: name,
		CreatorHomePage: "https://author.example.org",
		CreatorName: "A. Reader",
		Version: 1,
	};
}

function makeTheme(parent: string, name = "Reader"): string {
	const theme = join(parent, `${name}.nnwtheme`);
	writeFiles(theme, {
		"Info.plist": buildPlist(metadata(name)),
		"template.html": '<main class="articleBody">[[body]]</main>',
		"stylesheet.css": "body { color: CanvasText; }",
	});
	return theme;
}

const encoder = new TextEncoder();

/** A ZIP written entry by entry, allowing what zipSync refuses: duplicates, odd modes. */
function rawZip(entries: { name: string; content: Uint8Array; mode?: number }[]): Uint8Array {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const { name, content, mode = 0o100644 } of entries) {
		const nameBytes = encoder.encode(name);
		const local = new Uint8Array(30 + nameBytes.length + content.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true);
		lv.setUint32(18, content.length, true);
		lv.setUint32(22, content.length, true);
		lv.setUint16(26, nameBytes.length, true);
		local.set(nameBytes, 30);
		local.set(content, 30 + nameBytes.length);
		const central = new Uint8Array(46 + nameBytes.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, (3 << 8) | 20, true);
		cv.setUint16(6, 20, true);
		cv.setUint32(20, content.length, true);
		cv.setUint32(24, content.length, true);
		cv.setUint16(28, nameBytes.length, true);
		cv.setUint32(38, (mode << 16) >>> 0, true);
		cv.setUint32(42, offset, true);
		central.set(nameBytes, 46);
		locals.push(local);
		centrals.push(central);
		offset += local.length;
	}
	const centralSize = centrals.reduce((sum, item) => sum + item.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, entries.length, true);
	ev.setUint16(10, entries.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	return Buffer.concat([...locals, ...centrals, end]);
}

describe("source validation", () => {
	test("a valid minimal theme", () => {
		assert.deepEqual(validateSource(makeTheme(temporaryDirectory())).errors, []);
	});

	test("rejects a wrong-case required file and an extra file", () => {
		const theme = makeTheme(temporaryDirectory());
		renameSync(join(theme, "Info.plist"), join(theme, "info.plist"));
		writeFileSync(join(theme, "image.png"), "image");
		const { errors } = validateSource(theme);
		assert.ok(errors.some((error) => error.includes("Info.plist")));
		assert.ok(errors.some((error) => error.includes("image.png")));
	});

	test("rejects a bad homepage and a name mismatch", () => {
		const theme = makeTheme(temporaryDirectory());
		const value = metadata("Different");
		value.CreatorHomePage = "javascript:alert(1)";
		writeFileSync(join(theme, "Info.plist"), buildPlist(value));
		const { errors } = validateSource(theme);
		assert.ok(
			errors.includes("Info.plist Name ('Different') must match bundle name ('Reader')"),
		);
		assert.ok(errors.some((error) => error.includes("HTTP(S)")));
	});

	test("a real Version is not an integer", () => {
		const theme = makeTheme(temporaryDirectory());
		writeFileSync(
			join(theme, "Info.plist"),
			buildPlist({ ...metadata(), Version: new PlistReal(1) }),
		);
		assert.ok(
			validateSource(theme).errors.includes("Info.plist: Version must be a non-empty int"),
		);
	});

	test("remote media needs an explicit override, but a script is always rejected", () => {
		const theme = makeTheme(temporaryDirectory());
		writeFileSync(
			join(theme, "template.html"),
			'<main class="articleBody">[[body]]<img src="https://img.example/a.png">' +
				'<script src="https://js.example/a.js"></script></main>',
		);
		const blocked = validateSource(theme);
		const allowed = validateSource(theme, { allowRemoteMedia: true });
		assert.ok(blocked.errors.length >= 2);
		assert.ok(allowed.errors.some((error) => error.includes("external script")));
		assert.ok(allowed.warnings.some((warning) => warning.includes("remote theme-owned")));
	});

	test("protocol-relative media is remote", () => {
		const theme = makeTheme(temporaryDirectory());
		writeFileSync(
			join(theme, "template.html"),
			'<main class="articleBody">[[body]]<img src="//img.example/a.png"></main>',
		);
		assert.ok(validateSource(theme).errors.some((error) => error.includes("remote")));
	});

	test("rejects a fake bundle-local resource", () => {
		const theme = makeTheme(temporaryDirectory());
		writeFileSync(join(theme, "stylesheet.css"), "body { background: url(background.png); }");
		assert.ok(validateSource(theme).errors.some((error) => error.includes("bundle-local")));
		writeFileSync(
			join(theme, "template.html"),
			'<main class="articleBody">[[body]]<img src="a.png"></main>',
		);
		assert.ok(
			validateSource(theme).errors.includes(
				"bundle-local resource references do not work in NetNewsWire: src='a.png'",
			),
		);
	});

	test("an uninitialized template cannot be packaged", () => {
		const parent = temporaryDirectory();
		const theme = makeTheme(parent);
		writeFileSync(join(parent, ".nnw-theme-uninitialized"), "");
		assert.ok(validateSource(theme).errors.some((error) => error.includes("init")));
	});
});

describe("archive validation", () => {
	test("the package is deterministic and valid", () => {
		const theme = makeTheme(temporaryDirectory());
		const first = archiveBytes(theme);
		const second = archiveBytes(theme);
		assert.deepEqual(first.content, second.content);
		assert.deepEqual(first.warnings, []);
		assert.deepEqual(validateArchive(first.content, "Reader.nnwtheme.zip").errors, []);
	});

	test("entries are sorted with fixed timestamps and mode 0644", () => {
		const { content } = archiveBytes(makeTheme(temporaryDirectory()));
		const entries = readZip(content);
		assert.deepEqual(
			entries.map((entry) => entry.name),
			[
				"Reader.nnwtheme/Info.plist",
				"Reader.nnwtheme/stylesheet.css",
				"Reader.nnwtheme/template.html",
			],
		);
		assert.ok(entries.every((entry) => entry.mode === 0o100644));
		// DOS date 1980-01-01 00:00 is date 0x0021, time 0.
		const view = new DataView(content.buffer, content.byteOffset);
		assert.equal(view.getUint16(10, true), 0);
		assert.equal(view.getUint16(12, true), 0x21);
	});

	test("rejects traversal", () => {
		const content = zipSync({ "Reader.nnwtheme/../Info.plist": encoder.encode("bad") });
		const { errors } = validateArchive(content, "Reader.nnwtheme.zip");
		assert.ok(errors.some((error) => error.includes("unsafe path")));
	});

	test("rejects a symbolic link", () => {
		const content = rawZip([
			{
				name: "Reader.nnwtheme/Info.plist",
				content: encoder.encode("elsewhere"),
				mode: 0o120777,
			},
		]);
		const { errors } = validateArchive(content, "Reader.nnwtheme.zip");
		assert.ok(errors.some((error) => error.includes("symbolic link")));
	});

	test("rejects duplicate archive paths", () => {
		const plist = encoder.encode(buildPlist(metadata()));
		const content = rawZip([
			{ name: "Reader.nnwtheme/Info.plist", content: plist },
			{ name: "Reader.nnwtheme/Info.plist", content: plist },
		]);
		const { errors } = validateArchive(content, "Reader.nnwtheme.zip");
		assert.ok(errors.some((error) => error.includes("duplicate paths")));
	});

	test("rejects something that is not a ZIP", () => {
		const { errors } = validateArchive(encoder.encode("not a zip"), "Reader.nnwtheme.zip");
		assert.ok(errors.some((error) => error.startsWith("invalid theme archive")));
	});
});
