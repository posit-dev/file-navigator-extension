# Contributing to File Navigator

## Building the extension

Run `npm install` first.

```sh
npm run build        # Production build
npm run build -- --metafile  # Also write dist/meta.json, for https://esbuild.github.io/analyze/
npm run watch        # Watch mode
npm run check-types  # Type check (server, client, and tests)
npm run lint         # Lint with oxlint
npm run package      # Type check, lint, build, and package a .vsix
npx oxfmt src        # Format
```

To try it, build and then launch Positron (or VS Code) with the extension loaded:

```sh
positron --extensionDevelopmentPath=/path/to/file-navigator-extension
```

After you rebuild, run _Developer: Reload Window_ in that window.

## Testing

```sh
npm test
```

This builds the extension, compiles `src/test` to `out/`, and runs the tests inside VS Code with `@vscode/test-cli` (see `.vscode-test.mjs`). The first run downloads VS Code into `.vscode-test/`.

CI (`.github/workflows/ci.yml`) runs on pushes to `main` and on pull requests. One job runs `npm run package`, fails if the regenerated `ThirdPartyNotices.txt` is different from the committed one, and uploads the `.vsix`. The other job runs `npm test`.

## Packaging

`npm run package` writes `file-navigator-<version>.vsix` to the project root. It stops if the type check or lint fails. The `.vsix` holds only the bundled `dist/` (without source maps), the icons, the README, the CHANGELOG, the LICENSE, `ThirdPartyNotices.txt`, and the package metadata; `.vscodeignore` controls this. To install it:

```sh
positron --install-extension file-navigator-0.1.0.vsix   # or: code --install-extension ...
```

esbuild bundles everything, so all packages are dev dependencies and the `.vsix` ships no `node_modules`. A dependency that esbuild can't bundle would need to go in `dependencies`, and `--no-dependencies` would have to come out of the `package` script.

The production build also writes `ThirdPartyNotices.txt` from the packages in the bundle. If you add, remove, or update a bundled dependency, commit the regenerated file.

## Releasing

`.github/workflows/publish.yml` publishes the extension to [Open VSX](https://open-vsx.org/extension/posit/file-navigator) when you publish a GitHub release. It needs an Open VSX access token for the `posit` namespace in the `OVSX_PAT` repository secret.

1. Change `version` in `package.json` and add a section to `CHANGELOG.md`. Merge these changes to `main`.
2. Make a GitHub release from `main` with the tag `v<version>`, for example `v0.1.0`.
3. The workflow makes sure that the tag and the `package.json` version are the same. Then it packages the `.vsix`, publishes it to Open VSX, and attaches it to the release.

## Bundling in another product

A product that bundles the extension can hide the view by default with `configurationDefaults`:

```json
"configurationDefaults": {
  "fileNavigator.enabled": false
}
```

## Architecture

The extension has two halves:

- **Backend** (`src/extension.ts`): a `WebviewViewProvider` that runs in the extension host. It reads directories with `vscode.workspace.fs`, computes URIs, breadcrumbs, and file metadata, does the file operations, and watches the current directory and the expanded tree folders for changes. The backend is authoritative for all navigation logic.
- **Frontend** (`src/frontend/`): a React app that renders in the webview, with the file list drawn by [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees). It receives fully formed data from the backend and posts back URIs the backend gave it. The frontend never constructs or manipulates paths or URIs.
  - `App.tsx` owns the view mode, the current directory's listing, and the contents of loaded tree folders (kept by URI).
  - `treeLayout.ts` is a pure function that turns those listings into sorted tree paths.
  - `DirectoryView.tsx` owns the `@pierre/trees` model, the size and date columns, expansion, and focus.

Types shared by both halves are in `src/protocol.ts`. All messages use URI strings, so the extension works with `file://`, `vscode-remote://`, and any VS Code filesystem provider.

[AGENTS.md](AGENTS.md) has a more detailed map of the source files, the full message protocol, and the key design decisions.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
