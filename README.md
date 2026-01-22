# Storybook Live Preview Extension

A Cursor/VS Code extension that shows a live preview of React components when they have an associated Storybook story.

## Features

- 🎨 **Automatic Detection**: Automatically detects when you open a React component file that has a Storybook story
- 🔄 **Live Updates**: Preview updates automatically when story files change
- 🚀 **Quick Access**: Toggle preview on/off with a command
- 🎯 **Smart Story Detection**: Automatically extracts story IDs from Storybook story files

## Installation

### From Source

1. Clone or copy this extension directory
2. Install dependencies:
   ```bash
   cd .vscode-storybook-preview
   npm install
   ```
3. Compile the extension:
   ```bash
   npm run compile
   ```
4. Press `F5` in VS Code/Cursor to open a new window with the extension loaded
5. Or package and install:
   ```bash
   npm install -g vsce
   vsce package
   code --install-extension storybook-live-preview-0.1.0.vsix
   ```
   Press `Ctrl+Shift+P` and find `Install from VSIX` option in the IDE to install the extension.

## Configuration

Open Settings and search for "Storybook Preview" to configure:

- **Storybook URL**: The URL where Storybook is running (default: `http://localhost:6006`)
- **Storybook Build & Run command**: Commands to run and build storybook locally
- **Auto Start**: Automatically build and start Storybook if its not running
- **Auto Show**: Automatically show preview when opening components with stories

## Usage

1. **Start Storybook**: Make sure Storybook is running in your project:
   ```bash
   npm run storybook
   # or
   yarn storybook
   ```

2. **Open a Component**: Open any React component file (`.tsx`, `.ts`, `.jsx`, `.js`) that has a corresponding `.stories.tsx` file

3. **View Preview**: The preview will automatically appear (if auto-show is enabled) showing the first story for that component

4. **Toggle Preview**: Use the command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and search for "Toggle Storybook Preview"

## How It Works

The extension:
1. Monitors the active editor for React component files
2. Looks for corresponding `.stories.tsx` or `.stories.ts` files in the same directory
3. Extracts the Storybook story ID from the story file's `title` field or filename pattern.
4. Embeds Storybook's iframe in a webview panel
5. Updates the preview when story files change

## Story ID Detection

The extension extracts story IDs from:
- The `title` field in the story's meta export (e.g., `title: "Design System/Atoms/Button"`)
- Falls back to the file path if no title is found

Make sure your Storybook stories have a `title` field in the meta export for best results:

```typescript
const meta: Meta<typeof Button> = {
  component: Button,
  title: "Design System/Atoms/Button", // This will be used to build the story ID
  // ...
}
```

## Troubleshooting

### Preview Not Showing

- Make sure Storybook is running at the configured URL (default: `http://localhost:6006`)
- Check that the component file has a corresponding `.stories.tsx` file in the same directory
- Verify the story file has a `title` field in the meta export

### Wrong Story Displayed

- The extension uses the story's `title` field to build the story ID
- If multiple stories exist, it will show the first/default story
- You can manually navigate to other stories using Storybook's controls in the preview

### Preview Not Updating

- The extension watches for file changes, but there may be a delay
- Try clicking the "Refresh" button in the preview header
- Make sure the story file is saved

## Development

To contribute or modify this extension:

1. Make changes to `src/extension.ts`
2. Compile: `npm run compile`
3. Reload the extension window (press `Ctrl+R` or `Cmd+R` in the extension development host)
4. Or package the changes and raise a PR to this repo.

