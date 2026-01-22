# Quick Start Guide

## Installation Steps

1. **Install Dependencies**
   ```bash
   cd .vscode-storybook-preview
   npm install
   ```

2. **Compile the Extension**
   ```bash
   npm run compile
   ```

3. **Load the Extension in Cursor/VS Code**
   - Press `F5` to open a new Extension Development Host window
   - Or package and install:
     ```bash
     npm install -g @vscode/vsce
     vsce package
     code --install-extension storybook-live-preview-0.1.0.vsix
     ```

4. **Start Storybook**
   ```bash
   cd frontend/react
   npm run storybook
   ```

5. **Test the Extension**
   - Open a React component file that has a `.stories.tsx` file
   - The preview should automatically appear
   - Use `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux) and search for "Toggle Storybook Preview"

## Configuration

Open Settings (`Cmd+,` or `Ctrl+,`) and search for "Storybook Preview":

- **Storybook URL**: Set to your Storybook URL (default: `http://localhost:6006`)
- **Position**: Choose where the preview appears
- **Auto Show**: Enable/disable automatic preview when opening components

## Troubleshooting

- **Preview not showing?** Make sure Storybook is running
- **Wrong story?** Check that your story file has a `title` field in the meta export
- **Not updating?** Click the "Refresh" button in the preview header

