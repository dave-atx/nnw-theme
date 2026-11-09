// Enclosure checks, evaluated in each rendered page after its screenshot. Returns a
// list of failure messages. NetNewsWire writes each enclosure as
// div.nnw-enclosure > (img | video | audio | iframe), with an optional
// div.nnw-enclosure-caption, inside one div.nnw-enclosures: at [[enclosures]] in the
// template, or after the body when the template has no such macro. [[primary_media]]
// reuses those players, and adds div.nnw-primary-image > img with an optional
// div.nnw-primary-image-caption. A theme script may move any of them elsewhere, so
// each is found wherever it ended up.
() => {
	const failures = [];
	const fail = (message) => failures.push(message);
	const width = document.documentElement.clientWidth;
	const px = (value) => Math.round(value);
	const size = (value) => {
		const number = Number(value);
		return Number.isFinite(number) && number > 0 ? number : 0;
	};

	const enclosures = [...document.querySelectorAll(".nnw-enclosure, .nnw-primary-image")];
	enclosures.forEach((enclosure, index) => {
		const media = enclosure.querySelector(":scope > :is(img, video, audio, iframe)");
		if (!media) return;
		const kind =
			media.localName === "iframe"
				? "video player"
				: {
						img: "image",
						video: "video",
						audio: "audio player",
					}[media.localName];
		const label = `enclosure ${index + 1} (${kind})`;
		const box = media.getBoundingClientRect();
		if (
			!media.getClientRects().length ||
			box.width < 1 ||
			box.height < 1 ||
			getComputedStyle(media).visibility !== "visible"
		) {
			fail(`${label}: not shown`);
			return;
		}
		if (box.left < -1 || box.right > width + 1) {
			fail(`${label}: spans ${px(box.left)}–${px(box.right)}px, outside the ${width}px window`);
		}
		if (media.localName === "audio") {
			// Narrower than this, WebKit drops the scrubber and the player can't seek.
			const least = Math.min(240, width * 0.6);
			if (box.width < least) fail(`${label}: only ${px(box.width)}px wide`);
			return;
		}
		if (media.localName === "iframe") {
			// The player letterboxes its video in any box, so only a squashed or
			// towering frame is wrong; its width and height are the old Flash player's.
			const ratio = box.height / box.width;
			if (ratio < 0.45 || ratio > 1.05) {
				fail(`${label}: drawn ${px(box.width)}×${px(box.height)}, not a video's shape`);
			}
			return;
		}
		const [w, h] =
			media.localName === "img" && media.naturalWidth
				? [media.naturalWidth, media.naturalHeight]
				: [size(media.getAttribute("width")), size(media.getAttribute("height"))];
		if (!w || !h) return;
		const expected = (box.width * h) / w;
		if (Math.abs(box.height - expected) > Math.max(2, expected * 0.03)) {
			fail(
				`${label}: drawn ${px(box.width)}×${px(box.height)}, distorting its ${w}×${h} shape`,
			);
		}
	});

	// A caption must stand out from what it sits on, as footnote numerals must.
	const rgba = (value) => {
		const n = (value.match(/[\d.]+/g) || []).map(Number);
		return n.length ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : [0, 0, 0, 0];
	};
	const backdrop = (element) => {
		const layers = [];
		for (let node = element; node; node = node.parentElement) {
			const layer = rgba(getComputedStyle(node).backgroundColor);
			if (!layer[3]) continue;
			layers.push(layer);
			if (layer[3] === 1) break;
		}
		let base = layers.pop() || [255, 255, 255, 1];
		while (layers.length) {
			const top = layers.pop();
			base = [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3]));
		}
		return base.slice(0, 3);
	};
	const distance = (a, b) => [0, 1, 2].reduce((sum, i) => sum + Math.abs(a[i] - b[i]), 0);
	const captions = [...document.querySelectorAll(".nnw-enclosure-caption, .nnw-primary-image-caption")];
	for (const caption of captions) {
		if (!caption.getClientRects().length || !caption.innerText.trim()) continue;
		const name = JSON.stringify(caption.innerText.trim().slice(0, 40));
		const glyphs = [caption, ...caption.querySelectorAll("*")].filter((element) =>
			[...element.childNodes].some(
				(node) => node.nodeType === Node.TEXT_NODE && node.data.trim(),
			),
		);
		for (const glyph of glyphs) {
			const color = rgba(getComputedStyle(glyph).color);
			const ground = backdrop(glyph);
			if (color[3] < 0.5 || distance(color, ground) <= 60) {
				fail(`enclosure caption ${name}: text ${color.slice(0, 3)} is illegible on ${ground}`);
				break;
			}
		}
		const fontSize = Number.parseFloat(getComputedStyle(caption).fontSize);
		if (fontSize < 10) fail(`enclosure caption ${name}: ${fontSize}px text is too small`);
	}
	return failures;
}
