// The Size and Modified columns: their layout (widths, what gives way when the panel narrows),
// the header with its resize handles and column menu, and how rows draw them. Rows are inside the
// tree's shadow DOM, so widths reach them as CSS variables set on the list.
import type { FileTreeRowDecoration } from "@pierre/trees";
import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	type RefObject,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { detailsTitle, isoParts, shortDate, shortDateSamples, sizeParts } from "./format";
import { Menu, type MenuItem, type MenuSection } from "./Menu";
import { ToolbarButton } from "./ToolbarButton";
import type { DirectoryEntry, SortColumn, SortDirection } from "./types";

/** Left of the name: list padding + row padding + icon + gap (as `.file-list-header`). */
const PAD_LEFT = 8 + 6 + 16 + 6;
/** Right of the last column: list padding + row padding. */
const PAD_RIGHT = 8 + 6;
/** Space before each column, inside its width. */
const COL_GAP = 14;
/** Between the date and the time. */
const TIME_GAP = 6;
/** Space before the size unit. */
const UNIT_GAP = 4;
/** Below this the name is too short to scan, so columns give way. */
const MIN_NAME = 120;
/** Dragging the Modified column within this of a format's natural width snaps to it. */
const SNAP = 8;

/** What the user chose: which columns, and their widths (null: natural width). */
export type ColumnSettings = {
	size: boolean;
	modified: boolean;
	time: boolean;
	sizeWidth: number | null;
	modifiedWidth: number | null;
};

export const DEFAULT_COLUMN_SETTINGS: ColumnSettings = {
	size: true,
	modified: true,
	time: true,
	sizeWidth: null,
	modifiedWidth: null,
};

/** Parses saved settings, falling back to the defaults for anything missing or malformed. */
export function parseColumnSettings(value: unknown): ColumnSettings {
	if (typeof value !== "object" || value === null) return DEFAULT_COLUMN_SETTINGS;
	const v = value as Record<string, unknown>;
	const bool = (x: unknown, d: boolean) => (typeof x === "boolean" ? x : d);
	const width = (x: unknown) => (typeof x === "number" && x > 0 ? x : null);
	const d = DEFAULT_COLUMN_SETTINGS;
	return {
		size: bool(v.size, d.size),
		modified: bool(v.modified, d.modified),
		time: bool(v.time, d.time),
		sizeWidth: width(v.sizeWidth),
		modifiedWidth: width(v.modifiedWidth),
	};
}

export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
	const [width, setWidth] = useState(0);
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		setWidth(el.getBoundingClientRect().width);
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}

type Metrics = { date: number; time: number; short: number; num: number; unit: number };

let cachedMetrics: Metrics | undefined;

/**
 * Widths of the column text at the rows' size (0.85em, tabular digits). They don't depend on the
 * panel, so they're measured once, on first use.
 */
function metrics(): Metrics {
	if (cachedMetrics) return cachedMetrics;
	const span = document.createElement("span");
	span.style.cssText =
		"position:absolute;visibility:hidden;white-space:pre;font-size:0.85em;font-variant-numeric:tabular-nums";
	document.body.append(span);
	const measure = (text: string) => {
		span.textContent = text;
		return Math.ceil(span.getBoundingClientRect().width);
	};
	cachedMetrics = {
		date: measure("0000-00-00"),
		time: measure("00:00"),
		short: Math.max(...shortDateSamples().map(measure)),
		num: measure("000.0"),
		unit: measure("KB"),
	};
	span.remove();
	return cachedMetrics;
}

/** Modified column width that shows the date and time. */
function modifiedFullWidth(m: Metrics): number {
	return COL_GAP + m.date + TIME_GAP + m.time;
}

/** The column menu's checkable items, shared by the header menu and the toolbar menu. */
export function columnMenuItems(
	settings: ColumnSettings,
	onChange: (settings: ColumnSettings) => void,
): MenuItem[] {
	const update = (patch: Partial<ColumnSettings>) => onChange({ ...settings, ...patch });
	return [
		{
			id: "size",
			label: "Size Column",
			checked: settings.size,
			onSelect: () => update({ size: !settings.size }),
		},
		{
			id: "modified",
			label: "Modified Column",
			checked: settings.modified,
			onSelect: () => update({ modified: !settings.modified }),
		},
		{
			id: "time",
			label: "Show Time",
			checked: settings.time,
			disabled: !settings.modified,
			// Turning the time on widens a column too narrow to show it.
			onSelect: () =>
				settings.time
					? update({ time: false })
					: update({
							time: true,
							modifiedWidth:
								settings.modifiedWidth === null
									? null
									: Math.max(settings.modifiedWidth, modifiedFullWidth(metrics())),
						}),
		},
	];
}

export type ColumnLayout = {
	sizeWidth: number;
	modifiedWidth: number;
	/** The columns hidden to make room for names (not those the user turned off). */
	autoHidden: ("size" | "modified")[];
	/** Resize bounds. */
	sizeMin: number;
	sizeMax: number;
	modifiedMin: number;
	modifiedMax: number;
	snapModified: (width: number) => number;
	/** For the list element: the rows read their column widths from these. */
	style: CSSProperties;
};

/**
 * Lays the columns out right to left, then, while the name would be narrower than it can be
 * scanned, gives way in order: first the time, then Size, then the ISO date (for a short one:
 * see `shortDate`), then Modified. The Modified format follows from its width: date + time if it
 * fits, else the ISO date if that fits, else the short date.
 */
export function useColumnLayout(width: number, settings: ColumnSettings): ColumnLayout {
	const m = metrics();
	const unitWidth = UNIT_GAP + m.unit + 2;
	const timeWidth = TIME_GAP + m.time;
	const modifiedFull = modifiedFullWidth(m);
	const modifiedDate = COL_GAP + m.date;
	const modifiedShort = COL_GAP + m.short;
	const sizeNatural = COL_GAP + m.num + unitWidth;

	const available = width - PAD_LEFT - PAD_RIGHT;
	let modifiedWidth = settings.modified
		? (settings.modifiedWidth ?? (settings.time ? modifiedFull : modifiedDate))
		: 0;
	let sizeWidth = settings.size ? (settings.sizeWidth ?? sizeNatural) : 0;
	const nameWidth = () => available - modifiedWidth - sizeWidth;
	const autoHidden: ("size" | "modified")[] = [];
	if (width > 0) {
		if (settings.time && modifiedWidth >= modifiedFull && nameWidth() < MIN_NAME) {
			modifiedWidth = Math.min(modifiedWidth, modifiedDate);
		}
		if (sizeWidth > 0 && nameWidth() < MIN_NAME) {
			sizeWidth = 0;
			autoHidden.push("size");
		}
		if (modifiedWidth > modifiedShort && nameWidth() < MIN_NAME) {
			modifiedWidth = modifiedShort;
		}
		if (modifiedWidth > 0 && nameWidth() < MIN_NAME) {
			modifiedWidth = 0;
			autoHidden.push("modified");
		}
	}
	const timeShown = settings.time && modifiedWidth >= modifiedFull;
	const isoShown = modifiedWidth >= modifiedDate;
	const slack = Math.max(0, nameWidth() - MIN_NAME);

	return {
		sizeWidth,
		modifiedWidth,
		autoHidden,
		sizeMin: sizeNatural - COL_GAP + 6,
		sizeMax: sizeWidth + slack,
		modifiedMin: modifiedShort - COL_GAP + 6,
		modifiedMax: modifiedWidth + slack,
		snapModified: (w) =>
			[modifiedFull, modifiedDate, modifiedShort].find((s) => Math.abs(w - s) <= SNAP) ?? w,
		style: {
			"--fn-num-width": `${Math.max(0, sizeWidth - unitWidth)}px`,
			"--fn-unit-width": `${unitWidth}px`,
			"--fn-size-display": sizeWidth > 0 ? "inline-block" : "none",
			"--fn-date-width": `${timeShown ? modifiedWidth - timeWidth : modifiedWidth}px`,
			"--fn-time-width": `${timeWidth}px`,
			"--fn-date-display": isoShown ? "inline-block" : "none",
			"--fn-time-display": timeShown ? "inline-block" : "none",
			"--fn-short-display": modifiedWidth > 0 && !isoShown ? "inline-block" : "none",
		} as CSSProperties,
	};
}

// Rows draw the columns as five decoration parts (size number, unit, ISO date, time, short date),
// each a fixed width from the variables above, so they line up with each other and with the
// header. A display variable of `none` hides a part; the short date takes the ISO date's width
// when it's shown instead. All parts use the tree's subtly muted foreground at full opacity.
export const COLUMN_ROW_CSS = `
[data-type="item"] { -webkit-user-select: none; user-select: none; }
[data-item-section="content"] { flex: 1 1 0; }
[data-item-section="decoration"] { flex: none; font-size: 0.85em; }
[data-item-section="decoration"] > span { overflow: visible; max-width: none; }
[data-item-section="decoration"] > span > span {
	display: inline-block; box-sizing: border-box; white-space: nowrap; overflow: hidden;
	font-variant-numeric: tabular-nums;
}
[data-item-section="decoration"] > span > span:nth-child(1) {
	width: var(--fn-num-width); text-align: end; display: var(--fn-size-display, inline-block);
}
[data-item-section="decoration"] > span > span:nth-child(2) {
	width: var(--fn-unit-width); padding-left: ${UNIT_GAP}px; text-align: start;
	display: var(--fn-size-display, inline-block);
}
[data-item-section="decoration"] > span > span:nth-child(3) {
	width: var(--fn-date-width); text-align: end; display: var(--fn-date-display, inline-block);
}
[data-item-section="decoration"] > span > span:nth-child(4) {
	width: var(--fn-time-width); text-align: end;
	display: var(--fn-time-display, inline-block);
}
[data-item-section="decoration"] > span > span:nth-child(5) {
	width: var(--fn-date-width); text-align: end; display: var(--fn-short-display, none);
}
`;

export function columnDecoration(entry: DirectoryEntry): FileTreeRowDecoration {
	const size = entry.kind === "directory" ? null : sizeParts(entry.size);
	const modified = entry.mtime === null ? null : isoParts(entry.mtime);
	return {
		text: "",
		title: detailsTitle(entry),
		parts: [
			{ text: size?.num ?? "" },
			{ text: size?.unit ?? "" },
			{ text: modified?.date ?? "" },
			{ text: modified?.time ?? "" },
			{ text: entry.mtime === null ? "" : shortDate(entry.mtime) },
		],
	};
}

type HandleProps = {
	label: string;
	width: number;
	min: number;
	max: number;
	onChange: (width: number) => void;
	onReset: () => void;
	onDragging: (dragging: boolean) => void;
};

/**
 * A column's left divider. Columns are anchored right (the name takes what's left), so dragging
 * left widens the column. Double-click resets; arrow keys step by 8px when focused.
 */
function ResizeHandle({ label, width, min, max, onChange, onReset, onDragging }: HandleProps) {
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [dragging, setDragging] = useState(false);
	const clamp = (w: number) => Math.round(Math.max(min, Math.min(Math.max(min, max), w)));
	const end = () => {
		if (!drag.current) return;
		drag.current = null;
		setDragging(false);
		onDragging(false);
	};
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label={`Resize ${label} column`}
			aria-valuenow={Math.round(width)}
			tabIndex={0}
			data-dragging={dragging || undefined}
			className="fn-column-handle absolute top-0 -left-[4px] z-10 flex h-full w-[9px] cursor-col-resize justify-center outline-none"
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = { x: e.clientX, width };
				setDragging(true);
				onDragging(true);
			}}
			onPointerMove={(e) => {
				if (drag.current) onChange(clamp(drag.current.width - (e.clientX - drag.current.x)));
			}}
			onPointerUp={end}
			onLostPointerCapture={end}
			onDoubleClick={onReset}
			onKeyDown={(e) => {
				if (e.key === "ArrowLeft") onChange(clamp(width + 8));
				else if (e.key === "ArrowRight") onChange(clamp(width - 8));
				else if (e.key === "Home" || e.key === "Enter") onReset();
				else return;
				e.preventDefault();
				e.stopPropagation();
			}}
		>
			<span className="block h-full w-px" />
		</div>
	);
}

type CellProps = {
	column: SortColumn;
	label: string;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
	/** For a metadata column; the name column takes the remaining space. */
	width?: number;
	children?: ReactNode;
};

function HeaderCell({
	column,
	label,
	sortColumn,
	sortDirection,
	onSort,
	width,
	children,
}: CellProps) {
	const sorted = sortColumn === column;
	return (
		<div
			className={clsx(
				"relative flex h-full items-center",
				width === undefined ? "min-w-0 flex-1" : "shrink-0 justify-end",
			)}
			style={width === undefined ? undefined : { width }}
		>
			{children}
			<button
				className={clsx(
					"flex h-full min-w-0 cursor-pointer items-center gap-0.5 border-none bg-transparent p-0 font-[family-name:inherit] text-[length:inherit] whitespace-nowrap text-inherit select-none hover:text-foreground",
					sorted && "text-foreground",
				)}
				onClick={() => onSort(column)}
			>
				<span className="truncate">{label}</span>
				{sorted &&
					(sortDirection === "asc" ? (
						<ArrowUp className="size-3 shrink-0" />
					) : (
						<ArrowDown className="size-3 shrink-0" />
					))}
			</button>
		</div>
	);
}

type ColumnHeaderProps = {
	layout: ColumnLayout;
	settings: ColumnSettings;
	onSettingsChange: (settings: ColumnSettings) => void;
	sortColumn: SortColumn;
	sortDirection: SortDirection;
	onSort: (column: SortColumn) => void;
};

/**
 * The header: sortable labels, resize handles, a column menu on right-click, and, when columns are
 * hidden to make room for names, a button that says so and opens that menu. While a column is
 * dragged, a guide line runs down the list at its edge (the list must be positioned).
 */
export function ColumnHeader({
	layout,
	settings,
	onSettingsChange,
	sortColumn,
	sortDirection,
	onSort,
}: ColumnHeaderProps) {
	const [dragging, setDragging] = useState<"size" | "modified" | null>(null);
	const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
	const headerRef = useRef<HTMLDivElement>(null);
	const sort = { sortColumn, sortDirection, onSort };
	const { sizeWidth, modifiedWidth, autoHidden } = layout;
	const update = (patch: Partial<ColumnSettings>) => onSettingsChange({ ...settings, ...patch });

	const sections: MenuSection[] = [
		columnMenuItems(settings, onSettingsChange),
		[
			{
				id: "reset",
				label: "Reset Column Widths",
				onSelect: () => update({ sizeWidth: null, modifiedWidth: null }),
			},
		],
	];

	const hiddenLabel = `${
		autoHidden.length === 2
			? "Size and Modified are"
			: autoHidden[0] === "size"
				? "Size is"
				: "Modified is"
	} hidden to make room for names. Widen the panel, or choose columns.`;

	const guideRight =
		dragging === "size"
			? PAD_RIGHT + modifiedWidth + sizeWidth
			: dragging === "modified"
				? PAD_RIGHT + modifiedWidth
				: null;

	return (
		<>
			<div
				ref={headerRef}
				className="file-list-header flex h-[22px] shrink-0 items-center border-b border-border text-[0.85em] text-muted-foreground"
				onContextMenu={(e) => {
					e.preventDefault();
					e.stopPropagation();
					setMenu({ x: e.clientX, y: e.clientY });
				}}
			>
				<HeaderCell column="name" label="Name" {...sort}>
					{autoHidden.length > 0 && (
						<span className="absolute top-px right-1">
							<ToolbarButton
								label={hiddenLabel}
								onClick={() => {
									const header = headerRef.current?.getBoundingClientRect();
									setMenu({ x: header?.right ?? 0, y: header?.bottom ?? 0 });
								}}
							>
								<Columns3 className="size-3.5" />
							</ToolbarButton>
						</span>
					)}
				</HeaderCell>
				{sizeWidth > 0 && (
					<HeaderCell column="size" label="Size" width={sizeWidth} {...sort}>
						<ResizeHandle
							label="Size"
							width={sizeWidth}
							min={layout.sizeMin}
							max={layout.sizeMax}
							onChange={(w) => update({ sizeWidth: w })}
							onReset={() => update({ sizeWidth: null })}
							onDragging={(d) => setDragging(d ? "size" : null)}
						/>
					</HeaderCell>
				)}
				{modifiedWidth > 0 && (
					<HeaderCell column="mtime" label="Modified" width={modifiedWidth} {...sort}>
						<ResizeHandle
							label="Modified"
							width={modifiedWidth}
							min={layout.modifiedMin}
							max={layout.modifiedMax}
							onChange={(w) => update({ modifiedWidth: layout.snapModified(w) })}
							onReset={() => update({ modifiedWidth: null })}
							onDragging={(d) => setDragging(d ? "modified" : null)}
						/>
					</HeaderCell>
				)}
			</div>
			{guideRight !== null && (
				<div
					className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-focus-border opacity-70"
					style={{ right: guideRight }}
				/>
			)}
			{menu && (
				<Menu
					label="Columns"
					sections={sections}
					x={menu.x}
					y={menu.y}
					onClose={() => setMenu(null)}
				/>
			)}
		</>
	);
}
