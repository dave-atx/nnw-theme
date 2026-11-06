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
fixture in every `check`, twenty-eight for all seven. Their structure, classes, and attributes
come from real feeds; their text is synthetic and their links point at `example.org`.
The copy never changes on its own when `nnw-theme` updates. A header comment records
its catalog version, and `fixture list` says when a newer one is available; take it
with `fixture add NAME --force`, which replaces any edits to the file.

NetNewsWire turns Substack footnotes into popovers on its own. Most WordPress
footnotes stay plain links until a theme script turns them into `a.footnote` markers.

## Enclosures

An article's enclosures are data, not markup: NetNewsWire renders them into the
`enclosures` macro, or after the body, from the article's attachments. A fixture lists
them after its other keys, in feed order, and may give the article's image:

```toml
image_url = "https://example.org/episode-art.jpg"  # else thumbnail_url

[[attachments]]
url = "https://example.org/episode-311.mp3"        # required
mime_type = "audio/mpeg"
title = "311: The Long One"
size_in_bytes = 54919661
duration_in_seconds = 6849
width = 1920                                        # images and video
height = 1080
medium = "audio"            # image, audio, video, document, or executable
```

`nnw-theme` renders them as the pinned NetNewsWire does; the `theme-format` guide
describes the markup. `fixture add podcast media-rss` adds fixtures that exercise
every kind. Previews stay offline: images and posters become same-size placeholders,
players lose their network source, a video with nothing to show gets a placeholder
poster at its size, and the YouTube player becomes a placeholder frame. A `media/NAME`
URL plays or shows the file from `fixtures/media/`, including audio and video for a
screenshot; keep such files tiny, since every page that renders the fixture embeds them.

## Sync services

Readers who sync through a service see an article as that service hands it to
NetNewsWire, not as the publisher wrote it. A fixture can be rendered that way too:

```toml
deliveries = ["freshrss", "miniflux"]   # also render as each service delivers it
base_url = "https://example.org/"       # the page's base URL in every case
```

Each delivery adds two cases, Mac light and iPhone dark, with the body rewritten by
that service's sanitizer and the feed's home page (`feed_link`, or `base_url` when
given) as the page's base URL. That base is what NetNewsWire uses for every article synced through the Reader
API, since those carry only an external link. FreshRSS renames every `id` and `class` to
`data-sanitized-id` and `data-sanitized-class` and makes every link absolute,
fragments included; NetNewsWire 7.3 restores the names for FreshRSS accounts, but
earlier releases do not, and the delivery shows the content as they do. Miniflux strips
`class`, keeps `id` only on links, headings, list items, and `sup`, unwraps wrappers
such as `div.footnotes`, and marks external links `target="_blank"`. `base_url`
replaces the base in every case, delivered or not: give it the site URL the service
reports when that differs from the post URLs, or use it alone to reproduce a page whose
base differs from its links without rewriting the body.

## Your own articles

Prefer real articles for content a theme must handle. `npx nnw-theme@2 capture`
prints the steps for saving the selected article from a NetNewsWire debug build with
the `nnwdump` lldb command; it needs Xcode and a NetNewsWire clone, so the person
usually runs it. It records the article's attachments and image as the keys above,
not NetNewsWire's rendered enclosures, so any template previews them, and records
`base_url` when the page's base differs from the article's link, as it does for an
article synced through the Reader API. Rendering swaps every image that would load over the network for a
same-size placeholder and a network feed icon for a generated one; do not inline or
fetch the originals.

To show a real image, as a marketplace screenshot needs, commit it under
`fixtures/media/` and reference it by that relative path:
`<img src="media/sunset.jpg" width="1600" height="900">`. Rendering inlines it, so
previews stay offline; a missing file shows as a placeholder. Use only images the theme may redistribute, and keep them small:
each is copied into every page that renders the fixture.

Footnote markers are the links NetNewsWire's `newsfoot.js` handles: `a.footnote`.
Its `main.js` adds that class to local `sup > a[href*='#fn']` links and to Substack's
`a[id^='footnote-anchor-']` links; a theme script may add it to other formats. `check` requires every visible marker to resolve to a
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
