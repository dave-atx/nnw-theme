# Update a theme for NetNewsWire 7.3

Follow these steps in order, in the theme's repository. They suit an agent working on
the person's behalf as well as someone working by hand.

NetNewsWire 7.3 shows an article's audio, video, and attached images through two
macros: `primary_media`, usually above the body, and `enclosures`, after it. A theme
that places neither still works, but NetNewsWire appends the media after the body and
wraps the body in an extra `<div>`, which can break selectors such as
`.articleBody > p`, and it never shows the article's main media above the text.

Don't change the bundle name or `ThemeIdentifier`.

## 1. Start from a passing check

Run `npx nnw-theme@2 check --no-open`. If it reports that WebKit is missing, run
`npx nnw-theme@2 setup`. Fix any validation error or failure first, so that what fails
later comes from this update. Warnings about a missing `AGENTS.md`, skill, or workflow
stub don't block anything here.

## 2. Place the macros

Choose by what the theme has now:

- **It has a `template7.3.html`.** Add whichever macro is missing to that file.
- **Its `template.html` already places `enclosures` in a container that hides when
  empty.** Add `primary_media` the same way, above the body, and keep one template:

  ```html
  <div class="my-media">[[primary_media]]</div>
  ```

  ```css
  .my-media:not(:has(.nnw-primary-media, .nnw-enclosures)) { display: none; }
  ```

  Older releases leave the macro as text, so the rule above is required.
- **Anything else, which is most themes.** Copy `template.html` to `template7.3.html`
  in the bundle and leave `template.html` alone. NetNewsWire 7.3 reads the new file
  instead, and older releases ignore it. Add the macros around the body:

  ```html
  <div class="my-media [[text_size_class]]">[[primary_media]]</div>
  <div class="articleBody [[text_size_class]]">
    [[body]]
  </div>
  <div class="my-media [[text_size_class]]">[[enclosures]]</div>
  ```

  Match the markup the theme uses for its own body. Repeat the `text_size_class`
  macro on the wrappers only if the theme uses it, so captions follow the reader's
  text size on the Mac. From now on, make template changes in both files.

Keep margin and padding off the wrappers, because `primary_media` is empty in most
articles. If the template's header comment lists macros, add these two without double
brackets: NetNewsWire substitutes macros inside comments, and `check` rejects it.

## 3. Style the media

Add fixtures that have media, then render them:

```sh
npx nnw-theme@2 fixture add podcast media-rss
npx nnw-theme@2 render podcast media-rss
```

Look at `build/preview/` in light and dark on the Mac and iPhone. Most themes need
little more than this, using the theme's own colors and fonts:

```css
img, video, audio, iframe { max-width: 100%; }
img, video { height: auto; }
audio { width: 100%; }

.nnw-enclosure-caption,
.nnw-primary-image-caption {
  color: var(--muted); /* the theme's secondary text color */
  font-size: 0.82em;
}
```

The `theme-format` topic's Enclosures and Primary media sections have the full markup
and its classes. The built-in `article` and `kitchen-sink` fixtures have no media, so
keep the two new fixtures: they're how `check` tests it from now on.

A theme with a monochrome look can also show the feed icon in grayscale, the way
NetNewsWire's bundled Gray theme does, by adding `<key>grayscaleIcon</key><true/>` to
`Info.plist`. Ask the person first; it's a design choice, and the template stays the
same. The `theme-format` topic has the details.

## 4. Check it

Run `npx nnw-theme@2 check --no-open` and fix what it reports until it passes. It fails
media that's hidden, out of shape, or wider than the window, an audio player too narrow
to seek, an illegible caption, and macro text showing in the render for older releases.
Give the person the preview path it prints.

## 5. Release when the person asks

Publishing is the person's decision, so confirm first. Then increase the versions:

- If the plist has no `CFBundleShortVersionString` or `CFBundleGetInfoString`, run
  `npx nnw-theme@2 bump --get-info-version 1.0.0`, using the theme's own version if it
  has one. Finder's Get Info then shows that version.
- Otherwise run `npx nnw-theme@2 bump`.

Either one also adds a missing copyright. The `publishing` topic covers the rest.
