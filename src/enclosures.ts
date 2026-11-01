// A port of NetNewsWire's enclosure rendering: Attachment.displayMedium
// (Modules/Articles/Sources/Articles/Attachment.swift) and the [[enclosures]] HTML
// (Shared/Article Rendering/ArticleRenderer+Enclosures.swift), at the pinned commit.
// Keep it line for line with the Swift, so a diff of the two stays easy to review.
import { type Fixture, ThemeError } from "./project.ts";

export const MEDIA = ["image", "audio", "video", "document", "executable"] as const;
export type Medium = (typeof MEDIA)[number];

/** An enclosure or Media RSS item, as a fixture's [[attachments]] table gives it. */
export interface Attachment {
	url: string;
	mime_type?: string;
	title?: string;
	size_in_bytes?: number;
	duration_in_seconds?: number;
	width?: number;
	height?: number;
	medium?: Medium;
}

const STRING_KEYS = ["url", "mime_type", "title"] as const;
const INTEGER_KEYS = ["size_in_bytes", "duration_in_seconds", "width", "height"] as const;
const ATTACHMENT_KEYS: readonly string[] = [...STRING_KEYS, ...INTEGER_KEYS, "medium"];

function isTable(value: unknown): value is Record<string, unknown> {
	return (
		!!value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
	);
}

/**
 * A fixture's [[attachments]], validated. Like Attachment(url:…), an empty url makes
 * no attachment, so NetNewsWire never sees it.
 */
export function fixtureAttachments(fixture: Fixture, name: string): Attachment[] {
	const value = fixture.attachments;
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every(isTable)) {
		throw new ThemeError(`${name}: attachments must be [[attachments]] tables`);
	}
	return value.flatMap((table, index): Attachment[] => {
		const where = `${name}: attachments[${index}]`;
		const unknown = Object.keys(table)
			.filter((key) => !ATTACHMENT_KEYS.includes(key))
			.sort();
		if (unknown.length) throw new ThemeError(`${where}: unknown key(s): ${unknown.join(", ")}`);
		for (const key of STRING_KEYS) {
			if (key in table && typeof table[key] !== "string") {
				throw new ThemeError(`${where}: ${key} must be a string`);
			}
		}
		for (const key of INTEGER_KEYS) {
			if (key in table && !Number.isSafeInteger(table[key])) {
				throw new ThemeError(`${where}: ${key} must be an integer`);
			}
		}
		if ("medium" in table && !MEDIA.includes(table.medium as Medium)) {
			throw new ThemeError(`${where}: medium must be one of ${MEDIA.join(", ")}`);
		}
		if (typeof table.url !== "string") throw new ThemeError(`${where}: url is required`);
		return table.url ? [table as unknown as Attachment] : [];
	});
}

/** A fixture's image_url, else its thumbnail_url: Article.imageLink ?? thumbnailLink. */
export function fixtureImageURL(fixture: Fixture, name: string): string | undefined {
	for (const key of ["image_url", "thumbnail_url"]) {
		const value = fixture[key];
		if (value === undefined) continue;
		if (typeof value !== "string") throw new ThemeError(`${name}: ${key} must be a string`);
		return value;
	}
	return undefined;
}

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"]);
const VISUAL_ELEMENT_TAGS = ["<img", "<picture", "<video", "<iframe"];
const YOUTUBE_FLASH_PLAYER_PATH_PREFIX = "/v/";
const YOUTUBE_EMBED_URL_PREFIX = "https://www.youtube-nocookie.com/embed/";

/** Foundation's URL(string:), enough for host and path: relative URLs have no host. */
function parseURL(value: string): { host: string; path: string } | undefined {
	try {
		const url = new URL(value);
		return { host: url.hostname, path: url.pathname };
	} catch {
		if (/[\s<>"]/.test(value)) return undefined;
		return { host: "", path: value.replace(/[?#].*$/s, "") };
	}
}

function lastPathComponent(path: string): string {
	const parts = path.split("/").filter(Boolean);
	return parts.at(-1) ?? (path.startsWith("/") ? "/" : "");
}

function pathExtension(path: string): string {
	const last = lastPathComponent(path);
	const dot = last.lastIndexOf(".");
	return dot > 0 ? last.slice(dot + 1) : "";
}

/** How the article view shows an attachment, or undefined for anything else. */
export function displayMedium(attachment: Attachment): Medium | undefined {
	const mimeType = attachment.mime_type?.toLowerCase();
	if (mimeType !== undefined) {
		if (mimeType.startsWith("audio/")) return "audio";
		if (mimeType.startsWith("video/")) return "video";
		if (mimeType.startsWith("image/")) return "image";
	}
	const { medium } = attachment;
	if (medium === "audio" || medium === "video" || medium === "image") return medium;
	const path = parseURL(attachment.url)?.path;
	const extension = path === undefined ? "" : pathExtension(path).toLowerCase();
	if (!extension) return undefined;
	if (AUDIO_EXTENSIONS.has(extension)) return "audio";
	if (VIDEO_EXTENSIONS.has(extension)) return "video";
	if (IMAGE_EXTENSIONS.has(extension)) return "image";
	return undefined;
}

/** RSCore's escapingSpecialXMLCharacters: drops characters XML cannot hold. */
export function escapeXML(value: string): string {
	let escaped = "";
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (character === "&") escaped += "&amp;";
		else if (character === "<") escaped += "&lt;";
		else if (character === ">") escaped += "&gt;";
		else if (character === '"') escaped += "&quot;";
		else if (character === "'") escaped += "&apos;";
		else if (
			code === 0x9 ||
			code === 0xa ||
			code === 0xd ||
			(code >= 0x20 && code <= 0xd7ff) ||
			(code >= 0xe000 && code <= 0xfffd) ||
			code >= 0x10000
		) {
			escaped += character;
		}
	}
	return escaped;
}

/** ArticleRenderingSpecialCases.youTubeEmbedURL(forAttachmentURL:). */
export function youTubeEmbedURL(value: string): string | undefined {
	const url = parseURL(value);
	const host = url?.host.toLowerCase().replace(/^www\./, "");
	if (!url || !host || !(host === "youtube.com" || host.endsWith(".youtube.com"))) {
		return undefined;
	}
	if (!url.path.startsWith(YOUTUBE_FLASH_PLAYER_PATH_PREFIX)) return undefined;
	const videoID = url.path.slice(YOUTUBE_FLASH_PLAYER_PATH_PREFIX.length);
	if (!videoID || !/^[A-Za-z0-9_-]+$/.test(videoID)) return undefined;
	return YOUTUBE_EMBED_URL_PREFIX + videoID;
}

/** Foundation's ByteCountFormatter.string(fromByteCount:countStyle: .file), en_US. */
export function byteCount(bytes: number): string {
	if (bytes === 0) return "Zero KB";
	if (Math.abs(bytes) < 1000) return `${bytes} ${Math.abs(bytes) === 1 ? "byte" : "bytes"}`;
	const units = ["KB", "MB", "GB", "TB", "PB", "EB"];
	let value = bytes / 1000;
	let unit = 0;
	while (Math.abs(value) >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	const digits = Math.min(unit, 2);
	const text = value.toLocaleString("en-US", { maximumFractionDigits: digits });
	return `${text} ${units[unit]}`;
}

function durationString(durationInSeconds: number): string {
	const hours = Math.trunc(durationInSeconds / 3600);
	const minutes = Math.trunc((durationInSeconds % 3600) / 60);
	const seconds = durationInSeconds % 60;
	const pad = (value: number) => String(value).padStart(2, "0");
	return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function fileName(value: string): string | undefined {
	const path = parseURL(value)?.path;
	if (path === undefined) return undefined;
	const last = lastPathComponent(path);
	if (!last || last === "/") return undefined;
	try {
		return decodeURIComponent(last);
	} catch {
		return last;
	}
}

/** Title (or file name), duration, and size, such as “Episode 311 · 1:54:09 · 54.9 MB”. */
function audioCaption(attachment: Attachment): string {
	const components: string[] = [];
	const name = attachment.title || fileName(attachment.url);
	if (name) components.push(name);
	if (attachment.duration_in_seconds !== undefined) {
		components.push(durationString(attachment.duration_in_seconds));
	}
	if (attachment.size_in_bytes !== undefined)
		components.push(byteCount(attachment.size_in_bytes));
	return components.join(" · ");
}

function dimensionAttributes(attachment: Attachment): string {
	if (attachment.width === undefined || attachment.height === undefined) return "";
	return ` width="${attachment.width}" height="${attachment.height}"`;
}

function isVisual(attachment: Attachment): boolean {
	if (youTubeEmbedURL(attachment.url) !== undefined) return true;
	const medium = displayMedium(attachment);
	return medium === "image" || medium === "video";
}

function bodyContainsVisualElement(body: string): boolean {
	const lower = body.toLowerCase();
	return VISUAL_ELEMENT_TAGS.some((tag) => lower.includes(tag));
}

/** Body HTML escapes `&` in attributes, so check both forms of the URL. */
function bodyContainsURL(body: string, url: string): boolean {
	return body.includes(url) || body.includes(escapeXML(url));
}

function enclosureHTML(
	attachment: Attachment,
	posterURL: string | undefined,
): string | undefined {
	const youTube = youTubeEmbedURL(attachment.url);
	if (youTube !== undefined) {
		const iframe = `<iframe src="${youTube}"${dimensionAttributes(attachment)} allowfullscreen></iframe>`;
		return `<div class="nnw-enclosure nnw-enclosure-video">${iframe}</div>`;
	}
	const medium = displayMedium(attachment);
	if (medium === undefined) return undefined;
	const src = escapeXML(attachment.url);
	let mediaElement: string;
	let caption: string | undefined;
	switch (medium) {
		case "audio":
			mediaElement = `<audio controls preload="none" src="${src}"></audio>`;
			caption = audioCaption(attachment);
			break;
		case "video": {
			let attributes = `controls preload="metadata" playsinline src="${src}"${dimensionAttributes(attachment)}`;
			if (posterURL) attributes += ` poster="${escapeXML(posterURL)}"`;
			mediaElement = `<video ${attributes}></video>`;
			caption = attachment.title;
			break;
		}
		case "image":
			mediaElement = `<img src="${src}" alt=""${dimensionAttributes(attachment)}>`;
			caption = attachment.title;
			break;
		default:
			return undefined;
	}
	let html = `<div class="nnw-enclosure nnw-enclosure-${medium}">${mediaElement}`;
	if (caption) html += `<div class="nnw-enclosure-caption">${escapeXML(caption)}</div>`;
	return `${html}</div>`;
}

/**
 * HTML for the [[enclosures]] substitution, empty when there's nothing to show.
 * Skips attachments whose URLs already appear in the body. imageURL is shown only
 * when nothing else visual is: no image or video enclosure, nor one in the body.
 */
export function enclosuresHTML(
	attachments: readonly Attachment[],
	body: string,
	imageURL: string | undefined,
): string {
	const enclosures: string[] = [];
	let hasVisualEnclosure = false;
	for (const attachment of attachments) {
		if (bodyContainsURL(body, attachment.url)) continue;
		const enclosure = enclosureHTML(attachment, imageURL);
		if (enclosure === undefined) continue;
		enclosures.push(enclosure);
		hasVisualEnclosure ||= isVisual(attachment);
	}
	if (
		!hasVisualEnclosure &&
		imageURL &&
		!bodyContainsVisualElement(body) &&
		!bodyContainsURL(body, imageURL)
	) {
		enclosures.unshift(
			`<div class="nnw-enclosure nnw-enclosure-image"><img src="${escapeXML(imageURL)}" alt=""></div>`,
		);
	}
	if (!enclosures.length) return "";
	return `<div class="nnw-enclosures">\n${enclosures.join("\n")}\n</div>`;
}

/**
 * The body and [[enclosures]] values, as ArticleRenderer.articleSubstitutions() sets
 * them. A template without the macro gets its enclosures after the body, which a
 * wrapper <div> closes so an unclosed tag in it can't swallow them.
 */
export function placeEnclosures(
	template: string,
	body: string,
	enclosures: string,
): { body: string; enclosures?: string } {
	if (template.includes("[[enclosures]]")) return { body, enclosures };
	if (!enclosures) return { body };
	return { body: `<div>${body}</div>${enclosures}` };
}
