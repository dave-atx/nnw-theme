import { readFileSync } from "node:fs";
import { GUIDE_TOPICS } from "../commands.ts";
import type { Args } from "../main.ts";
import { packagePath } from "../project.ts";

export function guideText(topic: string = GUIDE_TOPICS[0]): string {
	return readFileSync(packagePath("assets", "guide", `${topic}.md`), "utf8");
}

export default function guide({ positionals }: Args): void {
	process.stdout.write(guideText(positionals[0]));
}
