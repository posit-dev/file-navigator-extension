# File Navigator

A VS Code / Positron extension that provides a directory browser in a sidebar webview, drawn with `@pierre/trees`. Two modes, toggled in the toolbar: a flat list of one directory, or a tree rooted at the current directory whose folders load on expand. Not constrained to the workspace; can browse anywhere on the filesystem — in tree mode, "up" moves the root to its parent.

## Structure

```
temp/file-navigator/
├── esbuild.ts              # Build: two contexts (Node extension + browser webview)
├── tailwind.config.ts
├── tsconfig.json            # Composite: references server + client tsconfigs
├── tsconfig.server.json     # Backend (extension host, Node)
├── tsconfig.client.json     # Frontend (webview, React + JSX)
├── images/
│   └── icon.svg             # Activity bar icon
└── src/
    ├── extension.ts         # Backend: WebviewViewProvider, message handling, file watcher, file operations
    ├── protocol.ts          # Types shared by backend and frontend (DirectoryEntry, BreadcrumbSegment, FileAction)
    └── frontend/
        ├── main.tsx         # React entry point
        ├── App.tsx          # Root component: state, view mode, message dispatch, saved webview state
        ├── DirectoryView.tsx # Trees model: rows, expansion, focus, inline rename/create, shortcuts, menus
        ├── columns.tsx      # Column layout (useColumnLayout), header with resize handles, column menu
        ├── contextMenus.ts  # Entry and empty-space menus; shortcutCommand() maps keys to commands
        ├── Menu.tsx         # VS Code-style context menu (portaled, keyboard nav, type-ahead, checkable items)
        ├── format.ts        # ISO local dates; sizes split into number and unit
        ├── treeLayout.ts    # Pure: entries + loaded folders → sorted tree paths
        ├── Breadcrumb.tsx   # Path bar: current folder as a title, dimmed parent if it fits, ancestor menu
        ├── FilterInput.tsx  # Client-side filter
        ├── ToolbarButton.tsx # Icon button with a themed, viewport-clamped tooltip
        ├── types.ts         # Frontend types (SortColumn, ViewMode), re-exports protocol types
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
- Computes entry URIs, parent URI, and breadcrumb segments (the user's home folder is labeled `~`)
- Validates all incoming messages before processing, including every file name; builds target URIs itself
- File operations: rename via `WorkspaceEdit.renameFile` (open editors follow); create opens new files; delete confirms, uses the Trash, and asks again before deleting permanently if that fails. After each mutation it posts `directoryChanged` for the parent folder, even on failure (that reverts a rename the list already showed)
- Watches the current directory, plus the folders expanded in the tree (`watchDirectories`), each with `RelativePattern(uri, "*")` (create/delete events only, 300ms debounce, tolerates watcher creation failures)
- Backend state (`currentUri`, root watcher) updates only after a successful read
- `readChildren` (tree folder loads) is never discarded as stale, unlike `readDirectory`; several can be in flight

### Frontend (React webview)

The frontend is a pure renderer. It receives fully-formed data from the backend and sends back URIs the backend gave it.

- **Rows**: tree paths are relative to the current directory (`name`, `dir/`, `dir/name`), rebuilt from scratch on each change with `resetPaths` (it keeps scroll position). A rebuild waits while a rename input exists (`rebuildDeferred`), so a watcher refresh can't wipe it.
- **Columns**: rows draw Size and Modified as 4 decoration parts (size number, unit, date, time), styled by `COLUMN_ROW_CSS` and sized by CSS variables from `useColumnLayout`. As the panel narrows the time hides first, then Size, then Modified, keeping names ≥120px. Header handles resize (double-click resets, arrows step 8px); Modified snaps to its date-only/date+time widths. Right-click the header (or the columns button shown when columns are auto-hidden) for the column menu. Column settings and view mode persist via `vscode.setState`.
- **Menus**: `Menu.tsx` marks itself `data-file-tree-context-menu-root` so the tree treats clicks in it as inside its menu. Entry menu, empty-space folder menu, column menu, and the path bar's ancestor menu all use it.
- **Rename / create**: the tree's `startRenaming(path, { removeIfCanceled })` on a placeholder row; the result is focused via `pendingFocus` by tree path. A new file's parent in tree mode is found through tree paths, never by slicing URIs.
- **Path bar**: shows the current folder in bold, with the path to it dimmed in front (`~/projects / app`): from home when under it (segments flagged `isHome`), else from `/`. If that doesn't fit, just the parent; then nothing. Each dimmed folder is clickable. Clicking the title opens a menu of every ancestor (current checked). Labels come straight from the backend's breadcrumbs.
- **Tree mode**: loaded folder contents are kept by URI (`loadedFolders`); expanded folders are tracked by URI, so they survive moving the root. Moving the root up keeps the old root's listing as a loaded, expanded folder. Click toggles a folder; double-click makes it the root.
- **Sorting**: directories always sort first; within each group (and within each folder in the tree), sortable by name, size, or modified date via column headers
- **Filtering**: the tree's own search (`hide-non-matches`) over loaded entries
- **Keyboard nav**: the tree's (arrows, type-ahead); Enter on a row is a click; Backspace goes up. Focus follows the same entry across rebuilds. Shortcuts (OS-specific, shown in menus): F2 rename, ⌘⌫/Delete, ⌥⌘C copy path, ⌥⇧⌘C copy relative path, ⌥⌘R reveal, Ctrl+Enter open to the side.
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
  { type: "openFile", uri: string, toSide?: boolean }
  { type: "fileAction", action: FileAction, uri: string }
      // reveal | openTerminal | findInFolder | copyPath | copyRelativePath | copyName | duplicate | delete
  { type: "rename", uri: string, newName: string }
  { type: "create", parentUri: string, name: string, kind: "file" | "directory" }

Extension → Webview:
  { type: "initialDirectory", uri: string, isWorkspace: boolean }  // also the Home button's target
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
