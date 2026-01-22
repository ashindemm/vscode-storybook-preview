# Installation Guide

## Prerequisites

1. **Node.js and npm** - Make sure you have Node.js installed
2. **Cursor or VS Code** - The extension works with both

## Installation Steps

### Step 1: Install Dependencies

```bash
cd .vscode-storybook-preview
npm install
```

### Step 2: Compile the Extension

```bash
npm run compile
```

This will create the `out/extension.js` file.

### Step 3: Choose Installation Method

#### Option A: Development Mode (Quick Testing)

1. Open the `.vscode-storybook-preview` folder in Cursor/VS Code
2. Press `F5` or go to **Run > Start Debugging**
3. A new "Extension Development Host" window will open
4. The extension is now active in that window
5. Test it by opening a React component file with a Storybook story

**Note:** The extension only works in the Extension Development Host window when using this method.

#### Option B: Package and Install (Permanent)

1. **Install VS Code Extension Manager:**
   ```bash
   npm install -g @vscode/vsce
   ```

2. **Package the extension:**
   ```bash
   cd .vscode-storybook-preview
   vsce package
   ```
   
   This creates a `.vsix` file (e.g., `storybook-live-preview-0.1.0.vsix`)

3. **Install the extension:**
   
   **In VS Code/Cursor:**
   - Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
   - Type "Extensions: Install from VSIX..."
   - Select the `.vsix` file you just created
   
   **Or from command line:**
   ```bash
   code --install-extension storybook-live-preview-0.1.0.vsix
   ```

4. **Reload Cursor/VS Code** to activate the extension

#### Option C: Symlink Method (Development)

1. **Find your extensions directory:**
   - **macOS:** `~/.cursor/extensions` or `~/.vscode/extensions`
   - **Linux:** `~/.cursor/extensions` or `~/.vscode/extensions`
   - **Windows:** `%USERPROFILE%\.cursor\extensions` or `%USERPROFILE%\.vscode\extensions`

2. **Create a symlink:**
   ```bash
   # macOS/Linux
   ln -s /Users/ashinde/Documents/GitHub/chaturbate/.vscode-storybook-preview ~/.cursor/extensions/storybook-live-preview
   
   # Windows (PowerShell as Administrator)
   New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.cursor\extensions\storybook-live-preview" -Target "C:\path\to\chaturbate\.vscode-storybook-preview"
   ```

3. **Reload Cursor/VS Code**

## Verify Installation

1. Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
2. Type "Toggle Storybook Preview" - you should see the command
3. Open Settings and search for "Storybook Preview" - you should see the configuration options

## First Use

1. **Start Storybook** in your project:
   ```bash
   cd frontend/react
   npm run storybook
   ```

2. **Open a React component** that has a `.stories.tsx` file (e.g., `Person.tsx`)

3. **The preview should automatically appear** (if auto-show is enabled)

4. **If not, use the command:** `Cmd+Shift+P` → "Toggle Storybook Preview"

## Troubleshooting

### Extension not appearing
- Make sure you compiled: `npm run compile`
- Check that `out/extension.js` exists
- Reload Cursor/VS Code window

### Preview not showing
- Verify Storybook is running at `http://localhost:6006`
- Check the Storybook URL in settings (Settings → Search "Storybook Preview")
- Make sure the component file has a corresponding `.stories.tsx` file

### TypeScript errors
- Run `npm install` to ensure all dependencies are installed
- Run `npm run compile` to check for compilation errors

