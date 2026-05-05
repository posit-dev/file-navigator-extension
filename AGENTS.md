# File Navigator

A VS Code / Positron extension that provides a directory browser in a sidebar webview. Shows one directory at a time with navigation — not a tree view. Not constrained to the workspace; can browse anywhere on the filesystem.

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
        ├── App.tsx          # Root component: state, sort logic, message dispatch
        ├── DirectoryView.tsx # File list with columns, keyboard nav, sort headers
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
- Watches the current directory with `RelativePattern(uri, "*")` (create/delete events only, 300ms debounce, tolerates watcher creation failures)
- Backend state (`currentUri`, watcher) updates only after a successful read

### Frontend (React webview)

The frontend is a pure renderer. It receives fully-formed data from the backend and sends back URIs the backend gave it.

- **Sorting**: directories always sort first; within each group, sortable by name, size, or modified date via column headers
- **Filtering**: client-side case-insensitive substring match on entry name
- **Keyboard nav**: arrow keys to move selection, Enter to open/navigate, Backspace to go up
- **Request IDs**: each `readDirectory` request gets an incrementing ID; stale responses are discarded
- Navigation only updates state after a successful response; failed reads show an error but keep the current view

### Message Protocol

All navigation uses URI strings (stringified `vscode.Uri`). The frontend never constructs or manipulates URIs.

```
Webview → Extension:
  { type: "getInitialDirectory" }
  { type: "readDirectory", requestId: number, uri: string }
  { type: "openFile", uri: string }

Extension → Webview:
  { type: "initialDirectory", uri: string }
  { type: "directoryContents", requestId, uri, entries, parentUri, breadcrumbs }
  { type: "directoryError", requestId, uri, error }
  { type: "directoryChanged", uri }
```

## UI Stack

- Tailwind CSS with VS Code theme variables mapped via `@theme inline`
- Lucide React icons
- No external component library — plain Tailwind utility classes

## Key Design Decisions

- **URI-first protocol**: supports `file://`, `vscode-remote://`, UNC paths, any VS Code filesystem provider
- **Backend-authoritative navigation**: avoids cross-platform path bugs; handles non-file schemes correctly
- **Per-directory watcher**: only watches the viewed directory; create/delete events only (no change events since we display size/mtime from the initial stat, not live updates). Manual refresh as fallback.
- **Self-contained**: no dependencies on other packages in this monorepo
