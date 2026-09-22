import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after } from "node:test";
import { fileURLToPath } from "node:url";

export const STARTER = join(
	dirname(fileURLToPath(import.meta.url)),
	"fixtures",
	"Starter.nnwtheme",
);

/** A temporary directory removed when the test file finishes. */
export function temporaryDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "nnw-theme-test-"));
	after(() => rmSync(directory, { recursive: true, force: true }));
	return directory;
}

export function writeFiles(root: string, files: Record<string, string | Uint8Array>): void {
	for (const [relative, content] of Object.entries(files)) {
		const path = join(root, relative);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}
}

/** Stand-in NetNewsWire rendering files. */
export function makeSnapshot(parent: string): string {
	const snapshot = join(parent, "snapshot");
	writeFiles(snapshot, {
		"Mac/page.html":
			"<html><head><title>[[title]]</title><style>[[style]]</style>" +
			'<base href="[[baseURL]]"></head><body>[[body]]</body></html>',
		"iOS/page.html":
			"<html><head><title>[[title]]</title><style>[[style]]</style>" +
			"</head><body>[[body]]</body></html>",
		// core.css carries no macros upstream; [[font-size]] lives in theme CSS.
		"Shared/core.css": "body { margin: 0; }",
		"Shared/main.js": "function processPage() {}",
		"Shared/newsfoot.js": "// test newsfoot",
		"Mac/main_mac.js": "function postRenderProcessing() {}",
		"iOS/main_ios.js": "function postRenderProcessing() {}",
	});
	return snapshot;
}
