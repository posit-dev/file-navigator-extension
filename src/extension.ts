import * as os from "os";
import * as path from "path";

import * as vscode from "vscode";

import {
	FILE_ACTIONS,
	type BreadcrumbSegment,
	type DirectoryEntry,
	type FileAction,
} from "./protocol";

const STAT_CONCURRENCY = 20;

type IncomingMessage =
	| { type: "getInitialDirectory" }
	| { type: "readDirectory"; requestId: number; uri: string }
	| { type: "readChildren"; uri: string }
	| { type: "watchDirectories"; uris: string[] }
	| { type: "openFile"; uri: string; toSide?: boolean }
	| { type: "fileAction"; action: FileAction; uri: string }
	| { type: "rename"; uri: string; newName: string }
	| { type: "create"; parentUri: string; name: string; kind: "file" | "directory" };

function isValidMessage(msg: unknown): msg is IncomingMessage {
	if (typeof msg !== "object" || msg === null) return false;
	const m = msg as Record<string, unknown>;
	if (typeof m.type !== "string") return false;
	if (m.type === "getInitialDirectory") return true;
	if (m.type === "readDirectory") {
		return typeof m.requestId === "number" && typeof m.uri === "string";
	}
	if (m.type === "readChildren") {
		return typeof m.uri === "string";
	}
	if (m.type === "openFile") {
		return typeof m.uri === "string" && (m.toSide === undefined || typeof m.toSide === "boolean");
	}
	if (m.type === "fileAction") {
		return typeof m.uri === "string" && FILE_ACTIONS.includes(m.action as FileAction);
	}
	if (m.type === "rename") {
		return typeof m.uri === "string" && typeof m.newName === "string";
	}
	if (m.type === "create") {
		return (
			typeof m.parentUri === "string" &&
			typeof m.name === "string" &&
			(m.kind === "file" || m.kind === "directory")
		);
	}
	if (m.type === "watchDirectories") {
		return Array.isArray(m.uris) && m.uris.every((uri) => typeof uri === "string");
	}
	return false;
}

function actionVerb(action: FileAction): string {
	switch (action) {
		case "reveal":
			return "reveal";
		case "openTerminal":
			return "open a terminal in";
		case "findInFolder":
			return "search in";
		case "copyPath":
		case "copyRelativePath":
			return "copy the path of";
		case "copyName":
			return "copy the name of";
		case "duplicate":
			return "duplicate";
		case "delete":
			return "delete";
	}
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

function parseUri(value: string): vscode.Uri | undefined {
	try {
		return vscode.Uri.parse(value, true);
	} catch {
		return undefined;
	}
}

/** Whether `name` can name an entry: not empty, not `.` or `..`, no path separators. */
function isValidName(name: string): boolean {
	return name.trim() !== "" && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}

function parentOf(uri: vscode.Uri): vscode.Uri {
	return uri.with({ path: path.posix.dirname(uri.path) });
}

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
	try {
		return ((await vscode.workspace.fs.stat(uri)).type & vscode.FileType.Directory) !== 0;
	} catch {
		return false;
	}
}

/** A free sibling name for a copy: `name copy.ext`, then `name copy 2.ext`, and so on. */
async function copyTarget(uri: vscode.Uri, directory: boolean): Promise<vscode.Uri> {
	const parent = parentOf(uri);
	const name = path.posix.basename(uri.path);
	const dot = directory ? -1 : name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	for (let i = 1; ; i++) {
		const candidate = vscode.Uri.joinPath(parent, `${stem} copy${i === 1 ? "" : ` ${i}`}${ext}`);
		if (!(await exists(candidate))) return candidate;
	}
}

/** The path to copy: the filesystem path where there is one, else the URI. */
function copyablePath(uri: vscode.Uri): string {
	return uri.scheme === "file" || uri.scheme === "vscode-remote" ? uri.fsPath : uri.toString();
}

function computeParentUri(uri: vscode.Uri): string | null {
	const parentPath = path.posix.dirname(uri.path);
	if (parentPath === uri.path) {
		return null;
	}
	return uri.with({ path: parentPath }).toString();
}

/** Every folder from the root down to `uri`. The user's home folder is labeled `~`. */
function computeBreadcrumbs(uri: vscode.Uri): BreadcrumbSegment[] {
	const segments: BreadcrumbSegment[] = [];
	const home = vscode.Uri.file(os.homedir()).toString();
	let current = uri;

	while (true) {
		const parentPath = path.posix.dirname(current.path);
		const uriString = current.toString();
		if (uriString === home) {
			segments.unshift({ label: "~", uri: uriString, isHome: true });
		} else {
			segments.unshift({ label: path.posix.basename(current.path) || "/", uri: uriString });
		}
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
				// Also the Home button's target: the first workspace folder, else the home directory.
				const folder = vscode.workspace.workspaceFolders?.[0];
				const uri = folder ? folder.uri : vscode.Uri.file(os.homedir());
				webview.postMessage({
					type: "initialDirectory",
					uri: uri.toString(),
					isWorkspace: folder !== undefined,
				});
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
					await vscode.window.showTextDocument(
						parsed,
						msg.toSide ? { viewColumn: vscode.ViewColumn.Beside } : undefined,
					);
				} catch {
					// File may not be openable as text
				}
				break;
			}
			case "fileAction": {
				const uri = parseUri(msg.uri);
				if (uri) await this.runFileAction(msg.action, uri, webview);
				break;
			}
			case "rename": {
				const uri = parseUri(msg.uri);
				if (uri) await this.rename(uri, msg.newName, webview);
				break;
			}
			case "create": {
				const parent = parseUri(msg.parentUri);
				if (parent) await this.create(parent, msg.name, msg.kind, webview);
				break;
			}
		}
	}

	/** Tells the webview a folder's contents changed, without waiting for its watcher. */
	private notifyChanged(webview: vscode.Webview, directory: vscode.Uri): void {
		webview.postMessage({ type: "directoryChanged", uri: directory.toString() });
	}

	private async runFileAction(
		action: FileAction,
		uri: vscode.Uri,
		webview: vscode.Webview,
	): Promise<void> {
		const name = path.posix.basename(uri.path);
		try {
			switch (action) {
				case "reveal":
					await vscode.commands.executeCommand("revealFileInOS", uri);
					break;
				case "openTerminal": {
					const cwd = (await isDirectory(uri)) ? uri : parentOf(uri);
					vscode.window.createTerminal({ cwd }).show();
					break;
				}
				case "findInFolder":
					await vscode.commands.executeCommand("workbench.action.findInFiles", {
						filesToInclude: vscode.workspace.asRelativePath(uri, false),
					});
					break;
				case "copyPath":
					await vscode.env.clipboard.writeText(copyablePath(uri));
					break;
				case "copyRelativePath":
					await vscode.env.clipboard.writeText(vscode.workspace.asRelativePath(uri, false));
					break;
				case "copyName":
					await vscode.env.clipboard.writeText(name);
					break;
				case "duplicate": {
					const target = await copyTarget(uri, await isDirectory(uri));
					await vscode.workspace.fs.copy(uri, target, { overwrite: false });
					this.notifyChanged(webview, parentOf(uri));
					break;
				}
				case "delete":
					await this.delete(uri, name);
					this.notifyChanged(webview, parentOf(uri));
					break;
			}
		} catch (e: unknown) {
			vscode.window.showErrorMessage(
				`Could not ${actionVerb(action)} '${name}': ${errorMessage(e)}`,
			);
		}
	}

	/** Moves to the trash after confirming; where there's no trash, offers to delete permanently. */
	private async delete(uri: vscode.Uri, name: string): Promise<void> {
		const trash = process.platform === "win32" ? "Recycle Bin" : "Trash";
		const directory = await isDirectory(uri);
		const confirm = `Move to ${trash}`;
		const choice = await vscode.window.showWarningMessage(
			`Are you sure you want to delete '${name}'?`,
			{
				modal: true,
				detail: `You can restore this ${directory ? "folder" : "file"} from the ${trash}.`,
			},
			confirm,
		);
		if (choice !== confirm) return;
		try {
			await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: true });
		} catch {
			const permanently = "Delete Permanently";
			const fallback = await vscode.window.showWarningMessage(
				`Could not move '${name}' to the ${trash}. Delete it permanently?`,
				{ modal: true, detail: "This can't be undone." },
				permanently,
			);
			if (fallback !== permanently) return;
			await vscode.workspace.fs.delete(uri, { recursive: true, useTrash: false });
		}
	}

	/**
	 * Renames as the Explorer does (a workspace edit, so open editors follow the file). The folder
	 * is refreshed either way: on failure that undoes the name the list already shows.
	 */
	private async rename(uri: vscode.Uri, newName: string, webview: vscode.Webview): Promise<void> {
		const oldName = path.posix.basename(uri.path);
		const parent = parentOf(uri);
		try {
			if (!isValidName(newName)) throw new Error(`'${newName}' is not a valid name`);
			const target = vscode.Uri.joinPath(parent, newName);
			// A change of case only names the same entry on case-insensitive filesystems.
			const caseOnly = newName.toLowerCase() === oldName.toLowerCase();
			if (!caseOnly && (await exists(target))) throw new Error(`'${newName}' already exists`);
			const edit = new vscode.WorkspaceEdit();
			edit.renameFile(uri, target, { overwrite: false });
			if (!(await vscode.workspace.applyEdit(edit))) throw new Error("the rename was not applied");
		} catch (e: unknown) {
			vscode.window.showErrorMessage(`Could not rename '${oldName}': ${errorMessage(e)}`);
		} finally {
			this.notifyChanged(webview, parent);
		}
	}

	/** Creates an empty file (and opens it, as the Explorer does) or a folder. */
	private async create(
		parent: vscode.Uri,
		name: string,
		kind: "file" | "directory",
		webview: vscode.Webview,
	): Promise<void> {
		try {
			if (!isValidName(name)) throw new Error(`'${name}' is not a valid name`);
			const target = vscode.Uri.joinPath(parent, name);
			if (await exists(target)) throw new Error(`'${name}' already exists`);
			if (kind === "directory") {
				await vscode.workspace.fs.createDirectory(target);
			} else {
				await vscode.workspace.fs.writeFile(target, new Uint8Array());
				await vscode.window.showTextDocument(target, { preview: false });
			}
		} catch (e: unknown) {
			vscode.window.showErrorMessage(`Could not create '${name}': ${errorMessage(e)}`);
		} finally {
			this.notifyChanged(webview, parent);
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
