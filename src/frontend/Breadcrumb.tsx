// The path bar: the current folder as a title, with the path to it dimmed in front: from `~` when
// under the home folder, else from `/`. When that doesn't fit, just the parent; then nothing.
// Clicking the title lists every ancestor in a menu, like a Finder window title.
import { ChevronDown } from "lucide-react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";

import { useElementWidth } from "./columns";
import { Menu } from "./Menu";
import type { BreadcrumbSegment } from "./types";

type BreadcrumbProps = {
	/** From the root down to the current folder. */
	segments: BreadcrumbSegment[];
	onNavigate: (uri: string) => void;
};

/** Horizontal padding of the bar (px-1 on each side). */
const BAR_PADDING = 8;

export function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
	const [menu, setMenu] = useState<{ x: number; y: number; fromKeyboard: boolean } | null>(null);
	const n = segments.length;
	const current = segments.at(-1);
	const root = segments[0];

	// The dimmed paths to try, longest first: from home (or the root), then just the parent.
	const home = segments.findIndex((s) => s.isHome);
	const start = home >= 0 && home < n - 1 ? home : 0;
	const candidates: BreadcrumbSegment[][] = [];
	if (n > 1) {
		candidates.push(segments.slice(start, n - 1));
		if (n - 1 - start > 1) candidates.push(segments.slice(n - 2, n - 1));
	}

	// Natural widths of each candidate with the title, measured off-screen.
	const boxRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const titleRef = useRef<HTMLButtonElement>(null);
	const width = useElementWidth(boxRef);
	const [needed, setNeeded] = useState<number[]>([]);
	const labels = segments.map((s) => s.label).join("\n");
	useLayoutEffect(() => {
		const rows = [...(measureRef.current?.children ?? [])];
		setNeeded(rows.map((row) => row.getBoundingClientRect().width));
	}, [labels]);
	const ancestors =
		candidates.find((_, i) => needed[i] !== undefined && needed[i] <= width - BAR_PADDING) ?? [];

	return (
		<div ref={boxRef} className="relative flex min-w-0 flex-1 items-center px-1 py-1 text-[0.9em]">
			<div
				ref={measureRef}
				aria-hidden
				className="pointer-events-none invisible absolute flex flex-col"
			>
				{candidates.map((c) => (
					<div key={c.length} className="flex w-max items-center whitespace-nowrap">
						<Ancestors segments={c} root={root} onNavigate={onNavigate} />
						<span className="flex items-center gap-0.5 px-1 font-semibold">
							{current?.label}
							<ChevronDown className="size-3" />
						</span>
					</div>
				))}
			</div>
			{ancestors.length > 0 && (
				<Ancestors segments={ancestors} root={root} onNavigate={onNavigate} />
			)}
			{current && (
				<button
					ref={titleRef}
					className="flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm border-none bg-transparent px-1 py-0.5 font-[family-name:inherit] text-[length:inherit] font-semibold text-foreground hover:bg-accent"
					aria-haspopup="menu"
					aria-expanded={menu !== null}
					title="Show parent folders"
					onClick={(e) => {
						const r = e.currentTarget.getBoundingClientRect();
						// A click from Enter or Space has no pointer position (detail 0).
						setMenu({ x: r.left, y: r.bottom + 2, fromKeyboard: e.detail === 0 });
					}}
				>
					<span className="truncate">{current.label}</span>
					<ChevronDown className="size-3 shrink-0 text-muted-foreground" />
				</button>
			)}
			{menu && (
				<Menu
					label="Parent folders"
					x={menu.x}
					y={menu.y}
					focusFirst={menu.fromKeyboard}
					sections={[
						[...segments].reverse().map((s) => ({
							id: s.uri,
							label: s.label,
							checked: s === current,
							onSelect: () => onNavigate(s.uri),
						})),
					]}
					onClose={() => {
						setMenu(null);
						titleRef.current?.focus({ preventScroll: true });
					}}
				/>
			)}
		</div>
	);
}

/** Dimmed, clickable folders joined by `/`, ending in a spaced `/` before the title. */
function Ancestors({
	segments,
	root,
	onNavigate,
}: {
	segments: BreadcrumbSegment[];
	/** Its label is already `/`, so no separator follows it. */
	root: BreadcrumbSegment | undefined;
	onNavigate: (uri: string) => void;
}) {
	return (
		<div className="flex shrink-0 items-center whitespace-nowrap text-muted-foreground">
			{segments.map((s, i) => (
				<Fragment key={s.uri}>
					<button
						className="cursor-pointer rounded-sm border-none bg-transparent px-0.5 py-0.5 font-[family-name:inherit] text-[length:inherit] text-inherit hover:bg-accent hover:text-foreground"
						onClick={() => onNavigate(s.uri)}
						title={`Go to ${s.label}`}
					>
						{s.label}
					</button>
					{s !== root && (
						<span className={i < segments.length - 1 ? "opacity-60" : "ml-0.5 opacity-60"}>/</span>
					)}
				</Fragment>
			))}
		</div>
	);
}
