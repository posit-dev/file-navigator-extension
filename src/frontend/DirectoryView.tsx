import { useState, useCallback, useRef, useEffect } from "react";

type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
};

type DirectoryViewProps = {
	entries: DirectoryEntry[];
	parentUri: string | null;
	loading: boolean;
	onNavigate: (uri: string) => void;
	onOpenFile: (uri: string) => void;
	onRefresh: () => void;
};

type ListItem =
	| { type: "parent"; uri: string }
	| { type: "entry"; entry: DirectoryEntry };

export function DirectoryView({
	entries,
	parentUri,
	loading,
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
		return <div className="loading">Loading...</div>;
	}

	return (
		<div
			className="directory-view"
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			<div className="toolbar">
				<button className="refresh-button" onClick={onRefresh} title="Refresh">
					↻
				</button>
			</div>
			{items.length === 0 ? (
				<div className="empty">Empty directory</div>
			) : (
				<div className="file-list">
					{items.map((item, index) => {
						if (item.type === "parent") {
							return (
								<div
									key=".."
									className={`file-item directory ${index === selectedIndex ? "selected" : ""}`}
									data-index={index}
									onClick={() => activateItem(item)}
								>
									<span className="icon">📁</span>
									<span className="name">..</span>
								</div>
							);
						}
						const { entry } = item;
						const isDir = entry.kind === "directory";
						return (
							<div
								key={entry.name}
								className={`file-item ${isDir ? "directory" : "file"} ${index === selectedIndex ? "selected" : ""}`}
								data-index={index}
								onClick={() => activateItem(item)}
							>
								<span className="icon">
									{isDir ? "📁" : "📄"}
									{entry.isSymbolicLink && <span className="symlink-badge">↗</span>}
								</span>
								<span className="name">{entry.name}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
