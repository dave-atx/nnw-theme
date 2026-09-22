// Just enough PNG decoding to compare screenshots by pixels, not by encoder output:
// 8-bit, non-interlaced grayscale, RGB, or RGBA, as Playwright writes them.
import { inflateSync } from "node:zlib";

export interface Pixels {
	width: number;
	height: number;
	rgba: Uint8Array;
}

export function decodePng(file: Uint8Array): Pixels {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	let offset = 8;
	let width = 0;
	let height = 0;
	let channels = 0;
	const data: Uint8Array[] = [];
	while (offset < file.length) {
		const length = view.getUint32(offset);
		const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8));
		const body = file.subarray(offset + 8, offset + 8 + length);
		if (type === "IHDR") {
			const header = new DataView(body.buffer, body.byteOffset, body.byteLength);
			width = header.getUint32(0);
			height = header.getUint32(4);
			const [depth, color, , , interlace] = body.subarray(8, 13);
			channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color as 0 | 2 | 4 | 6] ?? 0;
			if (depth !== 8 || interlace !== 0 || !channels) throw new Error("unsupported PNG");
		} else if (type === "IDAT") data.push(body);
		offset += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(data));
	const stride = width * channels;
	const out = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		for (let x = 0; x < stride; x++) {
			const a = x >= channels ? (out[y * stride + x - channels] ?? 0) : 0;
			const b = y ? (out[(y - 1) * stride + x] ?? 0) : 0;
			const c = x >= channels && y ? (out[(y - 1) * stride + x - channels] ?? 0) : 0;
			let predictor = 0;
			if (filter === 1) predictor = a;
			else if (filter === 2) predictor = b;
			else if (filter === 3) predictor = (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			out[y * stride + x] = ((line[x] ?? 0) + predictor) & 0xff;
		}
	}
	const rgba = new Uint8Array(width * height * 4);
	for (let pixel = 0; pixel < width * height; pixel++) {
		const source = out.subarray(pixel * channels, (pixel + 1) * channels);
		const gray = channels <= 2;
		rgba[pixel * 4] = source[0] ?? 0;
		rgba[pixel * 4 + 1] = (gray ? source[0] : source[1]) ?? 0;
		rgba[pixel * 4 + 2] = (gray ? source[0] : source[2]) ?? 0;
		rgba[pixel * 4 + 3] =
			channels === 4 ? (source[3] ?? 255) : channels === 2 ? (source[1] ?? 255) : 255;
	}
	return { width, height, rgba };
}

/** Why two PNGs' pixels differ, or null when they are identical. */
export function pixelDifference(a: Uint8Array, b: Uint8Array): string | null {
	if (Buffer.from(a).equals(Buffer.from(b))) return null;
	const left = decodePng(a);
	const right = decodePng(b);
	if (left.width !== right.width || left.height !== right.height) {
		return `${left.width}x${left.height} vs ${right.width}x${right.height}`;
	}
	let count = 0;
	for (let index = 0; index < left.rgba.length; index += 4) {
		if (
			left.rgba[index] !== right.rgba[index] ||
			left.rgba[index + 1] !== right.rgba[index + 1] ||
			left.rgba[index + 2] !== right.rgba[index + 2] ||
			left.rgba[index + 3] !== right.rgba[index + 3]
		) {
			count++;
		}
	}
	return count ? `${count} pixels differ` : null;
}
