import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
	checkPages,
	failures,
	type PageState,
	serve,
	webkitInstalled,
} from "../src/browser.ts";
import { RenderTarget } from "../src/render.ts";
import { temporaryDirectory, writeFiles } from "./helpers.ts";

const PASSING: PageState = {
	article: true,
	textLength: 100,
	unresolved: false,
	overflow: false,
	brokenImages: [],
	collapsedImages: [],
	footnotes: [],
	blocked: [],
	pageErrors: [],
};

describe("failures", () => {
	test("footnote failures are reported with the rest", () => {
		assert.deepEqual(failures(PASSING), []);
		const state = {
			...PASSING,
			overflow: true,
			footnotes: ["footnote 2: popover showed null"],
		};
		assert.deepEqual(failures(state), [
			"horizontal document overflow",
			"footnote 2: popover showed null",
		]);
	});

	test("lists are written as Python wrote them", () => {
		const state = {
			...PASSING,
			textLength: 3,
			brokenImages: ["a.png", "it's.png"],
			collapsedImages: ["b.png"],
			blocked: ["https://x.test/"],
			pageErrors: ["Error: boom"],
		};
		assert.deepEqual(failures(state), [
			"article content is missing or unreadable",
			`broken images: ['a.png', "it's.png"]`,
			"images drawn at zero size: ['b.png']",
			"external requests: ['https://x.test/']",
			"page errors: ['Error: boom']",
		]);
	});
});

describe("loopback server", () => {
	test("serves files and nothing outside its directory", async () => {
		const site = temporaryDirectory();
		writeFiles(site, { "pages/a.html": "<p>a</p>", "index.html": "home" });
		const server = await serve(join(site, "pages"));
		try {
			assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
			const page = await fetch(`${server.url}/a.html`);
			assert.equal(page.status, 200);
			assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
			assert.equal((await fetch(`${server.url}/..%2Findex.html`)).status, 404);
			assert.equal((await fetch(`${server.url}/missing.html`)).status, 404);
			assert.equal((await fetch(`${server.url}/__live`)).status, 404);
		} finally {
			await server.close();
		}
	});

	test("live mode reloads the gallery and views but leaves pages as rendered", async () => {
		const site = temporaryDirectory();
		writeFiles(site, {
			"index.html": "<body>home</body>",
			"views/a.html": "<body>view</body>",
			"pages/a.html": "<body>page</body>",
		});
		const server = await serve(site, { live: true });
		try {
			const text = async (path: string) => await (await fetch(`${server.url}${path}`)).text();
			assert.match(await text("/"), /^<body>home<script>.*EventSource.*<\/script><\/body>$/s);
			assert.match(await text("/views/a.html"), /EventSource/);
			assert.equal(await text("/pages/a.html"), "<body>page</body>");

			const response = await fetch(`${server.url}/__live`);
			assert.equal(response.headers.get("content-type"), "text/event-stream");
			const reader = (response.body as ReadableStream<Uint8Array>).getReader();
			const next = async () => new TextDecoder().decode((await reader.read()).value);
			assert.equal(await next(), 'event: build\ndata: {"build":0}\n\n');
			server.publish("bad fixture");
			assert.equal(await next(), 'event: build\ndata: {"build":0,"error":"bad fixture"}\n\n');
			server.publish();
			assert.equal(await next(), 'event: build\ndata: {"build":1}\n\n');
			await reader.cancel();
		} finally {
			await server.close();
		}
	});
});

const webkit = await webkitInstalled();

describe("WebKit checks", {
	skip: !webkit && "WebKit is not installed; run node src/cli.ts setup",
}, () => {
	// Written by hand, without the preview CSP, so each check has something to catch.
	const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="articleBody"><p>Readable article text that is comfortably longer than forty characters.</p>
<p>[[left_over]]</p><div style="width: 5000px">wide</div>
<img src="data:image/png;base64,AAAA"><img src="https://blocked.test/remote.png">
<script>throw new Error("thrown by the page")</script></div></body></html>`;

	test("each problem fails with the Python tool's message", async () => {
		const site = temporaryDirectory();
		writeFiles(site, { "pages/bad-mac-light.html": page });
		const target = new RenderTarget("bad", "mac", "light");
		const results = await checkPages(site, [target]);
		assert.deepEqual(results["bad-mac-light"], [
			"unresolved theme macro",
			"horizontal document overflow",
			"broken images: ['data:image/png;base64,AAAA', 'https://blocked.test/remote.png']",
			"external requests: ['https://blocked.test/remote.png']",
			"page errors: ['Error: thrown by the page']",
		]);
		assert.ok(existsSync(join(site, "screenshots", "bad-mac-light.png")));
	});

	test("an image the theme collapses fails; one hidden on purpose does not", async () => {
		const svg = (fill: string) =>
			"data:image/svg+xml," +
			encodeURIComponent(
				`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${fill}"/></svg>`,
			);
		const site = temporaryDirectory();
		writeFiles(site, {
			"pages/images-mac-light.html": `<!doctype html><html><head><meta charset="utf-8">
<style>/* Full-bleed media: inside a float, this width resolves to zero. */
figure img { display: block; margin: 0 -48px; width: calc(100% + 96px); }</style></head><body><div class="articleBody">
<p>Readable article text that is comfortably longer than forty characters.</p>
<figure style="float: left"><img src="${svg("red")}"></figure>
<img src="${svg("green")}">
<img src="${svg("blue")}" style="display: none">
<details><summary>More</summary><img src="${svg("navy")}"></details>
<img src="${svg("gray")}" width="0" height="0">
</div></body></html>`,
		});
		const results = await checkPages(site, [new RenderTarget("images", "mac", "light")]);
		assert.deepEqual(results["images-mac-light"], [
			`images drawn at zero size: ['${svg("red")}']`,
		]);
	});

	test("a page without an article fails, and a look-alike origin is blocked", async () => {
		const site = temporaryDirectory();
		writeFiles(site, {
			"pages/empty-iphone-dark.html":
				"<!doctype html><body><p>No article here.</p>" +
				'<script>fetch("http://127.0.0.1.blocked.test/").catch(() => {})</script></body>',
		});
		const results = await checkPages(site, [new RenderTarget("empty", "iphone", "dark")]);
		const found = results["empty-iphone-dark"] ?? [];
		assert.equal(found[0], "article content is missing or unreadable");
		assert.ok(found.some((failure) => failure.includes("127.0.0.1.blocked.test")));
	});
});
