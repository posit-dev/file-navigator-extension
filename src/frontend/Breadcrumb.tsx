import { ChevronRight } from "lucide-react";

type BreadcrumbSegment = {
	label: string;
	uri: string;
};

type BreadcrumbProps = {
	segments: BreadcrumbSegment[];
	onNavigate: (uri: string) => void;
};

export function Breadcrumb({ segments, onNavigate }: BreadcrumbProps) {
	if (segments.length === 0) return null;

	return (
		<nav className="flex items-center gap-0.5 px-2 py-1 text-[0.9em] overflow-x-auto scrollbar-none border-b border-border">
			{segments.map((segment, i) => (
				<span key={segment.uri} className="flex items-center shrink-0">
					{i > 0 && (
						<ChevronRight className="size-3 text-muted-foreground mx-0.5" />
					)}
					<button
						className="bg-transparent border-none text-foreground cursor-pointer px-1 py-0.5 rounded-sm hover:bg-accent text-[length:inherit] font-[family-name:inherit]"
						onClick={() => onNavigate(segment.uri)}
					>
						{segment.label}
					</button>
				</span>
			))}
		</nav>
	);
}
