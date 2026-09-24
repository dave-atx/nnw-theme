import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { setupWebkit } from "../browser.ts";
import { interactive, promptConfirm, promptText } from "../interactive.ts";
import type { Args } from "../main.ts";
import {
	findRoot,
	findTheme,
	IDENTITY_END,
	IDENTITY_START,
	PLACEHOLDER_MARKER,
	readPlist,
	ThemeError,
	writePlist,
} from "../project.ts";
import { pyRepr } from "../pyformat.ts";
import { urlsplit } from "../urlparse.ts";
import { marketplaceEnable } from "./marketplace.ts";

function slug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function identifierSlug(value: string): string {
	return slug(value).replace(/[^a-z0-9-]+/g, "") || "theme";
}

interface Repository {
	owner?: { login?: string };
	isFork?: boolean;
}

/** Owner and fork status of the current repository, when gh can report them. */
function repository(): Repository {
	const result = spawnSync("gh", ["repo", "view", "--json", "owner,isFork"], {
		encoding: "utf8",
	});
	if (result.error || result.status) return {};
	try {
		const value = JSON.parse(result.stdout);
		return value && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

export function defaultIdentifier(name: string, homepage: string, githubUser?: string): string {
	const suffix = identifierSlug(name);
	if (githubUser) return `io.github.${identifierSlug(githubUser)}.${suffix}`;
	const hostname = (urlsplit(homepage).hostname ?? "example.com").toLowerCase().split(".");
	const domain = hostname.map(identifierSlug).reverse().join(".");
	return `${domain}.${suffix}`;
}

export function absoluteHomepage(value: string): string {
	const parsed = urlsplit(value);
	if (!["http", "https"].includes(parsed.scheme) || !parsed.netloc) {
		throw new ThemeError("creator home page must be an absolute HTTP(S) URL");
	}
	if (parsed.hostname === "example.com" || parsed.hostname === "www.example.com") {
		throw new ThemeError("creator home page must not use the example.com placeholder");
	}
	return value;
}

function updateReadme(root: string, name: string, creator: string, homepage: string): void {
	const path = join(root, "README.md");
	const text = readFileSync(path, "utf8");
	const start = text.indexOf(IDENTITY_START);
	const end = text.indexOf(IDENTITY_END);
	if (start < 0 || end < start) throw new ThemeError("README identity markers are missing");
	const replacement =
		`${IDENTITY_START}\n# ${name}\n\n` +
		`A NetNewsWire theme by [${creator}](${homepage}).\n${IDENTITY_END}`;
	writeFileSync(
		path,
		text.slice(0, start) + replacement + text.slice(end + IDENTITY_END.length),
		"utf8",
	);
}

const TEMPLATE = "dave-atx/netnewswire-theme-template";

/** The theme root, or directions to create one: init starts from the template. */
function templateRoot(): string {
	try {
		return findRoot();
	} catch (error) {
		if (!(error instanceof ThemeError)) throw error;
		throw new ThemeError(
			"no theme repository here; init personalizes a copy of the theme template.\n" +
				`Create one with "Use this template" at https://github.com/${TEMPLATE}, ` +
				"clone it, and run init inside it. With the GitHub CLI:\n" +
				`  gh repo create my-theme --template ${TEMPLATE} --public --clone\n` +
				"  cd my-theme\n" +
				"  npx nnw-theme@1 init",
		);
	}
}

async function ask(value: string | undefined, flag: string, label: string, fallback: string) {
	if (value) return value;
	if (!interactive())
		throw new ThemeError(`pass --${flag} (no terminal to ask for ${label.toLowerCase()})`);
	return await promptText(label, fallback);
}

export default async function init({ values }: Args): Promise<void> {
	const root = templateRoot();
	let theme = findTheme(root);
	if (!existsSync(join(root, PLACEHOLDER_MARKER))) {
		throw new ThemeError(
			"this repository is already initialized; run `npx nnw-theme@1 setup` to install preview tools",
		);
	}
	const flag = (name: string) => values[name] as string | undefined;
	const prompting = !(flag("name") && flag("creator") && flag("homepage"));
	const repo = repository();
	if (repo.isFork) {
		console.error(
			"Warning: this repository is a fork. The theme marketplace skips forks, so " +
				"the theme will never be discovered. Start from GitHub's \"Use this " +
				'template" button instead, then rerun initialization.',
		);
	}
	const githubUser = flag("github-user") || repo.owner?.login || undefined;
	const name = await ask(flag("name"), "name", "Theme name", "Quiet Reader");
	const creator = await ask(flag("creator"), "creator", "Your name", "Theme Author");
	const homepage = absoluteHomepage(
		await ask(
			flag("homepage"),
			"homepage",
			"Your HTTP(S) home page (for example, your GitHub profile)",
			githubUser ? `https://github.com/${githubUser}` : "",
		),
	);
	const proposed = flag("identifier") || defaultIdentifier(name, homepage, githubUser);
	let identifier = proposed;
	if (prompting && !flag("identifier"))
		identifier = await promptText("Stable theme identifier", proposed);
	const confirmation = flag("confirm-identifier");
	if (confirmation) {
		if (confirmation !== identifier) {
			throw new ThemeError("--confirm-identifier must exactly match the chosen identifier");
		}
	} else if (!interactive()) {
		throw new ThemeError("pass --confirm-identifier with the identifier to keep permanently");
	} else if (
		!(await promptConfirm(
			`Use ${pyRepr(identifier)} permanently? It cannot change after the first release.`,
			true,
		))
	) {
		throw new ThemeError("choose a permanent identifier and rerun initialization");
	}

	if (!name.trim() || name === "." || name === ".." || /[/\\\0]/.test(name)) {
		throw new ThemeError("theme name must be non-empty and cannot contain path separators");
	}
	const destination = join(root, `${name}.nnwtheme`);
	if (existsSync(destination) && destination !== theme) {
		throw new ThemeError(`theme bundle already exists: ${destination}`);
	}
	const metadata = readPlist(theme);
	Object.assign(metadata, {
		ThemeIdentifier: identifier,
		Name: name,
		CreatorHomePage: homepage,
		CreatorName: creator,
		Version: 1,
	});
	if (destination !== theme) {
		renameSync(theme, destination);
		theme = destination;
	}
	writePlist(join(theme, "Info.plist"), metadata);
	updateReadme(root, name, creator, homepage);
	rmSync(join(root, "screenshots", "theme-preview.png"), { force: true });
	rmSync(join(root, PLACEHOLDER_MARKER));
	console.log(`Initialized ${name}.nnwtheme with identifier ${identifier}.`);
	console.log(
		"Create a deliberate marketplace image with `npx nnw-theme@1 screenshot --promote`.",
	);

	let marketplace = flag("marketplace");
	if (marketplace === undefined) {
		marketplace =
			interactive() && (await promptConfirm("Add this repository to the theme marketplace?"))
				? "yes"
				: "no";
	}
	if (marketplace === "yes") marketplaceEnable();

	let install = values["install-browser"] as boolean | undefined;
	if (install === undefined && prompting && interactive()) {
		install = await promptConfirm("Set up WebKit for previews now?");
	}
	if (install) {
		// Initialization is already complete; a preview setup failure must not look like
		// an init failure, because rerunning init is refused from here on.
		try {
			await setupWebkit();
		} catch (error) {
			console.error(
				`Warning: initialization succeeded, but preview setup did not: ${(error as Error).message}\n` +
					"Finish preview setup later with `npx nnw-theme@1 setup`.",
			);
		}
	}
	console.log(
		`Next: work on your design in ${relative(process.cwd(), theme) || "."}, then run \`npx nnw-theme@1 preview\`.`,
	);
}
