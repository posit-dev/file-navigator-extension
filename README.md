# File Navigator

A VS Code / Positron extension that provides a directory browser in a sidebar webview, drawn with [`@pierre/trees`](https://www.npmjs.com/package/@pierre/trees). It has two view modes, toggled from the toolbar: a flat list of one directory, or a tree rooted at the current directory. It can browse anywhere on the filesystem, not just the workspace.

![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.100.0-blue)

## Features

- **Flat view**: shows one directory at a time, like a traditional file manager. A `..` row at the top goes to the parent.
- **Tree view**: folders load their contents when expanded. Click a folder to expand or collapse it; double-click to make it the root. Moving the root up keeps the old root expanded.
- **Breadcrumb navigation**: click a path segment to jump to that ancestor. The Home button goes back to the workspace folder (or the home directory, with no workspace open).
- **Sortable columns**: sort by name, size, or modified date. Directories always sort first, and in tree view each folder is sorted on its own.
- **Filtering**: instant search over the entries that have been loaded.
- **Keyboard navigation**: arrow keys and type-ahead to move, Enter to open, Backspace to go up (in tree view, Backspace moves the root up).
- **File watching**: refreshes automatically when files are created or deleted in the current directory or an expanded folder. The Refresh button reloads by hand.
- **URI-based protocol**: supports `file://`, `vscode-remote://`, and any VS Code filesystem provider.

The view mode is remembered when the view is hidden and shown again.

## Development

Run `npm install` first.

### Commands

```sh
npm run build        # Production build
npm run build -- --metafile  # Also write dist/meta.json, for https://esbuild.github.io/analyze/
npm run watch        # Watch mode
npm run check-types  # Type check (server + client)
npm run lint         # Lint with oxlint
npm run package      # Type check, lint, build, and package a .vsix
npx oxfmt src        # Format
```

To try it, build and then launch Positron (or VS Code) with the extension loaded:

```sh
positron --extensionDevelopmentPath=/path/to/file-navigator
```

After rebuilding, run **Developer: Reload Window** in that window.

### Packaging

`npm run package` writes `file-navigator-<version>.vsix` to the project root. It stops if the type check or lint fails. The .vsix holds only the bundled `dist/` (without source maps), the icon, the LICENSE, and the package metadata; `.vscodeignore` controls this. To install it:

```sh
positron --install-extension file-navigator-0.1.0.vsix   # or: code --install-extension ...
```

Everything is bundled by esbuild, so all packages are dev dependencies and the .vsix ships no `node_modules`. A dependency that can't be bundled would need to go in `dependencies`, and `--no-dependencies` would have to come out of the `package` script.

### Architecture

The extension has two halves:

- **Backend** (`src/extension.ts`): a `WebviewViewProvider` running in the extension host. It reads directories via `vscode.workspace.fs`, computes URIs, breadcrumbs, and file metadata, and watches the current directory and the expanded tree folders for changes. The backend is authoritative for all navigation logic.

- **Frontend** (`src/frontend/`): a React app rendered in the webview. It receives fully formed data from the backend and posts back URIs the backend gave it. The frontend never constructs or manipulates paths or URIs.
  - `App.tsx` owns the view mode, the current directory's listing, and the contents of loaded tree folders (kept by URI).
  - `treeLayout.ts` is a pure function that turns those listings into sorted tree paths.
  - `DirectoryView.tsx` owns the `@pierre/trees` model, the size and date columns, expansion, and focus.

Types shared by both halves are in `src/protocol.ts`.

### Message Protocol

```
Webview → Extension:
  { type: "getInitialDirectory" }
  { type: "readDirectory", requestId, uri }
  { type: "readChildren", uri }              // load a folder expanded in the tree
  { type: "watchDirectories", uris }         // the expanded folders to watch, besides the current directory
  { type: "openFile", uri }

Extension → Webview:
  { type: "initialDirectory", uri, isWorkspace }  // also the Home button's target
  { type: "directoryContents", requestId, uri, entries, parentUri, breadcrumbs }
  { type: "directoryError", requestId, uri, error }
  { type: "childrenContents", uri, entries }
  { type: "childrenError", uri, error }
  { type: "directoryChanged", uri }          // the current directory or a watched folder
```

Each `readDirectory` carries an increasing `requestId`; stale responses are discarded. `readChildren` responses are never discarded, since several can be in flight.

## License

MIT. See [LICENSE](LICENSE).
