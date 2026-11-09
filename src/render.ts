import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { decodeHTML } from "entities";
import { Parser } from "htmlparser2";
import { DELIVERIES, DELIVERY_NAMES, type Delivery, deliver } from "./delivery.ts";
import {
	articleMediaHTML,
	fixtureAttachments,
	fixtureImages,
	placeEnclosures,
} from "./enclosures.ts";
import { renderingInputs } from "./netnewswire.ts";
import {
	type Fixture,
	fixturePath,
	readFixture,
	repositoryFixtures,
	TEMPLATE_7_3_FILE,
	ThemeError,
	themeStem,
} from "./project.ts";
import { formatG, pyStr } from "./pyformat.ts";

const MACRO_RE = /\[\[([a-zA-Z0-9_-]+)\]\]/g;
// A whole <img> or <source> tag; quoted attribute values may contain ">".
const MEDIA_TAG_RE = /<(img|source)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTRIBUTE_RE = /([^\s"'=<>/]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
const TEMPLATE_KEYS = [
	"title",
	"preferred_link",
	"external_link_label",
	"external_link_stripped",
	"external_link",
	"feed_link_title",
	"feed_link",
	"byline",
	"avatar_src",
	"dateline_style",
	"datetime_long",
	"datetime_medium",
	"datetime_short",
	"date_long",
	"date_medium",
	"date_short",
	"time_long",
	"time_medium",
	"time_short",
	"text_size_class",
	"body",
] as const;
// macOS scales through text_size_class, iOS through the font-size macro. largeText
// is the macOS default: an unset preference falls back to ArticleTextSize.large.
export const DEFAULT_TEXT_SIZE_CLASS = "largeText";
export const LARGE_TEXT_SIZE_CLASS = "xxLargeText";
export const DEFAULT_DYNAMIC_TYPE_SIZE = 17.0;
export const LARGE_DYNAMIC_TYPE_SIZE = 23.0;
const WEBKIT_SHIM = `
window.webkit = window.webkit || {messageHandlers: new Proxy({}, {
  get: function() { return {postMessage: function() {}}; }
})};
`;
// The iOS app injects the feed icon's localized accessibility label for main_ios.js
// (WebViewConfiguration.feedInfoLabelScript); templates with #nnwImageIcon need it.
const IOS_LABEL_SHIM = `
const nnwGetFeedInfoLabel = "Get Feed Info";
`;
export type Platform = "mac" | "iphone" | "ipad";
export type Appearance = "light" | "dark";
export const PLATFORM_NAMES: Record<Platform, string> = {
	mac: "Mac",
	iphone: "iPhone",
	ipad: "iPad",
};
const PLATFORMS = Object.keys(PLATFORM_NAMES) as Platform[];
export const APPEARANCES: readonly Appearance[] = ["light", "dark"];
const VIEWPORTS: Record<Platform, [number, number]> = {
	mac: [1280, 800],
	iphone: [393, 852],
	ipad: [834, 1112],
};
// The marketplace card shows its image at 347x240, cropped from the top.
const CARD_VIEWPORT: [number, number] = [800, 552];
// Fixture images a fixture may reference as media/NAME, from fixtures/media/NAME.
const IMAGE_TYPES: Record<string, string> = {
	".avif": "image/avif",
	".gif": "image/gif",
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".svg": "image/svg+xml",
	".webp": "image/webp",
};
// Enclosure players may also play a fixture's own audio or video file.
const PLAYABLE_TYPES: Record<string, string> = {
	".aac": "audio/aac",
	".flac": "audio/flac",
	".m4a": "audio/mp4",
	".m4v": "video/mp4",
	".mov": "video/quicktime",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".oga": "audio/ogg",
	".ogg": "audio/ogg",
	".opus": "audio/ogg",
	".wav": "audio/wav",
	".webm": "video/webm",
};
// An enclosure's own tag, as enclosuresHTML writes it.
const ENCLOSURE_TAG_RE = /<(video|audio|iframe)\b([^>]*)>/g;
// The template's own fixtures get the full matrix and the stress cases. Any other
// fixture a theme adds is an extra: checked on Mac and iPhone in both appearances.
export const FIXTURE_NAMES: Record<string, string> = {
	article: "Article",
	"kitchen-sink": "Kitchen sink",
};
const EXTRA_PLATFORMS: readonly Platform[] = ["mac", "iphone"];
// Gallery sections, in order: [scenario, heading, what the scenario covers].
const SCENARIOS: readonly [string, string, string][] = [
	[
		"article",
		"Everyday reading",
		"The article fixture: a typical short post with a headline, byline, standfirst, " +
			"prose, and a pull quote.",
	],
	[
		"kitchen-sink",
		"Stress test",
		"The kitchen-sink fixture: a very long headline, byline, and feed name; inline " +
			"formatting; nested lists; an unbroken identifier that exposes horizontal " +
			"overflow; a quotation, code block, table, figure, video embeds, footnote, and HTML comments " +
			"in the body.",
	],
	[
		"large-text",
		"Large text",
		"The kitchen-sink fixture at a large reading size: the xxLargeText size class on " +
			"Mac and 23 pt Dynamic Type on iPhone.",
	],
	[
		"older-netnewswire",
		"Older NetNewsWire",
		"The article fixture as NetNewsWire releases before enclosures and primary media " +
			"render it: template.html, with [[enclosures]] and [[primary_media]] left as " +
			"literal text, which must not show.",
	],
	[
		"article-javascript-off",
		"Article JavaScript off",
		"The article fixture with the theme's own scripts removed, as when a reader turns " +
			"off NetNewsWire's Article JavaScript setting. It must still read well.",
	],
];
export const RESERVED_FIXTURE_NAMES = SCENARIOS.map(([scenario]) => scenario);
const CHECKS = [
	"article content renders",
	"no unresolved [[macros]]",
	"no horizontal overflow",
	"no broken images",
	"no external requests",
	"no JavaScript errors",
	"enclosure players and images show, fit the window, and keep their shape",
	"enclosure captions are legible",
];

export class RenderTarget {
	readonly fixture: string;
	readonly platform: Platform;
	readonly appearance: Appearance;
	readonly width: number;
	readonly height: number;
	readonly largeText: boolean;
	readonly themeScripts: boolean;
	/** Rendered as older NetNewsWire: template.html, macros it lacks left literal. */
	readonly olderNetNewsWire: boolean;
	/** A 2x capture of the card viewport alone, for the marketplace card. */
	readonly card: boolean;
	/** The sync service the article arrives through, rewritten as it delivers it. */
	readonly delivery: Delivery | undefined;

	constructor(
		fixture: string,
		platform: Platform,
		appearance: Appearance,
		{
			largeText = false,
			themeScripts = true,
			olderNetNewsWire = false,
			card = false,
			delivery = undefined as Delivery | undefined,
		} = {},
	) {
		this.fixture = fixture;
		this.platform = platform;
		this.appearance = appearance;
		[this.width, this.height] = card ? CARD_VIEWPORT : VIEWPORTS[platform];
		this.largeText = largeText;
		this.themeScripts = themeScripts;
		this.olderNetNewsWire = olderNetNewsWire;
		this.card = card;
		this.delivery = delivery;
	}

	get ios(): boolean {
		return this.platform === "iphone" || this.platform === "ipad";
	}

	get label(): string {
		const parts = [
			FIXTURE_NAMES[this.fixture] ?? this.fixture,
			PLATFORM_NAMES[this.platform],
			this.appearance,
		];
		if (this.largeText) parts.push("large text");
		if (!this.themeScripts) parts.push("Article JavaScript off");
		if (this.olderNetNewsWire) parts.push("older NetNewsWire");
		if (this.delivery) parts.push(`via ${DELIVERY_NAMES[this.delivery]}`);
		if (this.card) parts.push("card");
		return parts.join(" · ");
	}

	get scenario(): string {
		if (this.largeText) return "large-text";
		if (!this.themeScripts) return "article-javascript-off";
		if (this.olderNetNewsWire) return "older-netnewswire";
		if (this.delivery) return `${this.fixture} via ${DELIVERY_NAMES[this.delivery]}`;
		return this.fixture;
	}

	get slug(): string {
		const parts = [this.fixture, this.platform, this.appearance];
		if (this.largeText) parts.push("large-text");
		if (!this.themeScripts) parts.push("no-article-js");
		if (this.olderNetNewsWire) parts.push("older-netnewswire");
		if (this.delivery) parts.push(this.delivery);
		if (this.card) parts.push("card");
		return parts.join("-");
	}
}

/** Fixture names beyond the template's own, in gallery order. */
export function extraFixtures(root: string): string[] {
	const extras = repositoryFixtures(root).filter((name) => !(name in FIXTURE_NAMES));
	const reserved = RESERVED_FIXTURE_NAMES.filter((name) => extras.includes(name)).sort();
	if (reserved.length) {
		throw new ThemeError(
			`fixture name(s) reserved for a check scenario: ${reserved.join(", ")}; rename the file`,
		);
	}
	return extras;
}

/** A fixture's deliveries = [...] key, validated: the services to also render it through. */
export function fixtureDeliveries(fixture: Fixture, name: string): Delivery[] {
	const value = fixture.deliveries;
	if (value === undefined) return [];
	if (
		!Array.isArray(value) ||
		!value.every((item) => DELIVERIES.includes(item as Delivery)) ||
		new Set(value).size !== value.length
	) {
		throw new ThemeError(
			`${name}: deliveries must list distinct services from ${DELIVERIES.join(", ")}`,
		);
	}
	return value as Delivery[];
}

/**
 * Each fixture's deliveries = [...], for those that list any. fixtures are the names
 * to read: the template's own and the extras.
 */
export function readDeliveries(
	root: string,
	fixtures: readonly string[],
): Record<string, Delivery[]> {
	const result: Record<string, Delivery[]> = {};
	for (const name of fixtures) {
		const deliveries = fixtureDeliveries(
			readFixture(fixturePath(root, name)),
			`fixtures/${name}.toml`,
		);
		if (deliveries.length) result[name] = deliveries;
	}
	return result;
}

/** The fixtures a repository renders: the template's own, then its extras. */
export function allFixtures(extras: readonly string[]): string[] {
	return [...Object.keys(FIXTURE_NAMES), ...extras];
}

/**
 * Every fixture's matrix. A fixture that lists deliveries is also rendered through
 * each service, on Mac in light and iPhone in dark, right after its own cases.
 */
export function normalTargets(
	extras: readonly string[] = [],
	deliveries: Record<string, readonly Delivery[]> = {},
): RenderTarget[] {
	const targets: RenderTarget[] = [];
	for (const fixture of allFixtures(extras)) {
		const platforms = fixture in FIXTURE_NAMES ? PLATFORMS : EXTRA_PLATFORMS;
		for (const platform of platforms) {
			for (const appearance of APPEARANCES) {
				targets.push(new RenderTarget(fixture, platform, appearance));
			}
		}
		for (const delivery of deliveries[fixture] ?? []) {
			targets.push(
				new RenderTarget(fixture, "mac", "light", { delivery }),
				new RenderTarget(fixture, "iphone", "dark", { delivery }),
			);
		}
	}
	return targets;
}

/** A repository's normal matrix, including each fixture's deliveries. */
export function repositoryTargets(root: string): RenderTarget[] {
	const extras = extraFixtures(root);
	return normalTargets(extras, readDeliveries(root, allFixtures(extras)));
}

/**
 * Everything check renders. A theme whose older releases render differently (see
 * rendersDifferentlyWhenOlder) also gets the older-NetNewsWire cases.
 */
export function checkTargets(
	extras: readonly string[] = [],
	{ olderNetNewsWire = false, deliveries = {} as Record<string, readonly Delivery[]> } = {},
): RenderTarget[] {
	const targets = [
		...normalTargets(extras, deliveries),
		new RenderTarget("kitchen-sink", "mac", "light", { largeText: true }),
		new RenderTarget("kitchen-sink", "iphone", "light", { largeText: true }),
		new RenderTarget("article", "mac", "light", { themeScripts: false }),
		new RenderTarget("article", "iphone", "light", { themeScripts: false }),
	];
	if (olderNetNewsWire) {
		targets.push(
			new RenderTarget("article", "mac", "light", { olderNetNewsWire: true }),
			new RenderTarget("article", "iphone", "dark", { olderNetNewsWire: true }),
		);
	}
	return targets;
}

/**
 * Whether older NetNewsWire renders this theme differently: it ignores template7.3.html,
 * and leaves a macro it doesn't know as text in every article.
 */
export function rendersDifferentlyWhenOlder(theme: string): boolean {
	if (existsSync(join(theme, TEMPLATE_7_3_FILE))) return true;
	const template = read(join(theme, "template.html"));
	return ["[[enclosures]]", "[[primary_media]]"].some((macro) => template.includes(macro));
}

/** The template NetNewsWire reads: 7.3 prefers template7.3.html, older releases can't. */
function themeTemplate(theme: string, target: RenderTarget): string {
	const preferred = join(theme, TEMPLATE_7_3_FILE);
	return read(
		!target.olderNetNewsWire && existsSync(preferred)
			? preferred
			: join(theme, "template.html"),
	);
}

/** Perform NetNewsWire's single-pass, non-recursive macro substitution. */
export function substitute(template: string, mapping: Record<string, unknown>): string {
	return template.replace(MACRO_RE, (match, name: string) =>
		Object.hasOwn(mapping, name) ? pyStr(mapping[name]) : match,
	);
}

/** Python's html.escape(value), which also escapes quotes. */
export function escapeHTML(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#x27;");
}

function base64(text: string): string {
	return Buffer.from(text, "utf8").toString("base64");
}

function avatarDataURI(title: string): string {
	const words = title.trim().split(/\s+/).filter(Boolean);
	const initials = words.length
		? words
				.slice(0, 3)
				.map((word) => Array.from(word)[0])
				.join("")
				.toUpperCase()
		: "?";
	const byte = Number.parseInt(
		createHash("sha256").update(title, "utf8").digest("hex").slice(0, 2),
		16,
	);
	const hue = ((byte / 255) * 360).toFixed(0);
	const svg =
		'<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
		`<rect width="96" height="96" rx="18" fill="hsl(${hue} 42% 38%)"/>` +
		'<text x="48" y="50" text-anchor="middle" dominant-baseline="central" ' +
		'font-family="system-ui" font-size="32" font-weight="700" fill="white">' +
		`${escapeHTML(initials)}</text></svg>`;
	return `data:image/svg+xml;base64,${base64(svg)}`;
}

/** Whether a URL would load over the network, including relative to the base URL. */
function fetches(url: string): boolean {
	const value = url.trim().toLowerCase();
	return !!value && !value.startsWith("data:") && !value.startsWith("#");
}

function placeholder(width?: string, height?: string): string {
	const size = [width, height].map((value) =>
		value && /^[0-9]+$/.test(value) ? Number.parseInt(value, 10) : 0,
	);
	const [widthPx, heightPx] = size.every(Boolean) ? size : [1600, 900];
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}">` +
		'<rect width="100%" height="100%" fill="#8a8f98" fill-opacity=".35"/></svg>';
	return `data:image/svg+xml;base64,${base64(svg)}`;
}

/**
 * A fixture's own image, media/NAME, as a data URI read from fixtures/media/NAME.
 * Undefined, so a placeholder as before, unless it is an image inside that directory.
 */
function mediaDataURI(
	media: string,
	src: string,
	types: Record<string, string> = IMAGE_TYPES,
): string | undefined {
	const type = types[extname(src).toLowerCase()];
	if (!src.startsWith("media/") || !type) return undefined;
	try {
		const path = realpathSync(join(media, src.slice("media/".length)));
		const inside = relative(realpathSync(media), path);
		if (inside.startsWith("..") || isAbsolute(inside)) return undefined;
		return `data:${type};base64,${readFileSync(path).toString("base64")}`;
	} catch {
		return undefined;
	}
}

/**
 * Swap a fixture's network images for same-size placeholders.
 *
 * Previews never touch the network, so a captured article's images would otherwise
 * render broken. Each <img> keeps its attributes and width/height (16:9 when it has
 * none), so layout matches; a <source> that would fetch is dropped for its <img>.
 * With a media directory, an <img src="media/NAME"> shows that file instead.
 */
export function offlineMedia(body: string, media?: string): string {
	return body.replace(MEDIA_TAG_RE, (whole, tagName: string, rest: string) => {
		const tag = tagName.toLowerCase();
		const attributes = [...rest.matchAll(ATTRIBUTE_RE)].map((match): [string, string] => [
			match[1] ?? "",
			match[2] ?? "",
		]);
		const values = new Map(
			attributes.map(([name, value]) => [
				name.toLowerCase(),
				decodeHTML(value.replace(/^["']+|["']+$/g, "")),
			]),
		);
		const src = values.get("src") ?? "";
		const srcset = (values.get("srcset") ?? "").split(",").some(fetches);
		if (!(srcset || fetches(src))) return whole;
		if (tag === "source") return "";
		const kept = attributes
			.filter(([name]) => !["src", "srcset", "sizes"].includes(name.toLowerCase()))
			.map(([name, value]) => (value ? ` ${name}=${value}` : ` ${name}`))
			.join("");
		const local = media === undefined ? undefined : mediaDataURI(media, src);
		return `<${tagName}${kept} src="${local ?? placeholder(values.get("width"), values.get("height"))}">`;
	});
}

/** A tag's attributes, in order, with their raw (still quoted) values. */
function parseAttributes(rest: string): [string, string][] {
	return [...rest.matchAll(ATTRIBUTE_RE)].map((match): [string, string] => [
		match[1] ?? "",
		match[2] ?? "",
	]);
}

function attributeValue(attributes: [string, string][], name: string): string | undefined {
	const found = attributes.find(([key]) => key.toLowerCase() === name);
	return found && decodeHTML(found[1].replace(/^["']+|["']+$/g, ""));
}

/**
 * Take enclosures offline, as offlineMedia does a body. Images and a video's poster
 * become placeholders (media/NAME shows the fixture's file); a player that would
 * fetch loses its source, as if the file had not loaded, unless it plays a media/
 * file; a video with nothing to show gets a placeholder poster at its own size, for
 * the frame it would load; and the YouTube player becomes a same-size placeholder.
 */
export function offlineEnclosures(html: string, media?: string): string {
	const local = (src: string, types?: Record<string, string>) =>
		media === undefined ? undefined : mediaDataURI(media, src, types);
	return offlineMedia(html, media).replace(
		ENCLOSURE_TAG_RE,
		(_whole, tagName: string, rest: string) => {
			const attributes = parseAttributes(rest);
			const width = attributeValue(attributes, "width");
			const height = attributeValue(attributes, "height");
			const src = attributeValue(attributes, "src") ?? "";
			if (tagName === "iframe") {
				const label = `${width && height ? `${width} × ${height} ` : ""}YouTube player`;
				const page =
					"<body style='margin:0;display:grid;place-items:center;height:100vh;" +
					`background:#8a8f98;color:#fff;font:600 16px system-ui'>${label}`;
				const kept = attributes.filter(([name]) => name.toLowerCase() !== "src");
				return `<iframe${kept.map(([n, v]) => (v ? ` ${n}=${v}` : ` ${n}`)).join("")} srcdoc="${escapeHTML(page)}">`;
			}
			const playable = fetches(src) ? local(src, PLAYABLE_TYPES) : src;
			const kept = attributes.filter(
				([name]) => !["src", "poster"].includes(name.toLowerCase()),
			);
			let tag = `<${tagName}${kept.map(([n, v]) => (v ? ` ${n}=${v}` : ` ${n}`)).join("")}`;
			if (playable) tag += ` src="${escapeHTML(playable)}"`;
			if (tagName === "video") {
				const poster = attributeValue(attributes, "poster");
				let shown: string | undefined;
				if (poster)
					shown = fetches(poster) ? (local(poster) ?? placeholder(width, height)) : poster;
				else if (!playable) shown = placeholder(width, height);
				if (shown) tag += ` poster="${escapeHTML(shown)}"`;
			}
			return `${tag}>`;
		},
	);
}

function fixtureMapping(
	fixture: Fixture,
	target: RenderTarget,
	template: string,
	media?: string,
): Record<string, string> {
	const mapping: Record<string, string> = {};
	for (const key of TEMPLATE_KEYS) mapping[key] = pyStr(fixture[key] ?? "");
	if (!mapping.dateline_style) {
		mapping.dateline_style = mapping.title ? "articleDateline" : "articleDatelineTitle";
	}
	let body = mapping.body ?? "";
	if (target.delivery) body = deliver(body, target.delivery, mapping.preferred_link ?? "");
	mapping.body = offlineMedia(body, media);
	// NetNewsWire before these macros ignores attachments and leaves them literal.
	if (!target.olderNetNewsWire) {
		const name = `fixtures/${target.fixture}.toml`;
		const { primaryMedia, enclosures } = articleMediaHTML(
			{
				attachments: fixtureAttachments(fixture, name),
				...fixtureImages(fixture, name),
				title: mapping.title ?? "",
				body,
				baseURL: pageBaseURL(fixture, target),
			},
			template.includes("[[primary_media]]"),
		);
		mapping.primary_media = offlineEnclosures(primaryMedia, media);
		Object.assign(
			mapping,
			placeEnclosures(template, mapping.body, offlineEnclosures(enclosures, media)),
		);
	}
	if (!mapping.avatar_src || fetches(mapping.avatar_src)) {
		mapping.avatar_src = avatarDataURI(mapping.feed_link_title ?? "");
	}
	if (target.ios) {
		// NetNewsWire leaves this macro unresolved on iOS; empty renders the same.
		mapping.text_size_class = "";
	} else {
		const fallback = target.largeText ? LARGE_TEXT_SIZE_CLASS : DEFAULT_TEXT_SIZE_CLASS;
		mapping.text_size_class = pyStr(fixture.text_size_class || fallback);
	}
	return mapping;
}

function read(path: string): string {
	return readFileSync(path, "utf8");
}

function injectScripts(page: string, inputs: string, platform: Platform): string {
	const ios = platform === "iphone" || platform === "ipad";
	const scripts = [WEBKIT_SHIM];
	if (ios) scripts.push(IOS_LABEL_SHIM);
	scripts.push(
		read(join(inputs, "Shared", "main.js")),
		read(ios ? join(inputs, "iOS", "main_ios.js") : join(inputs, "Mac", "main_mac.js")),
		read(join(inputs, "Shared", "newsfoot.js")),
	);
	const bundle = scripts.map((script) => `<script>\n${script}\n</script>`).join("\n");
	// The theme and fixture are already substituted into the page, so an earlier
	// </body> can be article text; the skeleton's own closing tag is the last one.
	const end = page.lastIndexOf("</body>");
	return `${page.slice(0, end)}${bundle}\n${page.slice(end)}`;
}

/**
 * Remove every <script> element as WebKit's tokenizer finds them, including end
 * tags like "</script >" and a script left open to the end of the document.
 */
export function removeScripts(html: string): string {
	const ranges: [number, number][] = [];
	let start = -1;
	const parser = new Parser({
		onopentag(name) {
			if (name === "script") start = parser.startIndex;
		},
		onclosetag(name, isImplied) {
			if (name !== "script" || start < 0) return;
			const end = isImplied
				? html.length
				: html.indexOf(">", parser.endIndex) + 1 || html.length;
			ranges.push([start, end]);
			start = -1;
		},
	});
	parser.end(html);
	let result = "";
	let offset = 0;
	for (const [from, to] of ranges) {
		result += html.slice(offset, from);
		offset = to;
	}
	return result + html.slice(offset);
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * Article.baseURL, made absolute as NetNewsWire does: no fragment, and nothing unless
 * http or https.
 */
export function articleBaseURL(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	url.hash = "";
	return url.href;
}

/**
 * The page's base URL: the fixture's base_url when it gives one, else its link. An
 * article synced through the Reader API (FreshRSS, Miniflux, Inoreader) has only an
 * external link, so NetNewsWire falls back to the feed's home page: a delivered case
 * uses feed_link, unless base_url gives the home page the service reports instead.
 */
function pageBaseURL(fixture: Fixture, target: RenderTarget): string {
	const name = `fixtures/${target.fixture}.toml`;
	const baseURL = fixture.base_url;
	if (baseURL !== undefined && typeof baseURL !== "string") {
		throw new ThemeError(`${name}: base_url must be a string`);
	}
	if (baseURL !== undefined) return articleBaseURL(baseURL);
	if (target.delivery && typeof fixture.feed_link === "string" && fixture.feed_link) {
		return articleBaseURL(fixture.feed_link);
	}
	return pyStr(fixture.preferred_link || fixture.feed_link || "");
}

export function renderPage(
	theme: string,
	fixture: Fixture,
	target: RenderTarget,
	snapshot: string = renderingInputs().path,
	media?: string,
): string {
	const pagePath = join(snapshot, target.ios ? "iOS" : "Mac", "page.html");
	const required = [
		pagePath,
		join(snapshot, "Shared", "core.css"),
		join(snapshot, "Shared", "main.js"),
	];
	if (!required.every(isFile)) {
		throw new ThemeError("bundled NetNewsWire rendering inputs are incomplete");
	}

	const skeleton = removeScripts(read(pagePath));
	const stylesheet = read(join(theme, "stylesheet.css"));
	// styleSubstitutions() is empty on macOS, so the macro must stay literal there.
	const styleSubstitutions: Record<string, string> = {};
	if (target.ios) {
		const size = target.largeText ? LARGE_DYNAMIC_TYPE_SIZE : DEFAULT_DYNAMIC_TYPE_SIZE;
		styleSubstitutions["font-size"] = formatG(Number(fixture.font_size ?? size));
	}
	const style = substitute(
		`${read(join(snapshot, "Shared", "core.css"))}\n${stylesheet}`,
		styleSubstitutions,
	);

	const template = themeTemplate(theme, target);
	let body = substitute(template, fixtureMapping(fixture, target, template, media));
	if (!target.themeScripts) body = removeScripts(body);
	let page = substitute(skeleton, {
		title: fixture.title ?? "Theme preview",
		style,
		body,
		baseURL: pageBaseURL(fixture, target),
		windowScrollY: "0",
	});
	page = injectScripts(page, snapshot, target.platform);
	const csp =
		"default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
		"img-src data:; media-src data:; connect-src 'none'; frame-src 'none'; " +
		"object-src 'none'; base-uri http: https:; form-action 'none'";
	const head =
		'<meta charset="utf-8">\n' +
		'<meta name="color-scheme" content="light dark">\n' +
		`<meta http-equiv="Content-Security-Policy" content="${csp}">`;
	return page.replace(/(<head[^>]*>)/i, (match) => `${match}\n${head}`);
}

export function renderSite(
	root: string,
	theme: string,
	targets: readonly RenderTarget[],
	snapshot: string = renderingInputs().path,
): string {
	const site = join(root, "build", "preview");
	rmSync(site, { recursive: true, force: true });
	const pages = join(site, "pages");
	const views = join(site, "views");
	for (const directory of [pages, views, join(site, "screenshots")]) {
		mkdirSync(directory, { recursive: true });
	}
	const name = themeStem(theme);
	for (const target of targets) {
		const fixture = readFixture(fixturePath(root, target.fixture));
		writeFileSync(
			join(pages, `${target.slug}.html`),
			renderPage(theme, fixture, target, snapshot, join(root, "fixtures", "media")),
			"utf8",
		);
		const label = escapeHTML(target.label);
		const viewer = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${label} · ${escapeHTML(name)} preview</title><style>
html,body,iframe { border: 0; height: 100%; margin: 0; width: 100%; }
</style></head><body><iframe src="../pages/${target.slug}.html" sandbox="allow-scripts"
style="color-scheme: ${target.appearance}"
title="Sandboxed ${label} theme preview"></iframe></body></html>`;
		writeFileSync(join(views, `${target.slug}.html`), viewer, "utf8");
	}
	writeGallery(site, name, targets);
	return site;
}

export type Results = Record<string, string[]>;

function renderCase(target: RenderTarget, failures: string[] | null): string {
	const slug = escapeHTML(target.slug);
	const label = escapeHTML(target.label);
	const shot = `screenshots/${slug}.png`;
	let status = "";
	if (failures !== null) {
		status = failures.length
			? '<span class="badge fail">✗ Failed</span>'
			: '<span class="badge pass">✓ Passed</span>';
	}
	const reasons = (failures ?? []).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("");
	// The live page renders at the real viewport size and is scaled into the thumbnail;
	// the checked screenshot covers it once it exists.
	return (
		`<figure class="case${failures?.length ? " failed" : ""}" id="${slug}">` +
		`<a class="thumb" href="views/${slug}.html" ` +
		`style="aspect-ratio: ${target.width} / ${target.height}">` +
		`<iframe loading="lazy" src="pages/${slug}.html" sandbox="allow-scripts" ` +
		`tabindex="-1" width="${target.width}" height="${target.height}" ` +
		`style="color-scheme: ${target.appearance}" ` +
		`title="Sandboxed ${label} theme preview"></iframe>` +
		`<img src="${shot}" alt="Checked screenshot: ${label}" ` +
		'onload="this.previousElementSibling.remove()" onerror="this.remove()"></a>' +
		`<figcaption>${status}` +
		`<a href="views/${slug}.html">Full size</a>` +
		`${failures !== null ? ` · <a href=${shot}>Screenshot</a>` : ""}` +
		`${reasons ? `<ul class=reasons>${reasons}</ul>` : ""}</figcaption></figure>`
	);
}

function title(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

function section(
	heading: string,
	description: string,
	targets: readonly RenderTarget[],
	results: Results | null,
): string {
	const platforms = PLATFORMS.filter((name) => targets.some((t) => t.platform === name));
	const appearances = APPEARANCES.filter((name) => targets.some((t) => t.appearance === name));
	const header = appearances.map((name) => `<div class="column">${title(name)}</div>`).join("");
	const byCell = new Map(targets.map((t) => [`${t.platform}/${t.appearance}`, t]));
	const rows = platforms.map((platform) => {
		const cells = appearances.map((appearance) => {
			const target = byCell.get(`${platform}/${appearance}`);
			if (!target) return "<div></div>";
			return renderCase(target, results === null ? null : (results[target.slug] ?? []));
		});
		return `<div class="row-label">${PLATFORM_NAMES[platform]}</div>${cells.join("")}`;
	});
	return (
		`<section><h2>${escapeHTML(heading)}</h2><p>${escapeHTML(description)}</p>` +
		`<div class="matrix" style="--columns: ${appearances.length}">` +
		`<div></div>${header}${rows.join("")}</div></section>`
	);
}

/** Write index.html; results maps each checked slug to its failures. */
export function writeGallery(
	site: string,
	themeName: string,
	targets: readonly RenderTarget[],
	results: Results | null = null,
): void {
	const known = new Set(RESERVED_FIXTURE_NAMES);
	const scenarios = new Map(
		SCENARIOS.map(([scenario, heading, text]) => [scenario, [heading, text]]),
	);
	for (const target of targets) {
		if (known.has(target.scenario) || scenarios.has(target.scenario)) continue;
		if (target.delivery) {
			const service = DELIVERY_NAMES[target.delivery];
			scenarios.set(target.scenario, [
				target.scenario,
				`fixtures/${target.fixture}.toml as ${service} delivers it through the Reader ` +
					`API: its body rewritten by ${service}'s sanitizer, and the feed's home page ` +
					"as the page's base URL.",
			]);
		} else {
			scenarios.set(target.scenario, [target.fixture, `Your fixtures/${target.fixture}.toml.`]);
		}
	}
	const sections: string[] = [];
	for (const [scenario, [heading = "", text = ""]] of scenarios) {
		const members = targets.filter((target) => target.scenario === scenario);
		if (members.length) sections.push(section(heading, text, members, results));
	}

	let summary: string;
	let failedList = "";
	if (results === null) {
		summary =
			`<p class=summary>${targets.length} cases, not checked yet. Run ` +
			"<code>npx nnw-theme@2 check</code> to verify them in WebKit.</p>";
	} else {
		const failed = targets.filter((target) => results[target.slug]?.length);
		summary =
			`<p class="summary ${failed.length ? "fail" : "pass"}">${targets.length} cases · ` +
			`${targets.length - failed.length} passed · ${failed.length} failed</p>`;
		if (failed.length) {
			failedList =
				"<section class=failures><h2>Failures</h2><ul>" +
				failed
					.map(
						(t) =>
							`<li><a href="#${escapeHTML(t.slug)}">${escapeHTML(t.label)}</a>: ` +
							`${escapeHTML((results[t.slug] ?? []).join("; "))}</li>`,
					)
					.join("") +
				"</ul></section>";
		}
	}
	const checks = CHECKS.map((check) => `<li>${escapeHTML(check)}</li>`).join("");
	const name = escapeHTML(themeName);
	const gallery = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E">
<title>${name} preview</title><style>
:root { color-scheme: light dark; font-family: system-ui; --pass: #1a7f37; --fail: #cf222e;
  --line: color-mix(in srgb, CanvasText 18%, Canvas);
  --wash: color-mix(in srgb, CanvasText 6%, Canvas); }
@media (prefers-color-scheme: dark) { :root { --pass: #3fb950; --fail: #f85149; } }
body { background: Canvas; color: CanvasText; line-height: 1.45; margin: 0 auto;
  max-width: 72rem; padding: 1.5rem 1rem 4rem; }
.notice { background: var(--wash); border-radius: .4rem; font-size: .9rem;
  margin: 0 0 1.5rem; padding: .6rem .9rem; }
h1 { margin: 0 0 .3rem; } h2 { margin: 0 0 .25rem; }
.summary { font-size: 1.1rem; font-weight: 600; margin: 0 0 .5rem; }
.summary.pass { color: var(--pass); } .summary.fail { color: var(--fail); }
details { margin-bottom: 1rem; } summary { cursor: pointer; }
section { border-top: 1px solid var(--line); padding: 1.5rem 0 .5rem; }
section > p { margin: 0 0 1rem; max-width: 46rem; }
.failures li { margin-bottom: .3rem; } .failures a { color: var(--fail); }
.matrix { align-items: start; display: grid; gap: 1rem 1.25rem;
  grid-template-columns: 4rem repeat(var(--columns), minmax(0, 1fr)); }
.column { font-weight: 600; }
.row-label { font-weight: 600; padding-top: .3rem; }
.case { margin: 0; }
.thumb { background: var(--wash); border: 1px solid var(--line); border-radius: .5rem;
  display: block; height: 20rem; max-width: 100%; overflow: hidden; position: relative;
  width: auto; }
.case.failed .thumb { border: 2px solid var(--fail); }
.thumb iframe { border: 0; left: 0; pointer-events: none; position: absolute; top: 0;
  transform-origin: 0 0; }
.thumb img { display: block; height: 100%; object-fit: cover; object-position: top;
  width: 100%; }
figcaption { font-size: .85rem; margin-top: .4rem; }
.badge { font-weight: 600; margin-right: .5rem; }
.badge.pass { color: var(--pass); } .badge.fail { color: var(--fail); }
.reasons { color: var(--fail); margin: .3rem 0 0; padding-left: 1.1rem; }
@media (max-width: 40rem) {
  .matrix { grid-template-columns: repeat(var(--columns), minmax(0, 1fr)); }
  .matrix > div:first-child { display: none; }
  .row-label { grid-column: 1 / -1; padding: 0; }
  .thumb { height: auto; width: 100%; }
}
</style></head><body>
<p class="notice">Development preview. Install themes only from a release.</p>
<h1>${name} preview</h1>
${summary}
<details><summary>What every case checks</summary><ul>${checks}</ul></details>
${failedList}${sections.join("")}
<script>
// Scale each live page from its real viewport width down to the thumbnail.
const fit = frame => { frame.style.transform =
  \`scale(\${frame.parentElement.clientWidth / frame.width})\`; };
const observer = new ResizeObserver(entries =>
  entries.forEach(entry => entry.target.querySelectorAll("iframe").forEach(fit)));
document.querySelectorAll(".thumb").forEach(thumb => observer.observe(thumb));
</script></body></html>`;
	writeFileSync(join(site, "index.html"), gallery, "utf8");
}
