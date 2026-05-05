type FilterInputProps = {
	value: string;
	onChange: (value: string) => void;
};

export function FilterInput({ value, onChange }: FilterInputProps) {
	return (
		<div className="filter-input-container">
			<input
				className="filter-input"
				type="text"
				placeholder="Filter..."
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
