// NetNewsWire's search for a body's real images: RSParser's HTMLImageParser and
// SignificantImageFilter, at the pinned commit. Enclosures and primary media use it to
// spot a resized copy of an image the body already shows.
import { Parser } from "htmlparser2";

const MINIMUM_DIMENSION = 64;
const MAXIMUM_ASPECT_RATIO = 6;
const PREFERRED_SRCSET_WIDTH = 1200;
const LAZY_SRCSET_ATTRIBUTES = ["data-lazy-srcset", "data-srcset"];
const LAZY_SOURCE_ATTRIBUTES = ["data-lazy-src", "data-src", "data-original"];
const DECORATIVE_CLASSES = new Set(["emoji", "wp-smiley"]);
const BLOCKED_FILE_NAMES = new Set(["1x1", "blank", "pixel", "spacer", "transparent"]);
const BLOCKED_PATH_COMPONENTS = new Set(["open", "track"]);
const PHOTO_EXTENSIONS = new Set(["avif", "heic", "jpeg", "jpg", "png", "webp"]);

type HostAndPrefix = readonly [host: string, pathPrefix: string];

const BLOCKED_IMAGES: readonly HostAndPrefix[] = [
	["addtoany.com", "/"],
	["feedburner.com", "/"],
	["feeds.wordpress.com", "/"],
	["pixel.wp.com", "/"],
	["s.w.org", "/images/core/emoji/"],
	["s0.wp.com", "/i/blank.jpg"],
	["stats.wordpress.com", "/"],
];
const SHARING_LINKS: readonly HostAndPrefix[] = [
	["addtoany.com", "/"],
	["bsky.app", "/intent/"],
	["digg.com", "/submit"],
	["facebook.com", "/dialog/"],
	["facebook.com", "/share"],
	["flipboard.com", "/bookmarklet"],
	["getpocket.com", "/save"],
	["linkedin.com", "/cws/share"],
	["linkedin.com", "/sharearticle"],
	["linkedin.com", "/sharing/"],
	["news.ycombinator.com", "/submitlink"],
	["pinterest.com", "/pin/create"],
	["reddit.com", "/submit"],
	["shareaholic.com", "/"],
	["sharethis.com", "/"],
	["t.me", "/share"],
	["threads.net", "/intent/"],
	["tumblr.com", "/share"],
	["tumblr.com", "/widgets/share"],
	["twitter.com", "/intent/"],
	["twitter.com", "/share"],
	["whatsapp.com", "/send"],
	["x.com", "/intent/"],
	["x.com", "/share"],
];

function matches(url: URL, prefixes: readonly HostAndPrefix[]): boolean {
	const host = url.hostname.toLowerCase();
	const path = url.pathname.toLowerCase();
	return prefixes.some(
		([domain, prefix]) =>
			(host === domain || host.endsWith(`.${domain}`)) && path.startsWith(prefix),
	);
}

function parsed(value: string): URL | undefined {
	try {
		return new URL(value);
	} catch {
		return undefined;
	}
}

function hasSignificantDimensions(width?: number, height?: number): boolean {
	if (width !== undefined && width < MINIMUM_DIMENSION) return false;
	if (height !== undefined && height < MINIMUM_DIMENSION) return false;
	if (width !== undefined && height !== undefined) {
		return Math.max(width, height) / Math.min(width, height) <= MAXIMUM_ASPECT_RATIO;
	}
	return true;
}

function isGravatar(url: URL): boolean {
	const host = url.hostname.toLowerCase();
	return (
		(host === "gravatar.com" || host.endsWith(".gravatar.com")) &&
		url.pathname.startsWith("/avatar/")
	);
}

function isBlockedURL(value: string): boolean {
	const url = parsed(value);
	if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname) return true;
	const components = url.pathname.split("/").filter(Boolean);
	const name = components.at(-1) ?? "";
	const dot = name.lastIndexOf(".");
	const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
	if (extension === "svg") return true;
	if (BLOCKED_FILE_NAMES.has((dot > 0 ? name.slice(0, dot) : name).toLowerCase())) return true;
	if (
		!PHOTO_EXTENSIONS.has(extension) &&
		components.some((component) => BLOCKED_PATH_COMPONENTS.has(component.toLowerCase()))
	) {
		return true;
	}
	return matches(url, BLOCKED_IMAGES) || isGravatar(url);
}

function isSharingLink(value: string | undefined): boolean {
	const url = value === undefined ? undefined : parsed(value);
	if (!url) return false;
	return url.protocol === "mailto:" || (url.hostname !== "" && matches(url, SHARING_LINKS));
}

function hasDecorativeClass(htmlClass: string | undefined): boolean {
	return (htmlClass ?? "")
		.split(/\s+/)
		.some((name) => DECORATIVE_CLASSES.has(name.toLowerCase()));
}

/** Foundation's URL(string:relativeTo:).absoluteString; undefined for data: or empty. */
function resolved(value: string | undefined, baseURL: string | undefined): string | undefined {
	if (value === undefined || /^\s*data:/i.test(value)) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	try {
		return new URL(trimmed, baseURL || undefined).href;
	} catch {
		return undefined;
	}
}

/** The narrowest candidate at least 1200w wide, else the one with the largest descriptor. */
function preferredSrcsetCandidate(srcset: string): string | undefined {
	let narrowest: { url: string; size: number } | undefined;
	let largest: { url: string; size: number } | undefined;
	for (const match of srcset.matchAll(/[\s,]*([^\s,][^\s]*)([^,]*)/g)) {
		let url = match[1] ?? "";
		const trailingComma = url.endsWith(",");
		url = url.replace(/,+$/, "");
		const descriptor = trailingComma ? "" : ((match[2] ?? "").trim().split(/\s+/)[0] ?? "");
		if (!url) continue;
		const size = Number.parseFloat(descriptor) || 1;
		if (
			descriptor.endsWith("w") &&
			size >= PREFERRED_SRCSET_WIDTH &&
			size < (narrowest?.size ?? Number.POSITIVE_INFINITY)
		) {
			narrowest = { url, size };
		}
		if (size > (largest?.size ?? Number.NEGATIVE_INFINITY)) largest = { url, size };
	}
	return (narrowest ?? largest)?.url;
}

function styleProperties(style: string | undefined): Map<string, string> {
	const properties = new Map<string, string>();
	for (const declaration of (style ?? "").split(";")) {
		const colon = declaration.indexOf(":");
		if (colon === -1) continue;
		properties.set(
			declaration.slice(0, colon).trim().toLowerCase(),
			declaration
				.slice(colon + 1)
				.trim()
				.toLowerCase(),
		);
	}
	return properties;
}

/** "300" and "300px" are pixel dimensions; percentages and other units are not. */
function pixelDimension(value: string | undefined): number | undefined {
	const match = value
		?.trim()
		.toLowerCase()
		.match(/^([+-]?\d+)(?:px)?$/);
	return match ? Number(match[1]) : undefined;
}

/** HTMLImageParser.significantImageURLStrings: absolute URLs, in document order. */
export function significantImageURLs(html: string, baseURL: string | undefined): string[] {
	const found = new Set<string>();
	let enclosingLink: string | undefined;
	const parser = new Parser(
		{
			onopentag(name, attributes) {
				if (name === "a") {
					enclosingLink = resolved(attributes.href, baseURL);
					return;
				}
				if (name !== "img") return;
				const style = styleProperties(attributes.style);
				if (attributes.hidden !== undefined || style.get("display")?.startsWith("none")) return;
				const width = pixelDimension(style.get("width")) ?? pixelDimension(attributes.width);
				const height = pixelDimension(style.get("height")) ?? pixelDimension(attributes.height);
				if (!hasSignificantDimensions(width, height)) return;
				if (hasDecorativeClass(attributes.class) || isSharingLink(enclosingLink)) return;
				const sources = [
					...LAZY_SRCSET_ATTRIBUTES.map((key) => attributes[key])
						.filter((value) => value !== undefined)
						.map(preferredSrcsetCandidate),
					...LAZY_SOURCE_ATTRIBUTES.map((key) => attributes[key]),
					attributes.srcset === undefined
						? undefined
						: preferredSrcsetCandidate(attributes.srcset),
					attributes.src,
				];
				for (const source of sources) {
					const url = resolved(source, baseURL);
					if (url !== undefined && !isBlockedURL(url)) {
						found.add(url);
						return;
					}
				}
			},
			onclosetag(name) {
				if (name === "a") enclosingLink = undefined;
			},
		},
		{ decodeEntities: true, lowerCaseTags: true, lowerCaseAttributeNames: true },
	);
	parser.end(html);
	return [...found];
}
