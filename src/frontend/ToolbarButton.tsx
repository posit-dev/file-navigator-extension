import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FocusEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
	type RefObject,
} from "react";

/** How long the pointer rests on a button before its tooltip shows. */
const SHOW_DELAY = 500;
/** Within this long of one tooltip hiding, another shows without delay, so moving along the toolbar
 * keeps showing them (as VS Code does). */
const WARM_PERIOD = 300;
/** Gap between the button and its tooltip, and the least distance from the viewport edges. */
const MARGIN = 4;

let lastHiddenAt = -Infinity;

type TooltipTriggerProps = {
	ref: RefObject<HTMLButtonElement | null>;
	onPointerEnter: (e: PointerEvent<HTMLButtonElement>) => void;
	onPointerLeave: () => void;
	onFocus: (e: FocusEvent<HTMLButtonElement>) => void;
	onBlur: () => void;
};

/**
 * A themed tooltip for a button: shown after a delay on hover, or at once on keyboard focus; hidden
 * on leave and blur (and by `hide()`, which callers use on click and Escape). The tooltip is placed
 * below the button (above, if there's no room) and kept inside the viewport, since the sidebar can
 * be narrow. `triggerProps` never includes click or key handlers, so spreading it can't clobber
 * the caller's.
 */
export function useTooltip(label: string) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const tipRef = useRef<HTMLDivElement>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [open, setOpen] = useState(false);
	const openRef = useRef(open);
	openRef.current = open;
	const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

	const show = (immediately: boolean) => {
		clearTimeout(timerRef.current);
		if (immediately || performance.now() - lastHiddenAt < WARM_PERIOD) {
			setOpen(true);
		} else {
			timerRef.current = setTimeout(() => setOpen(true), SHOW_DELAY);
		}
	};

	const hide = () => {
		clearTimeout(timerRef.current);
		if (openRef.current) lastHiddenAt = performance.now();
		setOpen(false);
	};

	useEffect(() => () => clearTimeout(timerRef.current), []);

	// Measure the tooltip (rendered hidden at the top left) and place it, before it paints.
	useLayoutEffect(() => {
		if (!open || !buttonRef.current || !tipRef.current) {
			setPosition(null);
			return;
		}
		const button = buttonRef.current.getBoundingClientRect();
		const tip = tipRef.current.getBoundingClientRect();
		const centered = button.left + button.width / 2 - tip.width / 2;
		const left = Math.max(MARGIN, Math.min(centered, window.innerWidth - tip.width - MARGIN));
		const below = button.bottom + MARGIN;
		const fitsBelow = below + tip.height <= window.innerHeight - MARGIN;
		setPosition({ left, top: fitsBelow ? below : button.top - MARGIN - tip.height });
	}, [open, label]);

	const triggerProps: TooltipTriggerProps = {
		ref: buttonRef,
		onPointerEnter: (e) => e.pointerType === "mouse" && show(false),
		onPointerLeave: hide,
		onFocus: (e) => e.currentTarget.matches(":focus-visible") && show(true),
		onBlur: hide,
	};

	const tooltip = open && (
		<div
			ref={tipRef}
			aria-hidden
			className="pointer-events-none fixed z-50 max-w-80 rounded-[3px] border border-tooltip-border bg-tooltip px-2 py-1 text-[0.9em] text-tooltip-foreground shadow-[0_2px_8px_var(--widget-shadow)]"
			style={
				position
					? { left: position.left, top: position.top }
					: { left: 0, top: 0, visibility: "hidden" }
			}
		>
			{label}
		</div>
	);

	return { triggerProps, hide, tooltip };
}

type ToolbarButtonProps = {
	/** The tooltip text, also the button's accessible name. */
	label: string;
	onClick: (event: MouseEvent<HTMLButtonElement>) => void;
	disabled?: boolean;
	pressed?: boolean;
	children: ReactNode;
};

/** An icon button with a tooltip (see `useTooltip`); hides it on click and on Escape. */
export function ToolbarButton({ label, onClick, disabled, pressed, children }: ToolbarButtonProps) {
	const { triggerProps, hide, tooltip } = useTooltip(label);

	return (
		<>
			<button
				{...triggerProps}
				className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent text-icon-foreground hover:bg-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
				// Hide on click, not just blur: a click can disable the button (Home), and a button that
				// becomes disabled may not get a blur event.
				onClick={(e) => {
					hide();
					onClick(e);
				}}
				disabled={disabled}
				aria-label={label}
				aria-pressed={pressed}
				onKeyDown={(e) => e.key === "Escape" && hide()}
			>
				{children}
			</button>
			{tooltip}
		</>
	);
}
