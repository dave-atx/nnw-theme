# Fixtures

Read this when adding, capturing, or changing the articles previews render.

Each `fixtures/*.toml` is one article: keys are the template macros, and any omitted
key renders empty. `article` and `kitchen-sink` are built into `nnw-theme` and get the
full matrix plus the large-text and Article-JavaScript-off cases; a repository's own
`fixtures/article.toml` or `fixtures/kitchen-sink.toml` replaces the built-in one. Every other fixture is
checked on macOS and iPhone in light and dark. Names used by check scenarios
(`large-text`, `article-javascript-off`) are reserved. Use `'''literal'''` strings for
HTML bodies so they need no escaping.

## Platform fixtures

Much of a theme's hardest content comes from the software that published the article:
Ghost cards, WordPress captions with inline pixel widths, Substack's image and footnote
wrappers. `nnw-theme` ships ready-made fixtures modeled on that markup:

```sh
npx nnw-theme@2 fixture list                     # names, summaries, and which you have
npx nnw-theme@2 fixture add ghost substack       # copy into fixtures/ghost.toml, ...
npx nnw-theme@2 fixture add wordpress --force    # replace a copy with the current one
```

Each is copied into `fixtures/` and is from then on an ordinary fixture of the
repository, checked on macOS and iPhone in light and dark: four more renders per
fixture in every `check`, sixteen for all four. Their structure, classes, and attributes
come from real feeds; their text is synthetic and their links point at `example.org`.
The copy never changes on its own when `nnw-theme` updates. A header comment records
its catalog version, and `fixture list` says when a newer one is available; take it
with `fixture add NAME --force`, which replaces any edits to the file.

Only NetNewsWire's own footnote format becomes a popover without a theme script, so
the Substack and most WordPress footnotes stay plain links until a theme script turns
them into `a.footnote` markers.

## Your own articles

Prefer real articles for content a theme must handle. `npx nnw-theme@2 capture`
prints the steps for saving the selected article from a NetNewsWire debug build with
the `nnwdump` lldb command; it needs Xcode and a NetNewsWire clone, so the person
usually runs it. Rendering swaps every image that would load over the network for a
same-size placeholder and a network feed icon for a generated one; do not inline or
fetch the originals.

Footnote markers are the links NetNewsWire's `newsfoot.js` handles: `a.footnote`.
Its `main.js` adds that class to local `sup > a[href*='#fn']` links; a theme script
may add it to other formats. `check` requires every visible marker to resolve to a
non-empty note with a unique id, stay legible on its background, match the other
markers' height, font size, and baseline offset, and open a popover with its note
without resizing. A fixture may declare exact expectations after its other keys:

```toml
[expect.footnotes]
plain_links = ["#ordinary-sup-link"]   # CSS selectors that must not become markers
keep_with_word = true                  # markers must not wrap apart from their word

[expect.footnotes.notes]
"1" = "First note."                    # marker text as rendered = note text
```

With `notes`, every listed marker must exist and any other marker fails. With
`keep_with_word`, a marker written against its word, with no space, must not wrap
onto a new line apart from it. NetNewsWire's `core.css` makes `a.footnote`
`inline-block`, which allows that break, and CSS alone cannot remove it: a theme
script must hold the pair together, for example in a `white-space: nowrap` span.
Expectations describe the theme's own scripts, so they are skipped with Article
JavaScript off.
