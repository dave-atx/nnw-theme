// Shell completion scripts, generated from the same command spec the parser uses.
// Each script also defines an nnw-theme function that runs `npx --yes nnw-theme@2`
// unless a real nnw-theme is already on PATH. The scripts never call npx to complete,
// so completion is instant.
import {
	BUILT_IN_FIXTURE_NAMES,
	COMMANDS,
	type CommandSpec,
	type OptionSpec,
	PROGRAM,
} from "./commands.ts";

const RUN = "npx --yes nnw-theme@2";
const visible = () => COMMANDS.filter((command) => !command.hidden);

function flags(option: OptionSpec): string[] {
	return option.negatable ? [`--${option.name}`, `--no-${option.name}`] : [`--${option.name}`];
}

function allFlags(command: CommandSpec): string[] {
	return [...command.options.flatMap(flags), "--help"];
}

/** Words a command's positional argument completes to, or null for fixture names. */
function positionalWords(command: CommandSpec): readonly string[] | null | undefined {
	if (command.subcommands) return command.subcommands.map((sub) => sub.name);
	if (command.positionals?.completeFixtures) return null;
	return command.positionals?.choices;
}

const single = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// fish ---------------------------------------------------------------------------

function fishQuote(text: string): string {
	return `'${text.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

export function fish(): string {
	const lines = [
		"# nnw-theme completion for fish. Install: npx nnw-theme@2 completion fish > ~/.config/fish/conf.d/nnw-theme.fish",
		`if not command -q ${PROGRAM}`,
		`    function ${PROGRAM} --description 'Run nnw-theme through npx'`,
		`        ${RUN} $argv`,
		"    end",
		"end",
		"function __nnw_theme_fixtures",
		"    # The theme root, as nnw-theme finds it: the nearest directory with a bundle.",
		"    set -l root $PWD",
		"    while test $root != / -a (count $root/*.nnwtheme) -eq 0",
		"        set root (dirname $root)",
		"    end",
		`    begin; printf '%s\\n' ${BUILT_IN_FIXTURE_NAMES.join(" ")}`,
		"        for file in $root/fixtures/*.toml; basename $file .toml; end",
		"    end | sort -u",
		"end",
		`complete -c ${PROGRAM} -f`,
		`complete -c ${PROGRAM} -n __fish_use_subcommand -l help -s h -d 'Show help'`,
		`complete -c ${PROGRAM} -n __fish_use_subcommand -l version -d 'Print the version'`,
	];
	for (const command of visible()) {
		lines.push(
			`complete -c ${PROGRAM} -n __fish_use_subcommand -a ${command.name} -d ${fishQuote(command.summary)}`,
		);
		const seen = `__fish_seen_subcommand_from ${command.name}`;
		if (!command.subcommands) {
			fishCommand(lines, command, `'${seen}'`);
			continue;
		}
		const names = command.subcommands.map((sub) => sub.name).join(" ");
		for (const sub of command.subcommands) {
			lines.push(
				`complete -c ${PROGRAM} -n '${seen}; and not __fish_seen_subcommand_from ${names}' ` +
					`-a ${sub.name} -d ${fishQuote(sub.summary)}`,
			);
			fishCommand(lines, sub, `'${seen}; and __fish_seen_subcommand_from ${sub.name}'`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** A leaf command's options and positional words, completed while `when` holds. */
function fishCommand(lines: string[], command: CommandSpec, when: string): void {
	for (const option of command.options) {
		const description = option.help ? ` -d ${fishQuote(option.help)}` : "";
		let values = "";
		if (option.completeFixtures) values = " -x -a '(__nnw_theme_fixtures)'";
		else if (option.choices) values = ` -x -a ${fishQuote(option.choices.join(" "))}`;
		else if (option.type === "string") values = option.name.endsWith("dir") ? " -r -F" : " -x";
		lines.push(`complete -c ${PROGRAM} -n ${when} -l ${option.name}${values}${description}`);
		if (option.negatable) lines.push(`complete -c ${PROGRAM} -n ${when} -l no-${option.name}`);
	}
	const words = positionalWords(command);
	if (words === null)
		lines.push(`complete -c ${PROGRAM} -n ${when} -a '(__nnw_theme_fixtures)'`);
	else if (words)
		lines.push(`complete -c ${PROGRAM} -n ${when} -a ${fishQuote(words.join(" "))}`);
}

// bash ---------------------------------------------------------------------------

/** The case body completing a leaf command's options and positional words. */
function bashCommand(command: CommandSpec, indent: string): string[] {
	const valueCases: string[] = [];
	for (const option of command.options) {
		if (option.type !== "string") continue;
		let reply = "COMPREPLY=()";
		if (option.completeFixtures)
			reply = 'COMPREPLY=($(compgen -W "$(_nnw_theme_fixtures)" -- "$cur"))';
		else if (option.choices)
			reply = `COMPREPLY=($(compgen -W ${single(option.choices.join(" "))} -- "$cur"))`;
		else if (option.name.endsWith("dir")) reply = 'COMPREPLY=($(compgen -d -- "$cur"))';
		valueCases.push(`${indent}  --${option.name}) ${reply}; return ;;`);
	}
	const words = positionalWords(command);
	let positional = "COMPREPLY=()";
	if (words === null)
		positional = 'COMPREPLY=($(compgen -W "$(_nnw_theme_fixtures)" -- "$cur"))';
	else if (words) positional = `COMPREPLY=($(compgen -W ${single(words.join(" "))} -- "$cur"))`;
	return [
		...(valueCases.length ? [`${indent}case "$prev" in`, ...valueCases, `${indent}esac`] : []),
		`${indent}if [[ "$cur" == -* ]]; then`,
		`${indent}  COMPREPLY=($(compgen -W ${single(allFlags(command).join(" "))} -- "$cur"))`,
		`${indent}else`,
		`${indent}  ${positional}`,
		`${indent}fi`,
	];
}

export function bash(): string {
	const cases: string[] = [];
	for (const command of visible()) {
		cases.push(`    ${command.name})`);
		if (command.subcommands) {
			const names = command.subcommands.map((sub) => sub.name).join(" ");
			cases.push(
				"      if (( COMP_CWORD == 2 )); then",
				`        COMPREPLY=($(compgen -W ${single(`${names} --help`)} -- "$cur"))`,
				"        return",
				"      fi",
				`      case "\${COMP_WORDS[2]}" in`,
			);
			for (const sub of command.subcommands) {
				cases.push(`        ${sub.name})`, ...bashCommand(sub, "          "), "          ;;");
			}
			cases.push("      esac");
		} else cases.push(...bashCommand(command, "      "));
		cases.push("      ;;");
	}
	return `# nnw-theme completion for bash. Install: source <(npx --yes nnw-theme@2 completion bash)
if ! type -P ${PROGRAM} >/dev/null 2>&1; then
  ${PROGRAM}() { ${RUN} "$@"; }
fi
_nnw_theme_fixtures() {
  local root=$PWD file
  # The theme root, as nnw-theme finds it: the nearest directory with a bundle.
  while [[ $root != / ]] && ! compgen -G "$root/*.nnwtheme" >/dev/null; do root=$(dirname "$root"); done
  {
    printf '%s\\n' ${BUILT_IN_FIXTURE_NAMES.join(" ")}
    for file in "$root"/fixtures/*.toml; do [ -e "$file" ] && basename "$file" .toml; done
  } | sort -u
}
_nnw_theme() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]}
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=($(compgen -W ${single(
			`${visible()
				.map((command) => command.name)
				.join(" ")} --help --version`,
		)} -- "$cur"))
    return
  fi
  case "\${COMP_WORDS[1]}" in
${cases.join("\n")}
  esac
}
complete -F _nnw_theme ${PROGRAM}
`;
}

// zsh ----------------------------------------------------------------------------

function zshEscape(text: string): string {
	return text
		.replaceAll("'", `'\\''`)
		.replaceAll(":", "\\:")
		.replaceAll("[", "\\[")
		.replaceAll("]", "\\]");
}

function zshOption(option: OptionSpec): string[] {
	const help = zshEscape(option.help ?? option.name);
	let value = "";
	if (option.completeFixtures) value = ":fixture:_nnw_theme_fixtures";
	else if (option.choices) value = `:${option.name}:(${option.choices.join(" ")})`;
	else if (option.type === "string")
		value = option.name.endsWith("dir") ? `:${option.name}:_files -/` : `:${option.name}: `;
	const specs = [`'--${option.name}[${help}]${value}'`];
	if (option.negatable) specs.push(`'--no-${option.name}[${help}]'`);
	return specs;
}

/** An _arguments call completing a leaf command's options and positional words. */
function zshArguments(command: CommandSpec): string {
	const specs = [...command.options.flatMap(zshOption), "'(- *)'{-h,--help}'[show help]'"];
	const words = positionalWords(command);
	if (words === null) specs.push("'*:fixture:_nnw_theme_fixtures'");
	else if (words) {
		const position = command.positionals?.variadic ? "*" : "1";
		specs.push(`'${position}:${command.positionals?.name ?? "command"}:(${words.join(" ")})'`);
	}
	return `_arguments -s ${specs.join(" ")}`;
}

export function zsh(): string {
	const described = visible().map(
		(command) => `    '${command.name}:${zshEscape(command.summary)}'`,
	);
	const cases: string[] = [];
	for (const command of visible()) {
		if (!command.subcommands) {
			cases.push(`    ${command.name}) ${zshArguments(command)} ;;`);
			continue;
		}
		const described = command.subcommands.map(
			(sub) => `'${sub.name}:${zshEscape(sub.summary)}'`,
		);
		cases.push(
			`    ${command.name})`,
			"      if (( CURRENT == 2 )); then",
			`        local -a subcommands=(${described.join(" ")})`,
			`        _describe -t commands 'nnw-theme ${command.name} command' subcommands`,
			"        return",
			"      fi",
			"      local subcommand=$words[2]",
			"      shift words",
			"      (( CURRENT-- ))",
			"      case $subcommand in",
			...command.subcommands.map((sub) => `        ${sub.name}) ${zshArguments(sub)} ;;`),
			"      esac",
			"      ;;",
		);
	}
	return `# nnw-theme completion for zsh. Install: source <(npx --yes nnw-theme@2 completion zsh)
if (( ! $+commands[${PROGRAM}] )); then
  ${PROGRAM}() { ${RUN} "$@"; }
fi
_nnw_theme_fixtures() {
  local root=$PWD
  local -a names
  # The theme root, as nnw-theme finds it: the nearest directory with a bundle.
  while [[ $root != / ]]; do
    names=($root/*.nnwtheme(N/))
    (( $#names )) && break
    root=\${root:h}
  done
  names=(${BUILT_IN_FIXTURE_NAMES.join(" ")} $root/fixtures/*.toml(N:t:r))
  compadd -- \${(u)names}
}
_nnw_theme() {
  local -a commands
  commands=(
${described.join("\n")}
  )
  if (( CURRENT == 2 )); then
    _describe -t commands 'nnw-theme command' commands
    return
  fi
  local command=$words[2]
  shift words
  (( CURRENT-- ))
  case $command in
${cases.join("\n")}
  esac
}
if (( $+functions[compdef] )); then
  compdef _nnw_theme ${PROGRAM}
fi
`;
}

export const SCRIPTS = { fish, bash, zsh } as const;
