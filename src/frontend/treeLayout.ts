import type { DirectoryEntry, SortColumn, SortDirection } from "./types";

/** What the tree shows: each entry under its tree path, in display order. */
export type TreeLayout = {
	/** Depth-first, each directory's entries sorted; the order the tree shows them in. */
	paths: string[];
	byPath: Map<string, DirectoryEntry>;
	pathByUri: Map<string, string>;
};

function compareEntries(
	a: DirectoryEntry,
	b: DirectoryEntry,
	column: SortColumn,
	direction: SortDirection,
): number {
	const dir = direction === "asc" ? 1 : -1;
	switch (column) {
		case "name":
			return dir * a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
		case "size": {
			const aVal = a.size ?? -1;
			const bVal = b.size ?? -1;
			return dir * (aVal - bVal);
		}
		case "mtime": {
			const aVal = a.mtime ?? -1;
			const bVal = b.mtime ?? -1;
			return dir * (aVal - bVal);
		}
	}
}

function sortEntries(
	entries: readonly DirectoryEntry[],
	column: SortColumn,
	direction: SortDirection,
	foldersFirst: boolean,
): DirectoryEntry[] {
	return [...entries].sort((a, b) => {
		if (foldersFirst) {
			if (a.kind === "directory" && b.kind !== "directory") return -1;
			if (a.kind !== "directory" && b.kind === "directory") return 1;
		}
		return compareEntries(a, b, column, direction);
	});
}

/**
 * Lays out the root's entries, and inside each directory the entries `children` has for its URI
 * (none for a flat list). Tree paths are relative to the root: a name, with a trailing slash for
 * a directory, under its parent's path. Directories sort before files unless `foldersFirst` is
 * false. Unless `showHidden` is true, entries whose name starts with "." are left out at every
 * level, and their folders are not walked. "Hidden" means that dot prefix only; the Windows hidden
 * attribute is not considered.
 */
export function layoutTree(
	rootEntries: readonly DirectoryEntry[],
	children: ReadonlyMap<string, readonly DirectoryEntry[]>,
	column: SortColumn,
	direction: SortDirection,
	{ foldersFirst = true, showHidden = true }: { foldersFirst?: boolean; showHidden?: boolean } = {},
): TreeLayout {
	const layout: TreeLayout = { paths: [], byPath: new Map(), pathByUri: new Map() };
	const walk = (entries: readonly DirectoryEntry[], prefix: string) => {
		const shown = showHidden ? entries : entries.filter((entry) => !entry.name.startsWith("."));
		for (const entry of sortEntries(shown, column, direction, foldersFirst)) {
			const directory = entry.kind === "directory";
			const path = `${prefix}${entry.name}${directory ? "/" : ""}`;
			layout.paths.push(path);
			layout.byPath.set(path, entry);
			layout.pathByUri.set(entry.uri, path);
			const nested = directory ? children.get(entry.uri) : undefined;
			if (nested) walk(nested, path);
		}
	};
	walk(rootEntries, "");
	return layout;
}
