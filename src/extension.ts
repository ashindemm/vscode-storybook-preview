import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import * as http from "http";
import * as https from "https";

let previewPanel: vscode.WebviewPanel | undefined;
let currentDisposable: vscode.Disposable | undefined;
let updateTimeout: NodeJS.Timeout | undefined;
let fileWatcher: vscode.FileSystemWatcher | undefined;
let previewViewColumn: vscode.ViewColumn | undefined;
let editorButtonDisposable: vscode.Disposable | undefined;
let storybookProcess: any = undefined;
let buildProcess: any = undefined;
let messageHandlerDisposable: vscode.Disposable | undefined;
let userExplicitlyClosedPreview: boolean = false;
let editorButtonUpdateTimeout: NodeJS.Timeout | undefined;
let activeEditorChangeTimeout: NodeJS.Timeout | undefined;
let saveDocumentDisposable: vscode.Disposable | undefined;
let currentComponentPath: string | undefined;
let currentStoryPath: string | undefined;
let lastActiveEditorPath: string | undefined;

// Function to update editor button visibility
async function updateEditorButton(editor: vscode.TextEditor | undefined) {
    if (editorButtonDisposable) {
        editorButtonDisposable.dispose();
        editorButtonDisposable = undefined;
    }
    
    if (!editor) {
        await vscode.commands.executeCommand("setContext", "storybookPreview.hasStory", false);
        return;
    }
    
    const fileName = editor.document.fileName;
    if (!fileName.match(/\.(tsx|ts|jsx|js)$/)) {
        await vscode.commands.executeCommand("setContext", "storybookPreview.hasStory", false);
        return;
    }
    
    // Check if this is a story file or a component file with a story
    let hasStory = false;
    if (fileName.includes(".stories.")) {
        // It's a story file, check if component exists
        const componentPath = await findComponentFile(fileName);
        hasStory = componentPath !== null;
    } else {
        // It's a component file, check if story exists
    const storyPath = await findStoryFile(fileName);
        hasStory = storyPath !== null;
    }
    
    if (hasStory) {
        // Show the button by updating the command's when clause context
        await vscode.commands.executeCommand("setContext", "storybookPreview.hasStory", true);
    } else {
        await vscode.commands.executeCommand("setContext", "storybookPreview.hasStory", false);
    }
}

export function activate(context: vscode.ExtensionContext) {
    console.log("Storybook Live Preview extension is now active");

    // Register toggle command
    const toggleCommand = vscode.commands.registerCommand(
        "storybookPreview.toggle",
        async () => {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return;
            }
            
            const fileName = activeEditor.document.fileName;
            let fileToShow: string | null = null;
            
            // Check if current file is a story file or a component file with a story
            if (fileName.includes(".stories.")) {
                // It's a story file, use it directly
                fileToShow = fileName;
            } else {
                // It's a component file, check if story exists
                const storyPath = await findStoryFile(fileName);
                if (storyPath) {
                    fileToShow = fileName;
                }
            }
            
            if (!fileToShow) {
                vscode.window.showInformationMessage("No Storybook story found for this component.");
                return;
            }
            
            if (previewPanel) {
                // User explicitly closed the preview
                userExplicitlyClosedPreview = true;
                previewPanel.dispose();
                // Button state will be updated in onDidDispose
            } else {
                // User explicitly opened the preview, reset the flag
                userExplicitlyClosedPreview = false;
                showPreview(context, fileToShow);
                // Button state will be updated after preview opens
            }
        }
    );

    context.subscriptions.push(toggleCommand);

    // Update button when editor changes (debounced to reduce lag)
    const onDidChangeActiveEditorForButton = vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
            // Clear previous timeout
            if (editorButtonUpdateTimeout) {
                clearTimeout(editorButtonUpdateTimeout);
            }
            // Debounce updates to reduce lag
            editorButtonUpdateTimeout = setTimeout(() => {
                updateEditorButton(editor);
            }, 150); // 150ms debounce
        }
    );
    context.subscriptions.push(onDidChangeActiveEditorForButton);

    // Update button for initial editor
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        updateEditorButton(activeEditor);
    }

    // Auto-show preview when component with story is opened
    const config = vscode.workspace.getConfiguration("storybookPreview");
    if (config.get("autoShow", true)) {
        const onDidChangeActiveEditor = vscode.window.onDidChangeActiveTextEditor(
            (editor) => {
                // Clear previous timeout
                if (activeEditorChangeTimeout) {
                    clearTimeout(activeEditorChangeTimeout);
                }
                
                if (!editor) {
                    return;
                }
                
                const fileName = editor.document.fileName;
                
                // Fast path: If switching to the same file, skip all operations
                if (lastActiveEditorPath === fileName) {
                    return;
                }
                
                // Don't update preview if the active editor is the preview panel itself
                if (previewViewColumn && editor.viewColumn === previewViewColumn) {
                    // This is the preview panel, ignore it
                    return;
                }
                
                // Fast path: If switching to a file that's already being previewed, skip file operations
                // Use simple string comparison first (faster than path.resolve)
                if (previewPanel && fileName) {
                    const isCurrentFile = (currentComponentPath && fileName === currentComponentPath) ||
                                        (currentStoryPath && fileName === currentStoryPath);
                    if (isCurrentFile) {
                        // File is already being previewed, just update tracked path and return immediately
                        lastActiveEditorPath = fileName;
                        return;
                    }
                }
                
                // Update tracked path immediately to prevent duplicate processing
                lastActiveEditorPath = fileName;
                
                // Debounce to reduce lag when switching files
                activeEditorChangeTimeout = setTimeout(async () => {
                    if (!editor) {
                        return;
                    }
                    
                    const currentFileName = editor.document.fileName;
                    
                    // Skip if file changed while we were waiting
                    if (currentFileName !== fileName) {
                        return;
                    }
                    
                    let fileToShow: string | null = null;
                    
                    // Check if current file is a story file or a component file with a story
                    if (currentFileName.includes(".stories.")) {
                        // It's a story file, use it directly
                        fileToShow = currentFileName;
                    } else {
                        // It's a component file, check if story exists
                        const storyPath = await findStoryFile(currentFileName);
                        if (storyPath) {
                            fileToShow = currentFileName;
                        }
                    }
                    
                    if (fileToShow) {
                        // Only auto-open if user didn't explicitly close it
                        if (!userExplicitlyClosedPreview) {
                            showPreview(context, fileToShow);
                        }
                    } else if (previewPanel) {
                        // Hide preview if no story found (but only if we're not in the preview panel)
                        // Don't dispose if user is viewing the preview
                        if (editor.viewColumn !== previewViewColumn) {
                            previewPanel.dispose();
                        }
                    }
                }, 50); // Reduced debounce to 50ms for faster response
            }
        );
        context.subscriptions.push(onDidChangeActiveEditor);

        // Ensure files NEVER open in the preview panel (but let VS Code handle normal file opening behavior)
        // Only intervene if a file somehow ends up in the preview panel's column
        const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
            // Only handle if preview panel is open
            if (!previewPanel || !previewViewColumn) {
                return;
            }

            // Skip if this is not a text file (e.g., images, etc.)
            if (!document.uri.fsPath.match(/\.(tsx|ts|jsx|js|md|mdx|json|css|scss|html)$/)) {
                return;
            }

            // Small delay to let VS Code finish opening, then check if file ended up in preview panel's column
            setTimeout(() => {
                // Check if document is open in the preview panel's column
                const editors = vscode.window.visibleTextEditors.filter(
                    e => e.document.uri.toString() === document.uri.toString()
                );
                
                for (const editor of editors) {
                    // If the document is in the preview panel's column, move it to ViewColumn.One
                    if (editor.viewColumn === previewViewColumn) {
                        // Find the first available editor column that's not the preview panel
                        let targetColumn = vscode.ViewColumn.One;
                        const otherEditors = vscode.window.visibleTextEditors.filter(
                            e => e.viewColumn && e.viewColumn !== previewViewColumn && e !== editor
                        );
                        if (otherEditors.length > 0 && otherEditors[0].viewColumn) {
                            targetColumn = otherEditors[0].viewColumn;
                        }
                        
                        vscode.window.showTextDocument(document, {
                            viewColumn: targetColumn,
                            preserveFocus: false
                        });
                        break; // Only need to move it once
                    }
                }
            }, 100); // Slightly longer delay to let VS Code finish its default behavior
        });
        context.subscriptions.push(onDidOpenTextDocument);

        // Check initial editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
            const fileName = activeEditor.document.fileName;
            
            if (fileName.includes(".stories.")) {
                // It's a story file, use it directly
                if (!userExplicitlyClosedPreview) {
                    showPreview(context, fileName);
                }
            } else {
                // It's a component file, check if story exists
                findStoryFile(fileName).then((storyPath) => {
                    if (storyPath && !userExplicitlyClosedPreview) {
                        showPreview(context, fileName);
                }
            });
            }
        }
    }
}

export function deactivate() {
    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }
    if (editorButtonUpdateTimeout) {
        clearTimeout(editorButtonUpdateTimeout);
    }
    if (activeEditorChangeTimeout) {
        clearTimeout(activeEditorChangeTimeout);
    }
    if (fileWatcher) {
        fileWatcher.dispose();
    }
    if (saveDocumentDisposable) {
        saveDocumentDisposable.dispose();
    }
    if (storybookProcess) {
        // Note: We don't kill the process automatically as the user might want it to keep running
        // If you want to kill it, uncomment the following:
        // storybookProcess.kill();
        storybookProcess = undefined;
    }
    if (editorButtonDisposable) {
        editorButtonDisposable.dispose();
    }
    if (previewPanel) {
        previewPanel.dispose();
    }
    if (currentDisposable) {
        currentDisposable.dispose();
    }
}

async function findStoryFile(componentPath: string): Promise<string | null> {
    // Check if it's a React component file
    if (
        !componentPath.match(/\.(tsx|ts|jsx|js)$/) ||
        componentPath.includes(".stories.")
    ) {
        return null;
    }

    const dir = path.dirname(componentPath);
    const basename = path.basename(componentPath, path.extname(componentPath));

    // Try different story file patterns
    const storyPatterns = [
        path.join(dir, `${basename}.stories.tsx`),
        path.join(dir, `${basename}.stories.ts`),
        path.join(dir, `${basename}.stories.jsx`),
        path.join(dir, `${basename}.stories.js`),
    ];

    for (const storyPath of storyPatterns) {
        if (fs.existsSync(storyPath)) {
            return storyPath;
        }
    }

    return null;
}

async function findComponentFile(storyPath: string): Promise<string | null> {
    // Check if it's a story file
    if (!storyPath.includes(".stories.")) {
        return null;
    }

    const dir = path.dirname(storyPath);
    const basename = path.basename(storyPath, path.extname(storyPath));
    
    // Remove .stories from the basename
    const componentBasename = basename.replace(/\.stories$/, "");

    // Try different component file patterns
    const componentPatterns = [
        path.join(dir, `${componentBasename}.tsx`),
        path.join(dir, `${componentBasename}.ts`),
        path.join(dir, `${componentBasename}.jsx`),
        path.join(dir, `${componentBasename}.js`),
    ];

    for (const componentPath of componentPatterns) {
        if (fs.existsSync(componentPath)) {
            return componentPath;
        }
    }

    return null;
}

function findSrcDirectory(storyPath: string, workspaceRoot: string): string | null {
    // Try to find the src directory by looking for common patterns
    // Storybook config is typically in frontend/react/.storybook/main.ts
    // and stories are in frontend/react/src/...
    
    let currentPath = storyPath;
    const maxDepth = 10; // Prevent infinite loops
    let depth = 0;
    
    while (depth < maxDepth) {
        const dir = path.dirname(currentPath);
        if (dir === currentPath) {
            // Reached root
            break;
        }
        
        // Check if this directory contains a .storybook folder
        const storybookDir = path.join(dir, ".storybook");
        if (fs.existsSync(storybookDir)) {
            // Found .storybook, so src should be at dir/src
            const srcDir = path.join(dir, "src");
            if (fs.existsSync(srcDir)) {
                return srcDir;
            }
        }
        
        // Also check if current directory is named "src"
        if (path.basename(dir) === "src") {
            return dir;
        }
        
        currentPath = dir;
        depth++;
    }
    
    // Fallback: look for src directory relative to workspace root
    const possibleSrcPaths = [
        path.join(workspaceRoot, "frontend", "react", "src"),
        path.join(workspaceRoot, "src"),
        path.join(workspaceRoot, "frontend", "react", "src", "components"),
    ];
    
    for (const srcPath of possibleSrcPaths) {
        if (fs.existsSync(srcPath)) {
            // Make sure it's actually a src directory (has components or similar)
            return srcPath;
        }
    }
    
    return null;
}

/**
 * Converts camelCase/PascalCase to kebab-case, handling acronyms correctly.
 * Examples:
 * - UploadedID -> uploaded-id (not uploaded-i-d)
 * - PrimaryButton -> primary-button
 * - XMLParser -> xml-parser
 * - HTTPSRequest -> https-request
 */
function camelToKebab(str: string): string {
    // Insert dash before capital letter if:
    // 1. It's preceded by a lowercase letter, OR
    // 2. It's followed by a lowercase letter (and not preceded by another capital)
    return str
        .replace(/([a-z])([A-Z])/g, "$1-$2") // lowercase followed by uppercase
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2") // sequence of capitals followed by capital+lowercase
        .toLowerCase();
}

function extractStoryId(storyContent: string, storyPath: string, workspaceRoot: string): string {
    try {
        // Primary method: Extract title from meta export (used by design system components)
        // Storybook uses the title field to generate story IDs
        // e.g., title: "Design System/Molecules/ScrollButton" -> "design-system-molecules-scrollbutton"
        // Handle both object literal: title: "..." and JSX: <Meta title="..." />
        // IMPORTANT: Only match title in meta object, not in story args
        // Strategy: Find title that appears before any "export const" (story exports) and not inside "args:"
        let titleMatch: RegExpMatchArray | null = null;
        
        // Split content at first story export to only search in meta section
        const storyExportIndex = storyContent.search(/export\s+(?:const|function)\s+\w+/);
        const metaSection = storyExportIndex > 0 ? storyContent.substring(0, storyExportIndex) : storyContent;
        
        // Look for title in meta section, but exclude any that's inside args: { ... }
        // First, try to find title that's clearly in a meta object (has Meta type annotation nearby)
        const metaWithTitleMatch = metaSection.match(/(?:const|let|var)\s+\w+\s*:\s*Meta[^=]*=\s*\{[^}]*title:\s*["']([^"']+)["']/s);
        if (metaWithTitleMatch) {
            titleMatch = metaWithTitleMatch;
        } else {
            // Try to find title in meta section, but make sure it's not inside args: { ... }
            // Look for title: that appears before any args: in the meta section
            const argsIndex = metaSection.indexOf('args:');
            if (argsIndex === -1) {
                // No args in meta section, safe to look for title
                titleMatch = metaSection.match(/title:\s*["']([^"']+)["']/);
                if (!titleMatch) {
                    titleMatch = metaSection.match(/title:\s*`([^`]+)`/);
                }
            } else {
                // args exists, only look for title before args
                const beforeArgs = metaSection.substring(0, argsIndex);
                titleMatch = beforeArgs.match(/title:\s*["']([^"']+)["']/);
                if (!titleMatch) {
                    titleMatch = beforeArgs.match(/title:\s*`([^`]+)`/);
                }
            }
        }
        
        // Try JSX format: <Meta title="..." />
        if (!titleMatch) {
            titleMatch = storyContent.match(/<Meta\s+title=["']([^"']+)["']/);
        }
        if (titleMatch && titleMatch[1]) {
            const title = titleMatch[1];
            // Convert title to Storybook ID format: lowercase, replace spaces/slashes/underscores with dashes
            let storyId = title
                .toLowerCase()
                .replace(/\s+/g, "-") // Replace spaces with dashes
                .replace(/\//g, "-") // Replace slashes with dashes
                .replace(/_/g, "-") // Replace underscores with dashes
                .replace(/-+/g, "-") // Replace multiple dashes with single dash
                .replace(/^-|-$/g, ""); // Remove leading/trailing dashes
            
            // Try to get the first exported story name to build full story ID
            // Look for exported story names like: export const PrimaryButton
            // Skip the default export (export default meta)
            const storyExports = storyContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
            for (const match of storyExports) {
                const exportName = match[1];
                // Skip if it's the meta export
                if (exportName.toLowerCase().includes("meta")) {
                    continue;
                }
                // Found the first story export
                const storyName = camelToKebab(exportName);
                return `${storyId}--${storyName}`;
            }
            
            // If no story exports found, return just the component ID
            // Storybook will show the default story
            return storyId;
        }
        
        // Fallback method: Extract from directory structure
        // Storybook generates IDs from the file path relative to the src directory
        const srcDir = findSrcDirectory(storyPath, workspaceRoot);
        
        if (srcDir) {
            // Get path relative to src directory
            const relativeToSrc = path.relative(srcDir, storyPath);
            
            // Get the directory and filename separately
            const dir = path.dirname(relativeToSrc);
            const filename = path.basename(relativeToSrc, path.extname(relativeToSrc));
            const dirname = path.basename(dir);
            
            // Remove .stories extension from filename
            const baseFilename = filename.replace(/\.stories$/, "");
            
            // If the directory name matches the filename, don't include filename twice
            // e.g., Person/Person.stories.tsx -> Person (not Person/Person)
            let normalizedPath: string;
            if (dirname.toLowerCase() === baseFilename.toLowerCase()) {
                normalizedPath = dir;
            } else {
                normalizedPath = relativeToSrc.replace(/\.stories\.(tsx|ts|jsx|js)$/, "");
            }
            
            // Normalize path separators and convert to lowercase
            normalizedPath = normalizedPath
                .replace(/\\/g, "/")
                .toLowerCase();
            
            // Convert to Storybook ID format (kebab-case with dashes)
            // e.g., "components/identity/PersonCard/Person" -> "components-identity-personcard-person"
            // Replace underscores with hyphens in directory names (e.g., "new_tag" -> "new-tag")
            let storyId = normalizedPath
                .split("/")
                .map(part => part.replace(/_/g, "-")) // Replace underscores with hyphens in each part
                .filter(part => part.length > 0) // Remove empty parts
                .join("-");
            
            // Try to get the first exported story name to build full story ID
            // Look for exported story names like: export const PrimaryButton
            // Skip the default export (export default meta)
            const storyExports = storyContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
            for (const match of storyExports) {
                const exportName = match[1];
                // Skip if it's the meta export
                if (exportName.toLowerCase().includes("meta")) {
                    continue;
                }
                // Found the first story export
                const storyName = camelToKebab(exportName);
                return `${storyId}--${storyName}`;
            }
            
            // If no story exports found, return just the component ID
            // Storybook will show the default story
            return storyId;
        }
        
        // Fallback: try to extract from file path relative to workspace
        const relativePath = path.relative(workspaceRoot, storyPath);
        const normalizedPath = relativePath
            .replace(/\\/g, "/")
            .replace(/\.stories\.(tsx|ts|jsx|js)$/, "")
            .toLowerCase();

        // Extract component path (look for src/components/... pattern)
        const match = normalizedPath.match(/(?:.*\/)?src\/(.+)/);
        if (match) {
            const storyId = match[1]
                .split("/")
                .filter(part => part.length > 0)
                .join("-");
            
            // Try to get first story name (skip meta exports)
            const storyExports = storyContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
            for (const match of storyExports) {
                const exportName = match[1];
                if (exportName.toLowerCase().includes("meta")) {
                    continue;
                }
                const storyName = camelToKebab(exportName);
                return `${storyId}--${storyName}`;
            }
            
            return storyId;
        }
        
    } catch (error) {
        console.error("Error extracting story ID:", error);
        // Return empty string on error to prevent flickering
    }

    return "";
}

// Check if Storybook is running by attempting to fetch the URL
async function isStorybookRunning(url: string): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const urlObj = new URL(url);
            const client = urlObj.protocol === 'https:' ? https : http;
            const request = client.request(url, { method: 'HEAD', timeout: 2000 }, (response) => {
                resolve(response.statusCode !== undefined && response.statusCode < 500);
            });
            
            request.on('error', () => {
                resolve(false);
            });
            
            request.on('timeout', () => {
                request.destroy();
                resolve(false);
            });
            
            request.end();
        } catch (error) {
            resolve(false);
        }
    });
}

// Run a command in the workspace directory
async function executeCommand(command: string, workspaceRoot: string, outputChannel: vscode.OutputChannel): Promise<boolean> {
    return new Promise((resolve) => {
        outputChannel.appendLine(`Running: ${command}`);
        const childProcess = exec(command, {
            cwd: workspaceRoot,
            env: { ...process.env }
        }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Error: ${error.message}`);
                if (stderr) {
                    outputChannel.appendLine(`Stderr: ${stderr}`);
                }
                resolve(false);
            } else {
                if (stdout) {
                    outputChannel.appendLine(stdout);
                }
                resolve(true);
            }
        });

        // Handle process output
        if (childProcess.stdout) {
            childProcess.stdout.on('data', (data: Buffer | string) => {
                outputChannel.append(data.toString());
            });
        }
        if (childProcess.stderr) {
            childProcess.stderr.on('data', (data: Buffer | string) => {
                outputChannel.append(data.toString());
            });
        }
    });
}

// Helper function to check if a process is still running
function isProcessRunning(process: any): boolean {
    if (!process) {
        return false;
    }
    // If exitCode is null, the process is still running
    return process.exitCode === null && !process.killed;
}

// Helper function to wait for a process to complete
async function waitForProcess(process: any, outputChannel: vscode.OutputChannel, processName: string): Promise<boolean> {
    if (!isProcessRunning(process)) {
        return true; // Process already completed
    }
    
    outputChannel.appendLine(`Waiting for existing ${processName} process to complete...`);
    return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
            if (!isProcessRunning(process)) {
                clearInterval(checkInterval);
                outputChannel.appendLine(`${processName} process completed.`);
                resolve(true);
            }
        }, 1000);
        
        // Also listen for the exit event
        process.once('exit', () => {
            clearInterval(checkInterval);
            outputChannel.appendLine(`${processName} process completed.`);
            resolve(true);
        });
    });
}

// Build and start Storybook if not running
async function ensureStorybookRunning(
    context: vscode.ExtensionContext,
    storybookUrl: string,
    buildCommand: string,
    runCommand: string,
    workspaceRoot: string
): Promise<boolean> {
    // Check if Storybook is already running
    const isRunning = await isStorybookRunning(storybookUrl);
    if (isRunning) {
        return true;
    }

    // Determine the Storybook directory (frontend/react)
    const storybookDir = path.join(workspaceRoot, "frontend", "react");
    
    // Check if the directory exists
    if (!fs.existsSync(storybookDir)) {
        vscode.window.showErrorMessage(`Storybook directory not found: ${storybookDir}`);
        return false;
    }

    // Create output channel for build/run commands
    const outputChannel = vscode.window.createOutputChannel("Storybook Preview");
    outputChannel.show(true);
    outputChannel.appendLine("Storybook is not running. Starting Storybook...");
    outputChannel.appendLine(`Using directory: ${storybookDir}`);

    // Check if build process is already running
    if (buildCommand && isProcessRunning(buildProcess)) {
        outputChannel.appendLine("Build process is already running. Waiting for it to complete...");
        const existingBuildProcess = buildProcess;
        await waitForProcess(buildProcess, outputChannel, "build");
        // Check if the existing build failed
        if (existingBuildProcess && existingBuildProcess.exitCode !== null && existingBuildProcess.exitCode !== 0) {
            vscode.window.showErrorMessage(`Build process failed. Check the output channel for details.`);
            buildProcess = undefined;
            return false;
        }
        buildProcess = undefined; // Clear the reference after it completes
    } else if (buildCommand) {
        // Run build command first
        outputChannel.appendLine(`Building Storybook with: ${buildCommand}`);
        let buildExitCode: number | null = null;
        buildProcess = exec(buildCommand, {
            cwd: storybookDir,
            env: { ...process.env }
        }, (error, stdout, stderr) => {
            if (error) {
                outputChannel.appendLine(`Build Error: ${error.message}`);
                if (stderr) {
                    outputChannel.appendLine(`Build Stderr: ${stderr}`);
                }
                buildExitCode = error.code || 1;
            } else {
                if (stdout) {
                    outputChannel.appendLine(stdout);
                }
                outputChannel.appendLine("Build completed successfully.");
                buildExitCode = 0;
            }
        });

        // Handle build process output
        if (buildProcess.stdout) {
            buildProcess.stdout.on('data', (data: Buffer | string) => {
                outputChannel.append(data.toString());
            });
        }
        if (buildProcess.stderr) {
            buildProcess.stderr.on('data', (data: Buffer | string) => {
                outputChannel.append(data.toString());
            });
        }

        // Wait for build to complete
        await waitForProcess(buildProcess, outputChannel, "build");
        
        // Check if build failed (use stored exit code or process exit code)
        const finalExitCode = buildExitCode !== null ? buildExitCode : (buildProcess ? buildProcess.exitCode : null);
        if (finalExitCode !== null && finalExitCode !== 0) {
            vscode.window.showErrorMessage(`Failed to build Storybook. Check the output channel for details.`);
            buildProcess = undefined;
            return false;
        }
        buildProcess = undefined;
    }

    // Check if run process is already running
    if (isProcessRunning(storybookProcess)) {
        outputChannel.appendLine("Storybook run process is already running. Reusing existing process...");
        // Wait for Storybook to be ready (poll the URL)
        outputChannel.appendLine("Waiting for Storybook to be ready...");
        let attempts = 0;
        const maxAttempts = 60; // Wait up to 60 seconds
        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const isRunning = await isStorybookRunning(storybookUrl);
            if (isRunning) {
                outputChannel.appendLine("Storybook is now running!");
                return true;
            }
            attempts++;
        }
        outputChannel.appendLine("Storybook process is running but not responding. Please check manually.");
        return false;
    }

    // Run storybook command (non-blocking)
    outputChannel.appendLine(`Starting Storybook with: ${runCommand}`);
    const childProcess = exec(runCommand, {
        cwd: storybookDir,
        env: { ...process.env }
    }, (error, stdout, stderr) => {
        if (error) {
            outputChannel.appendLine(`Error: ${error.message}`);
            vscode.window.showErrorMessage(`Failed to start Storybook: ${error.message}`);
        }
    });

    // Store the process reference
    storybookProcess = childProcess;

    // Handle process output
    if (childProcess.stdout) {
        childProcess.stdout.on('data', (data) => {
            outputChannel.append(data.toString());
        });
    }
    if (childProcess.stderr) {
        childProcess.stderr.on('data', (data) => {
            outputChannel.append(data.toString());
        });
    }

    // Wait for Storybook to be ready (poll the URL)
    outputChannel.appendLine("Waiting for Storybook to start...");
    let attempts = 0;
    const maxAttempts = 60; // Wait up to 60 seconds
    while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const isRunning = await isStorybookRunning(storybookUrl);
        if (isRunning) {
            outputChannel.appendLine("Storybook is now running!");
            vscode.window.showInformationMessage("Storybook started successfully!");
            return true;
        }
        attempts++;
    }

    outputChannel.appendLine("Storybook did not start within the expected time. It may still be starting in the background.");
    vscode.window.showWarningMessage("Storybook is taking longer than expected to start. Check the output channel for details.");
    return false;
}

function showPreview(
    context: vscode.ExtensionContext,
    componentPath?: string
) {
    const config = vscode.workspace.getConfiguration("storybookPreview");
    const storybookUrl = config.get<string>("storybookUrl", "http://localhost:6006");
    const autoStart = config.get<boolean>("autoStart", true);
    const buildCommand = config.get<string>("buildCommand", "yarn build-storybook");
    const runCommand = config.get<string>("runCommand", "yarn storybook");
    // Always use sandwiched position (full height between editor and chat)
    const position = "sandwiched";

    // Get story path if component path provided
    let storyPath: string | null = null;
    if (componentPath) {
        // Check if the path is already a story file
        if (componentPath.includes(".stories.")) {
            storyPath = componentPath;
        } else {
        // Find story file synchronously for immediate use
        const dir = path.dirname(componentPath);
        const basename = path.basename(componentPath, path.extname(componentPath));
        const storyPatterns = [
            path.join(dir, `${basename}.stories.tsx`),
            path.join(dir, `${basename}.stories.ts`),
            path.join(dir, `${basename}.stories.jsx`),
            path.join(dir, `${basename}.stories.js`),
        ];

        for (const pattern of storyPatterns) {
            if (fs.existsSync(pattern)) {
                storyPath = pattern;
                break;
                }
            }
        }
    }

    // Get workspace root
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
    
    // Ensure Storybook is running if autoStart is enabled
    if (autoStart) {
        ensureStorybookRunning(context, storybookUrl, buildCommand, runCommand, workspaceRoot).then((isRunning) => {
            if (!isRunning) {
                vscode.window.showWarningMessage("Storybook may not be running. The preview might not load correctly.");
            }
        });
    }
    
    // Store current component and story paths for auto-refresh
    if (componentPath) {
        if (componentPath.includes(".stories.")) {
            // If a story file is opened directly, find the component file
            currentStoryPath = componentPath;
            findComponentFile(componentPath).then((compPath) => {
                currentComponentPath = compPath || undefined;
            });
        } else {
            // Component file opened, track both
            currentComponentPath = componentPath;
            currentStoryPath = storyPath || undefined;
        }
    } else {
        currentComponentPath = undefined;
        currentStoryPath = undefined;
    }

    // Extract story ID and available stories from story file with error handling
    let storyId = "";
    let availableStories: string[] = [];
    if (storyPath) {
        try {
            const storyContent = fs.readFileSync(storyPath, "utf-8");
            storyId = extractStoryId(storyContent, storyPath, workspaceRoot);
            
            // Validate extracted storyId
            if (!storyId || !storyId.trim()) {
                console.warn(`Could not extract valid story ID from: ${storyPath}. Showing Storybook homepage.`);
                storyId = ""; // Ensure it's empty string, not undefined
            }
            
            // Extract all available story names
            const storyExports = storyContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
            for (const match of storyExports) {
                const exportName = match[1];
                // Skip meta exports
                if (!exportName.toLowerCase().includes("meta") && exportName !== "Story") {
                    availableStories.push(exportName);
                }
            }
        } catch (error) {
            console.error("Error reading story file:", error);
            // Continue with empty storyId - will show Storybook homepage
            storyId = ""; // Ensure it's empty string, not undefined
        }
    }

    // Use a separate editor group for the preview panel
    const viewColumn = vscode.ViewColumn.Beside;

    // Extract component name from storyId for the panel title
    function getComponentNameFromStoryId(storyId: string): string {
        if (!storyId) {
            return "";
        }
        // Get the base component ID (before --)
        const baseId = storyId.split("--")[0];
        // Get the last segment after splitting by dashes
        const segments = baseId.split("-");
        const lastSegment = segments[segments.length - 1];
        // Convert kebab-case to PascalCase
        return lastSegment
            .split("-")
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join("");
    }

    // Create or reveal panel
    const componentName = getComponentNameFromStoryId(storyId);
    const panelTitle = componentName 
        ? `Storybook Live Preview - ${componentName}`
        : "Storybook Live Preview";
    
    if (!previewPanel) {
        // Store the view column for this preview panel
        previewViewColumn = viewColumn;
        
        previewPanel = vscode.window.createWebviewPanel(
            "storybookPreview",
            panelTitle,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [],
            }
        );

        previewPanel.onDidDispose(
            () => {
                previewPanel = undefined;
                previewViewColumn = undefined;
                // Clear tracked paths
                currentComponentPath = undefined;
                currentStoryPath = undefined;
                // Dispose message handler when panel is disposed
                if (messageHandlerDisposable) {
                    messageHandlerDisposable.dispose();
                    messageHandlerDisposable = undefined;
                }
                // When panel is closed (via X button or any other way), treat it as user explicitly closing
                // This prevents auto-opening until user explicitly toggles it again
                userExplicitlyClosedPreview = true;
                // Update button state when preview closes
                updateEditorButton(vscode.window.activeTextEditor);
            },
            null,
            context.subscriptions
        );
        
        // Update button state when preview opens
        updateEditorButton(vscode.window.activeTextEditor);
        
        // Note: We removed the aggressive focus-stealing behavior to allow users
        // to interact with the preview panel (e.g., opening dropdowns, clicking buttons)
        // The preview panel is already set to not steal focus when files are opened
        // via preserveFocus: true in the reveal() call
    } else {
        // Update the title when switching files
        previewPanel.title = panelTitle;
        // Update the view column if it changed
        if (previewViewColumn !== viewColumn) {
            previewViewColumn = viewColumn;
        }
        // Reveal without making it active (preserveFocus: true)
        // This prevents the preview from stealing focus when files are opened
        previewPanel.reveal(viewColumn, true);
    }

    // Set webview content
    previewPanel.webview.html = getWebviewContent(storybookUrl, storyId, position, availableStories);

    // Dispose previous message handler if it exists to prevent duplicate handlers
    if (messageHandlerDisposable) {
        messageHandlerDisposable.dispose();
        messageHandlerDisposable = undefined;
    }

    // Handle messages from webview
    messageHandlerDisposable = previewPanel.webview.onDidReceiveMessage(
        (message) => {
            switch (message.command) {
                case "openInBrowser":
                    // vscode.Uri.parse() and vscode.Uri.with() will encode query parameters,
                    // but Storybook expects them unencoded (e.g., ?path=/story/...)
                    // Use a shell command to open the URL directly, bypassing VS Code's URI encoding
                    const platform = process.platform;
                    let command: string;
                    
                    if (platform === 'win32') {
                        command = `start "" "${message.url}"`;
                    } else if (platform === 'darwin') {
                        command = `open "${message.url}"`;
                    } else {
                        command = `xdg-open "${message.url}"`;
                    }
                    
                    exec(command, (error: any) => {
                        if (error) {
                            // Fallback to vscode.env.openExternal if shell command fails
                            vscode.window.showErrorMessage(`Failed to open browser: ${error.message}`);
                            try {
                                vscode.env.openExternal(vscode.Uri.parse(message.url));
                            } catch (e) {
                                vscode.window.showErrorMessage(`Failed to open URL: ${e}`);
                            }
                        }
                    });
                    break;
                case "focusEditor":
                    // When user clicks outside the preview panel, focus the editor
                    const activeEditor = vscode.window.activeTextEditor;
                    if (activeEditor) {
                        // If the active editor is in the preview panel's column, find another editor
                        if (previewViewColumn && activeEditor.viewColumn === previewViewColumn) {
                            const otherEditors = vscode.window.visibleTextEditors.filter(
                                e => e.viewColumn && e.viewColumn !== previewViewColumn
                            );
                            if (otherEditors.length > 0) {
                                vscode.window.showTextDocument(otherEditors[0].document, {
                                    viewColumn: otherEditors[0].viewColumn,
                                    preserveFocus: false
                                });
                            }
                        } else if (activeEditor.viewColumn) {
                            // Focus the current editor
                            vscode.window.showTextDocument(activeEditor.document, {
                                viewColumn: activeEditor.viewColumn,
                                preserveFocus: false
                            });
                        }
                    } else {
                        // No active editor, try to open the last active file or find any text editor
                        const editors = vscode.window.visibleTextEditors.filter(
                            e => e.viewColumn && e.viewColumn !== previewViewColumn
                        );
                        if (editors.length > 0) {
                            vscode.window.showTextDocument(editors[0].document, {
                                viewColumn: editors[0].viewColumn,
                                preserveFocus: false
                            });
                        }
                    }
                    break;
            }
        },
        null,
        context.subscriptions
    );

    // Clean up previous watcher
    if (fileWatcher) {
        fileWatcher.dispose();
        fileWatcher = undefined;
    }

    // Update preview when story changes (with debouncing to prevent flickering)
    if (storyPath) {
        fileWatcher = vscode.workspace.createFileSystemWatcher(storyPath);
        fileWatcher.onDidChange(() => {
            // Debounce updates to prevent flickering from rapid file changes
            if (updateTimeout) {
                clearTimeout(updateTimeout);
            }
            updateTimeout = setTimeout(() => {
                if (previewPanel && storyPath) {
                    try {
                        const newStoryContent = fs.readFileSync(storyPath, "utf-8");
                        const newStoryId = extractStoryId(newStoryContent, storyPath, workspaceRoot);
                        // Only update if story ID actually changed
                        const currentStoryId = previewPanel.webview.html.includes(`id=${encodeURIComponent(storyId)}`) ? storyId : "";
                        if (newStoryId !== currentStoryId || newStoryId !== storyId) {
                            // Re-extract available stories
                            const newStoryExports = newStoryContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
                            const newAvailableStories: string[] = [];
                            for (const match of newStoryExports) {
                                const exportName = match[1];
                                if (!exportName.toLowerCase().includes("meta") && exportName !== "Story") {
                                    newAvailableStories.push(exportName);
                                }
                            }
                            previewPanel.webview.html = getWebviewContent(storybookUrl, newStoryId, position, newAvailableStories);
                        }
                    } catch (error) {
                        console.error("Error updating preview:", error);
                        // Don't update on error to prevent flickering
                    }
                }
            }, 500); // 500ms debounce
        });
        context.subscriptions.push(fileWatcher);
    }

    // Set up save document listener for auto-refresh
    if (saveDocumentDisposable) {
        saveDocumentDisposable.dispose();
        saveDocumentDisposable = undefined;
    }

    saveDocumentDisposable = vscode.workspace.onDidSaveTextDocument((document) => {
        const savedFilePath = document.fileName;
        
        // Check if the saved file is the component file or story file
        const isComponentFile = currentComponentPath && path.resolve(savedFilePath) === path.resolve(currentComponentPath);
        const isStoryFile = currentStoryPath && path.resolve(savedFilePath) === path.resolve(currentStoryPath);
        
        if ((isComponentFile || isStoryFile) && previewPanel) {
            // Debounce refresh to prevent multiple refreshes from rapid saves
            if (updateTimeout) {
                clearTimeout(updateTimeout);
            }
            updateTimeout = setTimeout(() => {
                if (previewPanel && (isComponentFile || isStoryFile)) {
                    // If story file changed, update story ID and available stories
                    if (isStoryFile && currentStoryPath) {
                        try {
                            const newStoryContent = fs.readFileSync(currentStoryPath, "utf-8");
                            const newStoryId = extractStoryId(newStoryContent, currentStoryPath, workspaceRoot);
                            
                            // Re-extract available stories
                            const newStoryExports = newStoryContent.matchAll(/export\s+(?:const|function)\s+(\w+)/g);
                            const newAvailableStories: string[] = [];
                            for (const match of newStoryExports) {
                                const exportName = match[1];
                                if (!exportName.toLowerCase().includes("meta") && exportName !== "Story") {
                                    newAvailableStories.push(exportName);
                                }
                            }
                            
                            // Update webview HTML with new story ID and stories
                            previewPanel.webview.html = getWebviewContent(storybookUrl, newStoryId, position, newAvailableStories);
                        } catch (error) {
                            console.error("Error updating preview on save:", error);
                            // Still refresh the iframe even if story ID extraction fails
                            previewPanel.webview.postMessage({ command: "refresh" });
                        }
                    } else {
                        // Component file changed, just refresh the iframe
                        previewPanel.webview.postMessage({ command: "refresh" });
                    }
                }
            }, 300); // 300ms debounce
        }
    });
    
    if (saveDocumentDisposable) {
        context.subscriptions.push(saveDocumentDisposable);
    }
}

function getWebviewContent(
    storybookUrl: string,
    storyId: string,
    position: string,
    availableStories: string[] = []
): string {
    // Build the Storybook iframe URL
    // Storybook uses a specific URL format for individual stories
    // If storyId includes --, it's a full story ID, otherwise it's just the component ID
    let iframeUrl: string;
    let baseStoryId = storyId || "";
    let currentStoryName = "";
    
    // Validate storyId - must be non-empty and not just whitespace
    const isValidStoryId = storyId && storyId.trim().length > 0;
    
    if (isValidStoryId) {
        // Split story ID to get base component ID and story name
        if (storyId.includes("--")) {
            const parts = storyId.split("--");
            baseStoryId = parts[0] || "";
            currentStoryName = parts[1] || "";
        }
        // Ensure the story ID is properly formatted
        // Storybook expects IDs like: design-system-atoms-button--primary-button
        // Only encode if we have a valid storyId
        const cleanStoryId = storyId.trim();
        if (cleanStoryId) {
            iframeUrl = `${storybookUrl}/iframe.html?id=${encodeURIComponent(cleanStoryId)}&viewMode=story`;
        } else {
            // Fallback to homepage if storyId is empty after trimming
            iframeUrl = `${storybookUrl}`;
        }
    } else {
        // If no story ID, just show the Storybook homepage
        iframeUrl = `${storybookUrl}`;
    }
    
    // Convert story names to kebab-case for Storybook IDs
    const storyOptions = availableStories.map(name => ({
        display: name,
        id: camelToKebab(name)
    }));

    const storyOptionsHtml = storyOptions.map((story, index) => 
        `<option value="${story.id}" ${story.id === currentStoryName ? 'selected' : ''}>${story.display}</option>`
    ).join('');
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Storybook Preview</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            overflow: hidden;
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
        }
        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
            width: 100%;
            overflow: hidden;
        }
        .header {
            padding: 6px 12px;
            background-color: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .controls-row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .control-group {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .control-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        select, .btn, .btn-icon {
            padding: 3px 6px;
            background-color: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
            font-family: var(--vscode-font-family);
        }
        select:hover, .btn:hover, .btn-icon:hover {
            background-color: var(--vscode-dropdown-listBackground);
        }
        .btn {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
        }
        .btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .btn.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-icon {
            background-color: transparent;
            border: none;
            padding: 4px 6px;
            font-size: 14px;
            color: var(--vscode-icon-foreground);
        }
        .btn-icon:hover {
            background-color: var(--vscode-toolbar-hoverBackground);
        }
        .iframe-container {
            flex: 1;
            position: relative;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            min-height: 0;
        }
        iframe {
            width: 100%;
            flex: 1;
            border: none;
            min-height: 0;
        }
        .error-message {
            padding: 20px;
            text-align: center;
            color: var(--vscode-errorForeground);
        }
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="controls-row" id="controls-panel">
                ${storyOptions.length > 0 ? `
                <div class="control-group">
                    <label class="control-label">Story:</label>
                    <select id="story-selector" onchange="switchStory()">
                        ${storyOptionsHtml}
                    </select>
                </div>
                ` : ''}
                <div class="control-group">
                    <label class="control-label">Viewport:</label>
                    <select id="viewport-selector" onchange="changeViewport()">
                        <option value="reset">Responsive</option>
                        <option value="mobile1">Mobile (320px)</option>
                        <option value="mobile2">Mobile (375px)</option>
                        <option value="tablet">Tablet (768px)</option>
                        <option value="desktop">Desktop (1024px)</option>
                        <option value="desktop-large">Desktop Large (1440px)</option>
                    </select>
                </div>
                <div class="control-group">
                    <button class="btn-icon" onclick="refreshPreview()" title="Refresh">↻</button>
                    <button class="btn-icon" onclick="openInBrowser()" title="Open in Browser">↗</button>
                </div>
            </div>
        </div>
        <div class="iframe-container">
            <iframe id="storybook-iframe" src="${iframeUrl}" onload="onIframeLoad()" onerror="onIframeError()"></iframe>
            <div id="loading" class="loading">Loading Storybook preview...</div>
            <div id="error" class="error-message" style="display: none;">
                <p>Unable to load Storybook preview.</p>
                <p>Make sure Storybook is running at: <strong>${storybookUrl}</strong></p>
                <p><button class="btn" onclick="refreshPreview()">Retry</button></p>
            </div>
        </div>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const iframe = document.getElementById('storybook-iframe');
        const loading = document.getElementById('loading');
        const error = document.getElementById('error');
        const baseStoryId = '${baseStoryId || ""}';
        const storybookUrl = '${storybookUrl}';
        
        let currentViewport = 'reset';
        let currentStoryId = '${storyId || ""}';

        function onIframeLoad() {
            loading.style.display = 'none';
            error.style.display = 'none';
            // Wait for Storybook to be ready
            waitForStorybook(() => {
                // Inject a message listener into the iframe to handle args updates
                try {
                    const iframeWindow = iframe.contentWindow;
                    if (iframeWindow) {
                        // Try to inject a script that listens for args updates
                        try {
                            const script = iframeWindow.document.createElement('script');
                            script.textContent = 
                                '(function() {' +
                                '  window.addEventListener("message", function(event) {' +
                                '    if (event.data && event.data.type === "update-storybook-args") {' +
                                '      const channel = window.__STORYBOOK_ADDONS_CHANNEL__;' +
                                '      if (channel) {' +
                                '        channel.emit("updateArgs", {' +
                                '          storyId: event.data.storyId,' +
                                '          updatedArgs: event.data.args' +
                                '        });' +
                                '      }' +
                                '    }' +
                                '  });' +
                                '})();';
                            iframeWindow.document.head.appendChild(script);
                        } catch (scriptError) {
                            console.log('Script injection failed (cross-origin):', scriptError);
                        }
                    }
                } catch (e) {
                    // Cross-origin or other error - use postMessage instead
                    console.log('Cannot inject script, using postMessage:', e);
                }
            });
        }

        function onIframeError() {
            loading.style.display = 'none';
            error.style.display = 'block';
        }

        function refreshPreview() {
            iframe.src = iframe.src;
            loading.style.display = 'flex';
            error.style.display = 'none';
        }

        // Listen for refresh messages from the extension
        window.addEventListener('message', event => {
            const message = event.data;
            if (message && message.command === 'refresh') {
                refreshPreview();
            }
        });

        function openInBrowser() {
            // Try to extract storyId from the current iframe URL first (most accurate)
            // Otherwise fall back to currentStoryId variable
            let storyId = '';
            
            try {
                // Extract storyId from iframe URL: /iframe.html?id=STORY_ID&viewMode=story
                const iframeUrl = iframe.src;
                const urlMatch = iframeUrl.match(/[?&]id=([^&]+)/);
                if (urlMatch && urlMatch[1]) {
                    storyId = decodeURIComponent(urlMatch[1]);
                }
            } catch (e) {
                // Fall back to currentStoryId variable
                storyId = currentStoryId || '';
            }
            
            // If we still don't have a storyId, use the variable
            if (!storyId) {
                storyId = currentStoryId || '';
            }
            
            // Clean up the storyId - remove any trailing = or other invalid characters
            storyId = storyId.trim();
            // Remove trailing = if present (can happen from URL parsing)
            while (storyId.endsWith('=')) {
                storyId = storyId.slice(0, -1);
            }
            // Remove any whitespace
            storyId = storyId.trim();
            
            let browserUrl;
            if (storyId) {
                // Format: http://localhost:6006/?path=/story/components-identity-broadcasteronboarding-steps--steps-mobile
                // Storybook expects the path parameter unencoded
                browserUrl = storybookUrl + '/?path=/story/' + storyId;
            } else {
                browserUrl = storybookUrl;
            }
            
            vscode.postMessage({
                command: 'openInBrowser',
                url: browserUrl
            });
        }

        function sendToStorybook(message) {
            if (!message || typeof message !== 'object') {
                console.warn('sendToStorybook: Invalid message', message);
                return;
            }
            if (iframe && iframe.contentWindow) {
                try {
                    // Storybook listens for messages on the iframe's window
                    // Use the correct Storybook channel format
                    iframe.contentWindow.postMessage({
                        ...message,
                        source: 'storybook-channel'
                    }, storybookUrl);
                } catch (e) {
                    console.error('Error sending message to Storybook:', e);
                }
            } else {
                console.warn('sendToStorybook: iframe or contentWindow not available');
            }
        }
        
        function waitForStorybook(callback) {
            let attempts = 0;
            const maxAttempts = 30; // Reduced from 50
            const checkStorybook = () => {
                if (iframe.contentWindow && iframe.contentWindow.__STORYBOOK_ADDONS_CHANNEL__) {
                    callback();
                } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(checkStorybook, 200); // Increased from 100ms to 200ms to reduce polling frequency
                } else {
                    // Still try to execute callback even if channel isn't ready
                    callback();
                }
            };
            checkStorybook();
        }


        function switchStory() {
            const selector = document.getElementById('story-selector');
            const storyName = selector ? selector.value : '';
            // Validate that both baseStoryId and storyName are non-empty
            if (storyName && storyName.trim() && baseStoryId && baseStoryId.trim()) {
                const newStoryId = baseStoryId.trim() + '--' + storyName.trim();
                currentStoryId = newStoryId;
                iframe.src = storybookUrl + '/iframe.html?id=' + encodeURIComponent(newStoryId) + '&viewMode=story';
                loading.style.display = 'flex';
            } else {
                console.warn('Cannot switch story: invalid baseStoryId or storyName', { baseStoryId, storyName });
            }
        }

        function changeViewport() {
            const selector = document.getElementById('viewport-selector');
            currentViewport = selector.value;
            
            if (currentViewport === 'reset') {
                // Reset viewport
                iframe.style.width = '100%';
                iframe.style.height = '100%';
                iframe.style.margin = '0';
                iframe.style.display = 'block';
            } else {
                const viewports = {
                    'mobile1': { width: 320, height: 568 },
                    'mobile2': { width: 375, height: 667 },
                    'tablet': { width: 768, height: 1024 },
                    'desktop': { width: 1024, height: 768 },
                    'desktop-large': { width: 1440, height: 900 }
                };
                
                const viewport = viewports[currentViewport];
                if (viewport) {
                    iframe.style.width = viewport.width + 'px';
                    iframe.style.height = viewport.height + 'px';
                    iframe.style.margin = '0 auto';
                    iframe.style.display = 'block';
                }
            }
        }

        // Check if Storybook is accessible
        fetch(storybookUrl, { method: 'HEAD', mode: 'no-cors' })
            .catch(() => {
                setTimeout(() => {
                    if (loading.style.display !== 'none') {
                        onIframeError();
                    }
                }, 3000);
            });
    </script>
</body>
</html>`;
}

