import * as vscode from 'vscode';
import * as child_process from 'child_process';
import { TextEncoder, TextDecoder } from 'util'; // Node.js util, available in extension host

/**
 * Applies the given code to the active text editor based on the specified strategy.
 * @param code The code string to apply.
 * @param strategy Whether to insert the code at the cursor or replace the current selection.
 * @returns A promise that resolves to true if the edit was successfully applied, false otherwise.
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
        if (!appliedAtLeastOne && editor.selections.length > 0) {
            if (editor.selections.some(s => s.isEmpty)) {
                if (!editor.selections.some(s => !s.isEmpty)) {
                     workspaceEdit.insert(documentUri, editor.selection.active, code);
                     vscode.window.showInformationMessage('Selection was empty. Code inserted at cursor.');
                }
            }
        }
        if (workspaceEdit.size === 0) {
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
 * Creates a new file with the given code content.
 * @param fileUri The URI of the new file to create.
 * @param code The code content for the new file.
 * @param options Options for creating the file, e.g., overwrite.
 * @returns A promise that resolves to true if the file was successfully created, false otherwise.
 */
export async function createNewFileWithCode(
    fileUri: vscode.Uri,
    code: string,
    options: { overwrite?: boolean; autoOpen?: boolean } = {}
): Promise<boolean> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const uint8ArrayCode = new TextEncoder().encode(code);

    if (!options.overwrite) {
        try {
            await vscode.workspace.fs.stat(fileUri);
            const RENAME_ACTION = 'Rename';
            const OVERWRITE_ACTION = 'Overwrite';
            const CANCEL_ACTION = 'Cancel';
            const result = await vscode.window.showWarningMessage(
                `File '${vscode.workspace.asRelativePath(fileUri)}' already exists.`,
                { modal: true },
                OVERWRITE_ACTION, RENAME_ACTION, CANCEL_ACTION
            );

            if (result === OVERWRITE_ACTION) {
                options.overwrite = true;
            } else if (result === RENAME_ACTION) {
                const newName = await vscode.window.showInputBox({
                    prompt: 'Enter new file name',
                    value: vscode.workspace.asRelativePath(fileUri)
                });
                if (newName) {
                    const newUri = vscode.Uri.joinPath(fileUri, '../', newName);
                    return createNewFileWithCode(newUri, code, { overwrite: false, autoOpen: options.autoOpen });
                } else {
                    return false;
                }
            } else {
                return false;
            }
        } catch (e) {
            // File does not exist, proceed.
        }
    }

    workspaceEdit.createFile(fileUri, { contents: uint8ArrayCode, overwrite: options.overwrite });

    try {
        const success = await vscode.workspace.applyEdit(workspaceEdit);
        if (success) {
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
 * @returns The URI of the first workspace folder, or undefined if no workspace is open.
 */
export function getWorkspaceRootUri(): vscode.Uri | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri;
}

export async function appendToFile(uri: vscode.Uri, contentToAppend: string): Promise<boolean> {
    console.log(`Attempting to append to ${uri.fsPath}`);
    try {
        let existingContent = '';
        try {
            const currentData = await vscode.workspace.fs.readFile(uri);
            existingContent = new TextDecoder().decode(currentData);
        } catch (e) {
            // File might not exist
        }
        const newContent = existingContent + contentToAppend;
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.createFile(uri, { contents: new TextEncoder().encode(newContent), overwrite: true });
        return vscode.workspace.applyEdit(workspaceEdit);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to append to file ${uri.fsPath}: ${error.message}`);
        return false;
    }
}

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
        let modified = false;

        if (typeof startLine === 'number' && typeof endLine === 'number') {
            const lines = fileContent.split('\\n');
            if (startLine > 0 && endLine >= startLine && endLine <= lines.length) {
                lines.splice(startLine - 1, endLine - startLine + 1, replaceContent);
                fileContent = lines.join('\\n');
            } else {
                vscode.window.showErrorMessage('Invalid line numbers for replaceInFile.');
                return false;
            }
        } else if (findString) {
            if (replaceAll) {
                fileContent = fileContent.split(findString).join(replaceContent);
            } else {
                fileContent = fileContent.replace(findString, replaceContent);
            }
        } else if (findRegexString) {
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

        modified = fileContent !== originalFileContent;

        if (modified) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.createFile(uri, { contents: new TextEncoder().encode(fileContent), overwrite: true });
            return vscode.workspace.applyEdit(workspaceEdit);
        }
        vscode.window.showInformationMessage("No changes made by replaceInFile (target string/regex not found or content identical).");
        return true;
    } catch (error: any) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
             vscode.window.showErrorMessage(`File not found for replacement: ${uri.fsPath}`);
        } else {
            vscode.window.showErrorMessage(`Failed to replace in file ${uri.fsPath}: ${error.message}`);
        }
        return false;
    }
}

export async function readFileContent(uri: vscode.Uri): Promise<string | null> {
    console.log(`Attempting to read ${uri.fsPath}`);
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        return new TextDecoder().decode(data);
    } catch (error: any) {
        console.error(`Failed to read file ${uri.fsPath}: `, error);
        vscode.window.showErrorMessage(`Failed to read file ${uri.fsPath}. See dev console.`);
        return null;
    }
}

export async function listFiles(uri: vscode.Uri): Promise<string[] | null> {
    console.log(`Attempting to list files in ${uri.fsPath}`);
    try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        return entries.map(([name, type]) => type === vscode.FileType.Directory ? name + '/' : name);
    } catch (error: any) {
        console.error(`Failed to list files in ${uri.fsPath}: `, error);
        vscode.window.showErrorMessage(`Failed to list files in ${uri.fsPath}. See dev console.`);
        return null;
    }
}


export interface ShellCommandResult {
    success: boolean;
    stdout: string;
    stderr: string;
    error?: any; // For exec errors, distinct from stderr content
}

export async function executeShellCommand(
    command: string,
    cwdUri: vscode.Uri
): Promise<ShellCommandResult> {
    console.log(\`Executing shell command: '\${command}' in '\${cwdUri.fsPath}'\`);

    return new Promise((resolve) => {
        child_process.exec(command, { cwd: cwdUri.fsPath, encoding: 'utf8' }, (error, stdout, stderr) => {
            if (error) {
                console.error(\`Shell command error for '\${command}':\`, error);
                resolve({
                    success: false,
                    stdout: stdout.toString(),
                    stderr: stderr.toString(),
                    error: error
                });
            } else {
                console.log(\`Shell command stdout for '\${command}':\`, stdout);
                if (stderr) {
                    console.warn(\`Shell command stderr for '\${command}':\`, stderr);
                }
                resolve({
                    success: true,
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                });
            }
        });
    });
}
