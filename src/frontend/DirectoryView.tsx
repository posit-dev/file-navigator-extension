import { useState, useCallback, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { Folder, File, CornerUpLeft, RefreshCw, Link } from "lucide-react";

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
		return <div className="p-2 text-center text-muted-foreground">Loading...</div>;
	}

	return (
		<div
			className="flex-1 overflow-y-auto outline-none"
			ref={listRef}
			tabIndex={0}
			onKeyDown={handleKeyDown}
		>
			<div className="flex justify-end px-1 py-0.5">
				<button
					className="flex items-center justify-center size-6 bg-transparent border-none text-icon-foreground cursor-pointer rounded-sm hover:bg-accent"
					onClick={onRefresh}
					title="Refresh"
				>
					<RefreshCw className="size-3.5" />
				</button>
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
										"flex items-center gap-1.5 px-2 h-[22px] cursor-pointer select-none",
										selected
											? "bg-selected text-selected-foreground"
											: "hover:bg-accent",
									)}
									data-index={index}
									onClick={() => activateItem(item)}
								>
									<CornerUpLeft className="size-4 shrink-0" />
									<span className="truncate">..</span>
								</div>
							);
						}
						const { entry } = item;
						const isDir = entry.kind === "directory";
						return (
							<div
								key={entry.name}
								className={clsx(
									"flex items-center gap-1.5 px-2 h-[22px] cursor-pointer select-none",
									selected
										? "bg-selected text-selected-foreground"
										: "hover:bg-accent",
								)}
								data-index={index}
								onClick={() => activateItem(item)}
							>
								<span className="relative shrink-0 flex items-center">
									{isDir ? (
										<Folder className="size-4" />
									) : (
										<File className="size-4" />
									)}
									{entry.isSymbolicLink && (
										<Link className="size-2.5 absolute -bottom-0.5 -right-1" />
									)}
								</span>
								<span className="truncate">{entry.name}</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
