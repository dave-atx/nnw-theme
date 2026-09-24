import { ThemeError } from "../project.ts";

export default function update(): void {
	throw new ThemeError(
		"update was removed: the tooling now runs from npm with `npx nnw-theme@2`, so " +
			"fixes arrive without changing this repository. Delete src/, tests/, " +
			"pyproject.toml, uv.lock, and .python-version, and replace the stubs `check` " +
			"warns about.",
	);
}
