import { type FileTreeRowDecoration, preparePresortedFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useCallback, useEffect, useRef } from "react";

import { layoutTree } from "./treeLayout";
import type { DirectoryEntry, SortColumn, SortDirection, ViewMode } from "./types";

const NO_CHILDREN: ReadonlyMap<string, DirectoryEntry[]> = new Map();

/** The list's first row when the directory has a parent; activating it goes up. */
const PARENT_PATH = "..";

// The parent row's icon: Lucide's corner-left-up, as a symbol the tree can use.
const SPRITE = `<svg aria-hidden="true" width="0" height="0">
<symbol id="fn-parent" viewBox="0 0 24 24">
<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M14 9 9 4 4 9M20 20h-7a4 4 0 0 1-4-4V4"/>
</symbol>
</svg>`;

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
	onNavigate: (uri: string) => void;
	onNavigateUp: () => void;
	onOpenFile: (uri: string) => void;
};

const ROW_HEIGHT = 22;

// Rules the tree's CSS variables cannot express; they go into its shadow root above its own CSS.
// The decoration lane holds the Size and Modified columns: one span per part, each a fixed
// width, so they line up down the list and with the header (`.file-list-header`). The name
// takes the remaining space and truncates instead of squeezing the columns.
const UNSAFE_CSS = `
[data-type="item"] {
	-webkit-user-select: none;
	user-select: none;
}
[data-item-section="content"] {
	flex: 1 1 0;
}
[data-item-section="decoration"] {
	flex: none;
	font-size: 0.85em;
}
[data-item-section="decoration"] > span > span {
	width: var(--fn-column-width);
	text-align: end;
	font-variant-numeric: tabular-nums;
	overflow: hidden;
	text-overflow: ellipsis;
}
`;

function formatSize(bytes: number | null): string {
	if (bytes === null) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(mtime: number | null): string {
	if (mtime === null) return "";
	const date = new Date(mtime);
	const now = new Date();
	const sameYear = date.getFullYear() === now.getFullYear();
	if (sameYear) {
		return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
	}
	return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function decorationFor(entry: DirectoryEntry): FileTreeRowDecoration {
	const size = entry.kind === "directory" ? "" : formatSize(entry.size);
	const modified = formatDate(entry.mtime);
	const details = [
		entry.isSymbolicLink ? "Symbolic link" : null,
		entry.kind !== "directory" && entry.size !== null
			? `${entry.size.toLocaleString()} bytes`
			: null,
		entry.mtime !== null ? `Modified ${new Date(entry.mtime).toLocaleString()}` : null,
	].filter((detail) => detail !== null);
	return {
		text: `${size} ${modified}`.trim(),
		title: details.length > 0 ? details.join("\n") : undefined,
		parts: [{ text: size }, { text: modified }],
	};
}

/** The tree path of the row an event came from, if any. */
function eventRowPath(event: { nativeEvent: Event }): string | undefined {
	for (const target of event.nativeEvent.composedPath()) {
		if (target instanceof HTMLElement && target.dataset.type === "item") {
			return target.dataset.itemPath;
		}
	}
	return undefined;
}

/** Focuses the tree's focused row (its roving tab stop), else its first row. */
function focusTreeRow(model: { getFileTreeContainer(): HTMLElement | undefined }): void {
	const root = model.getFileTreeContainer()?.shadowRoot;
	const row =
		root?.querySelector<HTMLElement>("[data-type='item'][tabindex='0']") ??
		root?.querySelector<HTMLElement>("[data-type='item']");
	row?.focus();
}

function SortIndicator({
	column,
	sortColumn,
	sortDirection,
}: {
	column: SortColumn;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
}) {
	if (column !== sortColumn) return null;
	return sortDirection === "asc" ? (
		<ArrowUp className="size-3 shrink-0" />
	) : (
		<ArrowDown className="size-3 shrink-0" />
	);
}

function ColumnHeader({
	sortColumn,
	sortDirection,
	onSort,
}: {
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
}) {
	const buttonClass = "flex items-center gap-0.5 cursor-pointer select-none hover:text-foreground";
	const indicator = { sortColumn, sortDirection };
	return (
		<div className="file-list-header flex h-[22px] shrink-0 items-center border-b border-border text-[0.85em] text-muted-foreground">
			<button className={clsx(buttonClass, "min-w-0 flex-1")} onClick={() => onSort("name")}>
				Name
				<SortIndicator column="name" {...indicator} />
			</button>
			<button
				className={clsx(buttonClass, "w-(--fn-column-width) justify-end")}
				onClick={() => onSort("size")}
			>
				Size
				<SortIndicator column="size" {...indicator} />
			</button>
			<button
				className={clsx(buttonClass, "w-(--fn-column-width) justify-end")}
				onClick={() => onSort("mtime")}
			>
				Modified
				<SortIndicator column="mtime" {...indicator} />
			</button>
		</div>
	);
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
	onNavigate,
	onNavigateUp,
	onOpenFile,
}: DirectoryViewProps) {
	// The entries by tree path, read by the decoration renderer (the tree's options are fixed
	// when the model is created, so it reads the current entries through this ref).
	const entriesByPath = useRef(new Map<string, DirectoryEntry>());

	const { model } = useFileTree({
		paths: [],
		itemHeight: ROW_HEIGHT,
		icons: {
			set: "complete",
			colored: true,
			spriteSheet: SPRITE,
			byFileName: { [PARENT_PATH]: "fn-parent" },
		},
		fileTreeSearchMode: "hide-non-matches",
		unsafeCSS: UNSAFE_CSS,
		renderRowDecoration: ({ item }) => {
			const entry = entriesByPath.current.get(item.path);
			return entry ? decorationFor(entry) : null;
		},
	});

	const listRef = useRef<HTMLDivElement>(null);
	const shownUri = useRef<string | null>(null);
	const modeRef = useRef(mode);
	modeRef.current = mode;
	const filterRef = useRef(filter);
	filterRef.current = filter;
	const onExpandedChangeRef = useRef(onExpandedChange);
	onExpandedChangeRef.current = onExpandedChange;

	// Which folders are expanded, by URI, so it survives the tree being rebuilt with different
	// paths (a new root). Folders outside the current root keep their state for when they return.
	const expandedUris = useRef(new Set<string>());
	const resetting = useRef(false);
	const reported = useRef<string | null>(null);

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
			}),
		[model, syncExpanded],
	);

	// Rebuilds the rows. Expanded folders stay expanded; after moving the root up, the folder
	// just left is expanded too, so it shows where you came from. If the list had keyboard focus,
	// it keeps it: on the same entry if it is still shown, else on the directory just left, else
	// on the first row; an empty directory focuses the list itself, so Backspace still works.
	useEffect(() => {
		const active = document.activeElement;
		const hadFocus =
			active !== null && (active === model.getFileTreeContainer() || active === listRef.current);
		const focusedPath = model.getFocusedPath();
		const focusedUri =
			focusedPath === null ? undefined : entriesByPath.current.get(focusedPath)?.uri;

		const tree = mode === "tree";
		const previousUri = shownUri.current;
		shownUri.current = currentUri;
		if (tree && previousUri !== null && previousUri !== currentUri) {
			expandedUris.current.add(previousUri);
		}

		const layout = layoutTree(
			entries,
			tree ? loadedFolders : NO_CHILDREN,
			sortColumn,
			sortDirection,
		);
		entriesByPath.current = layout.byPath;
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
		syncExpanded,
	]);

	useEffect(() => {
		model.setSearch(filter.trim() === "" ? null : filter);
	}, [model, filter]);

	// A file opens on click, and `..` goes up. A folder in the list opens on click; in the tree a
	// click expands or collapses it (the tree does that itself) and a double-click makes it the
	// root.
	const onClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const path = eventRowPath(event);
			if (path === PARENT_PATH) {
				onNavigateUp();
				return;
			}
			const entry = path === undefined ? undefined : entriesByPath.current.get(path);
			if (!entry) return;
			if (entry.kind !== "directory") onOpenFile(entry.uri);
			else if (modeRef.current === "flat") onNavigate(entry.uri);
		},
		[onNavigate, onNavigateUp, onOpenFile],
	);

	const onDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const path = eventRowPath(event);
			const entry = path === undefined ? undefined : entriesByPath.current.get(path);
			if (entry?.kind === "directory" && modeRef.current === "tree") onNavigate(entry.uri);
		},
		[onNavigate],
	);

	// Rows are buttons, so Enter (and Space) on a row arrives as a click; only Backspace needs a
	// key handler. It sits on the list, not the tree, so it works in an empty directory too.
	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLElement>) => {
			if (event.key !== "Backspace") return;
			event.preventDefault();
			onNavigateUp();
		},
		[onNavigateUp],
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
			className="file-list flex min-h-0 flex-1 flex-col outline-none"
			ref={listRef}
			tabIndex={-1}
			onKeyDown={onKeyDown}
		>
			<ColumnHeader sortColumn={sortColumn} sortDirection={sortDirection} onSort={onSort} />
			{note && <div className="p-2 text-center text-muted-foreground">{note}</div>}
			{/* Kept laid out (not display: none) so the virtual list keeps its measured size. */}
			<FileTree
				className={clsx("min-h-0 flex-1", note && "invisible")}
				model={model}
				onClick={onClick}
				onDoubleClick={onDoubleClick}
			/>
		</div>
	);
}
