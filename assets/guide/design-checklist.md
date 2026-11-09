# Visual review checklist

Use this after the design direction is established; it is an inspection guide, not a
prescribed aesthetic.

- Read the pleasant article at ordinary size before judging edge cases.
- Check hierarchy, measure, paragraph rhythm, link recognition, and muted-text
  contrast in both light and dark appearance.
- Check long title/byline wrapping on macOS, iPhone, and iPad.
- Check lists, quotations, inline code, preformatted code, tables, captions, media,
  and footnotes in the kitchen-sink article and any fixtures the theme added. `check`
  verifies footnote popovers and marker consistency; judge how they look.
- Confirm wide media and long tokens do not create document-level horizontal scroll.
- Check large-text macOS and iPhone renders for clipping, overlap, and lost hierarchy.
  These exercise the real mechanisms: a macOS size class and an iOS Dynamic Type size.
- Check JavaScript-off macOS and iPhone renders for readable content and usable links.
- If the theme styles enclosures, check the `podcast` and `media-rss` fixtures: players,
  captions, and the article image leading a podcast episode, in light and dark. A
  theme with `primary_media` checks them above the body, and its older-NetNewsWire render.
- If the theme script handles footnotes or relies on classes or ids, give a fixture
  `deliveries = ["freshrss", "miniflux"]` and check the cases synced readers see.
- Check an untitled article, such as the `mastodon` fixture: the dateline stands in for
  the headline, and inline 16x16 custom emoji must stay inline beside the text.
- Inspect a real WebKit screenshot, not only the live gallery or Chromium fallback.
- Promote `screenshots/theme-preview.png` only when the 16:10 macOS article image is
  an intentional representation of the release.
