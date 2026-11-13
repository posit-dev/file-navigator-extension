import { CornerLeftUp, Ellipsis, House, RefreshCw } from "lucide-react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

import type { FileAction } from "../protocol";
import { Breadcrumb } from "./Breadcrumb";
import { type ColumnSettings, columnMenuItems, parseColumnSettings } from "./columns";
import { viewMenu } from "./contextMenus";
import { DirectoryView, type DirectoryViewHandle, type FileActions } from "./DirectoryView";
import { FilterInput } from "./FilterInput";
import { Menu } from "./Menu";
import { ToolbarButton } from "./ToolbarButton";
import type {
	BreadcrumbSegment,
	DirectoryEntry,
	SortColumn,
	SortDirection,
	ViewMode,
} from "./types";
import { ViewModeToggle } from "./ViewModeToggle";

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

/** The view mode, column settings, and view options saved in the webview state, else the defaults. */
function savedState(): {
	mode: ViewMode;
	columns: ColumnSettings;
	foldersFirst: boolean;
	showHidden: boolean;
} {
	const state = vscode.getState();
	const saved =
		typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
	return {
		mode: saved.mode === "tree" ? "tree" : "flat",
		columns: parseColumnSettings(saved.columns),
		foldersFirst: typeof saved.foldersFirst === "boolean" ? saved.foldersFirst : true,
		showHidden: typeof saved.showHidden === "boolean" ? saved.showHidden : true,
	};
}

export function App() {
	const [saved] = useState(savedState);
	const [mode, setMode] = useState<ViewMode>(saved.mode);
	const [columns, setColumns] = useState<ColumnSettings>(saved.columns);
	const [foldersFirst, setFoldersFirst] = useState<boolean>(saved.foldersFirst);
	const [showHidden, setShowHidden] = useState<boolean>(saved.showHidden);
	// Where the view starts and the Home button goes: the workspace folder, else the home directory.
	const [home, setHome] = useState<{ uri: string; isWorkspace: boolean } | null>(null);
	const [currentUri, setCurrentUri] = useState<string>("");
	const [entries, setEntries] = useState<DirectoryEntry[]>([]);
	// Contents of folders loaded in the tree, by URI. Kept across root changes: moving the root
	// up shows the old root (and whatever was loaded under it) as an expanded folder.
	const [loadedFolders, setLoadedFolders] = useState<ReadonlyMap<string, DirectoryEntry[]>>(
		new Map(),
	);
	const [parentUri, setParentUri] = useState<string | null>(null);
	const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([]);
	const [filter, setFilter] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	// The "…" menu's position, and the button to give focus back to when it closes.
	const [menu, setMenu] = useState<{ x: number; y: number; fromKeyboard: boolean } | null>(null);
	const menuButtonRef = useRef<HTMLButtonElement | null>(null);
	const directoryViewRef = useRef<DirectoryViewHandle>(null);
	const requestIdRef = useRef(0);
	const currentUriRef = useRef(currentUri);
	currentUriRef.current = currentUri;
	const entriesRef = useRef(entries);
	entriesRef.current = entries;
	const loadedFoldersRef = useRef(loadedFolders);
	loadedFoldersRef.current = loadedFolders;
	const expandedRef = useRef<ReadonlySet<string>>(new Set());

	useEffect(() => {
		vscode.setState({ mode, columns, foldersFirst, showHidden });
	}, [mode, columns, foldersFirst, showHidden]);

	const readDirectory = useCallback((uri: string) => {
		const id = ++requestIdRef.current;
		setLoading(true);
		setError(null);
		vscode.postMessage({ type: "readDirectory", requestId: id, uri });
	}, []);

	const loadChildren = useCallback((uri: string) => {
		vscode.postMessage({ type: "readChildren", uri });
	}, []);

	const navigate = useCallback(
		(uri: string) => {
			setFilter("");
			readDirectory(uri);
		},
		[readDirectory],
	);

	const navigateUp = useCallback(() => {
		if (parentUri) navigate(parentUri);
	}, [parentUri, navigate]);

	const refresh = useCallback(() => {
		if (currentUri) {
			readDirectory(currentUri);
		}
		for (const uri of expandedRef.current) loadChildren(uri);
	}, [currentUri, readDirectory, loadChildren]);

	// What the list asks of the backend. Created, renamed, duplicated, and deleted entries show up
	// when the backend then reports their folder changed.
	const actions: FileActions = useMemo(
		() => ({
			open: (uri, toSide) => vscode.postMessage({ type: "openFile", uri, toSide: toSide === true }),
			rename: (uri, newName) => vscode.postMessage({ type: "rename", uri, newName }),
			create: (parentUri, name, kind) =>
				vscode.postMessage({ type: "create", parentUri, name, kind }),
			run: (action: FileAction, uri) => vscode.postMessage({ type: "fileAction", action, uri }),
			refresh,
		}),
		[refresh],
	);

	// Loads each folder the tree newly expanded (again, if it was loaded before: it may have
	// changed while collapsed and unwatched), and watches the expanded ones.
	const handleExpandedChange = useCallback(
		(uris: ReadonlySet<string>) => {
			for (const uri of uris) if (!expandedRef.current.has(uri)) loadChildren(uri);
			expandedRef.current = uris;
			vscode.postMessage({ type: "watchDirectories", uris: [...uris] });
		},
		[loadChildren],
	);

	const handleSort = useCallback((column: SortColumn) => {
		setSortColumn((prev) => {
			if (prev === column) {
				setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
			} else {
				setSortDirection(column === "name" ? "asc" : "desc");
			}
			return column;
		});
	}, []);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data;
			switch (msg.type) {
				case "initialDirectory":
					setHome({ uri: msg.uri, isWorkspace: msg.isWorkspace });
					navigate(msg.uri);
					break;
				case "directoryContents": {
					if (msg.requestId !== requestIdRef.current) return;
					const previousUri = currentUriRef.current;
					if (previousUri !== "" && previousUri !== msg.uri) {
						const previousEntries = entriesRef.current;
						setLoadedFolders((prev) => new Map(prev).set(previousUri, previousEntries));
					}
					setCurrentUri(msg.uri);
					setEntries(msg.entries);
					setParentUri(msg.parentUri);
					setBreadcrumbs(msg.breadcrumbs);
					setError(null);
					setLoading(false);
					break;
				}
				case "directoryError":
					if (msg.requestId !== requestIdRef.current) return;
					setError(msg.error);
					setLoading(false);
					break;
				case "childrenContents":
					setLoadedFolders((prev) => new Map(prev).set(msg.uri, msg.entries));
					break;
				case "childrenError":
					setLoadedFolders((prev) => new Map(prev).set(msg.uri, []));
					setError(`Could not read folder: ${msg.error}`);
					break;
				case "directoryChanged":
					if (msg.uri === currentUriRef.current) {
						readDirectory(currentUriRef.current);
					} else if (loadedFoldersRef.current.has(msg.uri)) {
						loadChildren(msg.uri);
					}
					break;
			}
		};

		window.addEventListener("message", handler);
		vscode.postMessage({ type: "getInitialDirectory" });

		return () => window.removeEventListener("message", handler);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className="flex h-screen flex-col py-1">
			<FilterInput value={filter} onChange={setFilter} />
			<div className="flex items-center gap-0.5 border-b border-border px-1">
				<ToolbarButton
					label={mode === "tree" ? "Move root up to parent folder" : "Up to parent folder"}
					onClick={navigateUp}
					disabled={!parentUri}
				>
					<CornerLeftUp className="size-3.5" />
				</ToolbarButton>
				<ToolbarButton
					label={home?.isWorkspace === false ? "Go to home folder" : "Go to workspace folder"}
					onClick={() => home && navigate(home.uri)}
					disabled={!home || home.uri === currentUri}
				>
					<House className="size-3.5" />
				</ToolbarButton>
				<Breadcrumb segments={breadcrumbs} onNavigate={navigate} />
				<ViewModeToggle mode={mode} onChange={setMode} />
				<ToolbarButton label="Refresh" onClick={refresh}>
					<RefreshCw className="size-3" />
				</ToolbarButton>
				<ToolbarButton
					label="More Actions…"
					onClick={(e) => {
						const button = e.currentTarget;
						menuButtonRef.current = button;
						const r = button.getBoundingClientRect();
						// A click from Enter or Space has no pointer position (detail 0).
						setMenu({ x: r.left, y: r.bottom + 2, fromKeyboard: e.detail === 0 });
					}}
				>
					<Ellipsis className="size-3.5" />
				</ToolbarButton>
			</div>
			{error && <div className="px-2 py-1 text-[0.9em] text-error-foreground">{error}</div>}
			<DirectoryView
				ref={directoryViewRef}
				mode={mode}
				currentUri={currentUri}
				hasParent={parentUri !== null}
				entries={entries}
				loadedFolders={loadedFolders}
				onExpandedChange={handleExpandedChange}
				filter={filter}
				loading={loading}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSort={handleSort}
				columns={columns}
				onColumnsChange={setColumns}
				foldersFirst={foldersFirst}
				showHidden={showHidden}
				onNavigate={navigate}
				onNavigateUp={navigateUp}
				actions={actions}
			/>
			{menu && (
				<Menu
					label="View options"
					x={menu.x}
					y={menu.y}
					focusFirst={menu.fromKeyboard}
					sections={viewMenu({
						mode,
						onModeChange: setMode,
						columnItems: columnMenuItems(columns, setColumns),
						foldersFirst,
						onFoldersFirstChange: setFoldersFirst,
						showHidden,
						onShowHiddenChange: setShowHidden,
						collapseAll: () => directoryViewRef.current?.collapseAll(),
					})}
					onClose={() => {
						setMenu(null);
						menuButtonRef.current?.focus({ preventScroll: true });
					}}
				/>
			)}
		</div>
	);
}
