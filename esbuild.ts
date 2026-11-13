import { writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";
import { writeThirdPartyNotices } from "./thirdPartyNotices";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
// Write both builds' metafiles, merged, to dist/meta.json (load it in https://esbuild.github.io/analyze/).
const metafile = process.argv.includes("--metafile");

const baseConfig: esbuild.BuildOptions = {
	bundle: true,
	minify: production,
	sourcemap: !production,
	sourcesContent: false,
	logLevel: "info",
	// Prefer ESM entry points over CJS/UMD.
	mainFields: ["module", "main"],
};

const extensionConfig: esbuild.BuildOptions = {
	...baseConfig,
	entryPoints: ["src/extension.ts"],
	outdir: "dist/",
	format: "cjs",
	platform: "node",
	external: ["vscode"],
};

const webviewConfig: esbuild.BuildOptions = {
	...baseConfig,
	entryPoints: ["src/frontend/main.tsx"],
	outdir: "dist/client/",
	format: "esm",
	sourcemap: production ? false : "inline",
	sourcesContent: true,
	external: ["vscode-webview"],
	jsx: "automatic",
	// Run React code (ours, @pierre/trees/react, lucide-react) on Preact, which
	// @pierre/trees already bundles to draw the tree. Subpaths follow the alias:
	// react/jsx-runtime -> preact/compat/jsx-runtime, react-dom/client -> preact/compat/client.
	alias: { react: "preact/compat", "react-dom": "preact/compat" },
	plugins: [tailwindPlugin()],
};

async function main() {
	if (watch) {
		const contexts = await Promise.all([
			esbuild.context(extensionConfig),
			esbuild.context(webviewConfig),
		]);
		await Promise.all(contexts.map((context) => context.watch()));

		process.on("SIGINT", async () => {
			await Promise.all(contexts.map((context) => context.dispose()));
			process.exit(0);
		});
	} else {
		const results = await Promise.all(
			[extensionConfig, webviewConfig].map((config) =>
				esbuild.build({ ...config, metafile: metafile || production }),
			),
		);
		const merged: esbuild.Metafile = { inputs: {}, outputs: {} };
		for (const { metafile: meta } of results) {
			Object.assign(merged.inputs, meta?.inputs);
			Object.assign(merged.outputs, meta?.outputs);
		}
		if (metafile) {
			await writeFile("dist/meta.json", JSON.stringify(merged));
			console.log("Wrote dist/meta.json");
		}
		// Production builds are what ship, so regenerate the notices from what they bundled.
		if (production) {
			await writeThirdPartyNotices(merged, "ThirdPartyNotices.txt");
		}
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
