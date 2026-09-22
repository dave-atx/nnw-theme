// Deterministic ZIP writing, and a small reader that sees what validation needs:
// every central-directory entry, including duplicates and Unix mode bits, which
// fflate's own unzip hides.
import { inflateSync, type Zippable, zipSync } from "fflate";

export interface ZipEntry {
	name: string;
	size: number;
	/** The high 16 bits of the external attributes: the Unix mode, when made on Unix. */
	mode: number;
	isDirectory: boolean;
	read(): Uint8Array;
}

/**
 * Write a ZIP whose bytes depend only on its content: names in the given order,
 * 1980-01-01 00:00 timestamps, Unix mode 0644, maximum compression.
 */
export function writeZip(files: readonly [string, Uint8Array][]): Uint8Array {
	const entries: Zippable = {};
	// fflate writes DOS times from local-time fields, so this is 1980-01-01 00:00 exactly.
	const mtime = new Date(1980, 0, 1, 0, 0, 0);
	for (const [name, content] of files) {
		entries[name] = [content, { level: 9, mtime, os: 3, attrs: 0o100644 << 16 }];
	}
	return zipSync(entries);
}

export class ZipFormatError extends Error {}

export function readZip(content: Uint8Array): ZipEntry[] {
	const view = new DataView(content.buffer, content.byteOffset, content.byteLength);
	let end = -1;
	for (
		let offset = content.length - 22;
		offset >= Math.max(0, content.length - 65557);
		offset--
	) {
		if (view.getUint32(offset, true) === 0x06054b50) {
			end = offset;
			break;
		}
	}
	if (end < 0) throw new ZipFormatError("File is not a zip file");
	const count = view.getUint16(end + 10, true);
	let offset = view.getUint32(end + 16, true);
	const decoder = new TextDecoder();
	const entries: ZipEntry[] = [];
	for (let index = 0; index < count; index++) {
		if (offset + 46 > content.length || view.getUint32(offset, true) !== 0x02014b50) {
			throw new ZipFormatError("Bad magic number for central directory");
		}
		const method = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const size = view.getUint32(offset + 24, true);
		const nameLength = view.getUint16(offset + 28, true);
		const extraLength = view.getUint16(offset + 30, true);
		const commentLength = view.getUint16(offset + 32, true);
		const external = view.getUint32(offset + 38, true);
		const localOffset = view.getUint32(offset + 42, true);
		const name = decoder.decode(content.subarray(offset + 46, offset + 46 + nameLength));
		offset += 46 + nameLength + extraLength + commentLength;
		entries.push({
			name,
			size,
			mode: external >>> 16,
			isDirectory: name.endsWith("/"),
			read() {
				if (view.getUint32(localOffset, true) !== 0x04034b50) {
					throw new ZipFormatError("Bad magic number for file header");
				}
				const start =
					localOffset +
					30 +
					view.getUint16(localOffset + 26, true) +
					view.getUint16(localOffset + 28, true);
				const data = content.subarray(start, start + compressedSize);
				if (method === 0) return data;
				if (method === 8) return inflateSync(data, { out: new Uint8Array(size) });
				throw new ZipFormatError(`compression method ${method} is not supported`);
			},
		});
	}
	return entries;
}
