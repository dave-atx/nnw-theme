import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkPages } from "../browser.ts";
import type { Args } from "../main.ts";
import { findRoot, findTheme, ThemeError } from "../project.ts";
import {
	type Appearance,
	extraFixtures,
	FIXTURE_NAMES,
	type Platform,
	RenderTarget,
	renderSite,
} from "../render.ts";
import { expectations } from "./check.ts";

// Any fixture on any platform: a screenshot is a deliberate one-off, not the check matrix.
function selectTarget(root: string, values: Args["values"]): RenderTarget {
	const { fixture, platform, appearance, card } = values;
	if (![...Object.keys(FIXTURE_NAMES), ...extraFixtures(root)].includes(fixture as string)) {
		throw new ThemeError(`unknown fixture: ${fixture}`);
	}
	return new RenderTarget(fixture as string, platform as Platform, appearance as Appearance, {
		card: !!card,
	});
}

export default async function screenshot({ values }: Args): Promise<void> {
	const root = findRoot();
	const theme = findTheme(root);
	const target = selectTarget(root, values);
	const site = renderSite(root, theme, [target]);
	const results = await checkPages(site, [target], undefined, expectations(root, [target]));
	const failures = results[target.slug] ?? [];
	if (failures.length) {
		throw new ThemeError(`screenshot checks failed:\n- ${failures.join("\n- ")}`);
	}
	const source = join(site, "screenshots", `${target.slug}.png`);
	console.log(source);
	if (values.promote) {
		const destination = join(root, "screenshots", "theme-preview.png");
		mkdirSync(join(root, "screenshots"), { recursive: true });
		copyFileSync(source, destination);
		console.log(`Promoted marketplace screenshot: ${destination}`);
	}
}
