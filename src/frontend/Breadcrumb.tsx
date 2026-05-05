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
		<nav className="breadcrumb">
			{segments.map((segment, i) => (
				<span key={segment.uri}>
					{i > 0 && <span className="breadcrumb-separator"> › </span>}
					<button
						className="breadcrumb-segment"
						onClick={() => onNavigate(segment.uri)}
					>
						{segment.label}
					</button>
				</span>
			))}
		</nav>
	);
}
