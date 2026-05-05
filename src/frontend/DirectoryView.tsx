import { clsx } from "clsx";
import { Folder, File, CornerUpLeft, RefreshCw, Link, ArrowUp, ArrowDown } from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";

import type { DirectoryEntry, SortColumn, SortDirection } from "./types";

type DirectoryViewProps = {
	entries: DirectoryEntry[];
	parentUri: string | null;
	loading: boolean;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
	onNavigate: (uri: string) => void;
	onOpenFile: (uri: string) => void;
	onRefresh: () => void;
};

type ListItem = { type: "parent"; uri: string } | { type: "entry"; entry: DirectoryEntry };

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

export function DirectoryView({
	entries,
	parentUri,
	loading,
	sortColumn,
	sortDirection,
	onSort,
	onNavigate,
	onOpenFile,
	onRefresh,
}: DirectoryViewProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const items: ListItem[] = [];
	if (parentUri) {
		items.push({ type: "parent", uri: parentUri });
	}
	for (const entry of entries) {
		items.push({ type: "entry", entry });
	}

	useEffect(() => {
		setSelectedIndex(0);
	}, [entries, parentUri]);

	const activateItem = useCallback(
		(item: ListItem) => {
			if (item.type === "parent") {
				onNavigate(item.uri);
			} else if (item.entry.kind === "directory") {
				onNavigate(item.entry.uri);
			} else {
				onOpenFile(item.entry.uri);
			}
		},
		[onNavigate, onOpenFile],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((i) => Math.max(0, i - 1));
					break;
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
					break;
				case "Enter": {
					e.preventDefault();
					const item = items[selectedIndex];
					if (item) activateItem(item);
					break;
				}
				case "Backspace":
					e.preventDefault();
					if (parentUri) onNavigate(parentUri);
					break;
			}
		},
		[items, selectedIndex, activateItem, parentUri, onNavigate],
	);

	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [selectedIndex]);

	if (loading && entries.length === 0) {
		return <div className="p-2 text-center text-muted-foreground">Loading...</div>;
	}

	const columnHeaderClass =
		"flex items-center gap-0.5 cursor-pointer select-none hover:text-foreground";

	return (
		<div
			className="flex-1 overflow-y-auto outline-none"
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			{/* Column headers + refresh */}
			<div className="sticky top-0 z-10 border-b border-border bg-background">
				<div className="flex h-[22px] items-center px-2 text-[0.85em] text-muted-foreground">
					<div className="flex min-w-0 flex-1 items-center gap-1.5">
						<span className="w-4 shrink-0" />
						<button className={columnHeaderClass} onClick={() => onSort("name")}>
							Name
							<SortIndicator column="name" sortColumn={sortColumn} sortDirection={sortDirection} />
						</button>
					</div>
					<button
						className={clsx(columnHeaderClass, "w-[5.5rem] justify-end")}
						onClick={() => onSort("size")}
					>
						Size
						<SortIndicator column="size" sortColumn={sortColumn} sortDirection={sortDirection} />
					</button>
					<button
						className={clsx(columnHeaderClass, "w-[5.5rem] justify-end")}
						onClick={() => onSort("mtime")}
					>
						Modified
						<SortIndicator column="mtime" sortColumn={sortColumn} sortDirection={sortDirection} />
					</button>
					<button
						className="ml-1 flex size-5 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent"
						onClick={onRefresh}
						title="Refresh"
					>
						<RefreshCw className="size-3" />
					</button>
				</div>
			</div>
			{items.length === 0 ? (
				<div className="p-2 text-center text-muted-foreground">Empty directory</div>
			) : (
				<div className="flex flex-col">
					{items.map((item, index) => {
						const selected = index === selectedIndex;
						if (item.type === "parent") {
							return (
								<div
									key=".."
									className={clsx(
										"flex items-center px-2 h-[22px] cursor-pointer select-none",
										selected ? "bg-selected text-selected-foreground" : "hover:bg-accent",
									)}
									data-index={index}
									onClick={() => activateItem(item)}
								>
									<div className="flex min-w-0 flex-1 items-center gap-1.5">
										<CornerUpLeft className="size-4 shrink-0" />
										<span className="truncate">..</span>
									</div>
								</div>
							);
						}
						const { entry } = item;
						const isDir = entry.kind === "directory";
						return (
							<div
								key={entry.name}
								className={clsx(
									"flex items-center px-2 h-[22px] cursor-pointer select-none",
									selected ? "bg-selected text-selected-foreground" : "hover:bg-accent",
								)}
								data-index={index}
								onClick={() => activateItem(item)}
							>
								<div className="flex min-w-0 flex-1 items-center gap-1.5">
									<span className="relative flex shrink-0 items-center">
										{isDir ? <Folder className="size-4" /> : <File className="size-4" />}
										{entry.isSymbolicLink && (
											<Link className="absolute -right-1 -bottom-0.5 size-2.5" />
										)}
									</span>
									<span className="truncate">{entry.name}</span>
								</div>
								<span className="w-[5.5rem] shrink-0 text-right text-[0.85em] text-muted-foreground">
									{isDir ? "" : formatSize(entry.size)}
								</span>
								<span className="w-[5.5rem] shrink-0 text-right text-[0.85em] text-muted-foreground">
									{formatDate(entry.mtime)}
								</span>
								{/* spacer matching refresh button width */}
								<span className="ml-1 w-5 shrink-0" />
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
