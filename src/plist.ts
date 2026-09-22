// XML property lists, read and written the way Python's plistlib does, so an
// Info.plist that init or bump rewrites is byte-identical to the Python tool's.
import { Parser } from "htmlparser2";

/** A <real>, kept apart from <integer> so a Version of 1.0 is still rejected. */
export class PlistReal {
	readonly value: number;
	constructor(value: number) {
		this.value = value;
	}
}

export type PlistValue =
	| string
	| number
	| boolean
	| PlistReal
	| Date
	| Uint8Array
	| PlistValue[]
	| PlistDict;
export interface PlistDict {
	[key: string]: PlistValue;
}

interface Node {
	name: string;
	children: Node[];
	text: string;
}

function tree(text: string): Node {
	const root: Node = { name: "#root", children: [], text: "" };
	const stack = [root];
	let failure: Error | undefined;
	const parser = new Parser(
		{
			onopentag(name) {
				const node: Node = { name, children: [], text: "" };
				stack.at(-1)?.children.push(node);
				stack.push(node);
			},
			ontext(data) {
				const node = stack.at(-1);
				if (node) node.text += data;
			},
			onclosetag(name) {
				if (stack.at(-1)?.name !== name) failure ??= new Error(`mismatched tag </${name}>`);
				stack.pop();
			},
			onerror(error) {
				failure ??= error;
			},
		},
		{ xmlMode: true, decodeEntities: true },
	);
	parser.end(text);
	if (failure) throw failure;
	if (stack.length !== 1) throw new Error("unclosed element");
	return root;
}

function value(node: Node): PlistValue {
	switch (node.name) {
		case "dict": {
			const result: PlistDict = {};
			const children = node.children;
			for (let index = 0; index < children.length; index += 2) {
				const key = children[index];
				const item = children[index + 1];
				if (key?.name !== "key" || !item)
					throw new Error("dict keys and values must alternate");
				result[key.text] = value(item);
			}
			return result;
		}
		case "array":
			return node.children.map(value);
		case "string":
			return node.text;
		case "integer": {
			const text = node.text.trim();
			const parsed = /^[+-]?0x/i.test(text) ? Number.parseInt(text, 16) : Number(text);
			if (!/^[+-]?(0x[0-9a-f]+|\d+)$/i.test(text) || !Number.isSafeInteger(parsed)) {
				throw new Error(`invalid integer ${JSON.stringify(text)}`);
			}
			return parsed;
		}
		case "real": {
			const parsed = Number(node.text.trim());
			if (Number.isNaN(parsed) && !/nan/i.test(node.text)) {
				throw new Error(`invalid real ${JSON.stringify(node.text)}`);
			}
			return new PlistReal(parsed);
		}
		case "true":
			return true;
		case "false":
			return false;
		case "date":
			return new Date(node.text.trim());
		case "data":
			return Uint8Array.from(Buffer.from(node.text.replace(/\s+/g, ""), "base64"));
		default:
			throw new Error(`unknown element <${node.name}>`);
	}
}

/** Parse an XML property list; throws an Error describing what is invalid. */
export function parsePlist(text: string): PlistValue {
	const plist = tree(text).children.find((node) => node.name === "plist");
	const [content, ...rest] = plist?.children ?? [];
	if (!content || rest.length) throw new Error("expected one value inside <plist>");
	return value(content);
}

function escapeText(text: string): string {
	if (/[\0-\x08\x0b\x0c\x0e-\x1f]/.test(text)) {
		throw new Error("strings can't contain control characters; use bytes instead");
	}
	return text
		.replaceAll("\r\n", "\n")
		.replaceAll("\r", "\n")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function realText(value: number): string {
	if (Number.isNaN(value)) return "nan";
	if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
	const text = String(value);
	if (text.includes("e")) return text.replace(/e([+-])(\d)$/, "e$10$2");
	return Number.isInteger(value) ? `${text}.0` : text;
}

function lines(item: PlistValue, depth: number, out: string[]): void {
	const indent = "\t".repeat(depth);
	if (typeof item === "string") out.push(`${indent}<string>${escapeText(item)}</string>`);
	else if (typeof item === "boolean") out.push(`${indent}<${item}/>`);
	else if (typeof item === "number") {
		if (!Number.isInteger(item)) throw new Error("integers must be whole numbers");
		out.push(`${indent}<integer>${item}</integer>`);
	} else if (item instanceof PlistReal)
		out.push(`${indent}<real>${realText(item.value)}</real>`);
	else if (item instanceof Date) {
		out.push(`${indent}<date>${item.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>`);
	} else if (item instanceof Uint8Array) {
		const encoded = Buffer.from(item).toString("base64");
		const width = Math.max(16, 76 - indent.replaceAll("\t", " ".repeat(8)).length);
		const wrapped = encoded.match(
			new RegExp(`.{1,${(Math.floor(width / 4) * 3 * 4) / 3}}`, "g"),
		);
		out.push(`${indent}<data>`);
		for (const line of wrapped ?? []) out.push(`${indent}${line}`);
		out.push(`${indent}</data>`);
	} else if (Array.isArray(item)) {
		if (!item.length) out.push(`${indent}<array/>`);
		else {
			out.push(`${indent}<array>`);
			for (const child of item) lines(child, depth + 1, out);
			out.push(`${indent}</array>`);
		}
	} else {
		const entries = Object.entries(item);
		if (!entries.length) out.push(`${indent}<dict/>`);
		else {
			out.push(`${indent}<dict>`);
			for (const [key, child] of entries) {
				out.push(`${indent}\t<key>${escapeText(key)}</key>`);
				lines(child, depth + 1, out);
			}
			out.push(`${indent}</dict>`);
		}
	}
}

/** plistlib.dumps(value, fmt=FMT_XML, sort_keys=False). */
export function buildPlist(item: PlistValue): string {
	const out = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
	];
	lines(item, 0, out);
	out.push("</plist>", "");
	return out.join("\n");
}
