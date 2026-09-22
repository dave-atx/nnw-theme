import { SCRIPTS } from "../completion.ts";
import type { Args } from "../main.ts";
import { ThemeError } from "../project.ts";

export default function completion({ positionals }: Args): void {
	const shell = positionals[0] as keyof typeof SCRIPTS | undefined;
	if (!shell) throw new ThemeError("name a shell: fish, zsh, or bash");
	process.stdout.write(SCRIPTS[shell]());
}
