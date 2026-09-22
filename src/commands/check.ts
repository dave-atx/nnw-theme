import { writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkPages } from "../browser.ts";
import { interactive, openInBrowser, promptConfirm } from "../interactive.ts";
import { type Args, version } from "../main.ts";
import { buildArchive } from "../package.ts";
import {
	type FootnoteExpectations,
	findRoot,
	findTheme,
	fixturePath,
	footnoteExpectations,
	readFixture,
	ThemeError,
	themeStem,
} from "../project.ts";
import {
	checkTargets,
	extraFixtures,
	type RenderTarget,
	renderSite,
	writeGallery,
} from "../render.ts";
import { staleStubs } from "../stubs.ts";
import { printWarnings } from "./package.ts";
import { CheckProgress } from "./progress.ts";

export function expectations(
	root: string,
	targets: readonly RenderTarget[],
): Record<string, FootnoteExpectations> {
	const result: Record<string, FootnoteExpectations> = {};
	for (const name of new Set(targets.map((target) => target.fixture))) {
		result[name] = footnoteExpectations(
			readFixture(fixturePath(root, name)),
			`fixtures/${name}.toml`,
		);
	}
	return result;
}

async function offerToOpen(index: string, choice: boolean | undefined): Promise<void> {
	const open = choice ?? (interactive() && (await promptConfirm("Open the preview?", true)));
	if (open) openInBrowser(pathToFileURL(index).href);
}

export default async function check({ values }: Args): Promise<void> {
	const root = findRoot();
	const theme = findTheme(root);
	console.log(`nnw-theme ${version()}`);
	printWarnings(staleStubs(root));
	const targets = checkTargets(extraFixtures(root));
	const expected = expectations(root, targets);
	const progress = new CheckProgress(targets.length);
	progress.status("Validating and packaging the theme…");
	const archive = buildArchive(theme, join(root, "build", "release"), {
		allowRemoteMedia: values["allow-remote-media"] === true,
	});
	progress.done();
	printWarnings(archive.warnings);
	progress.status(`Rendering ${targets.length} pages…`);
	const site = renderSite(root, theme, targets);
	let results: Record<string, string[]>;
	try {
		results = await checkPages(site, targets, progress, expected);
	} finally {
		progress.done();
	}
	writeGallery(site, themeStem(theme), targets, results);
	const failures = targets.flatMap((target) =>
		(results[target.slug] ?? []).map((message) => `${target.label}: ${message}`),
	);
	const passed = targets.filter((target) => !results[target.slug]?.length).length;
	const packageName = basename(archive.path);
	const footer = `nnw-theme ${version()}\n`;
	const report = join(root, "build", "check-report.txt");
	if (failures.length) {
		writeFileSync(report, `FAIL\n${failures.join("\n")}\n${footer}`, "utf8");
	} else {
		writeFileSync(
			report,
			`PASS\n${targets.length} WebKit renders checked\nPackage: ${packageName}\n${footer}`,
			"utf8",
		);
		console.log(`PASS: ${targets.length} WebKit renders and ${packageName}`);
	}
	const index = join(site, "index.html");
	console.log(`Preview: ${index}`);
	await offerToOpen(index, values.open as boolean | undefined);
	if (failures.length) {
		throw new ThemeError(
			`${targets.length - passed} of ${targets.length} WebKit renders failed:\n- ${failures.join("\n- ")}`,
		);
	}
}
