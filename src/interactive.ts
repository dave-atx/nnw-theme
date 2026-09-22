import { spawn } from "node:child_process";
import { ThemeError } from "./project.ts";

/** Prompts appear only when stdin and stdout are both terminals. */
export function interactive(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function cancelled(error: unknown): never {
	if ((error as Error)?.name === "ExitPromptError") throw new ThemeError("cancelled");
	throw error;
}

export async function promptText(message: string, fallback: string): Promise<string> {
	const { input } = await import("@inquirer/prompts");
	const answer = await input({ message, default: fallback }).catch(cancelled);
	return answer.trim();
}

export async function promptConfirm(message: string, fallback = true): Promise<boolean> {
	const { confirm } = await import("@inquirer/prompts");
	return await confirm({ message, default: fallback }).catch(cancelled);
}

/** Open a file path or URL in the default browser; failures are ignored. */
export function openInBrowser(target: string): void {
	const command = process.platform === "darwin" ? "open" : "xdg-open";
	try {
		const child = spawn(command, [target], { detached: true, stdio: "ignore" });
		child.on("error", () => {});
		child.unref();
	} catch {
		// No browser to open; the path was printed.
	}
}
