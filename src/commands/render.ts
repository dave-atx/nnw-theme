import type { Args } from "../main.ts";
import { findRoot, findTheme, ThemeError } from "../project.ts";
import { renderSite, repositoryTargets } from "../render.ts";

export default function render({ positionals }: Args): void {
	const root = findRoot();
	const theme = findTheme(root);
	let targets = repositoryTargets(root);
	if (positionals.length) {
		const requested = new Set(positionals);
		targets = targets.filter((target) => requested.has(target.fixture));
		const found = new Set(targets.map((target) => target.fixture));
		const unknown = [...requested].filter((name) => !found.has(name)).sort();
		if (unknown.length) throw new ThemeError(`unknown fixture(s): ${unknown.join(", ")}`);
	}
	const site = renderSite(root, theme, targets);
	console.log(`${site}/index.html`);
}
