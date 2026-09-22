import { setupWebkit } from "../browser.ts";
import type { Args } from "../main.ts";

export default async function setup({ values }: Args): Promise<void> {
	await setupWebkit({ withDeps: values["with-deps"] === true });
}
