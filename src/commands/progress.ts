import type { CheckProgress as Progress } from "../browser.ts";
import type { RenderTarget } from "../render.ts";

interface Stream {
	isTTY?: boolean;
	write(text: string): unknown;
}

/** One line rewritten in place on a terminal; one plain line per case elsewhere. */
export class CheckProgress implements Progress {
	readonly total: number;
	readonly stream: Stream;
	readonly live: boolean;

	constructor(total: number, stream: Stream = process.stderr) {
		this.total = total;
		this.stream = stream;
		this.live = stream.isTTY === true;
	}

	status(message: string): void {
		this.stream.write(this.live ? `\r\x1b[K${message}` : `${message}\n`);
	}

	start(index: number, target: RenderTarget): void {
		if (this.live)
			this.stream.write(`\r\x1b[KChecking ${index}/${this.total} · ${target.label}`);
	}

	finish(index: number, target: RenderTarget, failures: string[]): void {
		if (this.live && failures.length) {
			this.stream.write(`\r\x1b[K✗ ${target.label}: ${failures.join("; ")}\n`);
		} else if (!this.live) {
			const outcome = failures.length ? `FAILED: ${failures.join("; ")}` : "passed";
			this.stream.write(`[${index}/${this.total}] ${target.label} … ${outcome}\n`);
		}
	}

	done(): void {
		if (this.live) this.stream.write("\r\x1b[K");
	}
}
