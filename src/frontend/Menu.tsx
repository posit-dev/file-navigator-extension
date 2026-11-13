// A context menu styled like VS Code's own: portaled to <body>, placed at a point and flipped to
// stay on screen, keyboard driven (arrows, Home/End, type-ahead, Enter/Space, Escape, Tab).
import { clsx } from "clsx";
import { Check } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
	id: string;
	label: string;
	shortcut?: string;
	disabled?: boolean;
	/** A checkable item: true/false shows its state; undefined is a plain item. */
	checked?: boolean;
	onSelect: () => void;
};
/** Sections are separated by a rule. */
export type MenuSection = MenuItem[];

/** Least distance from the viewport edges. */
const EDGE = 4;

type MenuProps = {
	sections: MenuSection[];
	x: number;
	y: number;
	label?: string;
	/** Start with the first item active (menus opened from the keyboard). */
	focusFirst?: boolean;
	onClose: () => void;
};

export function Menu({ sections, x, y, label, focusFirst, onClose }: MenuProps) {
	const panelRef = useRef<HTMLDivElement>(null);
	const items = useMemo(() => sections.flat(), [sections]);
	const [active, setActive] = useState(() =>
		focusFirst ? items.findIndex((i) => !i.disabled) : -1,
	);
	const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
	const typeahead = useRef({ text: "", at: 0 });

	useEffect(() => panelRef.current?.focus({ preventScroll: true }), []);
	useEffect(() => {
		const close = () => onClose();
		window.addEventListener("blur", close);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("blur", close);
			window.removeEventListener("resize", close);
		};
	}, [onClose]);

	// Measure, then place at the point, flipped left/up where it would overflow the viewport.
	useLayoutEffect(() => {
		const el = panelRef.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		let left = x;
		let top = y;
		if (left + width > window.innerWidth - EDGE) left = Math.max(EDGE, x - width);
		if (top + height > window.innerHeight - EDGE) top = Math.max(EDGE, y - height);
		setPos({ left, top });
	}, [x, y]);

	const step = (from: number, delta: number) => {
		const n = items.length;
		let i = from;
		for (let tries = 0; tries < n; tries++) {
			i = (i + delta + n) % n;
			if (!items[i].disabled) return i;
		}
		return from;
	};

	const activate = (i: number) => {
		const item = items[i];
		if (!item || item.disabled) return;
		onClose();
		item.onSelect();
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		const keys: Record<string, () => void> = {
			ArrowDown: () => setActive(step(active < 0 ? -1 : active, 1)),
			ArrowUp: () => setActive(step(active < 0 ? items.length : active, -1)),
			Home: () => setActive(step(-1, 1)),
			End: () => setActive(step(items.length, -1)),
			Enter: () => activate(active),
			" ": () => activate(active),
			Escape: onClose,
			Tab: onClose,
		};
		const handler = keys[e.key];
		if (handler) {
			e.preventDefault();
			e.stopPropagation();
			handler();
			return;
		}
		if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return;
		e.preventDefault();
		e.stopPropagation();
		const now = performance.now();
		const t = typeahead.current;
		t.text = now - t.at < 600 ? t.text + e.key.toLowerCase() : e.key.toLowerCase();
		t.at = now;
		const start = t.text.length > 1 ? Math.max(active, 0) : active + 1;
		for (let k = 0; k < items.length; k++) {
			const i = (start + k) % items.length;
			if (!items[i].disabled && items[i].label.toLowerCase().startsWith(t.text)) {
				setActive(i);
				break;
			}
		}
	};

	let index = -1;
	return createPortal(
		// The tree treats clicks inside an element marked like this as inside its menu.
		<div
			data-file-tree-context-menu-root="true"
			className="fixed inset-0 z-[1000]"
			onPointerDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
			onContextMenu={(e) => {
				e.preventDefault();
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				role="menu"
				aria-label={label}
				tabIndex={-1}
				aria-activedescendant={active >= 0 ? `fn-menu-item-${active}` : undefined}
				className="fixed min-w-[224px] rounded-[5px] border border-menu-border bg-menu py-1 text-[13px] leading-none text-menu-foreground shadow-[0_2px_8px_var(--widget-shadow)] outline-none select-none"
				// Unplaced, it is transparent rather than hidden: hidden elements can't take focus.
				style={pos ? pos : { left: 0, top: 0, opacity: 0 }}
				onKeyDown={onKeyDown}
				onPointerLeave={() => setActive(-1)}
			>
				{sections.map((section, s) => (
					<div key={s} role="group">
						{s > 0 && <div role="separator" className="mx-2.5 my-1 h-px bg-menu-separator" />}
						{section.map((item) => {
							index++;
							const i = index;
							const isActive = i === active && !item.disabled;
							return (
								<div
									key={item.id}
									id={`fn-menu-item-${i}`}
									role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
									aria-checked={item.checked}
									aria-disabled={item.disabled || undefined}
									className={clsx(
										"mx-1 flex h-[26px] cursor-default items-center rounded-[3px] pr-3 whitespace-nowrap",
										item.disabled && "opacity-45",
										isActive && "bg-menu-selection text-menu-selection-foreground",
									)}
									onPointerEnter={() => setActive(i)}
									onClick={() => activate(i)}
								>
									<span className="flex w-7 shrink-0 justify-center">
										{item.checked && <Check className="size-3.5" />}
									</span>
									<span className="flex-1">{item.label}</span>
									{item.shortcut && (
										<span
											className={clsx(
												"pl-8 text-[12px] tracking-wide",
												isActive ? "opacity-90" : "opacity-60",
											)}
										>
											{item.shortcut}
										</span>
									)}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>,
		document.body,
	);
}
