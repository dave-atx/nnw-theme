// Python's formatting of values that appear in messages and pages, so the port's
// output matches the Python tool's text exactly.

const NON_PRINTABLE = /[\p{C}\p{Zl}\p{Zp}]|(?! )\p{Zs}/u;

/** repr() of a str. */
export function pyRepr(value: string): string {
	const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
	let result = quote;
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (character === "\\") result += "\\\\";
		else if (character === quote) result += `\\${quote}`;
		else if (character === "\n") result += "\\n";
		else if (character === "\r") result += "\\r";
		else if (character === "\t") result += "\\t";
		else if (NON_PRINTABLE.test(character)) {
			if (code < 0x100) result += `\\x${code.toString(16).padStart(2, "0")}`;
			else if (code < 0x10000) result += `\\u${code.toString(16).padStart(4, "0")}`;
			else result += `\\U${code.toString(16).padStart(8, "0")}`;
		} else result += character;
	}
	return result + quote;
}

/** repr() of a list of str. */
export function pyReprList(values: readonly string[]): string {
	return `[${values.map(pyRepr).join(", ")}]`;
}

/** Python's shortest round-tripping float text: 17.0 -> "17.0", 1e16 -> "1e+16". */
function floatRepr(value: number): string {
	if (Number.isNaN(value)) return "nan";
	if (!Number.isFinite(value)) return value > 0 ? "inf" : "-inf";
	const text = String(value);
	if (/e/.test(text)) return text.replace(/e([+-])(\d)$/, "e$10$2");
	if (Math.abs(value) >= 1e16) return value.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
	return Number.isInteger(value) ? `${text}.0` : text;
}

/**
 * str() of a TOML value. Integers and floats are indistinguishable once parsed, so
 * callers that need Python's float text use formatG instead.
 */
export function pyStr(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return value ? "True" : "False";
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (value === null || value === undefined) return "None";
	if (value instanceof Date) return value.toISOString();
	return String(value);
}

/** format(value, "g"): six significant digits, trailing zeros dropped. */
export function formatG(value: number): string {
	if (!Number.isFinite(value)) return floatRepr(value);
	if (value === 0) return Object.is(value, -0) ? "-0" : "0";
	const exponent = Math.floor(Math.log10(Math.abs(Number(value.toPrecision(6)))));
	if (exponent < -4 || exponent >= 6) {
		const [mantissa = "", power = "0"] = value.toExponential(5).split("e");
		const trimmed = mantissa.includes(".") ? mantissa.replace(/\.?0+$/, "") : mantissa;
		const sign = power.startsWith("-") ? "-" : "+";
		return `${trimmed}e${sign}${power.replace(/^[+-]/, "").padStart(2, "0")}`;
	}
	const fixed = value.toFixed(Math.max(0, 5 - exponent));
	return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
