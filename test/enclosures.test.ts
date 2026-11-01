import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	byteCount,
	displayMedium,
	enclosuresHTML,
	escapeXML,
	fixtureAttachments,
	fixtureImageURL,
	placeEnclosures,
	youTubeEmbedURL,
} from "../src/enclosures.ts";

describe("enclosuresHTML, as NetNewsWire's EnclosuresHTMLTests", () => {
	test("a podcast episode gets an audio player and its artwork", () => {
		const artwork =
			"http://static1.squarespace.com/static/513abd71e4b0fe58c655c105/t/52c45a37e4b0a77a5034aa84/1388599866232/1500w/Artwork.jpg";
		const html = enclosuresHTML(
			[
				{
					url: "http://traffic.libsyn.com/atpfm/atp311.mp3",
					mime_type: "audio/mpeg",
					size_in_bytes: 54919661,
					duration_in_seconds: 6849,
					medium: "audio",
				},
			],
			"<ul><li>Facebook’s Onavo scam</li><li>Apple’s FaceTime bug</li></ul>",
			artwork,
		);
		assert.ok(
			html.includes(
				'<audio controls preload="none" src="http://traffic.libsyn.com/atpfm/atp311.mp3"></audio>',
			),
		);
		assert.ok(html.includes("atp311.mp3 · 1:54:09 · 54.9 MB"));
		assert.ok(html.includes(`<img src="${artwork}" alt="">`));
		// The artwork leads, as NetNewsWire inserts it first.
		assert.ok(html.indexOf("<img") < html.indexOf("<audio"));
	});

	test("an image enclosure already in the body, with & escaped, is skipped", () => {
		const url =
			"https://storage.googleapis.com/gweb-cloudblog-publish/images/hero.max-1000x1000.png?w=1000&h=500";
		const html = enclosuresHTML(
			[{ url, width: 1000, height: 500, medium: "image" }],
			'<p><img src="https://storage.googleapis.com/gweb-cloudblog-publish/images/hero.max-1000x1000.png?w=1000&amp;h=500"></p>',
			url,
		);
		assert.equal(html, "");
	});
});

describe("enclosuresHTML", () => {
	test("video gets the article image as its poster, and suppresses the fallback image", () => {
		const html = enclosuresHTML(
			[
				{
					url: "https://x.test/v.mp4",
					mime_type: "video/mp4",
					title: "A & B",
					width: 4,
					height: 3,
				},
			],
			"<p>Text</p>",
			"https://x.test/poster.jpg?a=1&b=2",
		);
		assert.equal(
			html,
			'<div class="nnw-enclosures">\n<div class="nnw-enclosure nnw-enclosure-video">' +
				'<video controls preload="metadata" playsinline src="https://x.test/v.mp4" width="4" height="3" ' +
				'poster="https://x.test/poster.jpg?a=1&amp;b=2"></video>' +
				'<div class="nnw-enclosure-caption">A &amp; B</div></div>\n</div>',
		);
	});

	test("a YouTube channel enclosure becomes the privacy-enhanced player", () => {
		const html = enclosuresHTML(
			[{ url: "https://www.youtube.com/v/Xr2kTq9mZ4c?version=3", width: 640, height: 390 }],
			"",
			undefined,
		);
		assert.ok(
			html.includes(
				'<iframe src="https://www.youtube-nocookie.com/embed/Xr2kTq9mZ4c" width="640" height="390" allowfullscreen></iframe>',
			),
		);
	});

	test("documents, executables, and unknown files show nothing", () => {
		const html = enclosuresHTML(
			[
				{ url: "https://x.test/map.pdf", mime_type: "application/pdf", medium: "document" },
				{ url: "https://x.test/setup.exe", medium: "executable" },
				{ url: "https://x.test/data.bin" },
			],
			"",
			undefined,
		);
		assert.equal(html, "");
	});

	test("the fallback image is skipped when the body has a visual element", () => {
		assert.equal(
			enclosuresHTML([], "<p><VIDEO src=x></VIDEO></p>", "https://x.test/a.jpg"),
			"",
		);
		assert.equal(
			enclosuresHTML([], "<p>see https://x.test/a.jpg</p>", "https://x.test/a.jpg"),
			"",
		);
		assert.match(enclosuresHTML([], "<p>Text</p>", "https://x.test/a.jpg"), /<img src=/);
		assert.equal(enclosuresHTML([], "<p>Text</p>", ""), "");
	});

	test("an untitled audio enclosure is captioned by its decoded file name", () => {
		const html = enclosuresHTML([{ url: "https://x.test/ep%20one.m4a?t=1" }], "", undefined);
		assert.match(html, /<div class="nnw-enclosure-caption">ep one\.m4a<\/div>/);
	});
});

describe("enclosure helpers", () => {
	test("displayMedium checks the MIME type, then medium, then the extension", () => {
		assert.equal(displayMedium({ url: "a.mp3", mime_type: "VIDEO/mp4" }), "video");
		assert.equal(
			displayMedium({ url: "a.mp3", mime_type: "text/html", medium: "image" }),
			"image",
		);
		assert.equal(displayMedium({ url: "https://x.test/a.JPG?w=1" }), "image");
		assert.equal(displayMedium({ url: "media/clip.webm" }), "video");
		assert.equal(displayMedium({ url: "https://x.test/a.pdf", medium: "document" }), undefined);
		assert.equal(displayMedium({ url: "https://x.test/" }), undefined);
	});

	test("YouTube is matched by host and the old player path only", () => {
		assert.equal(
			youTubeEmbedURL("https://m.youtube.com/v/abc_DEF-1"),
			"https://www.youtube-nocookie.com/embed/abc_DEF-1",
		);
		assert.equal(youTubeEmbedURL("https://www.youtube.com/watch?v=abc"), undefined);
		assert.equal(youTubeEmbedURL("https://notyoutube.com/v/abc"), undefined);
		assert.equal(youTubeEmbedURL("https://www.youtube.com/v/a%20b"), undefined);
	});

	test("byte counts read as Foundation's file style", () => {
		assert.equal(byteCount(0), "Zero KB");
		assert.equal(byteCount(1), "1 byte");
		assert.equal(byteCount(999), "999 bytes");
		assert.equal(byteCount(1499), "1 KB");
		assert.equal(byteCount(54919661), "54.9 MB");
		assert.equal(byteCount(1_234_567_890), "1.23 GB");
	});

	test("XML escaping covers quotes and drops illegal characters", () => {
		assert.equal(
			escapeXML(`<a href="x">'&'</a>\u0001`),
			"&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;",
		);
	});

	test("placement follows the template, as ArticleRenderer does", () => {
		const enclosures = '<div class="nnw-enclosures"></div>';
		assert.deepEqual(placeEnclosures("<p>[[body]]</p>[[enclosures]]", "B", enclosures), {
			body: "B",
			enclosures,
		});
		assert.deepEqual(placeEnclosures("[[body]]", "<audio>", enclosures), {
			body: `<div><audio></div>${enclosures}`,
		});
		assert.deepEqual(placeEnclosures("[[body]]", "B", ""), { body: "B" });
	});
});

describe("fixture enclosures", () => {
	test("attachments are validated, and an empty url is no attachment", () => {
		const fixture = {
			attachments: [{ url: "https://x.test/a.mp3", duration_in_seconds: 3 }, { url: "" }],
		};
		assert.deepEqual(fixtureAttachments(fixture, "f"), [
			{ url: "https://x.test/a.mp3", duration_in_seconds: 3 },
		]);
		assert.deepEqual(fixtureAttachments({}, "f"), []);
		assert.throws(
			() => fixtureAttachments({ attachments: { url: "x" } }, "f"),
			/\[\[attachments\]\]/,
		);
		assert.throws(
			() => fixtureAttachments({ attachments: [{ url: "x", size: 1 }] }, "f"),
			/unknown key\(s\): size/,
		);
		assert.throws(
			() => fixtureAttachments({ attachments: [{ url: "x", width: 1.5 }] }, "f"),
			/width must be an integer/,
		);
		assert.throws(
			() => fixtureAttachments({ attachments: [{ url: "x", medium: "photo" }] }, "f"),
			/medium must be one of/,
		);
		assert.throws(
			() => fixtureAttachments({ attachments: [{ title: "x" }] }, "f"),
			/url is required/,
		);
	});

	test("image_url wins over thumbnail_url, even when empty", () => {
		assert.equal(fixtureImageURL({ image_url: "a", thumbnail_url: "b" }, "f"), "a");
		assert.equal(fixtureImageURL({ image_url: "", thumbnail_url: "b" }, "f"), "");
		assert.equal(fixtureImageURL({ thumbnail_url: "b" }, "f"), "b");
		assert.equal(fixtureImageURL({}, "f"), undefined);
	});
});
