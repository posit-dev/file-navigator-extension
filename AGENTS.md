# File Navigator

A VS Code / Positron extension that provides a directory browser in a sidebar webview, drawn with `@pierre/trees`. Two modes, toggled in the toolbar: a flat list of one directory, or a tree rooted at the current directory whose folders load on expand. Not constrained to the workspace; can browse anywhere on the filesystem — in tree mode, "up" moves the root to its parent.

## Structure

```
packages/file-navigator/
├── esbuild.ts              # Build: two contexts (Node extension + browser webview)
├── tailwind.config.ts
├── tsconfig.json            # Composite: references server + client tsconfigs
├── tsconfig.server.json     # Backend (extension host, Node)
├── tsconfig.client.json     # Frontend (webview, React + JSX)
├── images/
│   └── icon.svg             # Activity bar icon
└── src/
    ├── extension.ts         # Backend: WebviewViewProvider, message handling, file watcher
    └── frontend/
        ├── main.tsx         # React entry point
        ├── App.tsx          # Root component: state, view mode, message dispatch
        ├── DirectoryView.tsx # Trees model: rows, size/date columns, expansion, focus, sort headers
        ├── treeLayout.ts    # Pure: entries + loaded folders → sorted tree paths
        ├── Breadcrumb.tsx   # Clickable path segments
        ├── FilterInput.tsx  # Client-side filter
        ├── types.ts         # Shared frontend types (DirectoryEntry, SortColumn, etc.)
        ├── styles.css       # Tailwind entry + VS Code theme variable mappings
        └── css.d.ts         # TypeScript declaration for CSS imports
```

## Commands

- Build: `npm run build`
- Watch: `npm run watch`
- Type check: `npm run check-types`
- Lint: `npm run lint`

## Architecture

### Backend (`extension.ts`)

The backend is authoritative for all navigation logic. The frontend never parses, joins, or computes URIs — it only renders what the backend sends and posts back URIs it received.

- Registers a `WebviewViewProvider` for `file-navigator.directoryView`
- Reads directories via `vscode.workspace.fs.readDirectory()` + `stat()` for size/mtime
- Computes entry URIs, parent URI, and breadcrumb segments
- Validates all incoming messages before processing
- Watches the current directory, plus the folders expanded in the tree (`watchDirectories`), each with `RelativePattern(uri, "*")` (create/delete events only, 300ms debounce, tolerates watcher creation failures)
- Backend state (`currentUri`, root watcher) updates only after a successful read
- `readChildren` (tree folder loads) is never discarded as stale, unlike `readDirectory`; several can be in flight

### Frontend (React webview)

The frontend is a pure renderer. It receives fully-formed data from the backend and sends back URIs the backend gave it.

- **Rows**: tree paths are relative to the current directory (`name`, `dir/`, `dir/name`), rebuilt from scratch on each change with `resetPaths` (it keeps scroll position). Size and Modified are the row decoration's two text parts, given fixed widths via `unsafeCSS`; the header shares the `--fn-*` spacing variables so its labels line up.
- **Tree mode**: loaded folder contents are kept by URI (`loadedFolders`); expanded folders are tracked by URI, so they survive moving the root. Moving the root up keeps the old root's listing as a loaded, expanded folder. Click toggles a folder; double-click makes it the root.
- **Sorting**: directories always sort first; within each group (and within each folder in the tree), sortable by name, size, or modified date via column headers
- **Filtering**: the tree's own search (`hide-non-matches`) over loaded entries
- **Keyboard nav**: the tree's (arrows, type-ahead); Enter on a row is a click; Backspace goes up. Focus follows the same entry across rebuilds.
- **Request IDs**: each `readDirectory` request gets an incrementing ID; stale responses are discarded
- Navigation only updates state after a successful response; failed reads show an error but keep the current view

### Message Protocol

All navigation uses URI strings (stringified `vscode.Uri`). The frontend never constructs or manipulates URIs.

```
Webview → Extension:
  { type: "getInitialDirectory" }
  { type: "readDirectory", requestId: number, uri: string }
  { type: "readChildren", uri: string }
  { type: "watchDirectories", uris: string[] }
  { type: "openFile", uri: string }

Extension → Webview:
  { type: "initialDirectory", uri: string }
  { type: "directoryContents", requestId, uri, entries, parentUri, breadcrumbs }
  { type: "directoryError", requestId, uri, error }
  { type: "childrenContents", uri, entries }
  { type: "childrenError", uri, error }
  { type: "directoryChanged", uri }   // the current directory or a watched folder
```

## UI Stack

- `@pierre/trees` (React) for the file list, themed via `--trees-*-override` variables in `styles.css`
- Tailwind CSS with VS Code theme variables mapped via `@theme inline`
- Lucide React icons

## Key Design Decisions

- **URI-first protocol**: supports `file://`, `vscode-remote://`, UNC paths, any VS Code filesystem provider
- **Backend-authoritative navigation**: avoids cross-platform path bugs; handles non-file schemes correctly
- **Per-directory watchers**: only watches the viewed directory and expanded tree folders; create/delete events only (no change events since we display size/mtime from the initial stat, not live updates). Manual refresh as fallback.
- **Self-contained**: no dependencies on other packages in this monorepo
