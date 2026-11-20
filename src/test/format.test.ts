import * as assert from "node:assert";

import { detailsTitle, isoParts, shortDate, sizeParts } from "../frontend/format";
import type { DirectoryEntry } from "../protocol";

suite("format", () => {
	suite("sizeParts", () => {
		test("returns null for an unknown size", () => {
			assert.strictEqual(sizeParts(null), null);
		});

		test("shows bytes as a whole number", () => {
			assert.deepStrictEqual(sizeParts(0), { num: "0", unit: "B" });
			assert.deepStrictEqual(sizeParts(1023), { num: "1023", unit: "B" });
		});

		test("uses 1024-based units with one decimal place", () => {
			assert.deepStrictEqual(sizeParts(1024), { num: "1.0", unit: "KB" });
			assert.deepStrictEqual(sizeParts(1.5 * 1024 * 1024), { num: "1.5", unit: "MB" });
			assert.deepStrictEqual(sizeParts(3 * 1024 ** 3), { num: "3.0", unit: "GB" });
		});

		test("stops at TB", () => {
			assert.deepStrictEqual(sizeParts(2048 * 1024 ** 4), { num: "2048.0", unit: "TB" });
		});
	});

	suite("isoParts", () => {
		test("pads each field to two digits, in local time", () => {
			const ms = new Date(2026, 0, 5, 7, 3, 9).getTime();
			assert.deepStrictEqual(isoParts(ms), { date: "2026-01-05", time: "07:03", seconds: "09" });
		});
	});

	suite("shortDate", () => {
		const now = new Date(2026, 5, 15, 12, 0);
		const monthDay = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

		test("shows the time for today", () => {
			assert.strictEqual(shortDate(new Date(2026, 5, 15, 8, 5).getTime(), now), "08:05");
		});

		test("shows the month and day for another day this year", () => {
			const d = new Date(2026, 5, 14, 8, 5);
			assert.strictEqual(shortDate(d.getTime(), now), monthDay.format(d));
		});

		test("shows the month and day for the same day of another month", () => {
			const d = new Date(2026, 2, 15, 8, 5);
			assert.strictEqual(shortDate(d.getTime(), now), monthDay.format(d));
		});

		test("shows only the year for another year", () => {
			assert.strictEqual(shortDate(new Date(2025, 5, 15, 8, 5).getTime(), now), "2025");
		});
	});

	suite("detailsTitle", () => {
		const mtime = new Date(2026, 0, 5, 7, 3, 9).getTime();
		const entry = (extra: Partial<DirectoryEntry>): DirectoryEntry => ({
			name: "x",
			uri: "file:///x",
			kind: "file",
			isSymbolicLink: false,
			size: null,
			mtime: null,
			...extra,
		});

		test("shows the size, exact bytes, and date modified to the second for a file", () => {
			assert.strictEqual(
				detailsTitle(entry({ size: 2048, mtime })),
				`2.0 KB (${(2048).toLocaleString()} bytes)\nModified 2026-01-05 07:03:09`,
			);
		});

		test("leaves out the size for a folder", () => {
			assert.strictEqual(
				detailsTitle(entry({ kind: "directory", size: 4096, mtime })),
				"Modified 2026-01-05 07:03:09",
			);
		});

		test("marks a symbolic link on the first line", () => {
			assert.strictEqual(
				detailsTitle(entry({ isSymbolicLink: true, mtime })),
				"Symbolic link\nModified 2026-01-05 07:03:09",
			);
		});

		test("returns undefined when there is nothing to show", () => {
			assert.strictEqual(detailsTitle(entry({})), undefined);
		});
	});
});
