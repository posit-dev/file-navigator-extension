import * as esbuild from "esbuild";

import {
	createBaseConfig,
	createCodeWatcher,
	createProblemMatcherPlugin,
} from "../../scripts/esbuild-utils";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
	const baseConfig = createBaseConfig({ production, metafile: false });

	const buildmap = {
		extension: esbuild.context({
			...baseConfig,
			entryPoints: ["src/extension.ts"],
			outdir: "dist/",
			format: "cjs",
			platform: "node",
			external: ["vscode"],
			plugins: [createProblemMatcherPlugin(["src/extension.ts"], watch)],
		}),
		webview: esbuild.context({
			...baseConfig,
			entryPoints: ["src/frontend/main.tsx"],
			outdir: "dist/client/",
			format: "esm",
			sourcemap: production ? false : "inline",
			sourcesContent: true,
			external: ["vscode-webview"],
			jsx: "automatic",
			plugins: [createProblemMatcherPlugin(["src/frontend/main.tsx"], watch)],
		}),
	};

	if (watch) {
		const contexts = await Promise.all(Object.values(buildmap));
		try {
			await Promise.all(contexts.map((context) => context.rebuild()));
		} catch {
			console.error("Initial build failed. Watching for changes...");
		}

		const codeWatcher = createCodeWatcher(["src/"], contexts, 100);

		process.on("SIGINT", async () => {
			await codeWatcher.close();
			await Promise.all(contexts.map((context) => context.dispose()));
			process.exit(0);
		});
	} else {
		await Promise.all(
			Object.values(buildmap).map((build) =>
				build.then(async (context: esbuild.BuildContext) => {
					await context.rebuild();
					await context.dispose();
				}),
			),
		);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
