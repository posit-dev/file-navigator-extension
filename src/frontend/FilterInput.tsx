import { Search } from "lucide-react";

type FilterInputProps = {
	value: string;
	onChange: (value: string) => void;
};

export function FilterInput({ value, onChange }: FilterInputProps) {
	return (
		<div className="relative px-2 pt-1.5 pb-1">
			<Search className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<input
				className="w-full rounded-sm border border-input-border bg-input py-1 pr-2 pl-8 font-[family-name:inherit] text-[length:inherit] text-input-foreground outline-none focus:border-focus-border"
				type="text"
				placeholder="Filter..."
				value={value}
				onChange={(e) => onChange(e.target.value)}
			/>
		</div>
	);
}
