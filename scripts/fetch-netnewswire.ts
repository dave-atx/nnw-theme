// Downloads the NetNewsWire rendering files pinned in netnewswire.json into
// assets/netnewswire/, verifying each file's SHA-256. The published package ships
// these files, so theme authors never download them.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Pin, readPin } from "../src/netnewswire.ts";

const RAW_ROOT = "https://raw.githubusercontent.com/Ranchero-Software/NetNewsWire";
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const destination = join(root, "assets", "netnewswire");

function sha256(content: Uint8Array): string {
	return createHash("sha256").update(content).digest("hex");
}

async function cached(path: string, expected: string): Promise<boolean> {
	try {
		return sha256(await readFile(path)) === expected;
	} catch {
		return false;
	}
}

async function download(url: string, expected: string): Promise<Uint8Array> {
	const response = await fetch(url, { headers: { "User-Agent": "nnw-theme" } });
	if (!response.ok) throw new Error(`could not download ${url}: HTTP ${response.status}`);
	const content = new Uint8Array(await response.arrayBuffer());
	if (content.length > MAX_FILE_BYTES) throw new Error(`${url} exceeds the size limit`);
	const actual = sha256(content);
	if (actual !== expected) {
		throw new Error(
			`${url} failed SHA-256 verification (expected ${expected}, received ${actual})`,
		);
	}
	return content;
}

async function main(): Promise<void> {
	const pin: Pin = readPin(await readFile(join(root, "netnewswire.json"), "utf8"));
	let downloaded = 0;
	for (const file of pin.files) {
		const path = join(destination, ...file.destination.split("/"));
		if (await cached(path, file.sha256)) continue;
		const source = file.source.split("/").map(encodeURIComponent).join("/");
		const content = await download(`${RAW_ROOT}/${pin.commit}/${source}`, file.sha256);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(`${path}.partial`, content);
		await rename(`${path}.partial`, path);
		downloaded += 1;
	}
	await writeFile(
		join(destination, "netnewswire.json"),
		`${JSON.stringify(pin, null, "\t")}\n`,
	);
	console.log(
		downloaded
			? `Downloaded and verified ${downloaded} NetNewsWire ${pin.release} rendering files.`
			: `NetNewsWire ${pin.release} rendering files are already verified.`,
	);
}

await main();
