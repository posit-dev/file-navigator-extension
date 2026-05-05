import { useState, useEffect, useCallback, useRef, useMemo } from "react";

import { Breadcrumb } from "./Breadcrumb";
import { DirectoryView } from "./DirectoryView";
import { FilterInput } from "./FilterInput";
import type { DirectoryEntry, SortColumn, SortDirection } from "./types";

type BreadcrumbSegment = {
	label: string;
	uri: string;
};

declare function acquireVsCodeApi(): {
	postMessage(msg: unknown): void;
	getState(): unknown;
	setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

function compareEntries(a: DirectoryEntry, b: DirectoryEntry, column: SortColumn, direction: SortDirection): number {
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

function sortEntries(entries: DirectoryEntry[], column: SortColumn, direction: SortDirection): DirectoryEntry[] {
	return [...entries].sort((a, b) => {
		if (a.kind === "directory" && b.kind !== "directory") return -1;
		if (a.kind !== "directory" && b.kind === "directory") return 1;
		return compareEntries(a, b, column, direction);
	});
}

export function App() {
	const [currentUri, setCurrentUri] = useState<string>("");
	const [entries, setEntries] = useState<DirectoryEntry[]>([]);
	const [parentUri, setParentUri] = useState<string | null>(null);
	const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([]);
	const [filter, setFilter] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [sortColumn, setSortColumn] = useState<SortColumn>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const requestIdRef = useRef(0);

	const readDirectory = useCallback((uri: string) => {
		const id = ++requestIdRef.current;
		setLoading(true);
		setError(null);
		vscode.postMessage({ type: "readDirectory", requestId: id, uri });
	}, []);

	const navigate = useCallback(
		(uri: string) => {
			setFilter("");
			readDirectory(uri);
		},
		[readDirectory],
	);

	const openFile = useCallback((uri: string) => {
		vscode.postMessage({ type: "openFile", uri });
	}, []);

	const refresh = useCallback(() => {
		if (currentUri) {
			readDirectory(currentUri);
		}
	}, [currentUri, readDirectory]);

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
					navigate(msg.uri);
					break;
				case "directoryContents":
					if (msg.requestId !== requestIdRef.current) return;
					setCurrentUri(msg.uri);
					setEntries(msg.entries);
					setParentUri(msg.parentUri);
					setBreadcrumbs(msg.breadcrumbs);
					setError(null);
					setLoading(false);
					break;
				case "directoryError":
					if (msg.requestId !== requestIdRef.current) return;
					setError(msg.error);
					setLoading(false);
					break;
				case "directoryChanged":
					if (msg.uri === currentUri) {
						readDirectory(currentUri);
					}
					break;
			}
		};

		window.addEventListener("message", handler);
		vscode.postMessage({ type: "getInitialDirectory" });

		return () => window.removeEventListener("message", handler);
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	const sortedFilteredEntries = useMemo(() => {
		const filtered = filter
			? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
			: entries;
		return sortEntries(filtered, sortColumn, sortDirection);
	}, [entries, filter, sortColumn, sortDirection]);

	return (
		<div className="flex h-screen flex-col py-1">
			<FilterInput value={filter} onChange={setFilter} />
			<Breadcrumb segments={breadcrumbs} onNavigate={navigate} />
			{error && <div className="px-2 py-1 text-[0.9em] text-error-foreground">{error}</div>}
			<DirectoryView
				entries={sortedFilteredEntries}
				parentUri={parentUri}
				loading={loading}
				sortColumn={sortColumn}
				sortDirection={sortDirection}
				onSort={handleSort}
				onNavigate={navigate}
				onOpenFile={openFile}
				onRefresh={refresh}
			/>
		</div>
	);
}
