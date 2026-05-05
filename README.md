# File Navigator

A VS Code / Positron extension that provides a flat directory browser in a sidebar webview. Shows one directory at a time with breadcrumb navigation — not a tree view. Can browse anywhere on the filesystem, not just the workspace.

![VS Code](https://img.shields.io/badge/VS%20Code-%3E%3D1.100.0-blue)

## Features

- **Flat directory view** — displays one directory at a time, like a traditional file manager
- **Breadcrumb navigation** — clickable path segments to jump to any ancestor
- **Sortable columns** — sort by name, size, or modified date (directories always sort first)
- **Client-side filtering** — instant case-insensitive search within the current directory
- **Keyboard navigation** — arrow keys to move, Enter to open, Backspace to go up
- **File watching** — auto-refreshes when files are created or deleted in the current directory
- **URI-based protocol** — supports `file://`, `vscode-remote://`, and any VS Code filesystem provider
- **Symlink indicators** — shows a link badge on symbolic links

## Development

### Commands

```sh
npm run build        # Production build
npm run watch        # Watch mode
npm run check-types  # Type check (server + client)
npm run lint         # Lint with oxlint
```

### Architecture

The extension has two halves:

- **Backend** (`src/extension.ts`) — a `WebviewViewProvider` running in the extension host. It reads directories via `vscode.workspace.fs`, computes URIs, breadcrumbs, and file metadata, and watches the current directory for changes. The backend is authoritative for all navigation logic.

- **Frontend** (`src/frontend/`) — a React app rendered in the webview. It receives fully-formed data from the backend and posts back URIs the backend gave it. The frontend never constructs or manipulates paths/URIs.

### Message Protocol

```
Webview → Extension:
  { type: "getInitialDirectory" }
  { type: "readDirectory", requestId, uri }
  { type: "openFile", uri }

Extension → Webview:
  { type: "initialDirectory", uri }
  { type: "directoryContents", requestId, uri, entries, parentUri, breadcrumbs }
  { type: "directoryError", requestId, uri, error }
  { type: "directoryChanged", uri }
```
