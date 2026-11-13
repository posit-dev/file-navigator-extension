// The list's menus: context menus for an entry and for the empty space below the rows (the
// folder), and the toolbar's "…" menu.
// Labels and shortcut hints follow the OS, as VS Code's own menus do.
import type { FileAction } from "../protocol";
import type { MenuItem, MenuSection } from "./Menu";
import type { DirectoryEntry, ViewMode } from "./types";

const ua = navigator.userAgent;
const isMac = ua.includes("Macintosh");
const isWindows = ua.includes("Windows");

const shortcut = (mac: string, other: string) => (isMac ? mac : other);

export const REVEAL_LABEL = isMac
	? "Reveal in Finder"
	: isWindows
		? "Reveal in File Explorer"
		: "Open Containing Folder";

/** The keyboard shortcuts the hints advertise, matched against a key event on a row. */
export function shortcutCommand(e: {
	key: string;
	code: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}): "copyPath" | "copyRelativePath" | "reveal" | "delete" | "openToSide" | null {
	if (isMac) {
		if (e.metaKey && e.altKey && e.code === "KeyC") {
			return e.shiftKey ? "copyRelativePath" : "copyPath";
		}
		if (e.metaKey && e.altKey && e.code === "KeyR") return "reveal";
		if (e.metaKey && e.key === "Backspace") return "delete";
	} else {
		if (e.shiftKey && e.altKey && !e.ctrlKey && e.code === "KeyC") return "copyPath";
		if (e.shiftKey && e.altKey && !e.ctrlKey && e.code === "KeyR") return "reveal";
	}
	if (e.key === "Delete" && !e.shiftKey) return "delete";
	if (e.ctrlKey && !e.metaKey && e.key === "Enter") return "openToSide";
	return null;
}

/** What the menus can do; DirectoryView supplies these. */
export type MenuCommands = {
	mode: ViewMode;
	open: (entry: DirectoryEntry, toSide?: boolean) => void;
	navigate: (uri: string) => void;
	run: (action: FileAction, uri: string) => void;
	rename: (entry: DirectoryEntry) => void;
	/** Starts creating a file or folder beside the entry, or in it if it's an expanded folder. */
	create: (kind: "file" | "directory", near: DirectoryEntry | undefined) => void;
	refresh: () => void;
};

export function entryMenu(entry: DirectoryEntry, c: MenuCommands): MenuSection[] {
	const folder = entry.kind === "directory";
	const run = (action: FileAction) => () => c.run(action, entry.uri);
	return [
		folder
			? [
					{
						id: "open",
						label: c.mode === "tree" ? "Set as Root" : "Open Folder",
						onSelect: () => c.navigate(entry.uri),
					},
					{
						id: "findInFolder",
						label: "Find in Folder…",
						shortcut: shortcut("⌥⇧F", "Shift+Alt+F"),
						onSelect: run("findInFolder"),
					},
				]
			: [
					{ id: "open", label: "Open", onSelect: () => c.open(entry) },
					{
						id: "openToSide",
						label: "Open to the Side",
						shortcut: shortcut("⌃↵", "Ctrl+Enter"),
						onSelect: () => c.open(entry, true),
					},
				],
		[
			{
				id: "reveal",
				label: REVEAL_LABEL,
				shortcut: shortcut("⌥⌘R", "Shift+Alt+R"),
				onSelect: run("reveal"),
			},
			{ id: "openTerminal", label: "Open in Integrated Terminal", onSelect: run("openTerminal") },
		],
		[
			{ id: "newFile", label: "New File…", onSelect: () => c.create("file", entry) },
			{ id: "newFolder", label: "New Folder…", onSelect: () => c.create("directory", entry) },
		],
		[
			{
				id: "copyPath",
				label: "Copy Path",
				shortcut: shortcut("⌥⌘C", "Shift+Alt+C"),
				onSelect: run("copyPath"),
			},
			{
				id: "copyRelativePath",
				label: "Copy Relative Path",
				shortcut: isMac ? "⌥⇧⌘C" : undefined,
				onSelect: run("copyRelativePath"),
			},
			{ id: "copyName", label: "Copy Name", onSelect: run("copyName") },
		],
		[
			{ id: "rename", label: "Rename…", shortcut: "F2", onSelect: () => c.rename(entry) },
			{ id: "duplicate", label: "Duplicate", onSelect: run("duplicate") },
		],
		[
			{
				id: "delete",
				label: isWindows ? "Delete" : "Move to Trash",
				shortcut: shortcut("⌘⌫", "Delete"),
				onSelect: run("delete"),
			},
		],
	];
}

export function folderMenu(folderUri: string, c: MenuCommands): MenuSection[] {
	const run = (action: FileAction) => () => c.run(action, folderUri);
	return [
		[
			{ id: "newFile", label: "New File…", onSelect: () => c.create("file", undefined) },
			{ id: "newFolder", label: "New Folder…", onSelect: () => c.create("directory", undefined) },
		],
		[
			{ id: "reveal", label: REVEAL_LABEL, onSelect: run("reveal") },
			{ id: "openTerminal", label: "Open in Integrated Terminal", onSelect: run("openTerminal") },
			{ id: "findInFolder", label: "Find in Folder…", onSelect: run("findInFolder") },
		],
		[
			{ id: "copyPath", label: "Copy Path", onSelect: run("copyPath") },
			{ id: "copyRelativePath", label: "Copy Relative Path", onSelect: run("copyRelativePath") },
		],
		[{ id: "refresh", label: "Refresh", onSelect: c.refresh }],
	];
}

/** What the toolbar's "…" menu shows and does. */
export type ViewMenuOptions = {
	mode: ViewMode;
	onModeChange: (mode: ViewMode) => void;
	/** The column items, from `columnMenuItems`. */
	columnItems: MenuItem[];
	foldersFirst: boolean;
	onFoldersFirstChange: (value: boolean) => void;
	showHidden: boolean;
	onShowHiddenChange: (value: boolean) => void;
	highContrast: boolean;
	onHighContrastChange: (value: boolean) => void;
	collapseAll: () => void;
};

/** The toolbar's "…" menu: view mode, columns, list options, and tree actions. Flat, no submenus. */
export function viewMenu(o: ViewMenuOptions): MenuSection[] {
	return [
		[
			{
				id: "viewList",
				label: "View as List",
				checked: o.mode === "flat",
				onSelect: () => o.onModeChange("flat"),
			},
			{
				id: "viewTree",
				label: "View as Tree",
				checked: o.mode === "tree",
				onSelect: () => o.onModeChange("tree"),
			},
		],
		o.columnItems,
		[
			{
				id: "foldersFirst",
				label: "Folders First",
				checked: o.foldersFirst,
				onSelect: () => o.onFoldersFirstChange(!o.foldersFirst),
			},
			{
				id: "showHidden",
				label: "Show Hidden Files",
				checked: o.showHidden,
				onSelect: () => o.onShowHiddenChange(!o.showHidden),
			},
			{
				id: "highContrast",
				label: "High Contrast Text",
				checked: o.highContrast,
				onSelect: () => o.onHighContrastChange(!o.highContrast),
			},
		],
		[
			{
				id: "collapseAll",
				label: "Collapse All Folders",
				disabled: o.mode === "flat",
				onSelect: o.collapseAll,
			},
		],
	];
}
