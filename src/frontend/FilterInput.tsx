import { Search } from "lucide-react";

type FilterInputProps = {
	value: string;
	onChange: (value: string) => void;
};

export function FilterInput({ value, onChange }: FilterInputProps) {
	return (
		<div className="relative px-2 pt-1.5 pb-1">
			<Search className="absolute left-4 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
			<input
				className="w-full pl-8 pr-2 py-1 text-[length:inherit] font-[family-name:inherit] bg-input text-input-foreground border border-input-border rounded-sm outline-none focus:border-focus-border"
				type="text"
				placeholder="Filter..."
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
