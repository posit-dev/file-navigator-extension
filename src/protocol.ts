export type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
	size: number | null;
	mtime: number | null;
};

export type BreadcrumbSegment = {
	label: string;
	uri: string;
};
