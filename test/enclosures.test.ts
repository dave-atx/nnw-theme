import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { significantImageURLs } from "../src/body-images.ts";
import {
	type Attachment,
	articleMediaHTML,
	bodyImageIdentities,
	byteCount,
	displayMedium,
	enclosuresHTML,
	escapeXML,
	fixtureAttachments,
	fixtureImages,
	placeEnclosures,
	youTubeEmbedURL,
} from "../src/enclosures.ts";

function enclosures(
	attachments: readonly Attachment[],
	body: string,
	posterURL: string | undefined,
): string {
	return enclosuresHTML(attachments, body, bodyImageIdentities(body), posterURL);
}

/** Primary media and enclosures for a template that places [[primary_media]]. */
function placed(
	article: Partial<Parameters<typeof articleMediaHTML>[0]>,
): ReturnType<typeof articleMediaHTML> {
	return articleMediaHTML({ attachments: [], title: "A title", body: "", ...article }, true);
}

describe("enclosuresHTML, as NetNewsWire's EnclosuresHTMLTests", () => {
	test("a podcast episode gets an audio player and its artwork", () => {
		const artwork =
			"http://static1.squarespace.com/static/513abd71e4b0fe58c655c105/t/52c45a37e4b0a77a5034aa84/1388599866232/1500w/Artwork.jpg";
		const { enclosures: html } = articleMediaHTML(
			{
				attachments: [
					{
						url: "http://traffic.libsyn.com/atpfm/atp311.mp3",
						mime_type: "audio/mpeg",
						size_in_bytes: 54919661,
						duration_in_seconds: 6849,
						medium: "audio",
					},
				],
				imageLink: artwork,
				title: "",
				body: "<ul><li>Facebook’s Onavo scam</li><li>Apple’s FaceTime bug</li></ul>",
			},
			false,
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
		const html = enclosures(
			[{ url, width: 1000, height: 500, medium: "image" }],
			'<p><img src="https://storage.googleapis.com/gweb-cloudblog-publish/images/hero.max-1000x1000.png?w=1000&amp;h=500"></p>',
			url,
		);
		assert.equal(html, "");
	});
});

describe("enclosuresHTML", () => {
	test("video gets the article image as its poster", () => {
		const html = enclosures(
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
		const html = enclosures(
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
		const html = enclosures(
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

	test("a template without the macro adds the article image unless the body shows it", () => {
		const image = (body: string, imageLink?: string, thumbnailLink?: string) =>
			articleMediaHTML({ attachments: [], imageLink, thumbnailLink, title: "T", body }, false)
				.enclosures;
		assert.match(image("<p>Text</p>", "https://x.test/a.jpg"), /<img src=/);
		assert.match(
			image('<p><img src="https://x.test/other.jpg"></p>', "https://x.test/a.jpg"),
			/a\.jpg/,
		);
		assert.equal(image('<p><img src="https://x.test/a.jpg"></p>', "https://x.test/a.jpg"), "");
		assert.equal(image("<p>Text</p>", undefined, "https://x.test/thumb.jpg"), "");
	});

	test("a template without the macro shows a video's poster as an image too", () => {
		const { enclosures: html } = articleMediaHTML(
			{
				attachments: [{ url: "https://x.test/v.mp4", mime_type: "video/mp4" }],
				imageLink: "https://x.test/poster.jpg",
				title: "T",
				body: "<p>Text</p>",
			},
			false,
		);
		assert.ok(html.indexOf('<img src="https://x.test/poster.jpg"') < html.indexOf("<video"));
		assert.match(html, /poster="https:\/\/x\.test\/poster\.jpg"/);
	});

	test("an untitled audio enclosure is captioned by its decoded file name", () => {
		const html = enclosures([{ url: "https://x.test/ep%20one.m4a?t=1" }], "", undefined);
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

	test("a fixture's image_url and thumbnail_url stay separate", () => {
		assert.deepEqual(fixtureImages({ image_url: "a", thumbnail_url: "b" }, "f"), {
			imageLink: "a",
			thumbnailLink: "b",
		});
		assert.deepEqual(fixtureImages({}, "f"), {
			imageLink: undefined,
			thumbnailLink: undefined,
		});
		assert.throws(
			() => fixtureImages({ thumbnail_url: 1 }, "f"),
			/thumbnail_url must be a string/,
		);
	});
});

describe("primary media, as NetNewsWire's EnclosuresHTMLTests", () => {
	const audio = {
		url: "https://x.test/ep.mp3",
		mime_type: "audio/mpeg",
		medium: "audio",
	} as const;
	const video = {
		url: "https://x.test/v.mp4",
		mime_type: "video/mp4",
		medium: "video",
	} as const;
	const art = "https://x.test/uploads/art.jpg";

	test("audio follows the article image, and leaves the enclosures", () => {
		const { primaryMedia, enclosures: rest } = placed({ attachments: [audio], imageLink: art });
		assert.ok(
			primaryMedia.startsWith(
				`<div class="nnw-primary-media"><div class="nnw-primary-image"><img src="${art}" alt=""></div>` +
					'<div class="nnw-enclosure nnw-enclosure-audio"><audio',
			),
		);
		assert.equal(rest, "");
	});

	test("a video takes the article image as its poster and shows no image", () => {
		const { primaryMedia, enclosures: rest } = placed({ attachments: [video], imageLink: art });
		assert.equal(
			primaryMedia,
			'<div class="nnw-primary-media"><div class="nnw-enclosure nnw-enclosure-video">' +
				`<video controls preload="metadata" playsinline src="${video.url}" poster="${art}"></video></div></div>`,
		);
		assert.equal(rest, "");
	});

	test("an attachment with the image's URL gives its dimensions and caption", () => {
		const attachment = { url: art, title: "A heron", width: 1200, height: 800 };
		assert.equal(
			placed({ attachments: [attachment], imageLink: art }).primaryMedia,
			`<div class="nnw-primary-media"><div class="nnw-primary-image"><img src="${art}" alt="A heron" title="A heron" width="1200" height="800">` +
				'<div class="nnw-primary-image-caption">A heron</div></div></div>',
		);
	});

	test("the caption is dropped when it repeats the article title", () => {
		for (const title of ["a  HERON ", "A\u00a0heron"]) {
			const attachment = { url: art, title: "A heron" };
			const { primaryMedia } = placed({ attachments: [attachment], imageLink: art, title });
			assert.doesNotMatch(primaryMedia, /caption/);
		}
	});

	test("the image is the article's, else the first image attachment, else the thumbnail", () => {
		const first = { url: "https://x.test/first.jpg", medium: "image" } as const;
		const thumbnailLink = "https://x.test/thumb.jpg";
		assert.match(
			placed({ attachments: [first], imageLink: art, thumbnailLink }).primaryMedia,
			/art\.jpg/,
		);
		assert.match(placed({ attachments: [first], thumbnailLink }).primaryMedia, /first\.jpg/);
		assert.match(placed({ thumbnailLink }).primaryMedia, /thumb\.jpg/);
		assert.equal(placed({}).primaryMedia, "");
	});

	test("an image already in the body, or a resized copy, is left out", () => {
		const imageLink = "https://x.test/uploads/2026/heron.jpg";
		for (const body of [
			`<img src="${imageLink}">`,
			'<img src="https://cdn.test/w/uploads/2026/heron-1024x683.jpg?resize=1">',
			'<img src="https://cdn.test/o/2026/heron.jpg" srcset="https://cdn.test/o/2026/heron-300x200.jpg 300w">',
		]) {
			assert.equal(placed({ imageLink, body }).primaryMedia, "", body);
		}
		assert.match(
			placed({ imageLink, body: '<img src="https://x.test/uploads/2026/gull.jpg">' })
				.primaryMedia,
			/heron\.jpg/,
		);
		const engadget = "https://o.aolcdn.engadget.com/images/l-intro-17.jpg";
		assert.equal(
			placed({
				imageLink: engadget,
				body: '<img src="https://s.yimg.com/images/intro-17.jpg">',
			}).primaryMedia,
			"",
		);
	});

	test("a body that embeds the YouTube video hides the still", () => {
		const imageLink = "https://substackcdn.com/image/youtube/w_728,c_limit/dQw4w9WgXcQ";
		const body = '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
		assert.equal(placed({ imageLink, body }).primaryMedia, "");
		assert.match(placed({ imageLink, body: "<p>x</p>" }).primaryMedia, /substackcdn/);
	});

	test("a short untitled post keeps its image in the enclosures, after a video or audio", () => {
		const shortPost = { imageLink: art, title: "", body: "<p>Short.</p>" };
		const image = placed(shortPost);
		assert.equal(image.primaryMedia, "");
		assert.match(image.enclosures, /art\.jpg/);
		const withAudio = placed({ ...shortPost, attachments: [audio] });
		assert.doesNotMatch(withAudio.primaryMedia, /<img/);
		assert.match(withAudio.primaryMedia, /<audio/);
		assert.match(withAudio.enclosures, /art\.jpg/);
		const long = { ...shortPost, body: `<p>${"x".repeat(2048)}</p>` };
		assert.match(placed(long).primaryMedia, /art\.jpg/);
	});
});

describe("significantImageURLs", () => {
	const urls = (html: string, base?: string) => significantImageURLs(html, base);

	test("skips what can't stand for an article", () => {
		assert.deepEqual(
			urls(`<img src="https://x.test/a.jpg" width="16" height="16">
				<img src="https://x.test/b.jpg" width="1000" height="10">
				<img class="wp-smiley" src="https://x.test/c.jpg">
				<img src="https://x.test/1x1.gif">
				<img src="https://x.test/d.svg">
				<img hidden src="https://x.test/e.jpg">
				<img style="display:none" src="https://x.test/f.jpg">
				<a href="https://twitter.com/intent/tweet"><img src="https://x.test/g.jpg"></a>
				<a href="mailto:a@x.test"><img src="https://x.test/h.jpg"></a>
				<img src="https://secure.gravatar.com/avatar/abc">
				<!-- <img src="https://x.test/i.jpg"> -->`),
			[],
		);
	});

	test("prefers a lazy source, and a wide-enough srcset candidate", () => {
		assert.deepEqual(
			urls('<img data-src="https://x.test/real.jpg" src="https://x.test/blank.gif">'),
			["https://x.test/real.jpg"],
		);
		assert.deepEqual(
			urls(
				'<img srcset="https://x.test/s.jpg 400w, https://x.test/m.jpg 1400w, https://x.test/l.jpg 2400w" src="https://x.test/o.jpg">',
			),
			["https://x.test/m.jpg"],
		);
		assert.deepEqual(urls('<img srcset="https://x.test/1.jpg 1x, https://x.test/2.jpg 2x">'), [
			"https://x.test/2.jpg",
		]);
	});

	test("resolves against the base, and drops a relative URL without one", () => {
		assert.deepEqual(urls('<img src="/a.jpg">', "https://x.test/post/"), [
			"https://x.test/a.jpg",
		]);
		assert.deepEqual(urls('<img src="/a.jpg">'), []);
		assert.deepEqual(urls('<img src="data:image/png;base64,AA">', "https://x.test/"), []);
	});
});
