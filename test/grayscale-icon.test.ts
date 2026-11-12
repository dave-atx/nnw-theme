import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { grayscaleIcon, imageSize } from "../src/grayscale-icon.ts";

function hex(text: string): Buffer {
	return Buffer.from(text.replaceAll(/\s/g, ""), "hex");
}

// Just the headers each reader needs, with distinct widths and heights.
const PNG = hex("89504e470d0a1a0a 0000000d 49484452 00000030 00000020 0806000000");
const GIF = hex("474946383961 3000 2000 000000");
const JPEG = hex("ffd8 ffe0 0004 0000 ffc0 0011 08 0020 0030 03");
const WEBP_LOSSY = Buffer.concat([
	Buffer.from("RIFF\0\0\0\0WEBPVP8 \0\0\0\0"),
	hex("000000 9d012a 3000 2000"),
]);
const WEBP_LOSSLESS = Buffer.concat([
	Buffer.from("RIFF\0\0\0\0WEBPVP8L\0\0\0\0"),
	hex("2f"),
	// 14 bits of width - 1 (47), then 14 bits of height - 1 (31).
	Buffer.from([47 & 0xff, ((47 >> 8) & 0x3f) | ((31 & 0x3) << 6), (31 >> 2) & 0xff, 0, 0]),
	Buffer.alloc(4),
]);
const WEBP_EXTENDED = Buffer.concat([
	Buffer.from("RIFF\0\0\0\0WEBPVP8X\0\0\0\0"),
	hex("00000000 2f0000 1f0000"),
	Buffer.alloc(2),
]);

function dataURI(type: string, bytes: Buffer): string {
	return `data:${type};base64,${bytes.toString("base64")}`;
}

function unwrap(uri: string): string {
	assert.ok(uri.startsWith("data:image/svg+xml;base64,"));
	return Buffer.from(uri.slice("data:image/svg+xml;base64,".length), "base64").toString("utf8");
}

describe("image sizes", () => {
	const expected = { width: 48, height: 32 };
	for (const [name, type, bytes] of [
		["PNG", "image/png", PNG],
		["GIF", "image/gif", GIF],
		["JPEG", "image/jpeg", JPEG],
		["lossy WebP", "image/webp", WEBP_LOSSY],
		["lossless WebP", "image/webp", WEBP_LOSSLESS],
		["extended WebP", "image/webp", WEBP_EXTENDED],
	] as const) {
		test(name, () => {
			assert.deepEqual(imageSize(type, bytes), expected);
		});
	}

	test("SVG from width and height, or from its viewBox", () => {
		const svg = (attributes: string) =>
			imageSize("image/svg+xml", Buffer.from(`<svg xmlns="x" ${attributes}></svg>`));
		assert.deepEqual(svg('width="48px" height="32"'), expected);
		assert.deepEqual(svg("viewBox='0 0 48 32'"), expected);
		assert.deepEqual(svg('width="96" viewBox="0 0 48 32"'), { width: 96, height: 64 });
		assert.equal(svg('width="100%" height="100%"'), undefined);
	});

	test("an unreadable or unknown image has no size", () => {
		assert.equal(imageSize("image/png", Buffer.from("not a png")), undefined);
		assert.equal(imageSize("image/avif", PNG), undefined);
	});
});

describe("grayscale icons", () => {
	test("wraps the icon at its own size in a Rec. 709 luma filter over sRGB", () => {
		const src = dataURI("image/png", PNG);
		const svg = unwrap(grayscaleIcon(src));
		assert.ok(svg.includes('width="48" height="32" viewBox="0 0 48 32"'));
		assert.ok(svg.includes('color-interpolation-filters="sRGB"'));
		assert.ok(svg.includes("0.2126 0.7152 0.0722 0 0 ".repeat(3)));
		assert.ok(svg.includes(`href="${src}"`));
	});

	test("escapes a URL-encoded SVG icon inside the attribute", () => {
		const src = `data:image/svg+xml,${encodeURIComponent('<svg width="4" height="4"/>')}`;
		const svg = unwrap(grayscaleIcon(src));
		assert.ok(svg.includes('width="4" height="4"'));
		assert.ok(svg.includes(`href="${src}"`), "percent-encoding leaves nothing to escape");
		const raw = 'data:image/svg+xml,<svg width="4" height="4"/>';
		assert.ok(
			unwrap(grayscaleIcon(raw)).includes('href="data:image/svg+xml,&lt;svg width=&quot;4'),
		);
	});

	test("leaves an icon of unknown size in color", () => {
		const avif = dataURI("image/avif", PNG);
		assert.equal(grayscaleIcon(avif), avif);
		assert.equal(grayscaleIcon("not a data URI"), "not a data URI");
	});
});
