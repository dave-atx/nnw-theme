import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
	COMMANDS,
	type CommandSpec,
	DESCRIPTION,
	findCommand,
	type OptionSpec,
	PROGRAM,
} from "./commands.ts";
import { packagePath, ThemeError } from "./project.ts";

export interface Args {
	values: Record<string, string | boolean | undefined>;
	positionals: string[];
}

type Handler = (args: Args) => void | Promise<void>;

// Loaded on demand, so a quick command never pays for Playwright or the prompts.
const HANDLERS: Record<string, () => Promise<{ default: Handler }>> = {
	setup: () => import("./commands/setup.ts"),
	preview: () => import("./commands/preview.ts"),
	render: () => import("./commands/render.ts"),
	check: () => import("./commands/check.ts"),
	screenshot: () => import("./commands/screenshot.ts"),
	package: () => import("./commands/package.ts"),
};

class UsageError extends Error {}

export function version(): string {
	const manifest = JSON.parse(readFileSync(packagePath("package.json"), "utf8"));
	return manifest.version as string;
}

function optionUsage(option: OptionSpec): string {
	const name = option.negatable ? `--${option.name} | --no-${option.name}` : `--${option.name}`;
	if (option.type === "boolean") return name;
	const value = option.choices
		? `{${option.choices.join(",")}}`
		: option.name.toUpperCase().replaceAll("-", "_");
	return `${name} ${value}`;
}

function wrap(text: string, indent: number, width = 80): string {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/)) {
		if (line && indent + line.length + 1 + word.length > width) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	if (line) lines.push(line);
	return lines.map((item) => " ".repeat(indent) + item).join("\n");
}

function rows(items: [string, string][]): string {
	const column = Math.min(24, Math.max(...items.map(([left]) => left.length)) + 4);
	return items
		.map(([left, right]) => {
			if (!right) return `  ${left}`;
			if (left.length + 4 > column) return `  ${left}\n${wrap(right, column)}`;
			return `  ${left.padEnd(column - 2)}${wrap(right, column).trimStart()}`;
		})
		.join("\n");
}

export function mainHelp(): string {
	const visible = COMMANDS.filter((command) => !command.hidden);
	return [
		`usage: ${PROGRAM} [-h] [--version] COMMAND ...`,
		"",
		DESCRIPTION,
		"",
		"commands:",
		rows(visible.map((command) => [command.name, command.summary])),
		"",
		"options:",
		rows([
			["-h, --help", "show this help message and exit"],
			["--version", "print the nnw-theme version and exit"],
		]),
		"",
		`Run \`${PROGRAM} COMMAND --help\` for a command's options.`,
		`Run it through npx: \`npx nnw-theme@1 COMMAND\`.`,
		"",
	].join("\n");
}

export function commandHelp(command: CommandSpec, path: string[]): string {
	const usage = [`usage: ${PROGRAM} ${path.join(" ")} [-h]`];
	for (const option of command.options) {
		const text = optionUsage(option);
		usage.push(option.required ? text : `[${text}]`);
	}
	if (command.subcommands)
		usage.push(`{${command.subcommands.map((sub) => sub.name).join(",")}}`);
	if (command.positionals) {
		const name = command.positionals.name.toUpperCase();
		usage.push(command.positionals.variadic ? `[${name} ...]` : `[${name}]`);
	}
	const sections = [
		wrap(usage.join(" "), 0),
		"",
		wrap(command.description ?? command.summary, 0),
	];
	if (command.subcommands) {
		sections.push(
			"",
			"commands:",
			rows(command.subcommands.map((sub) => [sub.name, sub.summary])),
		);
	}
	if (command.positionals) {
		sections.push(
			"",
			"positional arguments:",
			rows([[command.positionals.name, command.positionals.help]]),
		);
	}
	const options: [string, string][] = [["-h, --help", "show this help message and exit"]];
	for (const option of command.options) {
		const help = option.help ?? "";
		const fallback = option.default ? ` (default: ${option.default})` : "";
		options.push([optionUsage(option), help + (help ? fallback : fallback.trim())]);
	}
	sections.push("", "options:", rows(options), "");
	return sections.join("\n");
}

function parseCommand(command: CommandSpec, argv: string[]): Args | "help" {
	const options: Record<string, { type: "string" | "boolean"; short?: string }> = {
		help: { type: "boolean", short: "h" },
	};
	for (const option of command.options) options[option.name] = { type: option.type };
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: argv,
			options,
			allowPositionals: true,
			allowNegative: command.options.some((option) => option.negatable),
			strict: true,
		});
	} catch (error) {
		const message = (error as Error).message;
		const unknown = /Unknown option '([^']+)'/.exec(message);
		throw new UsageError(unknown ? `unrecognized arguments: ${unknown[1]}` : message);
	}
	const values = parsed.values as Record<string, string | boolean | undefined>;
	if (values.help) return "help";
	delete values.help;
	for (const option of command.options) {
		const value = values[option.name];
		if (value === false && option.type === "boolean" && !option.negatable) {
			throw new UsageError(`unrecognized arguments: --no-${option.name}`);
		}
		if (value === undefined && option.default !== undefined)
			values[option.name] = option.default;
		if (typeof value === "string" && option.choices && !option.choices.includes(value)) {
			throw new UsageError(
				`argument --${option.name}: invalid choice: '${value}' (choose from ${option.choices.map((choice) => `'${choice}'`).join(", ")})`,
			);
		}
		if (option.required && value === undefined) {
			throw new UsageError(`the following arguments are required: --${option.name}`);
		}
	}
	const positionals = parsed.positionals;
	const spec = command.positionals;
	if (!spec && positionals.length) {
		throw new UsageError(`unrecognized arguments: ${positionals.join(" ")}`);
	}
	if (spec && !spec.variadic && positionals.length > 1) {
		throw new UsageError(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
	}
	if (spec?.choices) {
		for (const value of positionals) {
			if (!spec.choices.includes(value)) {
				throw new UsageError(
					`argument ${spec.name}: invalid choice: '${value}' (choose from ${spec.choices.map((choice) => `'${choice}'`).join(", ")})`,
				);
			}
		}
	}
	return { values, positionals };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
	const [name, ...rest] = argv;
	if (name === undefined || name === "-h" || name === "--help") {
		process.stdout.write(mainHelp());
		return name === undefined ? 2 : 0;
	}
	if (name === "--version" || name === "-V") {
		console.log(version());
		return 0;
	}
	try {
		let command = findCommand(name);
		const path = [name];
		let args = rest;
		if (!command) {
			const choices = COMMANDS.filter((item) => !item.hidden).map((item) => `'${item.name}'`);
			throw new UsageError(
				`argument COMMAND: invalid choice: '${name}' (choose from ${choices.join(", ")})`,
			);
		}
		if (command.subcommands) {
			const [subName, ...subRest] = rest;
			if (subName === undefined || subName === "-h" || subName === "--help") {
				process.stdout.write(commandHelp(command, path));
				return subName === undefined ? 2 : 0;
			}
			const sub = command.subcommands.find((item) => item.name === subName);
			if (!sub) {
				const choices = command.subcommands.map((item) => `'${item.name}'`).join(", ");
				throw new UsageError(
					`argument ${name}: invalid choice: '${subName}' (choose from ${choices})`,
				);
			}
			command = sub;
			path.push(subName);
			args = subRest;
		}
		const parsed = parseCommand(command, args);
		if (parsed === "help") {
			process.stdout.write(commandHelp(command, path));
			return 0;
		}
		const load = HANDLERS[path.join(" ")];
		if (!load) throw new UsageError(`${path.join(" ")} is not implemented yet`);
		const handler = (await load()).default;
		await handler(parsed);
		return 0;
	} catch (error) {
		if (error instanceof UsageError) {
			process.stderr.write(
				`usage: ${PROGRAM} ${name} [-h] ...\n${PROGRAM}: error: ${error.message}\n`,
			);
			return 2;
		}
		if (error instanceof ThemeError) {
			process.stderr.write(`error: ${error.message}\n`);
			return 1;
		}
		throw error;
	}
}
