export type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
	size: number | null;
	mtime: number | null;
};

/** One folder of the path, from the root (labeled `/`) down to the current folder. */
export type BreadcrumbSegment = {
	label: string;
	uri: string;
	/** The user's home folder (labeled `~`). */
	isHome?: boolean;
};

/** An operation on one entry, done by the backend (`fileAction` message). */
export type FileAction =
	| "reveal"
	| "openTerminal"
	| "findInFolder"
	| "copyPath"
	| "copyRelativePath"
	| "copyName"
	| "duplicate"
	| "delete";

export const FILE_ACTIONS: readonly FileAction[] = [
	"reveal",
	"openTerminal",
	"findInFolder",
	"copyPath",
	"copyRelativePath",
	"copyName",
	"duplicate",
	"delete",
];
