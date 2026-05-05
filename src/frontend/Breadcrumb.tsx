import { ChevronRight } from "lucide-react";

import type { BreadcrumbSegment } from "./types";

type BreadcrumbProps = {
	segments: BreadcrumbSegment[];
	onNavigate: (uri: string) => void;
};

export function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
	if (segments.length === 0) return null;

	return (
		<nav className="scrollbar-none flex items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1 text-[0.9em]">
			{segments.map((segment, i) => (
				<span key={segment.uri} className="flex shrink-0 items-center">
					{i > 0 && <ChevronRight className="mx-0.5 size-3 text-muted-foreground" />}
					<button
						className="cursor-pointer rounded-sm border-none bg-transparent px-1 py-0.5 font-[family-name:inherit] text-[length:inherit] text-foreground hover:bg-accent"
						onClick={() => onNavigate(segment.uri)}
					>
						{segment.label}
					</button>
				</span>
			))}
		</nav>
	);
}
