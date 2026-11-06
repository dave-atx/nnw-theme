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
iframe player. Enclosures whose URL already appears in the body are skipped, and
documents are never shown. When nothing visual remains, neither an enclosure nor an
image or video in the body, the article's image (or thumbnail) leads the list as an
image enclosure: a podcast episode's artwork above its player. A video uses that image
as its poster.

NetNewsWire releases before enclosure support leave the macro as literal text in
every article, so a theme that places it should hide its container when it holds no
enclosures, for example `<div class="my-enclosures">[[enclosures]]</div>` with
`.my-enclosures:not(:has(.nnw-enclosures)) { display: none; }`. `check` renders the
article fixture that way too and fails if the text shows. With enclosures in a
fixture, `check` also fails an enclosure image, player, or video that is hidden,
leaves the window, or is drawn out of its shape, an audio player too narrow to seek,
and an illegible caption.

## Pinned NetNewsWire

The renderer pins NetNewsWire 7.3b3 for Mac (`mac-7.3b3`, commit
`be5cd9e92f400d453672e45087c06761a9ac3c00`), the first release with enclosure support,
which iOS 7.3 shares. It uses upstream `core.css`, macOS and
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
