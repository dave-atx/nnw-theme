import { join } from "node:path";
import { findRoot, packagePath } from "../project.ts";

export default function capture(): void {
	const script = packagePath("lldb", "nnwdump.py");
	const output = join(findRoot(), "fixtures", "my-article.toml");
	console.log(`Capture a real article as a fixture from a NetNewsWire debug build (needs Xcode).

1. Clone https://github.com/Ranchero-Software/NetNewsWire and open it in Xcode.
   In Shared/Article Rendering/ArticleRenderer.swift, set a breakpoint on the
   \`return d\` line at the end of articleSubstitutions(), then run the app.
2. Select the article to capture. When the breakpoint stops, load the command
   in the debugger console (once per debug session):

   command script import ${script}

3. Write the fixture, then let the app continue:

   nnwdump ${output}
   continue

4. Preview it with \`npx nnw-theme@1 render my-article\`.

nnwdump embeds the feed's real icon; pass --no-icon to keep the generated one.
The debugger's working directory is /, so give nnwdump an absolute path.
The script lives in the npx cache; rerun capture if that path stops working.`);
}
