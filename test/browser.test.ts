import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
	checkPages,
	failures,
	type PageState,
	serve,
	webkitInstalled,
} from "../src/browser.ts";
import { RenderTarget, renderSite } from "../src/render.ts";
import { STARTER, temporaryDirectory, writeFiles } from "./helpers.ts";

const PASSING: PageState = {
	article: true,
	textLength: 100,
	unresolved: false,
	literalEnclosures: false,
	overflow: false,
	brokenImages: [],
	collapsedImages: [],
	unloadedImages: [],
	footnotes: [],
	enclosures: [],
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
			unloadedImages: ["c.png"],
			blocked: ["https://x.test/"],
			pageErrors: ["Error: boom"],
		};
		assert.deepEqual(failures(state), [
			"article content is missing or unreadable",
			`broken images: ['a.png', "it's.png"]`,
			"images drawn at zero size: ['b.png']",
			"images still loading: ['c.png']",
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

	test("lazy images below the fold are loaded and checked", async () => {
		const svg =
			"data:image/svg+xml," +
			encodeURIComponent(
				'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96"/></svg>',
			);
		const site = temporaryDirectory();
		writeFiles(site, {
			"pages/lazy-mac-light.html": `<!doctype html><html><head><meta charset="utf-8">
<style>figure img { display: block; margin: 0 -48px; width: calc(100% + 96px); }</style></head><body><div class="articleBody">
<p>Readable article text that is comfortably longer than forty characters.</p>
<div style="height: 5000px"></div>
<figure style="float: left"><img loading="lazy" src="${svg}"></figure>
<img loading="lazy" src="data:image/png;base64,AAAA">
</div></body></html>`,
		});
		const results = await checkPages(site, [new RenderTarget("lazy", "mac", "light")]);
		assert.deepEqual(results["lazy-mac-light"], [
			"broken images: ['data:image/png;base64,AAAA']",
			`images drawn at zero size: ['${svg}']`,
		]);
	});

	test("a Substack note is the text newsfoot shows, not its backlink's", async () => {
		// Rendered with NetNewsWire's own main.js and newsfoot.js, which turn these
		// markers into popovers.
		const note = (n: number, text: string) =>
			`<div class="footnote"><a id="footnote-${n}" href="#footnote-anchor-${n}" ` +
			`class="footnote-number">${n}</a><div class="footnote-content"><p>${text}</p></div></div>`;
		const body =
			"<p>Readable article text that is comfortably longer than forty characters." +
			'<a class="footnote-anchor" id="footnote-anchor-1" href="#footnote-1">1</a></p>' +
			"<p>A second paragraph with its own note." +
			'<a class="footnote-anchor" id="footnote-anchor-2" href="#footnote-2">2</a></p>' +
			note(1, "The first note.") +
			note(2, "The second <em>note</em>.");
		const root = temporaryDirectory();
		writeFiles(root, {
			"fixtures/substack.toml": `title = "Substack"\nbody = ${JSON.stringify(body)}\n`,
		});
		const targets = [new RenderTarget("substack", "mac", "light")];
		const site = renderSite(root, STARTER, targets);
		const results = await checkPages(site, targets, undefined, {
			substack: { notes: { 1: "The first note.", 2: "The second note." } },
		});
		assert.deepEqual(results["substack-mac-light"], []);
	});

	test("a footnote link left a plain link warns, or fails with all_converted", async () => {
		// The feed's home page is on another host, so main.js doesn't see the post's own
		// absolute footnote link as local, as for an article synced through the Reader API.
		const fixture =
			'title = "Notes"\nbase_url = "https://blog.example.org/"\nbody = \'\'\'<p>Readable ' +
			"article text that is comfortably longer than forty characters.<sup>" +
			'<a href="https://example.org/post/#fn1">1</a></sup></p><ol><li id="fn1">The note. ' +
			"<sup><a href=\"#nothing\">x</a></sup></li></ol>'''\n";
		const root = temporaryDirectory();
		writeFiles(root, { "fixtures/notes.toml": fixture });
		const targets = [new RenderTarget("notes", "mac", "light")];
		const site = renderSite(root, STARTER, targets);
		const message =
			"footnote 1: https://example.org/post/#fn1 links to a note but never became an " +
			"a.footnote marker, so NetNewsWire opens it as a link";
		const warned: Record<string, string[]> = {};
		const results = await checkPages(site, targets, undefined, {}, warned);
		assert.deepEqual(results["notes-mac-light"], []);
		assert.deepEqual(warned["notes-mac-light"], [message]);
		const strict = await checkPages(site, targets, undefined, {
			notes: { all_converted: true },
		});
		assert.deepEqual(strict["notes-mac-light"], [message]);
		const plain = await checkPages(site, targets, undefined, {
			notes: { all_converted: true, plain_links: ["sup > a[href$='#fn1']"] },
		});
		assert.deepEqual(plain["notes-mac-light"], []);
	});

	test("a card shows a fixture's own image at 2x on iPad", async () => {
		const root = temporaryDirectory();
		const png =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		writeFiles(root, {
			"fixtures/media/dot.png": Buffer.from(png, "base64"),
			"fixtures/showcase.toml":
				"title = \"Showcase\"\nbody = '''<p>Readable article text that is comfortably " +
				'longer than forty characters.</p><img src="media/dot.png" width="40" height="40">\'\'\'\n',
		});
		const targets = [new RenderTarget("showcase", "ipad", "light", { card: true })];
		const site = renderSite(root, STARTER, targets);
		const results = await checkPages(site, targets);
		assert.deepEqual(results["showcase-ipad-light-card"], []);
		const image = readFileSync(join(site, "screenshots", "showcase-ipad-light-card.png"));
		assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1600, 1104]);
	});

	test("enclosures must show, fit, keep their shape, and have legible captions", async () => {
		const svg = (w: number, h: number) =>
			"data:image/svg+xml," +
			encodeURIComponent(
				`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"/>`,
			);
		const enclosure = (kind: string, inner: string) =>
			`<div class="nnw-enclosure nnw-enclosure-${kind}">${inner}</div>`;
		const site = temporaryDirectory();
		writeFiles(site, {
			"pages/enclosures-iphone-light.html": `<!doctype html><html><head><meta charset="utf-8">
<style>body { margin: 0; overflow-x: hidden; } .squash { width: 100%; height: 50px; }</style></head>
<body><div class="articleBody"><p>Readable article text that is comfortably longer than forty characters.</p></div>
<div class="nnw-enclosures">
${enclosure("image", `<img src="${svg(400, 300)}" style="width: 100%">`)}
${enclosure("image", `<img src="${svg(400, 300)}" class="squash">`)}
${enclosure("image", `<img src="${svg(800, 100)}" style="width: 800px; max-width: none">`)}
${enclosure("audio", '<audio controls style="width: 120px"></audio><div class="nnw-enclosure-caption" style="color: #fefefe">Episode · 1:00</div>')}
${enclosure("audio", '<audio controls style="display: none"></audio>')}
${enclosure("video", '<iframe srcdoc="" width="640" height="390" style="border: 0; width: 100%; height: 40px"></iframe>')}
${enclosure("video", '<video controls width="16" height="9" style="width: 100%; height: auto"></video><div class="nnw-enclosure-caption">Legible <span style="font-size: 8px">tiny</span></div>')}
</div></body></html>`,
		});
		const results = await checkPages(site, [new RenderTarget("enclosures", "iphone", "light")]);
		assert.deepEqual(results["enclosures-iphone-light"], [
			"horizontal document overflow",
			"enclosure 2 (image): drawn 393×50, distorting its 400×300 shape",
			"enclosure 3 (image): spans 0–800px, outside the 393px window",
			"enclosure 4 (audio player): only 120px wide",
			"enclosure 5 (audio player): not shown",
			"enclosure 6 (video player): drawn 393×40, not a video's shape",
			'enclosure caption "Episode · 1:00": text 254,254,254 is illegible on 255,255,255',
		]);
	});

	test("older NetNewsWire fails only a visible [[enclosures]]", async () => {
		const article =
			'<div class="articleBody"><p>Readable article text that is comfortably longer than forty characters.</p></div>';
		const site = temporaryDirectory();
		writeFiles(site, {
			"pages/article-mac-light-older-netnewswire.html": `<!doctype html><body>${article}<div>[[enclosures]]</div></body>`,
			"pages/hidden-mac-light-older-netnewswire.html": `<!doctype html><head><style>
.e:not(:has(.nnw-enclosures)) { display: none; }</style></head><body>${article}<div class="e">[[enclosures]]</div></body>`,
		});
		const older = { olderNetNewsWire: true };
		const results = await checkPages(site, [
			new RenderTarget("article", "mac", "light", older),
			new RenderTarget("hidden", "mac", "light", older),
		]);
		assert.deepEqual(results["article-mac-light-older-netnewswire"], [
			"[[enclosures]] shows as text in NetNewsWire releases without enclosure support; " +
				"hide its element when it holds no .nnw-enclosures",
		]);
		assert.deepEqual(results["hidden-mac-light-older-netnewswire"], []);
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
