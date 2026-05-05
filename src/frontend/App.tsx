import { useState, useEffect, useCallback, useRef } from "react";

import { Breadcrumb } from "./Breadcrumb";
import { DirectoryView } from "./DirectoryView";
import { FilterInput } from "./FilterInput";

type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
};

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

export function App() {
	const [currentUri, setCurrentUri] = useState<string>("");
	const [entries, setEntries] = useState<DirectoryEntry[]>([]);
	const [parentUri, setParentUri] = useState<string | null>(null);
	const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbSegment[]>([]);
	const [filter, setFilter] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
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

	const filteredEntries = filter
		? entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()))
		: entries;

	return (
		<div className="flex h-screen flex-col py-1">
			<FilterInput value={filter} onChange={setFilter} />
			<Breadcrumb segments={breadcrumbs} onNavigate={navigate} />
			{error && <div className="px-2 py-1 text-[0.9em] text-error-foreground">{error}</div>}
			<DirectoryView
				entries={filteredEntries}
				parentUri={parentUri}
				loading={loading}
				onNavigate={navigate}
				onOpenFile={openFile}
				onRefresh={refresh}
			/>
		</div>
	);
}
