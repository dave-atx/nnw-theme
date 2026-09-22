// The parts of Python's urllib.parse.urlsplit the checks rely on, so a URL is judged
// remote, absolute, or local exactly as the Python tool judged it.

export interface SplitURL {
	scheme: string;
	netloc: string;
	hostname: string | null;
}

const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+.-]*$/;

export function urlsplit(input: string): SplitURL {
	let url = input.replace(/^[\0-\x20]+/, "").replace(/[\t\r\n]/g, "");
	let scheme = "";
	const colon = url.indexOf(":");
	if (colon > 0 && SCHEME_CHARS.test(url.slice(0, colon))) {
		scheme = url.slice(0, colon).toLowerCase();
		url = url.slice(colon + 1);
	}
	let netloc = "";
	if (url.startsWith("//")) {
		const rest = url.slice(2);
		const end = rest.search(/[/?#]/);
		netloc = end < 0 ? rest : rest.slice(0, end);
	}
	return { scheme, netloc, hostname: hostname(netloc) };
}

function hostname(netloc: string): string | null {
	const host = netloc.slice(netloc.lastIndexOf("@") + 1);
	let name: string;
	if (host.startsWith("[")) {
		const end = host.indexOf("]");
		name = end < 0 ? host.slice(1) : host.slice(1, end);
	} else {
		const colon = host.indexOf(":");
		name = colon < 0 ? host : host.slice(0, colon);
	}
	return name ? name.toLowerCase() : null;
}
