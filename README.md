# File Navigator <a href="https://posit.co"><img src="https://cdn.jsdelivr.net/gh/posit-dev/supported-by-posit/img/badge.png" width="100" alt="Supported by Posit" align="right" /></a>

File Navigator is a file browser for [Positron](https://positron.posit.co/) and VS Code. It adds a view to the activity bar that shows the files in a folder with their size and date modified. You can browse to any folder on your computer or remote host, not only the folders in your workspace.

## Features

- **List or tree**: show one folder at a time as a list, or show a tree that opens folders in place. Use the List | Tree toggle in the toolbar to change between the two.
- **Go anywhere**: use the Up button to go to the parent folder, and the Home button to go back to your workspace folder (or your home folder, when no workspace is open). Click a folder in the path bar to go to it, or click the name of the current folder to choose from all of its parent folders. In the tree, double-click a folder to make it the root.
- **Size and date modified**: sort by name, size, or date modified with the column headers. Drag a column edge to change its width. Right-click a column header to show or hide columns. When the view is narrow, columns hide automatically.
- **Filter**: type in the filter box to show only the files that match.
- **File operations**: right-click a file or folder to open it, open it to the side, rename, duplicate, or delete it, copy its path, reveal it in your file manager, or open a terminal there. Right-click the empty space below the files to make a new file or folder.
- **View options**: the More Actions (…) menu lets you put folders first or mix them with files, show or hide hidden files (names that start with `.`), and collapse all folders in the tree.
- **Live updates**: the view updates automatically when files are created or deleted in the folders you can see. Use the Refresh button to update it yourself.

File Navigator remembers your view settings when you hide the view and show it again.

## Keyboard shortcuts

Use the arrow keys to move between files, and type the start of a name to jump to it. Press <kbd>Enter</kbd> to open a file or folder, and <kbd>Backspace</kbd> to go to the parent folder.

| Action | macOS | Windows and Linux |
|--------|-------|-------------------|
| Rename | <kbd>F2</kbd> | <kbd>F2</kbd> |
| Delete | <kbd>Cmd+Backspace</kbd> | <kbd>Delete</kbd> |
| Open to the side | <kbd>Ctrl+Enter</kbd> | <kbd>Ctrl+Enter</kbd> |
| Copy path | <kbd>Option+Cmd+C</kbd> | <kbd>Shift+Alt+C</kbd> |
| Copy relative path | <kbd>Option+Shift+Cmd+C</kbd> | |
| Reveal in file manager | <kbd>Option+Cmd+R</kbd> | <kbd>Shift+Alt+R</kbd> |

## Settings

- `fileNavigator.enabled` (default `true`): show File Navigator in the activity bar. When this setting is `false`, the view and its activity bar icon are hidden. The change applies immediately, without a reload.

## Getting help

If you find a bug or have an idea for a feature, open an issue in the [GitHub repository](https://github.com/posit-dev/file-navigator-extension/issues). To contribute, see [CONTRIBUTING.md](https://github.com/posit-dev/file-navigator-extension/blob/main/CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
