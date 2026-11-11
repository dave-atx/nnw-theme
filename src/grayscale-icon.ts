// A theme whose Info.plist sets grayscaleIcon gets its [[avatar_src]] in grayscale:
// NetNewsWire (Article.articleViewIconImage, IconImage.grayscaleCGImage) sets each
// pixel's red, green, and blue to its Rec. 709 luma over sRGB values and keeps alpha.
// Previews can't decode images without a dependency, so they wrap the icon in an SVG
// whose filter does the same arithmetic, sized to the icon so layout doesn't change.

const LUMA = "0.2126 0.7152 0.0722 0 0";
const DATA_URI = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is;

export interface Size {
	width: number;
	height: number;
}

/** The theme key behind this, read as NetNewsWire does: only a real <true/> counts. */
export const GRAYSCALE_ICON_KEY = "grayscaleIcon";

function pngSize(bytes: Buffer): Size | undefined {
	const signature = "89504e470d0a1a0a";
	if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return undefined;
	if (bytes.subarray(12, 16).toString("latin1") !== "IHDR") return undefined;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize(bytes: Buffer): Size | undefined {
	if (bytes.length < 10 || bytes.subarray(0, 4).toString("latin1") !== "GIF8") return undefined;
	return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function jpegSize(bytes: Buffer): Size | undefined {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
	let offset = 2;
	while (offset + 4 <= bytes.length) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1] ?? 0;
		if (marker === 0xff) {
			offset += 1; // fill byte
			continue;
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 2; // markers without a length
			continue;
		}
		const length = bytes.readUInt16BE(offset + 2);
		// SOF0 to SOF15, except DHT (C4), JPG (C8), and DAC (CC).
		const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
		if (isFrame && offset + 9 <= bytes.length) {
			return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
		}
		offset += 2 + length;
	}
	return undefined;
}

function webpSize(bytes: Buffer): Size | undefined {
	if (
		bytes.length < 30 ||
		bytes.subarray(0, 4).toString("latin1") !== "RIFF" ||
		bytes.subarray(8, 12).toString("latin1") !== "WEBP"
	) {
		return undefined;
	}
	switch (bytes.subarray(12, 16).toString("latin1")) {
		case "VP8 ":
			return {
				width: bytes.readUInt16LE(26) & 0x3fff,
				height: bytes.readUInt16LE(28) & 0x3fff,
			};
		case "VP8L": {
			const bits = bytes.readUInt32LE(21);
			return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
		}
		case "VP8X":
			return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
		default:
			return undefined;
	}
}

function svgLength(value: string | undefined): number | undefined {
	const match = value?.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/);
	return match ? Number(match[1]) : undefined;
}

function svgSize(text: string): Size | undefined {
	const root = text.match(/<svg\b([^>]*)>/i)?.[1];
	if (root === undefined) return undefined;
	const attribute = (name: string) =>
		root
			.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))
			?.slice(2)
			.find((value) => value !== undefined);
	const width = svgLength(attribute("width"));
	const height = svgLength(attribute("height"));
	if (width && height) return { width, height };
	const box = attribute("viewBox")
		?.trim()
		.split(/[\s,]+/)
		.map(Number);
	if (box?.length === 4 && box.every(Number.isFinite) && box[2] && box[3]) {
		const [, , boxWidth, boxHeight] = box as [number, number, number, number];
		if (width) return { width, height: (width * boxHeight) / boxWidth };
		if (height) return { width: (height * boxWidth) / boxHeight, height };
		return { width: boxWidth, height: boxHeight };
	}
	return undefined;
}

/** An image's intrinsic size in CSS pixels, from its header; undefined when unknown. */
export function imageSize(type: string, bytes: Buffer): Size | undefined {
	switch (type) {
		case "image/png":
			return pngSize(bytes);
		case "image/gif":
			return gifSize(bytes);
		case "image/jpeg":
			return jpegSize(bytes);
		case "image/webp":
			return webpSize(bytes);
		case "image/svg+xml":
			return svgSize(bytes.toString("utf8"));
		default:
			return undefined;
	}
}

function decodeDataURI(uri: string): { type: string; bytes: Buffer } | undefined {
	const match = uri.trim().match(DATA_URI);
	if (!match) return undefined;
	const [, type = "", parameters = "", data = ""] = match;
	const base64 = parameters.toLowerCase().split(";").includes("base64");
	try {
		const bytes = base64
			? Buffer.from(data, "base64")
			: Buffer.from(decodeURIComponent(data), "utf8");
		return { type: type.trim().toLowerCase(), bytes };
	} catch {
		return undefined;
	}
}

function attribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

/**
 * The icon as NetNewsWire shows it for a grayscaleIcon theme. A data URI whose size
 * can't be read (AVIF, an SVG without width, height, or viewBox) is returned as is.
 */
export function grayscaleIcon(src: string): string {
	const decoded = decodeDataURI(src);
	const size = decoded && imageSize(decoded.type, decoded.bytes);
	if (!size?.width || !size.height) return src;
	const { width, height } = size;
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
		`viewBox="0 0 ${width} ${height}">` +
		'<filter id="grayscale" color-interpolation-filters="sRGB">' +
		`<feColorMatrix type="matrix" values="${LUMA} ${LUMA} ${LUMA} 0 0 0 1 0"/>` +
		"</filter>" +
		`<image width="${width}" height="${height}" href="${attribute(src.trim())}" ` +
		'filter="url(#grayscale)"/></svg>';
	return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
