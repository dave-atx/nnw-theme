// Article HTML as a sync service delivers it to NetNewsWire. FreshRSS and Miniflux
// sanitize every article before NetNewsWire sees it, and both rewrites can break a
// theme that relies on the publisher's ids, classes, wrappers, or relative links.
//
// Each policy follows its service's sanitizer, closely enough for a preview: Miniflux's
// internal/reader/sanitizer/sanitizer.go (2.3.5) and FreshRSS's SimplePie settings in
// app/Models/SimplePieCustom.php (1.30.4). Neither removes tracking parameters or
// rewrites iframe URLs, which no theme can see in an offline preview. No imports from
// the project: commands.ts lists DELIVERIES, and project.ts imports commands.ts.
import { Parser } from "htmlparser2";

export const DELIVERIES = ["freshrss", "miniflux"] as const;
export type Delivery = (typeof DELIVERIES)[number];
export const DELIVERY_NAMES: Record<Delivery, string> = {
	freshrss: "FreshRSS",
	miniflux: "Miniflux",
};

const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

/** What a policy does with one element: keep it with these attributes, keep only its content, or drop it whole. */
type Decision = { keep: [string, string][] } | "unwrap" | "drop";
type Policy = (tag: string, attributes: [string, string][], articleURL: string) => Decision;

function escapeText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function absolute(value: string, base: string): string | undefined {
	try {
		return new URL(value.trim(), base || undefined).href;
	} catch {
		return undefined;
	}
}

function scheme(url: string): string {
	return url.slice(0, Math.max(url.indexOf(":"), 0)).toLowerCase();
}

/** Rewrite html element by element, as policy decides; comments are always dropped. */
function rewrite(html: string, policy: Policy, articleURL: string): string {
	let output = "";
	// One entry per open element: whether its end tag is written, or "drop" while its subtree is skipped.
	const stack: (boolean | "drop")[] = [];
	const dropping = () => stack.includes("drop");
	const parser = new Parser(
		{
			onopentag(name, attribs) {
				if (dropping()) {
					stack.push("drop");
					return;
				}
				const decision = policy(name, Object.entries(attribs), articleURL);
				if (decision === "drop") {
					stack.push("drop");
				} else if (decision === "unwrap") {
					stack.push(false);
				} else {
					const attributes = decision.keep
						.map(([key, value]) =>
							value === "" ? ` ${key}` : ` ${key}="${escapeAttribute(value)}"`,
						)
						.join("");
					output += `<${name}${attributes}>`;
					stack.push(!VOID_ELEMENTS.has(name));
				}
			},
			ontext(text) {
				if (!dropping()) output += escapeText(text);
			},
			onclosetag(name) {
				const entry = stack.pop();
				if (entry === true) output += `</${name}>`;
			},
		},
		{ decodeEntities: true },
	);
	parser.end(html);
	return output;
}

// Miniflux: an allowlist of elements and attributes; anything else is unwrapped.
const MINIFLUX_ALLOWED: Record<string, readonly string[]> = {
	a: ["href", "title", "id"],
	abbr: ["title"],
	acronym: ["title"],
	aside: [],
	audio: ["src"],
	blockquote: [],
	b: [],
	br: [],
	caption: [],
	cite: [],
	code: [],
	dd: ["id"],
	del: [],
	dfn: [],
	dl: ["id"],
	dt: ["id"],
	em: [],
	figcaption: [],
	figure: [],
	h1: ["id"],
	h2: ["id"],
	h3: ["id"],
	h4: ["id"],
	h5: ["id"],
	h6: ["id"],
	hr: [],
	i: [],
	iframe: ["width", "height", "frameborder", "src", "allowfullscreen"],
	img: [
		"alt",
		"title",
		"src",
		"srcset",
		"sizes",
		"width",
		"height",
		"fetchpriority",
		"decoding",
	],
	ins: [],
	kbd: [],
	li: ["id"],
	ol: ["id"],
	p: [],
	picture: [],
	pre: [],
	q: ["cite"],
	rp: [],
	rt: [],
	rtc: [],
	ruby: [],
	s: [],
	small: [],
	samp: [],
	source: ["src", "type", "srcset", "sizes", "media"],
	strong: [],
	sub: [],
	sup: ["id"],
	table: [],
	td: ["rowspan", "colspan"],
	tfoot: [],
	th: ["rowspan", "colspan"],
	thead: [],
	time: ["datetime"],
	tr: [],
	u: [],
	ul: ["id"],
	var: [],
	video: ["poster", "height", "width", "src"],
	wbr: [],
};
const MINIFLUX_IFRAME_HOSTS = new Set([
	"bandcamp.com",
	"cdn.embedly.com",
	"dailymotion.com",
	"framatube.org",
	"open.spotify.com",
	"player.bilibili.com",
	"player.twitch.tv",
	"player.vimeo.com",
	"soundcloud.com",
	"vk.com",
	"w.soundcloud.com",
	"youtube-nocookie.com",
	"youtube.com",
]);
const MINIFLUX_BLOCKED_URLS = [
	"api.flattr.com",
	"www.facebook.com/sharer.php",
	"feeds.feedburner.com",
	"feedsportal.com",
	"linkedin.com/shareArticle",
	"pinterest.com/pin/create/button/",
	"stats.wordpress.com",
	"twitter.com/intent/tweet",
	"twitter.com/share",
	"x.com/intent/tweet",
	"x.com/share",
];
const MINIFLUX_SCHEMES = new Set(
	(
		"https http apt bitcoin callto dav davs ed2k facetime feed ftp geo git gopher irc irc6 " +
		"ircs itms-apps itms magnet mailto news nntp rtmp sftp sip sips shortcuts skype spotify " +
		"ssh steam svn svn+ssh tel webcal xmpp opener hack"
	).split(" "),
);
const MINIFLUX_DATA_IMAGES = [
	"data:image/avif",
	"data:image/apng",
	"data:image/png",
	"data:image/svg",
	"data:image/jpg",
	"data:image/jpeg",
	"data:image/gif",
	"data:image/webp",
];
const URL_ATTRIBUTES = new Set(["src", "href", "poster", "cite"]);

function positiveInteger(value: string): boolean {
	return /^\+?[0-9]+$/.test(value) && Number(value) > 0;
}

function minifluxSrcset(value: string, base: string): string {
	return value
		.split(",")
		.map((candidate) => candidate.trim().split(/\s+/))
		.flatMap(([url = "", ...descriptors]) => {
			const resolved = url ? absolute(url, base) : undefined;
			if (!resolved || !MINIFLUX_SCHEMES.has(scheme(resolved))) return [];
			if (MINIFLUX_BLOCKED_URLS.some((blocked) => resolved.includes(blocked))) return [];
			return [[resolved, ...descriptors].join(" ")];
		})
		.join(", ");
}

const miniflux: Policy = (tag, attributes, articleURL) => {
	if (["script", "style", "noscript"].includes(tag)) return "drop";
	if (attributes.some(([key]) => key === "hidden")) return "drop";
	if (tag === "img") {
		const tiny = (key: string) =>
			attributes.some(([name, value]) => name === key && (value === "0" || value === "1"));
		if (tiny("width") && tiny("height")) return "drop";
	}
	const allowed = MINIFLUX_ALLOWED[tag];
	if (!allowed) return "unwrap";
	const keep: [string, string][] = [];
	let anchorLink = false;
	let youTube = false;
	for (const [key, raw] of attributes) {
		if (!allowed.includes(key)) continue;
		let value = raw;
		if (tag === "img") {
			if (key === "fetchpriority" && !["high", "low", "auto"].includes(value)) continue;
			if (key === "decoding" && !["sync", "async", "auto"].includes(value)) continue;
			if ((key === "width" || key === "height") && !positiveInteger(value)) continue;
		}
		if ((tag === "img" || tag === "source") && key === "srcset") {
			value = minifluxSrcset(value, articleURL);
			if (!value) continue;
		}
		if (URL_ATTRIBUTES.has(key)) {
			if (tag === "iframe") {
				let host = "";
				try {
					host = new URL(raw, "https://invalid.example").hostname.replace(/^www\./, "");
				} catch {
					// Not a URL: not an allowed host.
				}
				if (!MINIFLUX_IFRAME_HOSTS.has(host)) return "drop";
				youTube = host === "youtube.com" || host === "youtube-nocookie.com";
			} else if (
				tag === "img" &&
				key === "src" &&
				MINIFLUX_DATA_IMAGES.some((p) => raw.startsWith(p))
			) {
				// Allowed data image.
			} else if (tag === "a" && key === "href" && raw.startsWith("#")) {
				anchorLink = true;
			} else {
				if (MINIFLUX_BLOCKED_URLS.some((blocked) => raw.includes(blocked))) {
					return tag === "iframe" ? "drop" : "unwrap";
				}
				const resolved = absolute(raw, articleURL);
				if (!resolved || !MINIFLUX_SCHEMES.has(scheme(resolved))) continue;
				value = resolved;
			}
		}
		keep.push([key, value]);
	}
	const has = (key: string) => keep.some(([name]) => name === key);
	const required =
		tag === "a"
			? has("href")
			: tag === "iframe"
				? has("src")
				: tag === "img" || tag === "source"
					? has("src") || has("srcset")
					: true;
	if (!required) return tag === "iframe" ? "drop" : "unwrap";
	if (!anchorLink) {
		if (tag === "a") {
			keep.push(["rel", "noopener noreferrer"], ["referrerpolicy", "no-referrer"]);
			// The default for Miniflux's "Open external links in a new tab" setting.
			keep.push(["target", "_blank"]);
		} else if (tag === "video" || tag === "audio") {
			keep.push(["controls", ""]);
		} else if (tag === "iframe") {
			keep.push(
				[
					"sandbox",
					"allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox",
				],
				["loading", "lazy"],
			);
			if (youTube) keep.push(["referrerpolicy", "strict-origin-when-cross-origin"]);
		} else if (tag === "img") {
			keep.push(["loading", "lazy"]);
		}
	}
	return { keep };
};

// FreshRSS: SimplePie with FreshRSS's allowlist. id and class survive only renamed,
// as data-sanitized-id and data-sanitized-class; data-* and aria-* attributes stay.
const FRESHRSS_GLOBAL = ["dir", "draggable", "hidden", "lang", "role", "title"];
const FRESHRSS_ALLOWED: Record<string, readonly string[]> = {
	a: ["href", "hreflang", "type"],
	abbr: [],
	acronym: [],
	address: [],
	article: [],
	aside: [],
	audio: ["controlslist", "loop", "muted", "src"],
	b: [],
	bdi: [],
	bdo: [],
	big: [],
	blink: [],
	blockquote: ["cite"],
	br: ["clear"],
	button: ["disabled"],
	canvas: ["width", "height"],
	caption: ["align"],
	center: [],
	cite: [],
	code: [],
	col: ["span", "align", "valign", "width"],
	colgroup: ["span", "align", "valign", "width"],
	data: ["value"],
	datalist: [],
	dd: [],
	del: ["cite", "datetime"],
	details: ["open"],
	dfn: [],
	dialog: [],
	dir: [],
	div: ["align"],
	dl: [],
	dt: [],
	em: [],
	fieldset: ["disabled"],
	figcaption: [],
	figure: [],
	footer: [],
	h1: [],
	h2: [],
	h3: [],
	h4: [],
	h5: [],
	h6: [],
	header: [],
	hgroup: [],
	hr: ["align", "noshade", "size", "width"],
	i: [],
	iframe: [
		"src",
		"align",
		"frameborder",
		"longdesc",
		"marginheight",
		"marginwidth",
		"scrolling",
		"allowfullscreen",
	],
	img: ["src", "alt", "width", "height", "align", "border", "hspace", "longdesc", "vspace"],
	ins: ["cite", "datetime"],
	kbd: [],
	label: [],
	legend: [],
	li: ["value", "type"],
	main: [],
	mark: [],
	menu: [],
	meter: ["value", "min", "max", "low", "high", "optimum"],
	nav: [],
	nobr: [],
	ol: ["reversed", "start", "type"],
	output: [],
	p: ["align"],
	picture: [],
	pre: ["width", "wrap"],
	progress: ["max", "value"],
	q: ["cite"],
	rb: [],
	rp: [],
	rt: [],
	rtc: [],
	ruby: [],
	s: [],
	samp: [],
	search: [],
	section: [],
	small: [],
	source: ["type", "src", "media", "height", "width"],
	span: [],
	strike: [],
	strong: [],
	sub: [],
	summary: [],
	sup: [],
	table: ["align", "border", "cellpadding", "cellspacing", "rules", "summary", "width"],
	tbody: ["align", "char", "charoff", "valign"],
	td: ["colspan", "headers", "rowspan", "abbr", "align", "height", "scope", "valign", "width"],
	tfoot: ["align", "valign"],
	th: ["abbr", "colspan", "rowspan", "scope", "align", "height", "valign", "width"],
	thead: ["align", "valign"],
	time: ["datetime"],
	tr: ["align", "valign"],
	track: ["default", "kind", "srclang", "label", "src"],
	tt: [],
	u: [],
	ul: ["type"],
	var: [],
	video: ["src", "poster", "controlslist", "height", "loop", "muted", "playsinline", "width"],
	wbr: [],
};
const FRESHRSS_STRIPPED_DATA = new Set([
	"data-auto-leave-validation",
	"data-leave-validation",
	"data-no-leave-validation",
	"data-original",
]);
const FRESHRSS_URLS: Record<string, readonly string[]> = {
	a: ["href"],
	audio: ["src"],
	blockquote: ["cite"],
	del: ["cite"],
	iframe: ["src"],
	img: ["longdesc", "src"],
	ins: ["cite"],
	q: ["cite"],
	source: ["src"],
	track: ["src"],
	video: ["poster", "src"],
};
const FRESHRSS_ADDED: Record<string, [string, string][]> = {
	audio: [
		["controls", "controls"],
		["preload", "none"],
	],
	iframe: [
		[
			"allow",
			"accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
		],
		["sandbox", "allow-scripts allow-same-origin"],
		["allowfullscreen", "allowfullscreen"],
	],
	video: [
		["controls", "controls"],
		["preload", "none"],
	],
};

const freshRSS: Policy = (tag, attributes, articleURL) => {
	if (tag === "script" || tag === "style") return "drop";
	const allowed = FRESHRSS_ALLOWED[tag];
	if (!allowed) return "unwrap";
	const urls = FRESHRSS_URLS[tag] ?? [];
	const keep: [string, string][] = [];
	for (const [key, raw] of attributes) {
		let name = key;
		let value = raw;
		if (key === "id" || key === "class") {
			name = `data-sanitized-${key}`;
		} else if (key.startsWith("data-")) {
			if (FRESHRSS_STRIPPED_DATA.has(key)) continue;
		} else if (
			!key.startsWith("aria-") &&
			!allowed.includes(key) &&
			!FRESHRSS_GLOBAL.includes(key)
		) {
			continue;
		}
		if (urls.includes(key)) {
			// SimplePie makes every URL absolute against the article, fragments included.
			const resolved = absolute(raw, articleURL);
			if (!resolved) continue;
			const kind = scheme(resolved);
			if (kind === "javascript" || (kind === "data" && !(tag === "img" && key === "src"))) {
				continue;
			}
			value = resolved;
		}
		keep.push([name, value]);
	}
	const added = FRESHRSS_ADDED[tag] ?? [];
	const names = new Set(keep.map(([name]) => name));
	keep.push(...added.filter(([name]) => !names.has(name)));
	return { keep };
};

const POLICIES: Record<Delivery, Policy> = { freshrss: freshRSS, miniflux };

/** body as delivery would hand it to NetNewsWire for the article at articleURL. */
export function deliver(body: string, delivery: Delivery, articleURL: string): string {
	return rewrite(body, POLICIES[delivery], articleURL);
}
