// The small files every theme repository keeps. Each starts with a marker naming its
// stub and version; check compares only the marker, so authors can add notes below.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const TEMPLATE_BLOB = "https://github.com/dave-atx/netnewswire-theme-template/blob/main";

export interface Stub {
	path: string;
	name: string;
	version: number;
}

export const STUBS: readonly Stub[] = [
	{ path: "AGENTS.md", name: "agents", version: 1 },
	{ path: ".agents/skills/creating-nnw-themes/SKILL.md", name: "skill", version: 1 },
	{ path: ".github/workflows/check.yml", name: "check", version: 1 },
	{ path: ".github/workflows/pages.yml", name: "pages", version: 1 },
	{ path: ".github/workflows/release.yml", name: "release", version: 1 },
	{ path: ".github/workflows/screenshot.yml", name: "screenshot", version: 1 },
];

const MARKER = /nnw-theme-stub:\s*([a-z-]+)\s+v(\d+)/;

/** The marker in a stub file: its first line, or the first after YAML front matter. */
export function readMarker(text: string): { name: string; version: number } | null {
	let lines = text.split("\n");
	if (lines[0]?.trim() === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) lines = lines.slice(end + 1);
	}
	const match = MARKER.exec(lines[0] ?? "");
	return match ? { name: match[1] ?? "", version: Number(match[2]) } : null;
}

/** A warning for each stub that is missing, unmarked, or older than this package's. */
export function staleStubs(root: string): string[] {
	const warnings: string[] = [];
	for (const stub of STUBS) {
		const url = `${TEMPLATE_BLOB}/${stub.path}`;
		let text: string;
		try {
			text = readFileSync(join(root, stub.path), "utf8");
		} catch {
			warnings.push(`${stub.path} is missing; add the current stub from ${url}`);
			continue;
		}
		const marker = readMarker(text);
		if (!marker || marker.name !== stub.name) {
			warnings.push(`${stub.path} has no nnw-theme-stub marker; replace it with ${url}`);
		} else if (marker.version < stub.version) {
			warnings.push(
				`${stub.path} is stub ${stub.name} v${marker.version}; v${stub.version} is current. ` +
					`Replace it with ${url}`,
			);
		}
	}
	return warnings;
}
