import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { ThemeError } from "../src/project.ts";
import {
	articleBaseURL,
	checkTargets,
	DEFAULT_DYNAMIC_TYPE_SIZE,
	DEFAULT_TEXT_SIZE_CLASS,
	extraFixtures,
	LARGE_DYNAMIC_TYPE_SIZE,
	LARGE_TEXT_SIZE_CLASS,
	normalTargets,
	offlineEnclosures,
	offlineMedia,
	RenderTarget,
	removeScripts,
	renderPage,
	renderSite,
	substitute,
	writeGallery,
} from "../src/render.ts";
import { makeSnapshot, STARTER, temporaryDirectory, writeFiles } from "./helpers.ts";

function headings(gallery: string): string[] {
	return [...gallery.matchAll(/<section><h2>([^<]+)<\/h2>/g)].map((match) => match[1] ?? "");
}

function count(text: string, part: string): number {
	return text.split(part).length - 1;
}

describe("macros", () => {
	test("substitution is single pass and preserves unknown macros", () => {
		const actual = substitute("[[known]] [[unknown]]", { known: "[[nested]]", nested: "no" });
		assert.equal(actual, "[[nested]] [[unknown]]");
	});

	test("a card target is the card viewport at any platform", () => {
		const target = new RenderTarget("showcase", "ipad", "dark", { card: true });
		assert.deepEqual([target.width, target.height], [800, 552]);
		assert.equal(target.slug, "showcase-ipad-dark-card");
		assert.equal(target.label, "showcase · iPad · dark · card");
		assert.ok(target.ios);
	});

	test("matrix has twelve normal and four stress targets", () => {
		assert.equal(normalTargets().length, 12);
		assert.equal(checkTargets().length, 16);
		assert.equal(checkTargets().filter((target) => !target.themeScripts).length, 2);
		assert.equal(checkTargets().filter((target) => target.largeText).length, 2);
	});

	test("a template with [[enclosures]] adds two older-NetNewsWire targets", () => {
		const older = checkTargets([], { enclosuresMacro: true }).filter((t) => t.olderNetNewsWire);
		assert.deepEqual(
			older.map((target) => target.slug),
			["article-mac-light-older-netnewswire", "article-iphone-dark-older-netnewswire"],
		);
		assert.equal(older[0]?.scenario, "older-netnewswire");
		assert.equal(older[0]?.label, "Article · Mac · light · older NetNewsWire");
		assert.equal(checkTargets().filter((t) => t.olderNetNewsWire).length, 0);
	});
});

describe("enclosures", () => {
	const fixture = {
		title: "Episode",
		body: "<p>Show notes.</p>",
		image_url: "https://x.test/art.jpg",
		attachments: [
			{ url: "https://x.test/ep.mp3", title: "Episode", duration_in_seconds: 61 },
			{ url: "https://x.test/notes.pdf", medium: "document" },
		],
	};
	const enclosure = (page: string) => page.slice(page.indexOf('<div class="nnw-enclosures">'));

	test("a template without the macro gets them after a wrapped body", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const page = renderPage(STARTER, fixture, normalTargets()[0] as RenderTarget, snapshot);
		assert.ok(page.includes('<div><p>Show notes.</p></div><div class="nnw-enclosures">'));
		assert.match(enclosure(page), /<audio controls preload="none"><\/audio>/);
		assert.match(enclosure(page), /Episode · 1:01/);
		assert.doesNotMatch(page, /https:\/\/x\.test\//, "nothing fetches");
	});

	test("a template with the macro places them, and older NetNewsWire leaves it", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const theme = temporaryDirectory();
		for (const name of ["Info.plist", "stylesheet.css"]) {
			writeFileSync(join(theme, name), readFileSync(join(STARTER, name)));
		}
		writeFileSync(
			join(theme, "template.html"),
			'<div class="articleBody">[[body]]</div><aside>[[enclosures]]</aside>',
		);
		const page = renderPage(theme, fixture, normalTargets()[0] as RenderTarget, snapshot);
		assert.ok(
			page.includes(
				'<div class="articleBody"><p>Show notes.</p></div><aside><div class="nnw-enclosures">',
			),
		);
		const older = renderPage(
			theme,
			fixture,
			new RenderTarget("article", "mac", "light", { olderNetNewsWire: true }),
			snapshot,
		);
		assert.ok(
			older.includes(
				'<div class="articleBody"><p>Show notes.</p></div><aside>[[enclosures]]</aside>',
			),
		);
		assert.ok(!older.includes("nnw-enclosures"));
	});

	test("offline enclosures keep their shape and load only fixture media", () => {
		const media = temporaryDirectory();
		writeFiles(media, { "clip.mp4": "MP4", "art.png": "PNG" });
		const html = offlineEnclosures(
			'<video controls preload="metadata" playsinline src="https://x.test/v.mp4" width="16" height="9" poster="https://x.test/p.jpg"></video>' +
				'<video controls src="media/clip.mp4" poster="media/art.png"></video>' +
				'<video controls src="https://x.test/v.mp4"></video>' +
				'<audio controls preload="none" src="media/missing.mp3"></audio>' +
				'<iframe src="https://www.youtube-nocookie.com/embed/x" width="640" height="390" allowfullscreen></iframe>',
			media,
		);
		const placeholder16x9 = offlineMedia(
			'<img src="https://x.test/a" width="16" height="9">',
		).match(/src="([^"]+)"/)?.[1];
		assert.ok(
			html.startsWith(
				`<video controls preload="metadata" playsinline width="16" height="9" poster="${placeholder16x9}">`,
			),
		);
		assert.ok(
			html.includes(`src="data:video/mp4;base64,${Buffer.from("MP4").toString("base64")}"`),
		);
		assert.ok(
			html.includes(`poster="data:image/png;base64,${Buffer.from("PNG").toString("base64")}"`),
		);
		assert.ok(html.includes('<audio controls preload="none"></audio>'));
		assert.match(
			html,
			/<iframe width="640" height="390" allowfullscreen srcdoc="[^"]*640 × 390 YouTube player">/,
		);
		assert.ok(!html.includes("x.test") && !html.includes("youtube-nocookie"));
	});
});

describe("extra fixtures", () => {
	function fixtures(...names: string[]): string {
		const root = temporaryDirectory();
		mkdirSync(join(root, "fixtures"));
		for (const name of names)
			writeFileSync(join(root, "fixtures", `${name}.toml`), 'title = "T"\n');
		return root;
	}

	test("added fixtures are extras in name order", () => {
		const root = fixtures("kitchen-sink", "zebra", "article", "footnotes");
		assert.deepEqual(extraFixtures(root), ["footnotes", "zebra"]);
	});

	test("a repository without fixtures has no extras", () => {
		assert.deepEqual(extraFixtures(temporaryDirectory()), []);
	});

	test("scenario names are reserved", () => {
		assert.throws(
			() => extraFixtures(fixtures("large-text")),
			(error: Error) => {
				assert.ok(error instanceof ThemeError);
				assert.match(error.message, /reserved.*large-text/);
				return true;
			},
		);
	});

	test("extras are checked on Mac and iPhone in both appearances", () => {
		const added = checkTargets(["footnotes"]).filter((t) => t.fixture === "footnotes");
		assert.deepEqual(
			new Set(added.map((t) => `${t.platform} ${t.appearance}`)),
			new Set(["mac light", "mac dark", "iphone light", "iphone dark"]),
		);
		assert.equal(added.length, 4);
		assert.ok(!added.some((t) => t.largeText || !t.themeScripts));
		assert.equal(checkTargets(["a", "b"]).length, 24);
	});

	test("extras get their own gallery section after the scenarios", () => {
		const site = temporaryDirectory();
		writeGallery(site, "Quiet Reader", checkTargets(["footnotes"]));
		const gallery = readFileSync(join(site, "index.html"), "utf8");
		const found = headings(gallery);
		assert.equal(found.at(-1), "footnotes");
		assert.equal(found.length, 5);
		assert.ok(gallery.includes("fixtures/footnotes.toml"));
		assert.ok(gallery.includes("20 cases"));
	});
});

describe("offline media", () => {
	function placeholderSize(tag: string): [number, number] {
		const encoded = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(tag);
		assert.ok(encoded);
		const svg = Buffer.from(encoded[1] ?? "", "base64").toString();
		const size = /width="(\d+)" height="(\d+)"/.exec(svg);
		assert.ok(size);
		return [Number(size[1]), Number(size[2])];
	}

	test("network images become same-size placeholders", () => {
		const body = offlineMedia(
			'<a href="https://x.test/a.jpg"><img width="1024" height="683" alt="a > b" ' +
				'src="https://x.test/a-1024.jpg" srcset="https://x.test/w_1,c_2.jpg 2x" ' +
				'sizes="100vw" loading=lazy /></a>',
		);
		assert.deepEqual(placeholderSize(body), [1024, 683]);
		assert.ok(!body.includes("x.test/a-1024"));
		assert.ok(!body.includes("srcset"));
		assert.ok(!body.includes("sizes"));
		assert.ok(body.includes('alt="a > b" loading=lazy'));
		assert.ok(body.includes('<a href="https://x.test/a.jpg">'));
	});

	test("relative and protocol-relative images would fetch too", () => {
		for (const tag of ['<img src="images/a.png">', "<IMG SRC=//cdn.test/a.png>"]) {
			assert.deepEqual(placeholderSize(offlineMedia(tag)), [1600, 900], tag);
		}
	});

	test("fetching sources are dropped for their img", () => {
		const body = offlineMedia(
			'<picture><source srcset="https://x.test/a.webp"><img src="https://x.test/a.jpg"></picture>',
		);
		assert.ok(!body.includes("<source"));
		assert.ok(!body.includes("x.test"));
	});

	test("inline images are untouched", () => {
		for (const body of ['<img src="data:image/png;base64,AAA" alt="x">', '<img alt="none">']) {
			assert.equal(offlineMedia(body), body);
		}
	});

	test("entity-encoded attribute values are decoded before judging them", () => {
		assert.deepEqual(
			placeholderSize(offlineMedia('<img src="&#104;ttps://x.test/a.png">')),
			[1600, 900],
		);
		const inline = '<img src="&#100;ata:image/png;base64,AAA">';
		assert.equal(offlineMedia(inline), inline);
	});

	test("media/ images come from fixtures/media as data URIs", () => {
		const root = temporaryDirectory();
		const media = join(root, "fixtures", "media");
		writeFiles(root, { "fixtures/media/photos/a.JPG": "jpeg bytes", "secret.png": "secret" });
		const body = offlineMedia(
			'<img src="media/photos/a.JPG" srcset="https://x.test/a.jpg 2x" width="4">',
			media,
		);
		const data = Buffer.from("jpeg bytes").toString("base64");
		assert.equal(body, `<img width="4" src="data:image/jpeg;base64,${data}">`);
		// Without a media directory, it is a relative URL like any other.
		assert.deepEqual(
			placeholderSize(offlineMedia('<img src="media/photos/a.JPG">')),
			[1600, 900],
		);

		// Anything else stays a placeholder, as before: nothing outside fixtures/media.
		symlinkSync(join(root, "secret.png"), join(media, "link.png"));
		writeFiles(root, { "fixtures/media/notes.txt": "text" });
		for (const src of [
			"media/missing.png",
			"media/../../secret.png",
			"media/link.png",
			"media/notes.txt",
			"media/photos",
		]) {
			assert.deepEqual(
				placeholderSize(offlineMedia(`<img src="${src}">`, media)),
				[1600, 900],
				src,
			);
		}
	});
});

describe("render", () => {
	test("gallery links to the sandboxed viewer", () => {
		const root = temporaryDirectory();
		symlinkSync(join(STARTER, "..", "..", "..", "assets", "fixtures"), join(root, "fixtures"));
		const snapshot = makeSnapshot(root);
		const target = normalTargets()[0] as RenderTarget;
		const site = renderSite(root, STARTER, [target], snapshot);
		const gallery = readFileSync(join(site, "index.html"), "utf8");
		const viewer = readFileSync(join(site, "views", `${target.slug}.html`), "utf8");
		assert.ok(gallery.includes(`views/${target.slug}.html`));
		assert.ok(gallery.includes(`pages/${target.slug}.html`));
		assert.ok(gallery.includes(`screenshots/${target.slug}.png`));
		assert.ok(gallery.includes('sandbox="allow-scripts"'));
		assert.ok(viewer.includes('sandbox="allow-scripts"'));
	});

	test("built-in fixtures render when the repository has none, and repository copies win", () => {
		const root = temporaryDirectory();
		const snapshot = makeSnapshot(root);
		const target = normalTargets()[0] as RenderTarget;
		const builtIn = renderSite(root, STARTER, [target], snapshot);
		const page = readFileSync(join(builtIn, "pages", `${target.slug}.html`), "utf8");
		assert.ok(page.includes("articleBody"));
		assert.ok(!page.includes("Overridden headline"));

		writeFiles(root, {
			"fixtures/article.toml": 'title = "Overridden headline"\nbody = "<p>Own copy.</p>"\n',
		});
		const own = renderSite(root, STARTER, [target], snapshot);
		assert.ok(
			readFileSync(join(own, "pages", `${target.slug}.html`), "utf8").includes(
				"Overridden headline",
			),
		);
	});

	test("gallery groups cases by scenario and reports results", () => {
		const targets = checkTargets();
		const failing = targets.find((t) => t.platform === "iphone" && t.appearance === "dark");
		assert.ok(failing);
		const results: Record<string, string[]> = Object.fromEntries(
			targets.map((t) => [t.slug, []]),
		);
		results[failing.slug] = ["horizontal document overflow"];
		const site = temporaryDirectory();
		writeGallery(site, "Quiet Reader", targets, results);
		const gallery = readFileSync(join(site, "index.html"), "utf8");
		assert.deepEqual(headings(gallery), [
			"Everyday reading",
			"Stress test",
			"Large text",
			"Article JavaScript off",
		]);
		assert.ok(gallery.includes("16 cases · 15 passed · 1 failed"));
		assert.ok(gallery.indexOf("<h2>Failures</h2>") < gallery.indexOf("Everyday reading"));
		assert.ok(gallery.includes(`href="#${failing.slug}"`));
		assert.equal(count(gallery, "✓ Passed"), 15);
		assert.equal(count(gallery, "✗ Failed"), 1);
		assert.ok(gallery.includes("<li>horizontal document overflow</li>"));
	});

	test("an unchecked gallery has no results or screenshot links", () => {
		const site = temporaryDirectory();
		writeGallery(site, "Quiet Reader", normalTargets());
		const gallery = readFileSync(join(site, "index.html"), "utf8");
		assert.ok(gallery.includes("12 cases, not checked yet"));
		assert.ok(!gallery.includes("Passed"));
		assert.ok(!gallery.includes("Screenshot</a>"));
		assert.ok(!gallery.includes("Large text"));
	});

	test("render uses the pinned input and keeps inline theme scripts", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const fixture = {
			title: "Hello",
			feed_link_title: "Example",
			preferred_link: "https://example.org/post",
			body: "<p>Readable article body.</p>",
		};
		const page = renderPage(STARTER, fixture, normalTargets()[0] as RenderTarget, snapshot);
		assert.ok(page.includes("Readable article body."));
		assert.ok(page.includes("Content-Security-Policy"));
		assert.ok(page.includes("base-uri http: https:"));
		assert.ok(page.includes("function processPage()"));
		assert.ok(!page.includes("[[title]]"));
	});

	test("replacement text is inserted literally, never as a pattern", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const page = renderPage(
			STARTER,
			{ title: "$& $1 $$", body: "<p>Costs $5 and $&.</p>" },
			normalTargets()[0] as RenderTarget,
			snapshot,
		);
		assert.ok(page.includes("<title>$& $1 $$</title>"));
		assert.ok(page.includes("Costs $5 and $&."));
	});

	test("NetNewsWire's scripts follow an article that contains </body>", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const body = '<iframe srcdoc="<p>Embed</p></body>"></iframe><p>After the embed.</p>';
		const page = renderPage(
			STARTER,
			{ title: "T", body },
			normalTargets()[0] as RenderTarget,
			snapshot,
		);
		assert.ok(page.includes(body));
		const scripts = page.indexOf("function processPage()");
		assert.ok(scripts > page.indexOf("After the embed."));
		assert.ok(scripts < page.lastIndexOf("</body>"));
	});

	test("iOS pages define the feed icon label the app injects", () => {
		const snapshot = makeSnapshot(temporaryDirectory());
		const [ios, mac] = (["iphone", "mac"] as const).map((platform) =>
			renderPage(
				STARTER,
				{ title: "T", body: "<p>x</p>" },
				normalTargets().find((t) => t.platform === platform) as RenderTarget,
				snapshot,
			),
		);
		// main_ios.js labels #nnwImageIcon with it; a missing one is a page error.
		assert.ok(ios?.includes('const nnwGetFeedInfoLabel = "Get Feed Info";'));
		assert.ok(!mac?.includes("nnwGetFeedInfoLabel"));
	});

	test("a remote avatar gets the generated tile", () => {
		const directory = temporaryDirectory();
		const theme = join(directory, "Test.nnwtheme");
		writeFiles(theme, {
			"stylesheet.css": "",
			"template.html": '<img src="[[avatar_src]]">[[body]]',
		});
		const page = renderPage(
			theme,
			{ avatar_src: "https://x.test/icon.png", feed_link_title: "Feed" },
			normalTargets()[0] as RenderTarget,
			makeSnapshot(directory),
		);
		assert.ok(!page.includes("x.test"));
		assert.ok(page.includes('<img src="data:image/svg+xml;base64,'));
	});

	test("theme scripts can be removed without removing NetNewsWire's scripts", () => {
		const directory = temporaryDirectory();
		const theme = join(directory, "Test.nnwtheme");
		writeFiles(theme, {
			"stylesheet.css": "body {}",
			"template.html":
				'<article class="articleBody">[[body]]<script>window.themeRan=true</script></article>',
		});
		const target = checkTargets().find((t) => !t.themeScripts) as RenderTarget;
		const page = renderPage(
			theme,
			{ title: "Test", body: "<p>Still readable.</p><script>window.articleRan=true</script>" },
			target,
			makeSnapshot(directory),
		);
		assert.ok(!page.includes("window.themeRan"));
		assert.ok(!page.includes("window.articleRan"));
		assert.ok(page.includes("function processPage()"));
	});

	test("script removal follows the HTML tokenizer", () => {
		const cases: [string, string][] = [
			["a<script>x</script >b", "ab"],
			["a<SCRIPT src=x>x</script\tfoo>b", "ab"],
			["a<script>left open", "a"],
			["<script>a</script><script>b</script>z", "z"],
			["<svg><script>a<b/>c</script></svg>", "<svg></svg>"],
			// No script element here, so nothing is removed.
			["<style><script>x</script></style>", "<style><script>x</script></style>"],
			["<!-- <script>x</script> -->", "<!-- <script>x</script> -->"],
			["<div title='<script>'>t</div>", "<div title='<script>'>t</div>"],
		];
		for (const [html, expected] of cases) assert.equal(removeScripts(html), expected, html);
	});
});

describe("text scaling", () => {
	// NetNewsWire scales text per platform; the preview has to match it exactly.
	const fixture = { title: "Hello", body: "<p>Readable article body.</p>" };
	const render = (target: RenderTarget) =>
		renderPage(STARTER, fixture, target, makeSnapshot(temporaryDirectory()));
	const target = (platform: string, largeText = false) =>
		(largeText ? checkTargets() : normalTargets()).find(
			(item) => item.platform === platform && item.largeText === largeText && item.themeScripts,
		) as RenderTarget;

	test("font-size is substituted on iOS and left literal on macOS", () => {
		// styleSubstitutions() is empty on macOS, so no theme can rely on it there.
		assert.ok(render(target("mac")).includes("[[font-size]]"));
		const iphone = render(target("iphone"));
		assert.ok(!iphone.includes("[[font-size]]"));
		assert.ok(iphone.includes(`font-size: ${DEFAULT_DYNAMIC_TYPE_SIZE}px`));
		assert.ok(
			render(target("iphone", true)).includes(`font-size: ${LARGE_DYNAMIC_TYPE_SIZE}px`),
		);
	});

	test("text_size_class is macOS only and defaults to large", () => {
		// An unset macOS preference falls back to ArticleTextSize.large, not medium.
		assert.equal(DEFAULT_TEXT_SIZE_CLASS, "largeText");
		assert.ok(render(target("mac")).includes(`class="articleBody ${DEFAULT_TEXT_SIZE_CLASS}"`));
		assert.ok(
			render(target("mac", true)).includes(`class="articleBody ${LARGE_TEXT_SIZE_CLASS}"`),
		);
		for (const platform of ["iphone", "ipad"]) {
			const page = render(target(platform));
			assert.ok(page.includes('class="articleBody "'));
			assert.ok(!page.includes("[[text_size_class]]"));
		}
	});
});

describe("base URL and deliveries", () => {
	const snapshot = makeSnapshot(temporaryDirectory());
	const fixture = {
		title: "Hello",
		feed_link_title: "Example",
		feed_link: "https://example.org/",
		preferred_link: "https://example.org/2026/post/",
		body: '<p class="lede">Readable article body.<sup><a href="#fn1">1</a></sup></p>',
	};
	const base = (page: string) => /<base href="([^"]*)">/.exec(page)?.[1];
	const mac = new RenderTarget("sync", "mac", "light");

	test("the page's base is the fixture's link unless base_url replaces it", () => {
		assert.equal(base(renderPage(STARTER, fixture, mac, snapshot)), fixture.preferred_link);
		const page = renderPage(
			STARTER,
			{ ...fixture, base_url: "https://example.org/home/#top" },
			mac,
			snapshot,
		);
		assert.equal(base(page), "https://example.org/home/");
		assert.throws(
			() => renderPage(STARTER, { ...fixture, base_url: 1 }, mac, snapshot),
			ThemeError,
		);
	});

	test("base URLs follow Article.baseURL: no fragment, only http and https", () => {
		assert.equal(articleBaseURL("https://example.org/a#b"), "https://example.org/a");
		assert.equal(articleBaseURL("http://example.org"), "http://example.org/");
		assert.equal(articleBaseURL("ftp://example.org/"), "");
		assert.equal(articleBaseURL("not a url"), "");
	});

	test("a delivered article is rewritten and based on the feed's home page", () => {
		const target = new RenderTarget("sync", "mac", "light", { delivery: "freshrss" });
		const page = renderPage(STARTER, fixture, target, snapshot);
		assert.equal(base(page), "https://example.org/");
		assert.ok(page.includes('<p data-sanitized-class="lede">'));
		assert.ok(page.includes('<a href="https://example.org/2026/post/#fn1">'));
		assert.ok(renderPage(STARTER, fixture, mac, snapshot).includes('<p class="lede">'));
		// The home page a sync service reports can differ from the feed's own.
		const reported = { ...fixture, base_url: "https://www.example.org/" };
		assert.equal(
			base(renderPage(STARTER, reported, target, snapshot)),
			"https://www.example.org/",
		);
	});

	test("each delivery adds Mac light and iPhone dark cases after its fixture", () => {
		const targets = normalTargets(["sync"], { sync: ["freshrss", "miniflux"] });
		const delivered = targets.filter((target) => target.delivery);
		assert.deepEqual(
			delivered.map((target) => target.slug),
			[
				"sync-mac-light-freshrss",
				"sync-iphone-dark-freshrss",
				"sync-mac-light-miniflux",
				"sync-iphone-dark-miniflux",
			],
		);
		assert.equal(delivered[0]?.label, "sync · Mac · light · via FreshRSS");
		assert.equal(delivered[0]?.scenario, "sync via FreshRSS");
		assert.equal(targets.indexOf(delivered[0] as RenderTarget), 16);
		assert.equal(checkTargets(["sync"], { deliveries: { sync: ["miniflux"] } }).length, 22);
	});

	test("delivered cases get their own gallery section", () => {
		const site = temporaryDirectory();
		writeGallery(site, "Quiet Reader", normalTargets(["sync"], { sync: ["miniflux"] }));
		const gallery = readFileSync(join(site, "index.html"), "utf8");
		assert.deepEqual(headings(gallery).slice(-2), ["sync", "sync via Miniflux"]);
		assert.ok(gallery.includes("Miniflux delivers it through the Reader API"));
	});
});
