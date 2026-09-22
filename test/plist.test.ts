import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, test } from "node:test";
import { buildPlist, type PlistDict, PlistReal, parsePlist } from "../src/plist.ts";

const sample: PlistDict = {
	ThemeIdentifier: "io.github.someone.a&b",
	Name: "Quiet <Reader>",
	Version: 3,
	Flag: true,
	Off: false,
	Scale: new PlistReal(1.5),
	Whole: new PlistReal(2),
	List: ["x", 1],
	Empty: [],
	Nested: { Inner: "value" },
	Nothing: {},
};

describe("plist", () => {
	test("round-trips every value type, keeping integers and reals apart", () => {
		assert.deepEqual(parsePlist(buildPlist(sample)), sample);
	});

	test("matches Python's plistlib byte for byte", { skip: !hasPython() }, () => {
		const python = execFileSync(
			"python3",
			[
				"-c",
				"import plistlib,sys\n" +
					"v={'ThemeIdentifier':'io.github.someone.a&b','Name':'Quiet <Reader>','Version':3," +
					"'Flag':True,'Off':False,'Scale':1.5,'Whole':2.0,'List':['x',1],'Empty':[]," +
					"'Nested':{'Inner':'value'},'Nothing':{}}\n" +
					"sys.stdout.write(plistlib.dumps(v,sort_keys=False).decode())",
			],
			{ encoding: "utf8" },
		);
		assert.equal(buildPlist(sample), python);
	});

	test("invalid XML is an error", () => {
		assert.throws(() => parsePlist("<plist><dict><key>a</key></dict></plist>"));
		assert.throws(() => parsePlist('<plist version="1.0"><integer>1.5</integer></plist>'));
	});
});

function hasPython(): boolean {
	try {
		execFileSync("python3", ["--version"]);
		return true;
	} catch {
		return false;
	}
}
