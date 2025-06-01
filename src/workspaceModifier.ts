/**
 * @file src/workspaceModifier.ts
 * This module provides a collection of functions for interacting with the VSCode workspace.
 * It includes utilities for modifying text editors (inserting/replacing code),
 * performing file system operations (creating, reading, appending, replacing in files, listing files),
 * and executing shell commands. These functions are designed to be called by the main extension logic
 * in response to user actions or autonomous agent plans.
 */

import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { TextEncoder, TextDecoder } from 'util'; // Node.js util, available in extension host

/**
 * Applies the given code string to the active text editor.
 * It can either insert the code at the current cursor position(s) or
 * replace the content of the current selection(s).
 * Uses `vscode.WorkspaceEdit` to apply changes, making them undoable.
 *
 * @param code The string of code to apply.
 * @param strategy Determines whether to 'insertAtCursor' or 'replaceSelection'.
 * @returns A Promise that resolves to `true` if the edit was successfully applied,
 *          `false` otherwise (e.g., no active editor, or applyEdit failed).
 *          Error messages are shown to the user via `vscode.window.showErrorMessage`.
 */
export async function applyCodeToActiveEditor(
    code: string,
    strategy: 'insertAtCursor' | 'replaceSelection'
): Promise<boolean> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active text editor found to apply code.');
        return false;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    const documentUri = editor.document.uri;

    if (strategy === 'insertAtCursor') {
        editor.selections.forEach(selection => {
            workspaceEdit.insert(documentUri, selection.active, code);
        });
    } else if (strategy === 'replaceSelection') {
        let appliedAtLeastOne = false;
        editor.selections.forEach(selection => {
            if (!selection.isEmpty) {
                workspaceEdit.replace(documentUri, selection, code);
                appliedAtLeastOne = true;
            }
        });
        // Fallback: If all selections were empty, insert at the primary cursor.
        if (!appliedAtLeastOne && editor.selections.length > 0 && !editor.selections.some(s => !s.isEmpty)) {
            workspaceEdit.insert(documentUri, editor.selection.active, code);
            vscode.window.showInformationMessage('Selection was empty. Code inserted at cursor.');
        } else if (workspaceEdit.size === 0) { // No non-empty selections were found
            vscode.window.showInformationMessage('No non-empty selection to replace. Code not applied.');
            return false;
        }
    }

    try {
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        if (!success) {
            vscode.window.showErrorMessage('Failed to apply code to editor.');
        }
        return success;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error applying code: ${error.message}`);
        return false;
    }
}

/**
 * Creates a new file at the specified URI with the given code content.
 * If the file already exists and `options.overwrite` is false (default),
 * it prompts the user to Overwrite, Rename, or Cancel.
 * Uses `vscode.WorkspaceEdit` for file creation, making it undoable.
 *
 * @param fileUri The `vscode.Uri` where the new file should be created.
 * @param code The string content for the new file.
 * @param options Options for file creation:
 *                `overwrite?: boolean` - If true, overwrites the file if it exists. Defaults to false.
 *                `autoOpen?: boolean` - If true (default), opens the file after creation.
 * @returns A Promise that resolves to `true` if the file was successfully created (and potentially opened),
 *          `false` otherwise (e.g., user cancelled, path invalid, or applyEdit failed).
 *          Error or cancellation messages are shown to the user.
 */
export async function createNewFileWithCode(
    fileUri: vscode.Uri,
    code: string,
    options: { overwrite?: boolean; autoOpen?: boolean } = {}
): Promise<boolean> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    // Convert string code to Uint8Array for file system operations
    const uint8ArrayCode = new TextEncoder().encode(code);

    // Check if file exists only if not explicitly overwriting
    if (!options.overwrite) {
        try {
            await vscode.workspace.fs.stat(fileUri);
            // File exists, prompt user for action
            const RENAME_ACTION = 'Rename';
            const OVERWRITE_ACTION = 'Overwrite';
            const CANCEL_ACTION = 'Cancel';
            const result = await vscode.window.showWarningMessage(
                `File '${vscode.workspace.asRelativePath(fileUri)}' already exists.`,
                { modal: true }, // Modal dialog to ensure user makes a choice
                OVERWRITE_ACTION, RENAME_ACTION, CANCEL_ACTION
            );

            if (result === OVERWRITE_ACTION) {
                options.overwrite = true; // Proceed to overwrite
            } else if (result === RENAME_ACTION) {
                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new file name or path relative to workspace',
                    value: vscode.workspace.asRelativePath(fileUri) // Pre-fill with current path for easy modification
                });
                if (newName) {
                    const baseDir = vscode.Uri.joinPath(fileUri, '../'); // Get parent directory
                    const newUri = vscode.Uri.joinPath(baseDir, newName);
                    // Recursively call, ensuring overwrite is false to re-check existence for the new name
                    return createNewFileWithCode(newUri, code, { ...options, overwrite: false });
                } else {
                    return false; // User cancelled rename input
                }
            } else { // User clicked Cancel or closed dialog
                return false;
            }
        } catch (e) {
            // If vscode.workspace.fs.stat throws, it usually means file does not exist. Proceed to create.
        }
    }

    // Use WorkspaceEdit to create the file; this integrates with VSCode's file management and undo stack
    workspaceEdit.createFile(fileUri, { contents: uint8ArrayCode, overwrite: options.overwrite });

    try {
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        if (success) {
            // Auto-open the file if requested (and not explicitly set to false)
            if (options.autoOpen !== false) {
                await vscode.window.showTextDocument(fileUri);
            }
        } else {
            vscode.window.showErrorMessage(`Failed to create file: ${vscode.workspace.asRelativePath(fileUri)}`);
        }
        return success;
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error creating file: ${error.message}`);
        return false;
    }
}

/**
 * Gets the URI of the first workspace folder.
 * This is useful for resolving relative paths within the workspace.
 *
 * @returns The `vscode.Uri` of the first workspace folder, or `undefined` if no workspace is open
 *          or no workspace folders are found.
 */
export function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

/**
 * Appends the given content to an existing file. If the file does not exist,
 * it effectively creates a new file with the content.
 * Uses `vscode.WorkspaceEdit` by reading existing content (if any), appending,
 * and then using `createFile` with `overwrite: true`.
 *
 * @param uri The `vscode.Uri` of the file to append to.
 * @param contentToAppend The string content to append.
 * @returns A Promise that resolves to `true` if the operation was successful, `false` otherwise.
 *          Error messages are shown to the user.
 */
export async function appendToFile(uri: vscode.Uri, contentToAppend: string): Promise<boolean> {
    console.log(`Attempting to append to ${uri.fsPath}`);
    try {
        let existingContent = '';
        try {
            const currentData = await vscode.workspace.fs.readFile(uri);
            existingContent = new TextDecoder().decode(currentData);
        } catch (e) {
            // File might not exist, which is acceptable; existingContent remains empty.
        }
        const newContent = existingContent + contentToAppend;
        const workspaceEdit = new vscode.WorkspaceEdit();
        // Using createFile with overwrite:true acts as an upsert (create or overwrite)
        workspaceEdit.createFile(uri, { contents: new TextEncoder().encode(newContent), overwrite: true });
        return vscode.workspace.applyEdit(workspaceEdit);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to append to file ${uri.fsPath}: ${error.message}`);
        return false;
    }
}

/**
 * Replaces content within a specified file based on various strategies.
 * This function is a placeholder with basic implementations and needs further enhancement
 * for robust real-world use, especially for regex and line-based replacements.
 * Uses `vscode.WorkspaceEdit` by reading the file, performing replacement in memory,
 * and then using `createFile` with `overwrite: true`.
 *
 * @param uri The `vscode.Uri` of the file to modify.
 * @param findString If provided, the first or all occurrences of this exact string will be replaced.
 * @param findRegexString If provided (and `findString` is not), this string will be treated as a
 *                        regular expression to find content to replace.
 * @param startLine If provided (and string/regex find are not), the 1-indexed start line for replacement.
 * @param endLine If provided (and string/regex find are not), the 1-indexed end line for replacement (inclusive).
 * @param replaceContent The new content to insert.
 * @param replaceAll If true and using `findString` or `findRegexString\`, all occurrences are replaced. Defaults to false (first only).
 * @returns A Promise that resolves to \`true\` if a replacement was made or if no replacement was needed (target not found),
 *          \`false\` if an error occurred (e.g., invalid parameters, file read/write error).
 *          Error messages or informational messages are shown to the user.
 */
export async function replaceInFile(
    uri: vscode.Uri,
    findString: string | undefined,
    findRegexString: string | undefined,
    startLine: number | undefined,
    endLine: number | undefined,
    replaceContent: string,
    replaceAll?: boolean
): Promise<boolean> {
    console.log(`Attempting to replace in ${uri.fsPath}`);
    try {
        const currentData = await vscode.workspace.fs.readFile(uri);
        let fileContent = new TextDecoder().decode(currentData);
        let originalFileContent = fileContent;

        if (typeof startLine === 'number' && typeof endLine === 'number') {
            // Line-based replacement
            const lines = fileContent.split('\\n');
            if (startLine > 0 && endLine >= startLine && endLine <= lines.length) {
                lines.splice(startLine - 1, endLine - startLine + 1, replaceContent);
                fileContent = lines.join('\\n');
            } else {
                vscode.window.showErrorMessage('Invalid line numbers for replaceInFile.');
                return false;
            }
        } else if (findString) {
            // String-based replacement
            if (replaceAll) {
                fileContent = fileContent.split(findString).join(replaceContent);
            } else {
                fileContent = fileContent.replace(findString, replaceContent);
            }
        } else if (findRegexString) {
            // Regex-based replacement
            try {
                const regex = new RegExp(findRegexString, replaceAll ? 'g' : '');
                fileContent = fileContent.replace(regex, replaceContent);
            } catch (e: any) {
                vscode.window.showErrorMessage(`Invalid regex for replaceInFile: ${e.message}`);
                return false;
            }
        } else {
            vscode.window.showErrorMessage('No valid replacement strategy provided for replaceInFile (must provide lines, find_string, or find_regex).');
            return false;
        }

        const modified = fileContent !== originalFileContent;

        if (modified) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.createFile(uri, { contents: new TextEncoder().encode(fileContent), overwrite: true });
            return vscode.workspace.applyEdit(workspaceEdit);
        }
        // If no modification occurred (e.g., find_string not found), consider it a success but inform the user.
        vscode.window.showInformationMessage("No changes made by replaceInFile (target string/regex not found or content identical).");
        return true;
    } catch (error: any) {
        // Handle file not found error specifically
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
             vscode.window.showErrorMessage(`File not found for replacement: ${uri.fsPath}`);
        } else {
            vscode.window.showErrorMessage(`Failed to replace in file ${uri.fsPath}: ${error.message}`);
        }
        return false;
    }
}

/**
 * Reads the entire content of a specified file.
 *
 * @param uri The `vscode.Uri` of the file to read.
 * @returns A Promise that resolves to the string content of the file,
 *          or `null` if the file cannot be read (e.g., does not exist, permissions error).
 *          Errors are logged to the console and an error message is shown to the user.
 */
export async function readFileContent(uri: vscode.Uri): Promise<string | null> {
    console.log(`Attempting to read ${uri.fsPath}`);
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(data);
    } catch (error: any) {
        console.error(`Failed to read file ${uri.fsPath}: `, error);
        vscode.window.showErrorMessage(`Failed to read file ${uri.fsPath}. See dev console for details.`);
        return null;
    }
}

/**
 * Lists all entries (files and directories) within a specified directory.
 * Appends a '/' to directory names.
 *
 * @param uri The `vscode.Uri` of the directory to list.
 * @returns A Promise that resolves to an array of entry names (strings),
 *          or `null` if the directory cannot be read.
 *          Errors are logged to the console and an error message is shown to the user.
 */
export async function listFiles(uri: vscode.Uri): Promise<string[] | null> {
    console.log(`Attempting to list files in ${uri.fsPath}`);
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        // Map entries to their names, appending '/' for directories
        return entries.map(([name, type]) => type === vscode.FileType.Directory ? name + '/' : name);
    } catch (error: any) {
        console.error(`Failed to list files in ${uri.fsPath}: `, error);
        vscode.window.showErrorMessage(`Failed to list files in ${uri.fsPath}. See dev console for details.`);
        return null;
    }
}

/**
 * Defines the structure for the result of executing a shell command.
 */
export interface ShellCommandResult {
    success: boolean;   // True if the command exited with code 0, false otherwise.
    stdout: string;     // Standard output from the command.
    stderr: string;     // Standard error output from the command.
    error?: any;        // The Error object from child_process.exec if the command failed to execute or exited non-zero.
}

/**
 * Executes a shell command in the specified current working directory (CWD).
 * **Important Security Note:** This function directly executes shell commands.
 * The caller (e.g., in `extension.ts`) is responsible for ALL security checks,
 * including user confirmation and settings-based enablement, BEFORE calling this function.
 * This function itself does not implement safeguards beyond what `child_process.exec` offers.
 *
 * @param command The shell command string to execute.
 * @param cwdUri The `vscode.Uri` representing the current working directory for the command.
 * @returns A Promise that resolves to a `ShellCommandResult` object containing:
 *          `success`: boolean indicating if the command exited with code 0.
 *          `stdout`: string containing standard output.
 *          `stderr`: string containing standard error.
 *          `error`: The `Error` object from `child_process.exec` if one occurred (distinct from stderr content).
 */
export async function executeShellCommand(
    command: string,
    cwdUri: vscode.Uri
): Promise<ShellCommandResult> {
    console.log(`Executing shell command: '${command}' in '${cwdUri.fsPath}'`);

    return new Promise((resolve) => {
        // Execute the command using Node.js child_process.exec
        child_process.exec(command, { cwd: cwdUri.fsPath, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Shell command error for '${command}':`, error);
                resolve({
                    success: false,
                    stdout: stdout.toString(), // stdout/stderr might still have content on error
                    stderr: stderr.toString(),
                    error: error // The error object itself
                });
            } else {
                console.log(`Shell command stdout for '${command}':`, stdout);
                if (stderr) {
                    // Stderr is not always an error condition, some tools output to stderr for info/warnings
                    console.warn(`Shell command stderr for '${command}':`, stderr);
                }
                resolve({
                    success: true,
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                    // No error object if command executed successfully (exit code 0)
                });
            }
        });
    });
}
