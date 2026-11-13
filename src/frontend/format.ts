// Display formats. Dates are ISO 8601 in local time, always the same shape; they're split into
// date and time so the list can align, dim, or drop the time independently.
import type { DirectoryEntry } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function isoParts(ms: number): { date: string; time: string; seconds: string } {
	const d = new Date(ms);
	return {
		date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
		time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
		seconds: pad(d.getSeconds()),
	};
}

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

/**
 * A compact date for narrow columns, at the precision that tells rows apart: the time for today,
 * the month and day for this year, otherwise the year.
 */
export function shortDate(ms: number, now: Date = new Date()): string {
	const d = new Date(ms);
	if (d.getFullYear() !== now.getFullYear()) return String(d.getFullYear());
	if (d.getMonth() !== now.getMonth() || d.getDate() !== now.getDate()) return MONTH_DAY.format(d);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Strings at least as wide as any `shortDate` result, for sizing its column. */
export function shortDateSamples(): string[] {
	const months = Array.from({ length: 12 }, (_, i) => MONTH_DAY.format(new Date(2000, i, 28)));
	return [...months, "00:00", "0000"];
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** The size as a number and a unit (1024-based), e.g. `{ num: "47.1", unit: "KB" }`. */
export function sizeParts(bytes: number | null): { num: string; unit: string } | null {
	if (bytes === null) return null;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < UNITS.length - 1) {
		value /= 1024;
		unit++;
	}
	return { num: unit === 0 ? String(value) : value.toFixed(1), unit: UNITS[unit] };
}

/** A row's tooltip: everything, exactly. */
export function detailsTitle(entry: DirectoryEntry): string | undefined {
	const size = sizeParts(entry.size);
	const lines = [
		entry.isSymbolicLink ? "Symbolic link" : null,
		entry.kind !== "directory" && entry.size !== null && size
			? `${size.num} ${size.unit} (${entry.size.toLocaleString()} bytes)`
			: null,
		entry.mtime !== null
			? (() => {
					const p = isoParts(entry.mtime);
					return `Modified ${p.date} ${p.time}:${p.seconds}`;
				})()
			: null,
	].filter((line) => line !== null);
	return lines.length > 0 ? lines.join("\n") : undefined;
}
