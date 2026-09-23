// WebKit checks through the Playwright library: one browser per run, a fresh context
// per case. Theme and fixture HTML/JavaScript are untrusted: pages are served from
// 127.0.0.1 only, every other request is blocked and fails the case, and the only
// outputs are screenshots and results.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { extname, join, normalize, sep } from "node:path";
import type { Browser } from "playwright-core";
import { type FootnoteExpectations, packagePath, ThemeError } from "./project.ts";
import { pyReprList } from "./pyformat.ts";
import type { RenderTarget } from "./render.ts";

const FOOTNOTE_CHECK = readFileSync(packagePath("assets", "footnotes.js"), "utf8");
const NOT_INSTALLED = "WebKit is not installed; run `npx nnw-theme@1 setup`";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".png": "image/png",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".svg": "image/svg+xml",
	".json": "application/json",
	".txt": "text/plain; charset=utf-8",
};

export interface Served {
	url: string;
	close(): Promise<void>;
}

/** Serve a directory on 127.0.0.1 at a free port. */
export async function serve(directory: string, port = 0): Promise<Served> {
	const root = normalize(directory);
	const server: Server = createServer((request, response) => {
		let path: string;
		try {
			path = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
		} catch {
			response.writeHead(400).end();
			return;
		}
		if (path.endsWith("/")) path += "index.html";
		const file = normalize(join(root, path));
		if (
			!file.startsWith(root + sep) ||
			(request.method !== "GET" && request.method !== "HEAD")
		) {
			response.writeHead(404).end();
			return;
		}
		let content: Buffer;
		try {
			content = readFileSync(file);
		} catch {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			"Content-Type": CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
			"Content-Length": content.length,
			"Cache-Control": "no-store",
		});
		response.end(request.method === "HEAD" ? undefined : content);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("server has no port");
	return {
		url: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

async function playwright() {
	return await import("playwright-core");
}

/** Whether this version's WebKit build is installed. */
export async function webkitInstalled(): Promise<boolean> {
	const { webkit } = await playwright();
	return existsSync(webkit.executablePath());
}

async function launch(): Promise<Browser> {
	const { webkit } = await playwright();
	if (!existsSync(webkit.executablePath())) throw new ThemeError(NOT_INSTALLED);
	try {
		return await webkit.launch();
	} catch (error) {
		const message = (error as Error).message;
		if (/Executable doesn't exist|install/i.test(message) && !/dependencies/i.test(message)) {
			throw new ThemeError(NOT_INSTALLED);
		}
		throw new ThemeError(`could not start WebKit: ${message.split("\n")[0]}`);
	}
}

/** Install this version's WebKit build (and, withDeps, its Linux system libraries). */
export async function setupWebkit({ withDeps = false } = {}): Promise<void> {
	if (!withDeps && (await webkitInstalled())) {
		try {
			await (await launch()).close();
			console.log("WebKit is already installed.");
			return;
		} catch {
			// Installed but not runnable: reinstall below.
		}
	}
	console.log(
		withDeps
			? "Installing WebKit and its Linux runtime dependencies…"
			: "Installing the WebKit browser used by theme checks…",
	);
	const cli = join(createRequire(import.meta.url).resolve("playwright-core"), "..", "cli.js");
	const args = [cli, "install", ...(withDeps ? ["--with-deps"] : []), "webkit"];
	const status = await new Promise<number | null>((resolve, reject) => {
		const child = spawn(process.execPath, args, { stdio: "inherit" });
		child.once("error", reject);
		child.once("exit", resolve);
	});
	if (status !== 0) throw new ThemeError("WebKit installation failed; see the output above");
}

export interface PageState {
	article: boolean;
	textLength: number;
	unresolved: boolean;
	overflow: boolean;
	brokenImages: string[];
	collapsedImages: string[];
	footnotes: string[];
	blocked: string[];
	pageErrors: string[];
}

export function failures(state: PageState): string[] {
	const found: string[] = [];
	if (!state.article || state.textLength < 40)
		found.push("article content is missing or unreadable");
	if (state.unresolved) found.push("unresolved theme macro");
	if (state.overflow) found.push("horizontal document overflow");
	if (state.brokenImages.length) found.push(`broken images: ${pyReprList(state.brokenImages)}`);
	if (state.collapsedImages.length)
		found.push(`images drawn at zero size: ${pyReprList(state.collapsedImages)}`);
	found.push(...(state.footnotes ?? []));
	if (state.blocked.length) found.push(`external requests: ${pyReprList(state.blocked)}`);
	if (state.pageErrors.length) found.push(`page errors: ${pyReprList(state.pageErrors)}`);
	return found;
}

// Runs in the page after its screenshot.
function pageState() {
	const article = document.querySelector<HTMLElement>(".articleBody");
	const root = document.documentElement;
	return {
		article: Boolean(article),
		textLength: (article?.innerText || "").trim().length,
		// Body only: macOS CSS legitimately keeps the font-size macro literal. Match
		// whole macro names, so a theme script's regex such as /[[(]/ is no macro.
		unresolved: /\[\[[A-Za-z0-9_-]+\]\]/.test(document.body.innerHTML),
		overflow: root.scrollWidth > root.clientWidth + 1,
		brokenImages: [...document.images]
			.filter((image) => image.complete && image.naturalWidth === 0)
			.map((image) => image.currentSrc || image.src),
		// A loaded image the theme lays out at no size, such as a percentage width
		// inside a shrink-to-fit float, which WebKit resolves to zero. Images that are
		// not laid out at all (display: none, a closed <details>) are deliberate, and
		// so is one the article itself sizes to zero, like a tracking pixel.
		collapsedImages: [...document.images]
			.filter((image) => {
				if (!image.complete || image.naturalWidth < 2 || image.naturalHeight < 2) return false;
				if (!image.getClientRects().length) return false;
				const zero = (value: string | null) => value !== null && /^\s*0(px)?\s*$/i.test(value);
				if ([image.getAttribute("width"), image.getAttribute("height")].some(zero))
					return false;
				if ([image.style.width, image.style.height].some(zero)) return false;
				const box = image.getBoundingClientRect();
				return box.width < 1 || box.height < 1;
			})
			.map((image) => image.currentSrc || image.src),
	};
}

export interface CheckProgress {
	status(message: string): void;
	start(index: number, target: RenderTarget): void;
	finish(index: number, target: RenderTarget, failures: string[]): void;
}

/**
 * Each target's slug mapped to its failures (empty when it passed).
 *
 * expectations maps a fixture name to its [expect.footnotes] table. They describe
 * the theme's own footnote handling, so they are skipped with theme scripts off.
 */
export async function checkPages(
	site: string,
	targets: readonly RenderTarget[],
	progress?: CheckProgress,
	expectations: Record<string, FootnoteExpectations> = {},
): Promise<Record<string, string[]>> {
	const results: Record<string, string[]> = {};
	const screenshots = join(site, "screenshots");
	mkdirSync(screenshots, { recursive: true });
	const server = await serve(site);
	try {
		progress?.status("Starting WebKit…");
		const browser = await launch();
		try {
			for (const [offset, target] of targets.entries()) {
				const index = offset + 1;
				progress?.start(index, target);
				const url = `${server.url}/pages/${encodeURIComponent(target.slug)}.html`;
				const footnotes = target.themeScripts ? (expectations[target.fixture] ?? {}) : {};
				const state = await checkPage(
					browser,
					server.url,
					url,
					target,
					join(screenshots, `${target.slug}.png`),
					footnotes,
				);
				const found = failures(state);
				results[target.slug] = found;
				progress?.finish(index, target, found);
			}
		} finally {
			await browser.close();
		}
	} finally {
		await server.close();
	}
	return results;
}

async function checkPage(
	browser: Browser,
	origin: string,
	url: string,
	target: RenderTarget,
	screenshot: string,
	footnotes: FootnoteExpectations,
): Promise<PageState> {
	const context = await browser.newContext({
		viewport: { width: target.width, height: target.height },
		colorScheme: target.appearance,
		serviceWorkers: "block",
	});
	try {
		const blocked: string[] = [];
		const pageErrors: string[] = [];
		await context.route("**/*", async (route) => {
			const requestURL = route.request().url();
			if (requestURL.startsWith("data:")) return route.continue();
			let requestOrigin: string | null = null;
			try {
				requestOrigin = new URL(requestURL).origin;
			} catch {
				// Not a URL with an origin: blocked below.
			}
			// Whole-origin match: a prefix test would accept 127.0.0.1:PORT.example.net.
			if (requestOrigin === origin) return route.continue();
			blocked.push(requestURL);
			return route.abort("blockedbyclient");
		});
		const page = await context.newPage();
		page.on("pageerror", (error) => pageErrors.push(String(error)));
		await page.goto(url, { waitUntil: "networkidle" });
		await page.screenshot({ path: screenshot, fullPage: true });
		const state = await page.evaluate(pageState);
		// Last: it clicks footnotes open, so it must not disturb the screenshot.
		const found = (await page.evaluate(
			`(${FOOTNOTE_CHECK})(${JSON.stringify(footnotes)})`,
		)) as string[];
		return { ...state, footnotes: found, blocked, pageErrors };
	} finally {
		await context.close();
	}
}
