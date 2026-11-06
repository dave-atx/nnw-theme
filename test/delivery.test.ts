import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { deliver } from "../src/delivery.ts";
import { ThemeError } from "../src/project.ts";
import { fixtureDeliveries } from "../src/render.ts";

const POST = "https://example.org/2026/11/post/";

describe("FreshRSS delivery", () => {
	test("renames id and class, as SimplePie does", () => {
		assert.equal(
			deliver('<div class="footnotes" id="notes"><p>Note.</p></div>', "freshrss", POST),
			'<div data-sanitized-class="footnotes" data-sanitized-id="notes"><p>Note.</p></div>',
		);
	});

	test("makes every link absolute against the article, fragments included", () => {
		assert.equal(
			deliver('<sup><a href="#fn:1" rel="footnote">1</a></sup>', "freshrss", POST),
			`<sup><a href="${POST}#fn:1">1</a></sup>`,
		);
		assert.equal(
			deliver('<img src="/a.png" width="10" style="float:left">', "freshrss", POST),
			'<img src="https://example.org/a.png" width="10">',
		);
	});

	test("keeps data and aria attributes, drops scripts and javascript links", () => {
		assert.equal(
			deliver(
				'<span data-fn="x" aria-label="y" onclick="z()">t</span><script>bad()</script>' +
					'<a href="javascript:bad()">k</a>',
				"freshrss",
				POST,
			),
			'<span data-fn="x" aria-label="y">t</span><a>k</a>',
		);
	});

	test("adds player controls and unwraps unknown elements", () => {
		assert.equal(
			deliver('<custom-card><video src="v.mp4"></video></custom-card>', "freshrss", POST),
			`<video src="${new URL("v.mp4", POST).href}" controls="controls" preload="none"></video>`,
		);
	});
});

describe("Miniflux delivery", () => {
	test("strips class, keeps id only where allowed, and unwraps wrappers", () => {
		assert.equal(
			deliver(
				'<div class="footnotes" id="notes"><ol class="list"><li id="fn:1">Note.</li></ol></div>',
				"miniflux",
				POST,
			),
			'<ol><li id="fn:1">Note.</li></ol>',
		);
	});

	test("leaves fragment links alone and marks external ones", () => {
		assert.equal(
			deliver('<sup id="r1"><a href="#fn:1" class="ref">1</a></sup>', "miniflux", POST),
			'<sup id="r1"><a href="#fn:1">1</a></sup>',
		);
		assert.equal(
			deliver('<a href="/other/">x</a>', "miniflux", POST),
			'<a href="https://example.org/other/" rel="noopener noreferrer" ' +
				'referrerpolicy="no-referrer" target="_blank">x</a>',
		);
	});

	test("drops trackers, hidden elements, and iframes from unknown hosts", () => {
		assert.equal(
			deliver(
				'<p>a<img src="https://t.example/p.gif" width="1" height="1"></p>' +
					'<p hidden>secret</p><iframe src="https://evil.example/x">fallback</iframe>' +
					'<img src="https://example.org/i.jpg" width="0" height="300">',
				"miniflux",
				POST,
			),
			'<p>a</p><img src="https://example.org/i.jpg" height="300" loading="lazy">',
		);
	});

	test("keeps allowed embeds sandboxed", () => {
		assert.equal(
			deliver('<iframe src="https://www.youtube.com/embed/abc"></iframe>', "miniflux", POST),
			'<iframe src="https://www.youtube.com/embed/abc" sandbox="allow-scripts allow-same-origin ' +
				'allow-popups allow-popups-to-escape-sandbox" loading="lazy" ' +
				'referrerpolicy="strict-origin-when-cross-origin"></iframe>',
		);
	});

	test("escapes text and attribute values again", () => {
		assert.equal(
			deliver('<p title="a &quot;b&quot;">1 &lt; 2 &amp; 3</p>', "miniflux", POST),
			"<p>1 &lt; 2 &amp; 3</p>",
		);
		assert.equal(
			deliver('<abbr title="a &quot;b&quot; &amp; c">x</abbr>', "miniflux", POST),
			'<abbr title="a &quot;b&quot; &amp; c">x</abbr>',
		);
	});
});

describe("fixture deliveries", () => {
	test("are optional, and must be distinct known services", () => {
		assert.deepEqual(fixtureDeliveries({}, "f"), []);
		assert.deepEqual(fixtureDeliveries({ deliveries: ["miniflux", "freshrss"] }, "f"), [
			"miniflux",
			"freshrss",
		]);
		for (const deliveries of ["freshrss", ["inoreader"], ["miniflux", "miniflux"]]) {
			assert.throws(() => fixtureDeliveries({ deliveries }, "f"), ThemeError);
		}
	});
});
