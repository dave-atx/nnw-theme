// Footnote checks, evaluated in each rendered page after its screenshot. Returns
// {failures, warnings}, each a list of messages. NetNewsWire's newsfoot.js opens a popover for any
// a.footnote whose hash names an element; main.js adds that class to local
// sup > a[href*='#fn'] links and Substack's a[id^='footnote-anchor-'] links, and a
// theme script may add it to other formats.
//
// expect is the fixture's [expect.footnotes] table: notes maps each marker's text to
// its note text, plain_links lists selectors for links that are not footnotes, and
// keep_with_word requires a marker written against its word to stay on its line.
// all_converted makes an unconverted marker a failure rather than a warning.
async ({notes = null, plain_links = [], keep_with_word = false, all_converted = false} = {}) => {
	const failures = [];
	const warnings = [];
	const fail = message => failures.push(message);
	const article = document.querySelector(".articleBody");
	if (!article) return {failures, warnings};
	const text = element => element.textContent.replace(/\s+/g, " ").trim();
	const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

	// Markers the reader can see; a theme may hide the source's originals.
	const markers = [...article.querySelectorAll("a.footnote")]
		.filter(marker => marker.getClientRects().length);
	const label = marker => text(marker) || marker.getAttribute("href");
	const fragment = link => {
		try {
			return link.hash ? decodeURIComponent(link.hash.slice(1)) : "";
		} catch {
			return "";
		}
	};

	// A reference in a shape main.js or a theme converts, linking to an element in the
	// article, that never became a marker: NetNewsWire opens it as a link. It happens
	// when the page's base URL doesn't match the link, as for an article synced through
	// the Reader API, or when a sync service rewrote the markup a theme script expects.
	const plain = new Set();
	for (const selector of plain_links) {
		try {
			for (const link of document.querySelectorAll(selector)) plain.add(link);
		} catch {
			// Reported below.
		}
	}
	const references = article.querySelectorAll(
		"sup > a[href], sup > div > a[href], a[id^='footnote-anchor-'][href]");
	for (const link of references) {
		if (link.matches(".footnote") || plain.has(link) || !link.getClientRects().length) continue;
		const id = fragment(link);
		const target = id && document.getElementById(id);
		if (!target || !article.contains(target) || target.contains(link)) continue;
		const message = `footnote ${label(link)}: ${link.getAttribute("href")} links to a note ` +
			"but never became an a.footnote marker, so NetNewsWire opens it as a link";
		(all_converted ? failures : warnings).push(message);
	}

	// Every marker resolves, as newsfoot does, to one non-empty note.
	const noteFor = new Map();
	for (const marker of markers) {
		const id = fragment(marker);
		const target = id && document.getElementById(id);
		if (!target) {
			fail(`footnote ${label(marker)}: ${marker.getAttribute("href")} names no note`);
			continue;
		}
		if (document.querySelectorAll(`[id="${CSS.escape(id)}"]`).length > 1) {
			fail(`footnote ${label(marker)}: more than one element has id ${id}`);
		}
		// newsfoot shows a Substack note from the elements after its backlink
		// <a id="footnote-N">N</a>, and any other note from the target itself.
		let note = text(target);
		if (marker.matches("a[id^='footnote-anchor-']")) {
			let content = "";
			for (let node = target.nextElementSibling; node && !node.matches("a[id^='footnote-']");
				node = node.nextElementSibling) content += node.textContent;
			note = content.replace(/\s+/g, " ").trim();
		}
		if (note) noteFor.set(marker, note);
		else fail(`footnote ${label(marker)}: note is empty`);
	}

	if (notes) {
		const byLabel = new Map(markers.map(marker => [text(marker), marker]));
		for (const [expected, note] of Object.entries(notes)) {
			const marker = byLabel.get(expected);
			if (!marker) fail(`footnote ${expected}: no marker with this text`);
			else if (noteFor.has(marker) && noteFor.get(marker) !== note) {
				fail(`footnote ${expected}: note reads ${JSON.stringify(noteFor.get(marker))}, ` +
					`expected ${JSON.stringify(note)}`);
			}
		}
		for (const found of byLabel.keys()) {
			if (!Object.hasOwn(notes, found)) fail(`unexpected footnote marker ${JSON.stringify(found)}`);
		}
	}

	for (const selector of plain_links) {
		let links = [];
		try {
			links = [...document.querySelectorAll(selector)];
		} catch {
			fail(`plain link ${selector}: invalid selector`);
			continue;
		}
		if (!links.length) fail(`plain link ${selector}: not found`);
		if (links.some(link => link.matches(".footnote"))) {
			fail(`plain link ${selector}: treated as a footnote`);
		}
	}

	// The numeral must stand out from what it sits on. A marker's fill may be a
	// tint, so flatten the backgrounds under it before comparing.
	const rgba = value => {
		const n = (value.match(/[\d.]+/g) || []).map(Number);
		return n.length ? [n[0], n[1], n[2], n.length > 3 ? n[3] : 1] : [0, 0, 0, 0];
	};
	const backdrop = element => {
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
			base = [0, 1, 2].map(i => top[i] * top[3] + base[i] * (1 - top[3]));
		}
		return base.slice(0, 3);
	};
	const distance = (a, b) => [0, 1, 2].reduce((sum, i) => sum + Math.abs(a[i] - b[i]), 0);
	for (const marker of markers) {
		// The deepest element carrying the numeral is what actually gets painted.
		const glyph = [...marker.querySelectorAll("*")].filter(e => text(e)).pop() || marker;
		const color = rgba(getComputedStyle(glyph).color);
		const ground = backdrop(marker);
		if (distance(color, ground) <= 60) {
			fail(`footnote ${label(marker)}: numeral ${color.slice(0, 3)} is illegible on ${ground}`);
		}
		const box = marker.getBoundingClientRect();
		const inner = glyph.getBoundingClientRect();
		if (inner.top < box.top - 1 || inner.bottom > box.bottom + 1) {
			fail(`footnote ${label(marker)}: numeral spills out of its marker`);
		}
	}

	// A marker written against its word, with no space between, stays on that
	// word's line: a line that starts with a marker has lost what it annotates.
	// Opt-in: core.css makes a.footnote inline-block, so a line may break before any
	// marker, and only a theme script can hold the pair together.
	for (const marker of keep_with_word ? markers : []) {
		let box = marker;
		while (box.parentElement && box.parentElement !== article &&
			box.parentElement.childNodes.length === 1) box = box.parentElement;
		// Empty elements, such as an anchor landmark for return links, don't count.
		let before = box.previousSibling;
		while (before && !before.textContent) before = before.previousSibling;
		if (before?.nodeType !== Node.TEXT_NODE || !before.data || /\s$/.test(before.data)) continue;
		const range = document.createRange();
		range.setStart(before, before.data.length - 1);
		range.setEnd(before, before.data.length);
		if (marker.getBoundingClientRect().top >= range.getBoundingClientRect().bottom - 1) {
			fail(`footnote ${label(marker)}: wraps onto a new line, apart from its word`);
		}
	}

	// Every marker presents alike, whatever markup the source used. Seat is measured
	// against a probe on the marker's own line, so it holds across lines. The probe
	// is a zero-width word joiner: it always fits, so it never wraps to the next line
	// or pushes an unbreakable group there, and the marker is measured beside it.
	const geometry = markers.map(marker => {
		const probe = document.createElement("span");
		probe.textContent = "\u2060";
		marker.after(probe);
		const box = marker.getBoundingClientRect();
		const seat = box.bottom - probe.getBoundingClientRect().bottom;
		probe.remove();
		return {marker, height: box.height, seat, size: parseFloat(getComputedStyle(marker).fontSize)};
	});
	const [first] = geometry;
	for (const g of geometry.slice(1)) {
		const name = `footnote ${label(g.marker)}`;
		const reference = label(first.marker);
		if (Math.abs(g.height - first.height) >= 0.5) {
			fail(`${name}: ${g.height}px tall, footnote ${reference} is ${first.height}px`);
		}
		if (Math.abs(g.seat - first.seat) >= 0.5) {
			fail(`${name}: sits ${g.seat}px from its baseline, footnote ${reference} ${first.seat}px`);
		}
		if (Math.abs(g.size - first.size) >= 0.1) {
			fail(`${name}: font-size ${g.size}px, footnote ${reference} is ${first.size}px`);
		}
	}

	// End to end: a click opens newsfoot's popover with the note, and moving the
	// marker into newsfoot's container does not restyle it.
	for (const marker of markers) {
		const note = noteFor.get(marker);
		if (note === undefined) continue;
		const resting = marker.getBoundingClientRect();
		marker.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
		await pause(60);
		const opened = marker.getBoundingClientRect();
		if (Math.abs(resting.width - opened.width) >= 0.5 ||
			Math.abs(resting.height - opened.height) >= 0.5) {
			fail(`footnote ${label(marker)}: ${resting.width}x${resting.height} marker became ` +
				`${opened.width}x${opened.height} when opened`);
		}
		const popover = document.querySelector(".newsfoot-footnote-popover");
		const shown = popover ? text(popover) : null;
		if (shown !== note) fail(`footnote ${label(marker)}: popover showed ${JSON.stringify(shown)}`);
		document.body.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true, view: window}));
		await pause(30);
	}
	return {failures, warnings};
}
