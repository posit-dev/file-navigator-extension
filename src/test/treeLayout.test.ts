import * as assert from "node:assert";

import { layoutTree } from "../frontend/treeLayout";
import type { DirectoryEntry } from "../protocol";

function file(name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry {
	return {
		name,
		uri: `file:///root/${name}`,
		kind: "file",
		isSymbolicLink: false,
		size: 0,
		mtime: 0,
		...extra,
	};
}

function dir(name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry {
	return file(name, { kind: "directory", size: null, ...extra });
}

const noChildren = new Map<string, DirectoryEntry[]>();

suite("layoutTree", () => {
	test("puts folders first, then sorts by name without regard to case", () => {
		const entries = [file("b.txt"), dir("Zeta"), file("A.txt"), dir("alpha")];
		const { paths } = layoutTree(entries, noChildren, "name", "asc");
		assert.deepStrictEqual(paths, ["alpha/", "Zeta/", "A.txt", "b.txt"]);
	});

	test("mixes folders and files when foldersFirst is false", () => {
		const entries = [file("b.txt"), dir("Zeta"), file("A.txt"), dir("alpha")];
		const { paths } = layoutTree(entries, noChildren, "name", "asc", { foldersFirst: false });
		assert.deepStrictEqual(paths, ["A.txt", "alpha/", "b.txt", "Zeta/"]);
	});

	test("reverses the order within each group, but keeps folders first", () => {
		const entries = [file("a.txt"), dir("x"), file("b.txt"), dir("y")];
		const { paths } = layoutTree(entries, noChildren, "name", "desc");
		assert.deepStrictEqual(paths, ["y/", "x/", "b.txt", "a.txt"]);
	});

	test("sorts by size and by date modified, with unknown values first", () => {
		const entries = [
			file("big", { size: 300, mtime: 1 }),
			file("unknown", { size: null, mtime: null }),
			file("small", { size: 10, mtime: 3 }),
			file("medium", { size: 20, mtime: 2 }),
		];
		assert.deepStrictEqual(layoutTree(entries, noChildren, "size", "asc").paths, [
			"unknown",
			"small",
			"medium",
			"big",
		]);
		assert.deepStrictEqual(layoutTree(entries, noChildren, "mtime", "desc").paths, [
			"small",
			"medium",
			"big",
			"unknown",
		]);
	});

	test("walks loaded folders depth-first, each sorted on its own", () => {
		const src = dir("src", { uri: "file:///root/src" });
		const lib = dir("lib", { uri: "file:///root/src/lib" });
		const docs = dir("docs", { uri: "file:///root/docs" });
		const children = new Map<string, DirectoryEntry[]>([
			[src.uri, [file("z.ts", { uri: "file:///root/src/z.ts" }), lib]],
			[lib.uri, [file("a.ts", { uri: "file:///root/src/lib/a.ts" })]],
		]);

		const layout = layoutTree([src, docs, file("README.md")], children, "name", "asc");

		// docs/ isn't loaded, so it has no children.
		assert.deepStrictEqual(layout.paths, [
			"docs/",
			"src/",
			"src/lib/",
			"src/lib/a.ts",
			"src/z.ts",
			"README.md",
		]);
		assert.strictEqual(layout.byPath.get("src/lib/a.ts")?.uri, "file:///root/src/lib/a.ts");
		assert.strictEqual(layout.pathByUri.get("file:///root/src/lib"), "src/lib/");
	});

	test("doesn't walk into a file, even if children has an entry for its URI", () => {
		const notes = file("notes");
		const children = new Map([[notes.uri, [file("inner", { uri: "file:///root/notes/inner" })]]]);
		assert.deepStrictEqual(layoutTree([notes], children, "name", "asc").paths, ["notes"]);
	});

	test("shows hidden entries by default", () => {
		const { paths } = layoutTree([file(".env"), file("app.py")], noChildren, "name", "asc");
		assert.deepStrictEqual(paths, [".env", "app.py"]);
	});

	test("leaves out hidden entries at every level, and doesn't walk hidden folders", () => {
		const git = dir(".git", { uri: "file:///root/.git" });
		const src = dir("src", { uri: "file:///root/src" });
		const children = new Map<string, DirectoryEntry[]>([
			[git.uri, [file("HEAD", { uri: "file:///root/.git/HEAD" })]],
			[
				src.uri,
				[
					file(".cache", { uri: "file:///root/src/.cache" }),
					file("main.ts", { uri: "file:///root/src/main.ts" }),
				],
			],
		]);

		const layout = layoutTree([git, src, file(".env")], children, "name", "asc", {
			showHidden: false,
		});

		assert.deepStrictEqual(layout.paths, ["src/", "src/main.ts"]);
		assert.strictEqual(layout.pathByUri.has("file:///root/.git/HEAD"), false);
	});
});
