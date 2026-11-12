import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import type { DirectoryEntry, BreadcrumbSegment } from "./protocol";

const STAT_CONCURRENCY = 20;

type IncomingMessage =
	| { type: "getInitialDirectory" }
	| { type: "readDirectory"; requestId: number; uri: string }
	| { type: "readChildren"; uri: string }
	| { type: "watchDirectories"; uris: string[] }
	| { type: "openFile"; uri: string };

function isValidMessage(msg: unknown): msg is IncomingMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	if (typeof m.type !== "string") return false;
	if (m.type === "getInitialDirectory") return true;
	if (m.type === "readDirectory") {
		return typeof m.requestId === "number" && typeof m.uri === "string";
	}
	if (m.type === "readChildren" || m.type === "openFile") {
		return typeof m.uri === "string";
	}
	if (m.type === "watchDirectories") {
		return Array.isArray(m.uris) && m.uris.every((uri) => typeof uri === "string");
	}
	return false;
}

function errorMessage(e: unknown): string {
	return e instanceof vscode.FileSystemError
		? (e.code ?? e.message)
		: e instanceof Error
			? e.message
			: "Unknown error";
}

/**
 * Watches `uri`'s direct entries for creation and deletion (not changes: sizes and dates are
 * shown as of the last read), calling `onChange` after 300ms without further events. Some
 * filesystem providers don't support watching; then it watches nothing.
 */
function watchDirectory(uri: vscode.Uri, onChange: () => void): vscode.Disposable {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let watcher: vscode.FileSystemWatcher | undefined;
	try {
		watcher = vscode.workspace.createFileSystemWatcher(
			new vscode.RelativePattern(uri, "*"),
			false, // create
			true, // change — ignored
			false, // delete
		);
		const notify = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(onChange, 300);
		};
		watcher.onDidCreate(notify);
		watcher.onDidDelete(notify);
	} catch {
		// Some filesystem providers don't support watching
	}
	return new vscode.Disposable(() => {
		if (timer) clearTimeout(timer);
		watcher?.dispose();
	});
}

function computeParentUri(uri: vscode.Uri): string | null {
	const parentPath = path.posix.dirname(uri.path);
	if (parentPath === uri.path) {
		return null;
	}
	return uri.with({ path: parentPath }).toString();
}

function computeBreadcrumbs(uri: vscode.Uri): BreadcrumbSegment[] {
	const segments: BreadcrumbSegment[] = [];
	let current = uri;

	while (true) {
		const parentPath = path.posix.dirname(current.path);
		const label = path.posix.basename(current.path) || "/";
		segments.unshift({
			label,
			uri: current.toString(),
		});
		if (parentPath === current.path) break;
		current = current.with({ path: parentPath });
	}

	return segments;
}

function fileTypeToKind(fileType: vscode.FileType): {
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
} {
	const isSymbolicLink = (fileType & vscode.FileType.SymbolicLink) !== 0;
	const baseType = fileType & ~vscode.FileType.SymbolicLink;
	let kind: "file" | "directory" | "unknown";
	if (baseType === vscode.FileType.Directory) {
		kind = "directory";
	} else if (baseType === vscode.FileType.File) {
		kind = "file";
	} else {
		kind = "unknown";
	}
	return { kind, isSymbolicLink };
}

async function statEntries(
	rawEntries: [string, vscode.FileType][],
	parentUri: vscode.Uri,
): Promise<DirectoryEntry[]> {
	const entries: DirectoryEntry[] = [];
	let i = 0;

	async function next(): Promise<void> {
		while (i < rawEntries.length) {
			const idx = i++;
			const [name, fileType] = rawEntries[idx];
			const { kind, isSymbolicLink } = fileTypeToKind(fileType);
			const entryUri = vscode.Uri.joinPath(parentUri, name);
			let size: number | null = null;
			let mtime: number | null = null;
			try {
				const stat = await vscode.workspace.fs.stat(entryUri);
				size = stat.size;
				mtime = stat.mtime;
			} catch {
				// Permission denied, broken symlink, etc.
			}
			entries[idx] = { name, uri: entryUri.toString(), kind, isSymbolicLink, size, mtime };
		}
	}

	const workers = Array.from({ length: Math.min(STAT_CONCURRENCY, rawEntries.length) }, () =>
		next(),
	);
	await Promise.all(workers);
	return entries;
}

class FileNavigatorViewProvider implements vscode.WebviewViewProvider {
	private currentUri: vscode.Uri | undefined;
	private latestRequestId = -1;
	/** Watches the current directory (the list's, or the tree's root). */
	private rootWatch: vscode.Disposable | undefined;
	/** Watches the folders expanded in the tree, by URI string. */
	private folderWatches = new Map<string, vscode.Disposable>();

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
		};

		webviewView.webview.html = this.getHtml(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((msg: unknown) => {
			if (!isValidMessage(msg)) return;
			this.handleMessage(msg, webviewView.webview);
		});

		webviewView.onDidDispose(() => {
			this.disposeWatches();
		});
	}

	private async handleMessage(msg: IncomingMessage, webview: vscode.Webview): Promise<void> {
		switch (msg.type) {
			case "getInitialDirectory": {
				const folders = vscode.workspace.workspaceFolders;
				const uri = folders && folders.length > 0 ? folders[0].uri : vscode.Uri.file(os.homedir());
				webview.postMessage({ type: "initialDirectory", uri: uri.toString() });
				break;
			}
			case "readDirectory": {
				this.latestRequestId = msg.requestId;

				let parsed: vscode.Uri;
				try {
					parsed = vscode.Uri.parse(msg.uri, true);
				} catch {
					webview.postMessage({
						type: "directoryError",
						requestId: msg.requestId,
						uri: msg.uri,
						error: "Invalid URI",
					});
					return;
				}

				try {
					const rawEntries = await vscode.workspace.fs.readDirectory(parsed);
					const entries = await statEntries(rawEntries, parsed);

					if (msg.requestId !== this.latestRequestId) return;

					this.currentUri = parsed;
					this.rootWatch?.dispose();
					this.rootWatch = watchDirectory(parsed, () =>
						webview.postMessage({ type: "directoryChanged", uri: parsed.toString() }),
					);

					webview.postMessage({
						type: "directoryContents",
						requestId: msg.requestId,
						uri: parsed.toString(),
						entries,
						parentUri: computeParentUri(parsed),
						breadcrumbs: computeBreadcrumbs(parsed),
					});
				} catch (e: unknown) {
					if (msg.requestId !== this.latestRequestId) return;

					webview.postMessage({
						type: "directoryError",
						requestId: msg.requestId,
						uri: msg.uri,
						error: errorMessage(e),
					});
				}
				break;
			}
			// A folder expanded in the tree. Unlike `readDirectory`, several can be in flight at
			// once, so none is discarded; the reply carries the URI as sent.
			case "readChildren": {
				try {
					const parsed = vscode.Uri.parse(msg.uri, true);
					const entries = await statEntries(
						await vscode.workspace.fs.readDirectory(parsed),
						parsed,
					);
					webview.postMessage({ type: "childrenContents", uri: msg.uri, entries });
				} catch (e: unknown) {
					webview.postMessage({ type: "childrenError", uri: msg.uri, error: errorMessage(e) });
				}
				break;
			}
			// The folders expanded in the tree: replaces the set watched besides the root.
			case "watchDirectories": {
				const wanted = new Set(msg.uris);
				for (const [uri, watch] of this.folderWatches) {
					if (wanted.has(uri)) continue;
					watch.dispose();
					this.folderWatches.delete(uri);
				}
				for (const uri of wanted) {
					if (this.folderWatches.has(uri)) continue;
					let parsed: vscode.Uri;
					try {
						parsed = vscode.Uri.parse(uri, true);
					} catch {
						continue;
					}
					this.folderWatches.set(
						uri,
						watchDirectory(parsed, () => webview.postMessage({ type: "directoryChanged", uri })),
					);
				}
				break;
			}
			case "openFile": {
				let parsed: vscode.Uri;
				try {
					parsed = vscode.Uri.parse(msg.uri, true);
				} catch {
					return;
				}
				try {
					await vscode.window.showTextDocument(parsed);
				} catch {
					// File may not be openable as text
				}
				break;
			}
		}
	}

	private disposeWatches(): void {
		this.rootWatch?.dispose();
		this.rootWatch = undefined;
		for (const watch of this.folderWatches.values()) watch.dispose();
		this.folderWatches.clear();
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "dist", "client", "main.js"),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, "dist", "client", "main.css"),
		);

		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
	<link rel="stylesheet" href="${styleUri}">
	<title>File Navigator</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}

	dispose(): void {
		this.disposeWatches();
	}
}

function getNonce(): string {
	let text = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

let provider: FileNavigatorViewProvider | undefined;

export function activate(context: vscode.ExtensionContext): void {
	provider = new FileNavigatorViewProvider(context.extensionUri);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider("file-navigator.directoryView", provider),
	);
}

export function deactivate(): void {
	provider?.dispose();
}
