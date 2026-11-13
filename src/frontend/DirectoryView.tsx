import { preparePresortedFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { clsx } from "clsx";
import {
	type KeyboardEvent,
	type MouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import type { FileAction } from "../protocol";
import {
	ColumnHeader,
	type ColumnSettings,
	COLUMN_ROW_CSS,
	columnDecoration,
	useColumnLayout,
	useElementWidth,
} from "./columns";
import { entryMenu, folderMenu, type MenuCommands, shortcutCommand } from "./contextMenus";
import { Menu } from "./Menu";
import { layoutTree } from "./treeLayout";
import type { DirectoryEntry, SortColumn, SortDirection, ViewMode } from "./types";

const NO_CHILDREN: ReadonlyMap<string, DirectoryEntry[]> = new Map();

/** The list's first row when the directory has a parent; activating it goes up. */
const PARENT_PATH = "..";

// Symbols the tree can use: the parent row's icon (Lucide's corner-left-up) and the folder icon
// (Lucide's folder) that replaces the chevron in flat mode.
const SPRITE = `<svg aria-hidden="true" width="0" height="0">
<symbol id="fn-parent" viewBox="0 0 24 24">
<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 9 9 4 4 9M20 20h-7a4 4 0 0 1-4-4V4"/>
</symbol>
<symbol id="fn-folder" viewBox="0 0 24 24">
<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
</symbol>
</svg>`;

// The tree's icon options. Flat mode has no expanding, so folders get a folder icon, not a chevron.
function treeIcons(folderIcons: boolean) {
	return {
		set: "complete",
		colored: true,
		spriteSheet: SPRITE,
		byFileName: { [PARENT_PATH]: "fn-parent" },
		...(folderIcons ? { remap: { "file-tree-icon-chevron": "fn-folder" } } : {}),
	} as const;
}

/** What the list asks the backend to do. URIs are always ones the backend sent. */
export type FileActions = {
	open: (uri: string, toSide?: boolean) => void;
	rename: (uri: string, newName: string) => void;
	create: (parentUri: string, name: string, kind: "file" | "directory") => void;
	run: (action: FileAction, uri: string) => void;
	refresh: () => void;
};

type DirectoryViewProps = {
	mode: ViewMode;
	/** The directory shown: the list's directory, or the tree's root. */
	currentUri: string;
	/** Whether the directory has a parent; the list then starts with a `..` row. */
	hasParent: boolean;
	/** The directory's entries, unsorted. */
	entries: DirectoryEntry[];
	/** Loaded directory contents by directory URI; the tree shows those of expanded folders. */
	loadedFolders: ReadonlyMap<string, DirectoryEntry[]>;
	/**
	 * Called with the URIs of the folders expanded in the tree (always empty for the list),
	 * whenever that set changes.
	 */
	onExpandedChange: (uris: ReadonlySet<string>) => void;
	filter: string;
	loading: boolean;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
	columns: ColumnSettings;
	onColumnsChange: (settings: ColumnSettings) => void;
	/** Whether directories sort before files (in the tree, within each folder). */
	foldersFirst: boolean;
	/** Whether entries whose names start with "." are shown (tree mode hides them at every level). */
	showHidden: boolean;
	onNavigate: (uri: string) => void;
	onNavigateUp: () => void;
	actions: FileActions;
};

const ROW_HEIGHT = 22;

/** The tree path of the row an event came from, if any. */
function eventRowPath(event: { nativeEvent: Event }): string | undefined {
	for (const target of event.nativeEvent.composedPath()) {
		if (target instanceof HTMLElement && target.dataset.type === "item") {
			return target.dataset.itemPath;
		}
	}
	return undefined;
}

/** Whether a key event was typed into a text field (the tree's rename input, inside its shadow DOM). */
function fromTextInput(event: { nativeEvent: Event }): boolean {
	const origin = event.nativeEvent.composedPath()[0];
	return origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement;
}

/** A tree path's last segment: the entry's name. */
function lastSegment(path: string): string {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/** Focuses the tree's focused row (its roving tab stop), else its first row. */
function focusTreeRow(model: { getFileTreeContainer(): HTMLElement | undefined }): void {
	const root = model.getFileTreeContainer()?.shadowRoot;
	const row =
		root?.querySelector<HTMLElement>("[data-type='item'][tabindex='0']") ??
		root?.querySelector<HTMLElement>("[data-type='item']");
	row?.focus();
}

export function DirectoryView({
	mode,
	currentUri,
	hasParent,
	entries,
	loadedFolders,
	onExpandedChange,
	filter,
	loading,
	sortColumn,
	sortDirection,
	onSort,
	columns,
	onColumnsChange,
	foldersFirst,
	showHidden,
	onNavigate,
	onNavigateUp,
	actions,
}: DirectoryViewProps) {
	// The entries by tree path (and back), read by the decoration renderer and event handlers (the
	// tree's options are fixed when the model is created, so it reads the current ones through refs).
	const entriesByPath = useRef(new Map<string, DirectoryEntry>());
	const pathByUri = useRef(new Map<string, string>());
	const onRenameRef = useRef<(source: string, destination: string) => void>(() => {});

	const { model } = useFileTree({
		paths: [],
		itemHeight: ROW_HEIGHT,
		icons: treeIcons(mode === "flat"),
		fileTreeSearchMode: "hide-non-matches",
		// The tree rotates collapsed chevrons; keep the folder icon upright.
		unsafeCSS: `${COLUMN_ROW_CSS}
[data-item-section="icon"] > svg:has(use[href="#fn-folder"]) { transform: none; }`,
		renaming: {
			canRename: (item) => item.path !== PARENT_PATH,
			onRename: (event) => onRenameRef.current(event.sourcePath, event.destinationPath),
		},
		composition: { contextMenu: { enabled: true, triggerMode: "right-click" } },
		renderRowDecoration: ({ item }) => {
			const entry = entriesByPath.current.get(item.path);
			return entry ? columnDecoration(entry) : null;
		},
	});

	const listRef = useRef<HTMLDivElement>(null);
	const width = useElementWidth(listRef);
	const layout = useColumnLayout(width, columns);
	const shownUri = useRef<string | null>(null);
	const modeRef = useRef(mode);
	modeRef.current = mode;
	const filterRef = useRef(filter);
	filterRef.current = filter;
	const onExpandedChangeRef = useRef(onExpandedChange);
	onExpandedChangeRef.current = onExpandedChange;
	const [folderMenuAt, setFolderMenuAt] = useState<{ x: number; y: number } | null>(null);

	// Which folders are expanded, by URI, so it survives the tree being rebuilt with different
	// paths (a new root). Folders outside the current root keep their state for when they return.
	const expandedUris = useRef(new Set<string>());
	const resetting = useRef(false);
	const reported = useRef<string | null>(null);

	// A placeholder row being named (New File/Folder), and the row to focus once a rebuild shows
	// it (a created or renamed entry, by tree path without a trailing slash).
	const pendingCreate = useRef<{
		path: string;
		parentUri: string;
		kind: "file" | "directory";
	} | null>(null);
	const pendingFocus = useRef<string | null>(null);

	// Rebuilding the rows would drop an inline rename in progress (say, when a watched folder
	// changes meanwhile), so rebuilds wait until it ends, then run.
	const isRenaming = useCallback(
		() =>
			model.getFileTreeContainer()?.shadowRoot?.querySelector("[data-item-rename-input]") != null,
		[model],
	);
	const rebuildDeferred = useRef(false);
	const [rebuildTick, setRebuildTick] = useState(0);

	// Reads the expansion of the folders in the tree into `expandedUris` and reports the expanded
	// ones when that set changed. The tree has no expand event; this runs on each of its changes.
	const syncExpanded = useCallback(() => {
		const inView = new Set<string>();
		if (modeRef.current === "tree") {
			for (const [path, entry] of entriesByPath.current) {
				if (entry.kind !== "directory") continue;
				const item = model.getItem(path);
				if (item !== null && "isExpanded" in item && item.isExpanded()) {
					inView.add(entry.uri);
					expandedUris.current.add(entry.uri);
				} else {
					expandedUris.current.delete(entry.uri);
				}
			}
		}
		const key = [...inView].sort().join("\n");
		if (key === reported.current) return;
		reported.current = key;
		onExpandedChangeRef.current(inView);
	}, [model]);

	useEffect(
		() =>
			model.subscribe(() => {
				// Mid-reset the tree may not have the new paths yet; the reset syncs afterwards.
				if (!resetting.current) syncExpanded();
				if (rebuildDeferred.current && !isRenaming()) {
					rebuildDeferred.current = false;
					setRebuildTick((t) => t + 1);
				}
			}),
		[model, syncExpanded, isRenaming],
	);

	// The tree's options are fixed at creation, so swap the icons when the mode changes.
	useEffect(() => model.setIcons(treeIcons(mode === "flat")), [model, mode]);

	// Rebuilds the rows. Expanded folders stay expanded; after moving the root up, the folder
	// just left is expanded too, so it shows where you came from. If the list had keyboard focus,
	// it keeps it: on a just created or renamed entry, else the same entry if it is still shown,
	// else the directory just left, else the first row; an empty directory focuses the list itself,
	// so Backspace still works.
	useEffect(() => {
		if (isRenaming()) {
			rebuildDeferred.current = true;
			return;
		}
		const active = document.activeElement;
		const hadFocus =
			active !== null && (active === model.getFileTreeContainer() || active === listRef.current);
		const focusedPath = model.getFocusedPath();
		const focusedUri =
			focusedPath === null ? undefined : entriesByPath.current.get(focusedPath)?.uri;

		const tree = mode === "tree";
		const previousUri = shownUri.current;
		shownUri.current = currentUri;
		if (previousUri !== currentUri) pendingFocus.current = null;
		if (tree && previousUri !== null && previousUri !== currentUri) {
			expandedUris.current.add(previousUri);
		}

		const layout = layoutTree(
			entries,
			tree ? loadedFolders : NO_CHILDREN,
			sortColumn,
			sortDirection,
			{ foldersFirst, showHidden },
		);
		entriesByPath.current = layout.byPath;
		pathByUri.current = layout.pathByUri;
		const initialExpandedPaths = tree
			? [...expandedUris.current].flatMap((uri) => layout.pathByUri.get(uri) ?? [])
			: [];
		const paths = !tree && hasParent ? [PARENT_PATH, ...layout.paths] : layout.paths;
		resetting.current = true;
		try {
			model.resetPaths({
				preparedInput: preparePresortedFileTreeInput(paths),
				initialExpandedPaths,
			});
		} finally {
			resetting.current = false;
		}
		model.setSearch(filterRef.current.trim() === "" ? null : filterRef.current);
		syncExpanded();

		const wanted = pendingFocus.current;
		const wantedPath =
			wanted === null ? undefined : [wanted, `${wanted}/`].find((p) => layout.byPath.has(p));
		if (wantedPath !== undefined) {
			pendingFocus.current = null;
			model.focusPath(wantedPath);
			return;
		}
		if (!hadFocus) return;
		if (paths.length === 0) {
			listRef.current?.focus();
			return;
		}
		const target = [focusedUri, previousUri]
			.map((uri) => (uri == null ? undefined : layout.pathByUri.get(uri)))
			.find((path) => path !== undefined);
		if (target !== undefined) model.focusPath(target);
		else model.focusFirstItem();
		// The tree moves DOM focus itself only when it already has it; coming from the list (an
		// empty directory), focus its focused row once the tree has drawn the new rows.
		if (active === listRef.current) setTimeout(() => focusTreeRow(model), 0);
	}, [
		model,
		mode,
		currentUri,
		hasParent,
		entries,
		loadedFolders,
		sortColumn,
		sortDirection,
		foldersFirst,
		showHidden,
		syncExpanded,
		isRenaming,
		rebuildTick,
	]);

	useEffect(() => {
		model.setSearch(filter.trim() === "" ? null : filter);
	}, [model, filter]);

	// A rename (or a placeholder's first name) was entered. The tree has already shown it; the
	// backend does it, and the folder's refresh then shows the result, focused.
	onRenameRef.current = (source, destination) => {
		const name = lastSegment(destination);
		const pending = pendingCreate.current;
		// Folder paths may come with or without their trailing slash.
		const trim = (path: string) => path.replace(/\/$/, "");
		if (pending !== null && trim(pending.path) === trim(source)) {
			pendingCreate.current = null;
			if (name === "") return;
			pendingFocus.current = destination.replace(/\/$/, "");
			actions.create(pending.parentUri, name, pending.kind);
			return;
		}
		const entry = entriesByPath.current.get(source);
		if (!entry || name === "" || name === entry.name) return;
		pendingFocus.current = destination.replace(/\/$/, "");
		actions.rename(entry.uri, name);
	};

	const startRename = useCallback(
		(entry: DirectoryEntry) => {
			const path = pathByUri.current.get(entry.uri);
			if (path !== undefined) model.startRenaming(path);
		},
		[model],
	);

	// Adds a placeholder row and starts naming it: in the current directory, or in the tree, in
	// the folder `near` is (or in `near`, an expanded folder, which this expands).
	const startCreate = useCallback(
		(kind: "file" | "directory", near: DirectoryEntry | undefined) => {
			let parentUri = currentUri;
			let prefix = "";
			const nearPath = near === undefined ? undefined : pathByUri.current.get(near.uri);
			if (modeRef.current === "tree" && near !== undefined && nearPath !== undefined) {
				if (near.kind === "directory") {
					parentUri = near.uri;
					prefix = nearPath;
					const item = model.getItem(nearPath);
					if (item !== null && "expand" in item) item.expand();
				} else {
					prefix = nearPath.slice(0, nearPath.lastIndexOf("/") + 1);
					parentUri =
						prefix === "" ? currentUri : (entriesByPath.current.get(prefix)?.uri ?? currentUri);
				}
			}
			const siblings = parentUri === currentUri ? entries : (loadedFolders.get(parentUri) ?? []);
			const taken = new Set(siblings.map((entry) => entry.name));
			const base = kind === "file" ? "untitled" : "New Folder";
			let name = base;
			for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
			const path = `${prefix}${name}${kind === "directory" ? "/" : ""}`;
			model.add(path);
			pendingCreate.current = { path, parentUri, kind };
			// After the tree has drawn the row.
			setTimeout(() => model.startRenaming(path, { removeIfCanceled: true }), 0);
		},
		[model, currentUri, entries, loadedFolders],
	);

	const commands: MenuCommands = {
		mode,
		open: (entry, toSide) => actions.open(entry.uri, toSide),
		navigate: onNavigate,
		run: actions.run,
		rename: startRename,
		create: startCreate,
		refresh: actions.refresh,
	};

	// A file opens on click, and `..` goes up. A folder in the list opens on click; in the tree a
	// click expands or collapses it (the tree does that itself) and a double-click makes it the
	// root.
	const onClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
			if (modified || event.button !== 0) return;
			const path = eventRowPath(event);
			if (path === PARENT_PATH) {
				onNavigateUp();
				return;
			}
			const entry = path === undefined ? undefined : entriesByPath.current.get(path);
			if (!entry) return;
			if (entry.kind !== "directory") actions.open(entry.uri);
			else if (modeRef.current === "flat") onNavigate(entry.uri);
		},
		[onNavigate, onNavigateUp, actions],
	);

	const onDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const path = eventRowPath(event);
			const entry = path === undefined ? undefined : entriesByPath.current.get(path);
			if (entry?.kind === "directory" && modeRef.current === "tree") onNavigate(entry.uri);
		},
		[onNavigate],
	);

	// Rows are buttons, so Enter (and Space) on a row arrives as a click, and the tree handles F2.
	// Backspace goes up; it's handled on the list, not the tree, so it works in an empty directory
	// too. The menu's shortcuts act on the focused row. Keys typed into the rename input bubble
	// out of the tree as well; those are left alone.
	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			if (fromTextInput(event)) return;
			if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey) {
				event.preventDefault();
				onNavigateUp();
				return;
			}
			const command = shortcutCommand(event);
			const focusedPath = model.getFocusedPath();
			const entry = focusedPath === null ? undefined : entriesByPath.current.get(focusedPath);
			if (command === null || entry === undefined) return;
			event.preventDefault();
			if (command === "openToSide") {
				if (entry.kind !== "directory") actions.open(entry.uri, true);
			} else {
				actions.run(command, entry.uri);
			}
		},
		[onNavigateUp, actions, model],
	);

	// With no match the tree would show every row (it filters only when something matches).
	const search = useFileTreeSearch(model);
	const noMatches = search.value !== "" && search.matchingPaths.length === 0;
	// An empty directory with a parent shows just its `..` row.
	const parentRow = mode === "flat" && hasParent;
	// "Loading..." only before the first listing: hiding the tree while a later one loads would
	// drop keyboard focus (and flash the empty directory being left).
	const note =
		loading && currentUri === ""
			? "Loading..."
			: entries.length === 0 && !parentRow
				? "Empty directory"
				: noMatches
					? "No matches"
					: null;

	return (
		<div
			className="file-list relative flex min-h-0 flex-1 flex-col outline-none"
			ref={listRef}
			style={layout.style}
			tabIndex={-1}
			onKeyDown={onKeyDown}
			onContextMenu={(event) => {
				// Rows have their own menu; the empty space below them is the folder's.
				if (eventRowPath(event) !== undefined || currentUri === "") return;
				event.preventDefault();
				setFolderMenuAt({ x: event.clientX, y: event.clientY });
			}}
		>
			<ColumnHeader
				layout={layout}
				settings={columns}
				onSettingsChange={onColumnsChange}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSort={onSort}
			/>
			{note && <div className="p-2 text-center text-muted-foreground">{note}</div>}
			{/* Kept laid out (not display: none) so the virtual list keeps its measured size. */}
			<FileTree
				className={clsx("min-h-0 flex-1", note && "invisible")}
				model={model}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
				renderContextMenu={(item, context) => {
					const entry = entriesByPath.current.get(item.path);
					if (!entry) return <CloseNow close={context.close} />;
					// From the keyboard (Shift+F10) the anchor is the row; from the mouse, the pointer.
					const rect = context.anchorRect;
					const fromKeyboard = rect.width > 0;
					return (
						<Menu
							label={entry.name}
							sections={entryMenu(entry, commands)}
							x={fromKeyboard ? rect.left + 24 : rect.left}
							y={fromKeyboard ? rect.bottom : rect.top}
							focusFirst={fromKeyboard}
							onClose={() => context.close()}
						/>
					);
				}}
			/>
			{folderMenuAt && (
				<Menu
					label="Folder"
					sections={folderMenu(currentUri, commands)}
					x={folderMenuAt.x}
					y={folderMenuAt.y}
					onClose={() => setFolderMenuAt(null)}
				/>
			)}
		</div>
	);
}

/** Tells the tree its menu is closed at once: for rows without one, like `..`. */
function CloseNow({ close }: { close: () => void }) {
	useEffect(() => close(), [close]);
	return null;
}
