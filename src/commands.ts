// The one description of the command line: the parser, help, and shell completion
// are all generated from it, so they cannot drift apart.

export interface OptionSpec {
	name: string;
	type: "string" | "boolean";
	/** Also accept --no-NAME (argparse's BooleanOptionalAction). */
	negatable?: boolean;
	choices?: readonly string[];
	default?: string;
	required?: boolean;
	help?: string;
	/** Complete this option's value with fixture names. */
	completeFixtures?: boolean;
}

export interface CommandSpec {
	name: string;
	summary: string;
	description?: string;
	options: readonly OptionSpec[];
	positionals?: {
		name: string;
		help: string;
		variadic: boolean;
		choices?: readonly string[];
		completeFixtures?: boolean;
	};
	subcommands?: readonly CommandSpec[];
	/** Parsed but left out of help and completion. */
	hidden?: boolean;
}

export const PROGRAM = "nnw-theme";
export const DESCRIPTION = "Create, preview, check, and publish a NetNewsWire theme.";
export const GUIDE_TOPICS = [
	"skill",
	"theme-format",
	"fixtures",
	"design-checklist",
	"publishing",
] as const;
export const SHELLS = ["fish", "zsh", "bash"] as const;
/** Fixtures that ship in the package; also in project.ts, which reads them. */
export const BUILT_IN_FIXTURE_NAMES = ["article", "kitchen-sink"] as const;

const allowRemoteMedia: OptionSpec = {
	name: "allow-remote-media",
	type: "boolean",
	help: "acknowledge warnings for theme-owned remote fonts/images/media",
};

export const COMMANDS: readonly CommandSpec[] = [
	{
		name: "init",
		summary: "personalize a fresh copy of the template (run once)",
		description:
			"Name the theme, choose its permanent identifier, and optionally join the " +
			"marketplace and install WebKit. Runs once, while .nnw-theme-uninitialized exists.",
		options: [
			{ name: "name", type: "string" },
			{ name: "creator", type: "string" },
			{ name: "homepage", type: "string" },
			{ name: "identifier", type: "string" },
			{ name: "confirm-identifier", type: "string" },
			{ name: "github-user", type: "string" },
			{ name: "marketplace", type: "string", choices: ["yes", "no"] },
			{ name: "install-browser", type: "boolean", negatable: true },
		],
	},
	{
		name: "setup",
		summary: "install the WebKit browser that check and screenshot use",
		description:
			"Install the WebKit build this version of nnw-theme checks with. " +
			"--with-deps also installs its Linux system libraries (for CI). Safe to rerun.",
		options: [
			{
				name: "with-deps",
				type: "boolean",
				help: "also install WebKit's Linux system dependencies",
			},
		],
	},
	{
		name: "preview",
		summary: "live gallery for editing: serves, opens, and rebuilds on save",
		description:
			"Serve the preview gallery on localhost, open it, and rebuild whenever the theme " +
			"or fixtures change. Pages render live in your own browser; nothing is checked. " +
			"Runs until Ctrl-C.",
		options: [{ name: "no-open", type: "boolean", help: "do not open a browser" }],
	},
	{
		name: "render",
		summary: "write the preview gallery once, without serving or checking",
		description:
			"Write the same gallery as preview to build/preview/ and exit. Useful for scripts " +
			"and agents, since preview never exits.",
		options: [],
		positionals: {
			name: "fixtures",
			help: "fixtures to include (default: all), e.g. article",
			variadic: true,
			completeFixtures: true,
		},
	},
	{
		name: "check",
		summary: "release gate: package and test every case in WebKit",
		description:
			"Validate and package the theme, then render 16 cases (the article and " +
			"kitchen-sink fixtures on Mac, iPhone, and iPad in light and dark, plus large " +
			"text and Article JavaScript off) and four more for each fixture you add (Mac " +
			"and iPhone, light and dark) in WebKit. Screenshot each, and fail on missing " +
			"content, unresolved macros, overflow, broken images, footnotes that do not " +
			"open, external requests, or JavaScript errors. Results go into the gallery in " +
			"build/preview/.",
		options: [
			allowRemoteMedia,
			{
				name: "open",
				type: "boolean",
				negatable: true,
				help: "open the gallery when done (default: ask in a terminal)",
			},
		],
	},
	{
		name: "screenshot",
		summary: "check one case in WebKit and save its image",
		description:
			"Render and check a single case in WebKit and save its full-page screenshot. " +
			"With --promote, it becomes screenshots/theme-preview.png, the marketplace card.",
		options: [
			{
				name: "fixture",
				type: "string",
				default: "article",
				help: "fixture name",
				completeFixtures: true,
			},
			{ name: "platform", type: "string", choices: ["mac", "iphone", "ipad"], default: "mac" },
			{ name: "appearance", type: "string", choices: ["light", "dark"], default: "light" },
			{ name: "promote", type: "boolean", help: "use it as the marketplace screenshot" },
		],
	},
	{
		name: "package",
		summary: "validate the theme and build its release ZIP (no WebKit)",
		options: [{ name: "output-dir", type: "string", default: "dist" }, allowRemoteMedia],
	},
	{
		name: "capture",
		summary: "explain how to capture a real article from NetNewsWire as a fixture",
		options: [],
	},
	{
		name: "bump",
		summary: "increase the Info.plist Version before a release",
		options: [{ name: "yes", type: "boolean", help: "skip the confirmation" }],
	},
	{
		name: "marketplace",
		summary: "manage marketplace participation",
		options: [],
		subcommands: [
			{ name: "enable", summary: "add the discovery topic on GitHub", options: [] },
		],
	},
	{
		name: "guide",
		summary: "print the theme authoring guide for agents and people",
		description:
			"Print the guidance for building a theme with this tool. Topics: " +
			`${GUIDE_TOPICS.join(", ")} (default: skill).`,
		options: [],
		positionals: {
			name: "topic",
			help: "guide topic (default: skill)",
			variadic: false,
			choices: GUIDE_TOPICS,
		},
	},
	{
		name: "completion",
		summary: "print shell completion and an npx wrapper for fish, zsh, or bash",
		description:
			"Print a script that defines an nnw-theme command running `npx --yes nnw-theme@2` " +
			"(skipped when nnw-theme is already installed) and completes its commands, " +
			"options, and fixture names.",
		options: [],
		positionals: {
			name: "shell",
			help: "fish, zsh, or bash",
			variadic: false,
			choices: SHELLS,
		},
	},
	{
		name: "update",
		summary: "removed: tooling now runs from npm",
		options: [],
		hidden: true,
	},
	// Used only by the Publish workflow.
	{
		name: "release-check",
		summary: "compare the theme with its previous release",
		options: [{ name: "previous-asset", type: "string", required: true }],
		hidden: true,
	},
];

export function findCommand(name: string): CommandSpec | undefined {
	return COMMANDS.find((command) => command.name === name);
}
