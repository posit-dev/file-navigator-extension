import * as assert from "node:assert";

import * as vscode from "vscode";

const EXTENSION_ID = "posit.file-navigator";

suite("Extension", () => {
	test("is installed", () => {
		assert.ok(vscode.extensions.getExtension(EXTENSION_ID));
	});

	test("activates without error when its view opens", async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(extension);

		// Opening the view activates the extension (VS Code adds the onView event from package.json).
		await vscode.commands.executeCommand("file-navigator.directoryView.focus");

		// isActive is true even if activate() threw, so await activate(): it rejects on failure.
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});
});
