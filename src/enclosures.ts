// A port of NetNewsWire's enclosure rendering: Attachment.displayMedium
// (Modules/Articles/Sources/Articles/Attachment.swift) and the [[enclosures]] and
// [[primary_media]] HTML (Shared/Article Rendering/ArticleRenderer+Enclosures.swift and
// ArticleRenderer+PrimaryMedia.swift), at the pinned commit.
// Keep it line for line with the Swift, so a diff of the two stays easy to review.
import { significantImageURLs } from "./body-images.ts";
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

/** A fixture's image_url and thumbnail_url: Article.imageLink and thumbnailLink. */
export function fixtureImages(
	fixture: Fixture,
	name: string,
): { imageLink?: string; thumbnailLink?: string } {
	const text = (key: string) => {
		const value = fixture[key];
		if (value !== undefined && typeof value !== "string") {
			throw new ThemeError(`${name}: ${key} must be a string`);
		}
		return value;
	};
	return { imageLink: text("image_url"), thumbnailLink: text("thumbnail_url") };
}

const AUDIO_EXTENSIONS = new Set(["mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "avif"]);
const YOUTUBE_FLASH_PLAYER_PATH_PREFIX = "/v/";
const YOUTUBE_EMBED_URL_PREFIX = "https://www.youtube-nocookie.com/embed/";
const YOUTUBE_EMBED_PATHS = ["youtube.com/embed/", "youtube-nocookie.com/embed/"];
const WORDPRESS_SIZE_SUFFIX = /-\d+x\d+(?=\.[A-Za-z0-9]+$)/;
const ENGADGET_LARGE_IMAGE_PREFIX = "l-";
const SHORT_POST_MAXIMUM_BODY_LENGTH = 2048;

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

/** Body HTML escapes `&` in attributes, so check both forms of the URL. */
function bodyContainsURL(body: string, url: string): boolean {
	return body.includes(url) || body.includes(escapeXML(url));
}

/** URL.pathComponents without the root, percent-decoded. */
function pathComponents(value: string): string[] | undefined {
	const path = parseURL(value)?.path;
	if (path === undefined) return undefined;
	return path
		.split("/")
		.filter(Boolean)
		.map((component) => {
			try {
				return decodeURIComponent(component);
			} catch {
				return component;
			}
		});
}

/** ArticleRenderingSpecialCases.bodyEmbedsYouTubeVideo(stillImageURL:body:). */
function bodyEmbedsYouTubeVideo(stillImageURL: string, body: string): boolean {
	return (pathComponents(stillImageURL) ?? []).some(
		(component) =>
			/^[A-Za-z0-9_-]{11}$/.test(component) &&
			YOUTUBE_EMBED_PATHS.some((path) => body.includes(path + component)),
	);
}

function isEngadgetImage(value: string): boolean {
	const host =
		parseURL(value)
			?.host.toLowerCase()
			.replace(/^www\./, "") ?? "";
	return host === "engadget.com" || host.endsWith(".engadget.com");
}

/**
 * The last two path components, lowercased, without a WordPress size suffix or Engadget
 * size prefix. Ignores the host and query: resized copies often come through a service.
 */
function imageIdentity(value: string): string | undefined {
	const components = pathComponents(value);
	const last = components?.at(-1);
	if (!components || last === undefined) return undefined;
	const name = (
		last.startsWith(ENGADGET_LARGE_IMAGE_PREFIX) && isEngadgetImage(value)
			? last.slice(ENGADGET_LARGE_IMAGE_PREFIX.length)
			: last
	).replace(WORDPRESS_SIZE_SUFFIX, "");
	return [...components.slice(0, -1).slice(-1), name].join("/").toLowerCase();
}

/** ArticleRenderer.bodyImageIdentities: for spotting a resized copy of a body image. */
export function bodyImageIdentities(body: string, baseURL?: string): Set<string> {
	return new Set(
		significantImageURLs(body, baseURL)
			.map(imageIdentity)
			.filter((identity) => identity !== undefined),
	);
}

function bodyContains(url: string, body: string, identities: ReadonlySet<string>): boolean {
	if (bodyContainsURL(body, url) || bodyEmbedsYouTubeVideo(url, body)) return true;
	const identity = imageIdentity(url);
	return identity !== undefined && identities.has(identity);
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
 * HTML for the [[enclosures]] substitution, empty when there's nothing to show. Skips
 * attachments already in the body, including resized copies. posterURL is a video's poster.
 */
export function enclosuresHTML(
	attachments: readonly Attachment[],
	body: string,
	identities: ReadonlySet<string>,
	posterURL: string | undefined,
): string {
	const enclosures = attachments
		.filter((attachment) => !bodyContains(attachment.url, body, identities))
		.map((attachment) => enclosureHTML(attachment, posterURL))
		.filter((enclosure) => enclosure !== undefined);
	if (!enclosures.length) return "";
	return `<div class="nnw-enclosures">\n${enclosures.join("\n")}\n</div>`;
}

/** Untitled and short, as Mastodon posts are: their images follow the text. */
function isShortUntitledPost(title: string, body: string): boolean {
	if (title) return false;
	return [...new Intl.Segmenter().segment(body)].length < SHORT_POST_MAXIMUM_BODY_LENGTH;
}

function isVideo(attachment: Attachment): boolean {
	return displayMedium(attachment) === "video" || youTubeEmbedURL(attachment.url) !== undefined;
}

/** The article image, else the first image attachment, else the thumbnail; undefined if in the body. */
function primaryImage(
	imageLink: string | undefined,
	thumbnailLink: string | undefined,
	attachments: readonly Attachment[],
	body: string,
	identities: ReadonlySet<string>,
): Attachment | undefined {
	let image: Attachment | undefined;
	if (imageLink) {
		image = attachments.find((attachment) => attachment.url === imageLink) ?? {
			url: imageLink,
			medium: "image",
		};
	} else {
		image = attachments.find((attachment) => displayMedium(attachment) === "image");
		if (!image && thumbnailLink) image = { url: thumbnailLink, medium: "image" };
	}
	return image && !bodyContains(image.url, body, identities) ? image : undefined;
}

function collapsingWhitespace(value: string): string {
	return value.split(/\s+/).filter(Boolean).join(" ").toLowerCase();
}

function primaryImageHTML(image: Attachment, articleTitle: string): string {
	let attributes = `src="${escapeXML(image.url)}"`;
	let caption = "";
	if (image.title) {
		const title = escapeXML(image.title);
		attributes += ` alt="${title}" title="${title}"`;
		if (collapsingWhitespace(image.title) !== collapsingWhitespace(articleTitle)) {
			caption = `<div class="nnw-primary-image-caption">${title}</div>`;
		}
	} else {
		attributes += ' alt=""';
	}
	return `<div class="nnw-primary-image"><img ${attributes}${dimensionAttributes(image)}>${caption}</div>`;
}

/** An article's media, as ArticleRenderer takes them from the feed. */
export interface ArticleMedia {
	attachments: readonly Attachment[];
	imageLink?: string | undefined;
	thumbnailLink?: string | undefined;
	title: string;
	body: string;
	baseURL?: string | undefined;
}

/** A video, else audio with the article image, else the article image. */
function primaryMedia(
	article: ArticleMedia,
	identities: ReadonlySet<string>,
	includesImage: boolean,
): { html: string; urls: Set<string> } | undefined {
	const { attachments, imageLink, thumbnailLink, title, body } = article;
	const wrap = (html: string) => `<div class="nnw-primary-media">${html}</div>`;
	const playable = attachments.filter(({ url }) => !bodyContains(url, body, identities));
	const posterURL = imageLink ?? thumbnailLink;
	const video = playable.find(isVideo);
	const videoHTML = video && enclosureHTML(video, posterURL);
	if (video && videoHTML !== undefined) {
		const urls = new Set([video.url]);
		if (posterURL !== undefined) urls.add(posterURL);
		return { html: wrap(videoHTML), urls };
	}
	let imageHTML = "";
	const urls = new Set<string>();
	const image = includesImage
		? primaryImage(imageLink, thumbnailLink, attachments, body, identities)
		: undefined;
	if (image) {
		imageHTML = primaryImageHTML(image, title);
		urls.add(image.url);
	}
	const audio = playable.find((attachment) => displayMedium(attachment) === "audio");
	const audioHTML = audio && enclosureHTML(audio, undefined);
	if (audio && audioHTML !== undefined) {
		urls.add(audio.url);
		return { html: wrap(imageHTML + audioHTML), urls };
	}
	return imageHTML ? { html: wrap(imageHTML), urls } : undefined;
}

/**
 * The [[primary_media]] and [[enclosures]] HTML, as articleSubstitutions() builds them.
 * A template without [[primary_media]], or a short untitled post, gets the article image
 * in the enclosures instead; only [[primary_media]] uses the thumbnail as an image.
 */
export function articleMediaHTML(
	article: ArticleMedia,
	hasPrimaryMedia: boolean,
): { primaryMedia: string; enclosures: string } {
	const { imageLink, thumbnailLink, title, body } = article;
	const identities = bodyImageIdentities(body, article.baseURL);
	let attachments = [...article.attachments];
	const showsPrimaryImage = hasPrimaryMedia && !isShortUntitledPost(title, body);
	const primary = hasPrimaryMedia
		? primaryMedia(article, identities, showsPrimaryImage)
		: undefined;
	if (primary) attachments = attachments.filter(({ url }) => !primary.urls.has(url));
	if (!showsPrimaryImage) {
		const image = primaryImage(imageLink, undefined, attachments, body, identities);
		if (image && !primary?.urls.has(image.url) && !attachments.includes(image)) {
			attachments.unshift(image);
		}
	}
	return {
		primaryMedia: primary?.html ?? "",
		enclosures: enclosuresHTML(attachments, body, identities, imageLink ?? thumbnailLink),
	};
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
