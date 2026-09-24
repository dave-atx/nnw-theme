# Create NetNewsWire themes

This guide is for people and agents building a theme with `nnw-theme`. Run the tool
as `npx nnw-theme@2 <command>`; never install it globally or add it to the theme
repository. Read another topic with `npx nnw-theme@2 guide <topic>`: `theme-format`,
`fixtures`, `design-checklist`, or `publishing`.

The upstream `dave-atx/netnewswire-theme-template` repository is a GitHub template.
Work in the person's own repository made via **Use this template**, not in the
upstream template or a fork. If they already have their own copy open, use it.
Otherwise, help them create one from the template if you can, or ask them to create
and open it; confirm before creating a GitHub repository. Then work on its single
root-level `*.nnwtheme` bundle. If `.nnw-theme-uninitialized` exists, run the guided
`npx nnw-theme@2 init` before design work; let the person approve the permanent
identifier even when other identity details are already known.

Collect or infer a compact design brief: mood, typography, color direction, and any
specific reading needs. Prefer changing the CSS variables and rules in
`stylesheet.css`. Edit `template.html` only when the requested structure or behavior
needs it. For format constraints and macro behavior, read the `theme-format` topic.
To preview content the built-in articles lack, such as a real feed's markup or
footnotes, add a fixture as the `fixtures` topic describes.

Iterate with this loop:

1. Make a focused theme edit.
2. Run `npx nnw-theme@2 render` for fast generated pages or
   `npx nnw-theme@2 screenshot` when a checked image is needed.
3. Inspect relevant light/dark and device previews under `build/preview/`.
4. Explain what changed in visual terms and incorporate the person’s reaction.

Use the `design-checklist` topic during final visual review. Always finish
implementation with `npx nnw-theme@2 check`; do not substitute a Chromium result for
the required WebKit gate. Give the person a concrete preview or screenshot path they
can open. If `check` reports that WebKit is missing, run `npx nnw-theme@2 setup`.

Treat the root bundle filename and `ThemeIdentifier` as permanent after the first
release. Increase the integer `Version` with `npx nnw-theme@2 bump` for each release.
Read the `publishing` topic for publishing work. Local packaging is not publication.
Obtain clear user confirmation immediately before triggering a GitHub release or
another external mutation.

If the tooling misbehaves, do not work around it in the theme repository: report it at
https://github.com/dave-atx/nnw-theme/issues with the version line `check` prints.
