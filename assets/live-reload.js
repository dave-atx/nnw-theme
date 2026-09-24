// Live reload for `nnw-theme preview`. The preview server injects this into the
// gallery and the full-size views only; rendered theme pages stay exactly as NNW
// would show them. Each build event carries the build number and, when the latest
// rebuild failed, its error.
(() => {
	const events = new EventSource("/__live");
	const style = document.createElement("style");
	// Scroll anchoring keeps the case in view steady while the error banner comes and
	// goes. The banner itself can't be the anchor, and neither can the scaled thumbnail
	// frames: WebKit anchors on them but then doesn't adjust.
	style.textContent = `#nnw-live-error, .thumb iframe { overflow-anchor: none; }
#nnw-live-error { background: #cf222e; color: #fff; font: .9rem/1.4 system-ui;
  margin: 0 0 1rem; padding: .6rem .9rem; position: sticky; top: 0;
  white-space: pre-wrap; z-index: 1; }
body:not(:has(.case)) #nnw-live-error { left: 0; margin: 0; position: fixed; right: 0; }`;
	document.head.append(style);

	let build;
	events.addEventListener("build", (event) => {
		const state = JSON.parse(event.data);
		showError(state.error);
		if (build !== undefined && state.build !== build) refresh();
		build = state.build;
	});

	function showError(message) {
		let banner = document.getElementById("nnw-live-error");
		if (!message) return banner?.remove();
		if (!banner) {
			banner = document.createElement("div");
			banner.id = "nnw-live-error";
			banner.setAttribute("role", "alert");
			document.body.prepend(banner);
		}
		banner.textContent = `Rebuild failed; showing the last good build.\n${message}`;
	}

	// Setting src, even to its current value, navigates the frame again.
	const reload = (frames) => {
		for (const frame of frames) frame.setAttribute("src", frame.getAttribute("src"));
	};

	async function refresh() {
		const cases = (root) => [...root.querySelectorAll(".case")].map((c) => c.id).join();
		if (!document.querySelector(".case")) {
			// A full-size view: reload its page in place.
			reload(document.querySelectorAll("iframe"));
			return;
		}
		// Refresh the thumbnails in place when the cases are unchanged, so nothing
		// moves; a fixture added or removed changes the gallery, so reload it.
		try {
			const response = await fetch(location.pathname, { cache: "no-store" });
			const next = new DOMParser().parseFromString(await response.text(), "text/html");
			if (response.ok && cases(next) === cases(document)) {
				reload(document.querySelectorAll(".case iframe"));
				return;
			}
		} catch {}
		location.reload();
	}
})();
