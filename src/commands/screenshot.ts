import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { checkPages } from "../browser.ts";
import type { Args } from "../main.ts";
import { findRoot, findTheme, ThemeError } from "../project.ts";
import { extraFixtures, normalTargets, type RenderTarget, renderSite } from "../render.ts";
import { expectations } from "./check.ts";

function selectTarget(root: string, values: Args["values"]): RenderTarget {
	const targets = normalTargets(extraFixtures(root));
	const { fixture, platform, appearance } = values;
	if (!targets.some((target) => target.fixture === fixture)) {
		throw new ThemeError(`unknown fixture: ${fixture}`);
	}
	const target = targets.find(
		(item) =>
			item.fixture === fixture && item.platform === platform && item.appearance === appearance,
	);
	if (!target) throw new ThemeError(`${fixture} is checked on Mac and iPhone only`);
	return target;
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
