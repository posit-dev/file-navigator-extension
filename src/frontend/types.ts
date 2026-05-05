export type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
	size: number | null;
	mtime: number | null;
};

export type SortColumn = "name" | "size" | "mtime";
export type SortDirection = "asc" | "desc";
