import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
	readPlist,
	repositoryFixtures,
	TEMPLATE_7_3_FILE,
	ThemeError,
	themeStem,
} from "../project.ts";
import {
	allFixtures,
	checkTargets,
	extraFixtures,
	type RenderTarget,
	readDeliveries,
	renderSite,
	rendersDifferentlyWhenOlder,
	writeGallery,
} from "../render.ts";
import { staleStubs } from "../stubs.ts";
import { printWarnings } from "./package.ts";
import { CheckProgress } from "./progress.ts";

/**
 * Each fixture's [expect.footnotes]. A fixture that models a sync service, with
 * base_url or deliveries, fails a footnote link that never became a marker unless it
 * sets all_converted = false; any other fixture only warns about one, unless it sets
 * all_converted = true.
 */
export function expectations(
	root: string,
	targets: readonly RenderTarget[],
): Record<string, FootnoteExpectations> {
	const result: Record<string, FootnoteExpectations> = {};
	for (const name of new Set(targets.map((target) => target.fixture))) {
		const fixture = readFixture(fixturePath(root, name));
		const expected = footnoteExpectations(fixture, `fixtures/${name}.toml`);
		expected.all_converted ??= "base_url" in fixture || "deliveries" in fixture;
		result[name] = expected;
	}
	return result;
}

/** A one-line pointer to the platform fixtures, for a theme with no fixtures of its own. */
export function fixtureHint(root: string): string | undefined {
	if (repositoryFixtures(root).length) return undefined;
	return (
		"Hint: this theme has no fixtures of its own. `npx nnw-theme@2 fixture list` " +
		"shows ready-made ones modeled on WordPress, Ghost, Substack, Medium, and Mastodon " +
		"markup, and on podcast and Media RSS enclosures."
	);
}

/**
 * A one-line pointer to the 7.3 update steps for a theme that doesn't place the media
 * macros, or to the media fixtures for one that does but can't yet test them. A theme
 * with no fixtures at all gets fixtureHint instead.
 */
export function mediaHint(root: string, theme: string): string | undefined {
	const newer = join(theme, TEMPLATE_7_3_FILE);
	const template = readFileSync(
		existsSync(newer) ? newer : join(theme, "template.html"),
		"utf8",
	);
	const missing = ["primary_media", "enclosures"].filter(
		(macro) => !template.includes(`[[${macro}]]`),
	);
	if (missing.length) {
		return (
			`Hint: this theme doesn't place NetNewsWire 7.3's ${missing.join(" or ")}. ` +
			"`npx nnw-theme@2 guide update-7.3` has the steps."
		);
	}
	const fixtures = repositoryFixtures(root);
	const hasMedia = (name: string) => {
		const fixture = readFixture(fixturePath(root, name));
		return ["attachments", "image_url", "thumbnail_url"].some((key) => key in fixture);
	};
	if (!fixtures.length || fixtures.some(hasMedia)) return undefined;
	return (
		"Hint: no fixture here has audio, video, or an article image, so check can't test " +
		"this theme's media. `npx nnw-theme@2 fixture add podcast media-rss` adds some."
	);
}

/** A one-line pointer to bump, for a theme whose Get Info window shows no version. */
export function getInfoHint(theme: string): string | undefined {
	if (readPlist(theme).CFBundleGetInfoString !== undefined) return undefined;
	return (
		"Hint: Finder's Get Info shows no version for this theme. " +
		"At your next release, `npx nnw-theme@2 bump --get-info-version 1.0.0` adds one."
	);
}

function printHints(root: string, theme: string): void {
	let hints: (string | undefined)[];
	try {
		hints = [fixtureHint(root), mediaHint(root, theme), getInfoHint(theme)];
	} catch {
		return; // A bundle too broken to read: validation says why.
	}
	for (const hint of hints) {
		if (hint) console.log(hint);
	}
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
	const extras = extraFixtures(root);
	const targets = checkTargets(extras, {
		olderNetNewsWire: rendersDifferentlyWhenOlder(theme),
		deliveries: readDeliveries(root, allFixtures(extras)),
	});
	const expected = expectations(root, targets);
	const progress = new CheckProgress(targets.length);
	progress.status("Validating and packaging the theme…");
	let archive: ReturnType<typeof buildArchive>;
	try {
		archive = buildArchive(theme, join(root, "build", "release"), {
			allowRemoteMedia: values["allow-remote-media"] === true,
		});
	} catch (error) {
		progress.done();
		printHints(root, theme);
		throw error;
	}
	progress.done();
	printWarnings(archive.warnings);
	progress.status(`Rendering ${targets.length} pages…`);
	const site = renderSite(root, theme, targets);
	let results: Record<string, string[]>;
	const warned: Record<string, string[]> = {};
	try {
		results = await checkPages(site, targets, progress, expected, warned);
	} finally {
		progress.done();
	}
	writeGallery(site, themeStem(theme), targets, results);
	const failures = targets.flatMap((target) =>
		(results[target.slug] ?? []).map((message) => `${target.label}: ${message}`),
	);
	const warnings = targets.flatMap((target) =>
		(warned[target.slug] ?? []).map((message) => `Warning: ${target.label}: ${message}`),
	);
	for (const warning of warnings) console.log(warning);
	const warningLines = warnings.map((warning) => `${warning}\n`).join("");
	const passed = targets.filter((target) => !results[target.slug]?.length).length;
	const packageName = basename(archive.path);
	const footer = `nnw-theme ${version()}\n`;
	const report = join(root, "build", "check-report.txt");
	if (failures.length) {
		writeFileSync(report, `FAIL\n${failures.join("\n")}\n${warningLines}${footer}`, "utf8");
	} else {
		writeFileSync(
			report,
			`PASS\n${targets.length} WebKit renders checked\nPackage: ${packageName}\n` +
				`${warningLines}${footer}`,
			"utf8",
		);
		console.log(`PASS: ${targets.length} WebKit renders and ${packageName}`);
	}
	printHints(root, theme);
	const index = join(site, "index.html");
	console.log(`Preview: ${index}`);
	await offerToOpen(index, values.open as boolean | undefined);
	if (failures.length) {
		throw new ThemeError(
			`${targets.length - passed} of ${targets.length} WebKit renders failed:\n- ${failures.join("\n- ")}`,
		);
	}
}
