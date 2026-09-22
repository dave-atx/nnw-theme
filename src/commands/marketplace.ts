import { spawnSync } from "node:child_process";

/** Add the marketplace discovery topic with gh; warn rather than fail. */
export function marketplaceEnable(): boolean {
	const result = spawnSync("gh", ["repo", "edit", "--add-topic", "netnewswire-theme"], {
		encoding: "utf8",
	});
	if (result.error) {
		console.error(
			"Warning: GitHub CLI is not installed. Run `npx nnw-theme@1 marketplace enable` " +
				"after installing and authenticating gh.",
		);
		return false;
	}
	if (result.status) {
		console.error(
			"Warning: could not add the marketplace topic. " +
				`Run \`npx nnw-theme@1 marketplace enable\` later.\n${(result.stderr || result.stdout).trim()}`,
		);
		return false;
	}
	console.log("Added the netnewswire-theme GitHub topic.");
	return true;
}

export default function marketplace(): void {
	marketplaceEnable();
}
