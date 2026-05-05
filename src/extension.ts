import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

type DirectoryEntry = {
	name: string;
	uri: string;
	kind: "file" | "directory" | "unknown";
	isSymbolicLink: boolean;
};

type BreadcrumbSegment = {
	label: string;
	uri: string;
};

type IncomingMessage =
	| { type: "getInitialDirectory" }
	| { type: "readDirectory"; requestId: number; uri: string }
	| { type: "openFile"; uri: string };

function isValidMessage(msg: unknown): msg is IncomingMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	if (typeof m.type !== "string") return false;
	if (m.type === "getInitialDirectory") return true;
	if (m.type === "readDirectory") {
		return typeof m.requestId === "number" && typeof m.uri === "string";
	}
	if (m.type === "openFile") {
		return typeof m.uri === "string";
	}
	return false;
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

	// Walk up from the current URI to the root
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

function fileTypeToKind(
	fileType: vscode.FileType,
): { kind: "file" | "directory" | "unknown"; isSymbolicLink: boolean } {
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

function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
	return entries.sort((a, b) => {
		if (a.kind === "directory" && b.kind !== "directory") return -1;
		if (a.kind !== "directory" && b.kind === "directory") return 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
}

class FileNavigatorViewProvider implements vscode.WebviewViewProvider {
	private currentUri: vscode.Uri | undefined;
	private watcher: vscode.FileSystemWatcher | undefined;
	private debounceTimer: ReturnType<typeof setTimeout> | undefined;
	private webviewView: vscode.WebviewView | undefined;

	constructor(private readonly extensionUri: vscode.Uri) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.webviewView = webviewView;

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
			this.disposeWatcher();
			this.webviewView = undefined;
		});
	}

	private async handleMessage(msg: IncomingMessage, webview: vscode.Webview): Promise<void> {
		switch (msg.type) {
			case "getInitialDirectory": {
				const folders = vscode.workspace.workspaceFolders;
				const uri = folders && folders.length > 0
					? folders[0].uri
					: vscode.Uri.file(os.homedir());
				webview.postMessage({ type: "initialDirectory", uri: uri.toString() });
				break;
			}
			case "readDirectory": {
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
					const entries: DirectoryEntry[] = rawEntries.map(([name, fileType]) => {
						const { kind, isSymbolicLink } = fileTypeToKind(fileType);
						const entryUri = vscode.Uri.joinPath(parsed, name);
						return { name, uri: entryUri.toString(), kind, isSymbolicLink };
					});

					sortEntries(entries);

					this.currentUri = parsed;
					this.setupWatcher(parsed, webview);

					webview.postMessage({
						type: "directoryContents",
						requestId: msg.requestId,
						uri: parsed.toString(),
						entries,
						parentUri: computeParentUri(parsed),
						breadcrumbs: computeBreadcrumbs(parsed),
					});
				} catch (e: unknown) {
					const error = e instanceof vscode.FileSystemError
						? e.code ?? e.message
						: e instanceof Error
							? e.message
							: "Unknown error";
					webview.postMessage({
						type: "directoryError",
						requestId: msg.requestId,
						uri: msg.uri,
						error,
					});
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
					// File may not be openable as text — ignore
				}
				break;
			}
		}
	}

	private setupWatcher(uri: vscode.Uri, webview: vscode.Webview): void {
		this.disposeWatcher();
		try {
			const pattern = new vscode.RelativePattern(uri, "*");
			this.watcher = vscode.workspace.createFileSystemWatcher(
				pattern,
				false, // create
				true,  // change — ignored
				false, // delete
			);

			const notify = () => {
				if (this.debounceTimer) clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => {
					webview.postMessage({
						type: "directoryChanged",
						uri: uri.toString(),
					});
				}, 300);
			};

			this.watcher.onDidCreate(notify);
			this.watcher.onDidDelete(notify);
		} catch {
			// Some filesystem providers don't support watching — tolerate
		}
	}

	private disposeWatcher(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = undefined;
		}
		if (this.watcher) {
			this.watcher.dispose();
			this.watcher = undefined;
		}
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
		this.disposeWatcher();
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
