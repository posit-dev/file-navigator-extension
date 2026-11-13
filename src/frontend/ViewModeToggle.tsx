import { List, ListTree } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useTooltip } from "./ToolbarButton";
import type { ViewMode } from "./types";

type SegmentProps = {
	label: string;
	checked: boolean;
	onSelect: () => void;
	onArrow: (key: string) => void;
	children: ReactNode;
};

/** One radio of the toggle, with its own tooltip. Only the checked one is in the tab order. */
function Segment({ label, checked, onSelect, onArrow, children }: SegmentProps) {
	const { triggerProps, hide, tooltip } = useTooltip(label);
	return (
		<>
			<button
				{...triggerProps}
				type="button"
				role="radio"
				aria-checked={checked}
				aria-label={label}
				tabIndex={checked ? 0 : -1}
				className={`flex h-4 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none outline-offset-1 focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-border ${
					checked
						? "bg-toggled text-foreground"
						: "bg-transparent text-icon-foreground hover:bg-accent"
				}`}
				onClick={() => {
					hide();
					onSelect();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") hide();
					else if (e.key.startsWith("Arrow")) {
						e.preventDefault();
						onArrow(e.key);
					}
				}}
			>
				{children}
			</button>
			{tooltip}
		</>
	);
}

/** A two-segment switch between the flat list and the tree. Arrow keys switch and move focus. */
export function ViewModeToggle({
	mode,
	onChange,
}: {
	mode: ViewMode;
	onChange: (mode: ViewMode) => void;
}) {
	const groupRef = useRef<HTMLDivElement>(null);

	const select = (next: ViewMode) => {
		onChange(next);
		// Roving tabindex: focus the newly checked radio (index 0 is List, 1 is Tree).
		const radios = groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]');
		radios?.[next === "flat" ? 0 : 1]?.focus();
	};
	const onArrow = (key: string) => {
		const next: ViewMode = key === "ArrowLeft" || key === "ArrowUp" ? "flat" : "tree";
		select(next);
	};

	return (
		<div
			ref={groupRef}
			role="radiogroup"
			aria-label="View"
			className="flex shrink-0 items-center rounded-[3px] border border-input-border p-px"
		>
			<Segment
				label="List: one folder at a time"
				checked={mode === "flat"}
				onSelect={() => onChange("flat")}
				onArrow={onArrow}
			>
				<List className="size-3.5" />
			</Segment>
			<Segment
				label="Tree: expand folders in place"
				checked={mode === "tree"}
				onSelect={() => onChange("tree")}
				onArrow={onArrow}
			>
				<ListTree className="size-3.5" />
			</Segment>
		</div>
	);
}
