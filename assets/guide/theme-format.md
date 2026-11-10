# NetNewsWire theme format

Read this when changing theme structure, metadata, scripts, or resources.

The one root-level `<Name>.nnwtheme` directory is the release bundle. It contains
exactly `Info.plist`, `template.html`, `stylesheet.css`, and optional license or notice
files. NetNewsWire does not serve arbitrary bundle-local assets: do not add fonts,
images, media, or references to them. Small demonstrated assets may use data URLs.

`Info.plist` requires non-empty `ThemeIdentifier`, `Name`, `CreatorHomePage`, and
`CreatorName`, plus an integer `Version`. `Name` and the bundle stem match exactly,
including spaces and capitalization. `CreatorHomePage` is an absolute HTTP(S) URL.
The identifier and bundle name stay stable after the first release.

Two optional string keys fill in Finder's Get Info window, and NetNewsWire ignores
both. `CFBundleShortVersionString` is the Version row, and `NSHumanReadableCopyright`
is the Copyright row. Finder's window ignores `CFBundleGetInfoString`, which
`nnw-theme` 2.6.0 wrote; `bump` moves it to `CFBundleShortVersionString`. `init` writes both. `bump` keeps the
version current and adds a missing copyright from `CreatorName` and the current year.

NetNewsWire performs two single-pass substitutions. First, article values replace
macros in `template.html`; then that body and combined core/theme CSS enter a platform
page skeleton. Unknown macros remain literal, and substituted values are not scanned
again. Common template macros are visible in the starter markup and synthetic
fixtures.

Article text scales through a different mechanism on each platform, and a theme must
honor both. On macOS the app substitutes `text_size_class` in `template.html` with one
of `smallText`, `mediumText`, `largeText`, `xLargeText`, or `xxLargeText`, and the
theme's CSS supplies the sizes; an unset preference means `largeText`, not `mediumText`.
On iOS and iPadOS the app leaves `text_size_class` unsubstituted and replaces the
`font-size` macro in the stylesheet with the reader's Dynamic Type body size instead.
NetNewsWire emits the capital-L `xLargeText` and `xxLargeText` while its bundled themes
select the lowercase spellings, so define both.

Neither rule needs a platform query. A macOS render leaves the `font-size` macro
literal, exactly as the app does, so that declaration is invalid there and is dropped;
the size classes are inert on iOS, where the app never sets one. Do not reach for
`@supports (-webkit-touch-callout: none)` even though NetNewsWire's own stylesheet
uses it: no desktop WebKit implements that property, so every preview resolves the iOS
branch as false and platform-conditional CSS is checked the wrong way round. Do not
write macro names in double brackets inside comments either, because substitution
rewrites those too: a body containing `-->`, as every Reddit post does, closes the
comment early and shows the rest of it as text. `check` fails on them. NetNewsWire's stylesheet also sets `font: -apple-system-body` at
`:root`; a theme with its own typography should not, because that shorthand resets
`font-family` and `line-height`.

## Enclosures

NetNewsWire shows an article's enclosures (RSS `<enclosure>` and Media RSS items) as
players and images. A template places them with the `enclosures` macro; one without it
gets them appended after the body, inside the body container, and its body is then
wrapped in an extra `<div>` (so the enclosures escape any tag the body leaves open).
That wrapper changes the body's children: a theme whose selectors rely on
`.articleBody > …` should place the macro itself. NetNewsWire tests for the literal
macro text anywhere in `template.html`, comments included.

The markup is fixed and carries no inline styles:

```html
<div class="nnw-enclosures">
  <div class="nnw-enclosure nnw-enclosure-image"><img src="…" alt="" width="…" height="…"></div>
  <div class="nnw-enclosure nnw-enclosure-audio"><audio controls preload="none" src="…"></audio>
    <div class="nnw-enclosure-caption">Title · 1:54:09 · 54.9 MB</div></div>
  <div class="nnw-enclosure nnw-enclosure-video"><video controls preload="metadata" playsinline …></video></div>
  <div class="nnw-enclosure nnw-enclosure-video"><iframe src="https://www.youtube-nocookie.com/embed/…" …></iframe></div>
</div>
```

Images and video carry the feed's `width` and `height` when it gives both; a caption
appears only when there is text for it. The audio caption joins the title (else the
file name), duration, and size with ` · `. A YouTube channel enclosure becomes the
iframe player. Enclosures already in the body are skipped, including a resized
copy at another URL or the still of a YouTube video the body embeds, and documents are
never shown. A video uses the article's image, else its thumbnail, as its poster.

A template without `primary_media`, and a short untitled post, gets the article's image
as the first image enclosure unless the body already shows it, even beside other
enclosures or a video that uses it as its poster. The thumbnail is not shown there:
only `primary_media` uses it as an image.

NetNewsWire releases before enclosure support leave the macro as literal text in
every article, so a theme that places it should hide its container when it holds no
enclosures, for example `<div class="my-enclosures">[[enclosures]]</div>` with
`.my-enclosures:not(:has(.nnw-enclosures)) { display: none; }`. `check` renders the
article fixture that way too and fails if the text shows. With enclosures in a
fixture, `check` also fails an enclosure image, player, or video that is hidden,
leaves the window, or is drawn out of its shape, an audio player too narrow to seek,
and an illegible caption.

## Primary media

The `primary_media` macro places the article's main media, usually above the body: a
video with the article image as its poster, else audio with the article image above
it, else the article image. The image is the article's own, else the first image
enclosure, else the thumbnail. Media already in the body is left out, and whatever
appears here is left out of the enclosures. A short untitled post, such as a Mastodon
post, keeps its images in the enclosures, after the text. With nothing to show the
macro is empty.

```html
<div class="nnw-primary-media">
  <div class="nnw-primary-image"><img src="…" alt="…" title="…" width="…" height="…">
    <div class="nnw-primary-image-caption">The image's title</div></div>
  <div class="nnw-enclosure nnw-enclosure-audio">…</div>
</div>
```

The video and audio blocks are the enclosures' markup. The caption appears only when
the image has a title that differs from the article's. `core.css` adds margins and
`height: auto`. `check` applies the enclosure rules here too.

NetNewsWire before 7.3b6 leaves the macro as text, as with `enclosures`. Either hide its
container, `.my-media:not(:has(.nnw-primary-media)) { display: none; }`, or put the
macro only in `template7.3.html`: NetNewsWire 7.3 reads that file instead of
`template.html` when a theme ships one, and older releases ignore it, so `template.html`
can stay free of new macros at the cost of keeping two templates in step. `check`
renders `template7.3.html` when it exists, and its older-NetNewsWire cases render
`template.html` with both macros left as text.

## Pinned NetNewsWire

The renderer pins NetNewsWire 7.3b6 for Mac (`mac-7.3b6`, commit
`9a07d406177e896826e33952fb16c06e21c19000`), whose rendering files iOS 7.3 shares.
Enclosure support starts with 7.3b3, 7.3b4 keeps the footnote popover inside the
article column, and 7.3b6 adds `primary_media` and `template7.3.html`. It uses upstream `core.css`, macOS and
iOS page skeletons, and `main.js`, `main_mac.js`, `main_ios.js`, and `newsfoot.js`.
These files ship inside the `nnw-theme` package, verified by SHA-256, so previews work
offline. iPhone and iPad share the iOS skeleton. WebKit native
color-scheme emulation controls light/dark captures; CSS is not rewritten.

## Scripts and resources

Inline scripts in `template.html` are supported. External scripts and stylesheets are
rejected. Remote theme-owned fonts, images, audio, or video require an explicit local
warning override and are still blocked during checks. The article must remain useful
when Article JavaScript is off; those smoke renders remove theme inline scripts while
retaining NetNewsWire’s injected scripts.
