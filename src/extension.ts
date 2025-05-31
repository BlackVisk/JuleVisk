import * as vscode from 'vscode';
import { getWebviewContent } from './getWebviewContent';
import * as ollamaClient from './ollamaClient';
import * as workspaceModifier from './workspaceModifier';
import { TextEncoder, TextDecoder } from 'util';
import * as path from 'path';

// --- Autonomous Action Execution Engine ---
interface AgentAction {
    action: string;
    description?: string;
    id?: string;
}
interface CreateFileAction extends AgentAction { action: "create_file"; path: string; content: string; overwrite?: boolean; }
interface AppendToFileAction extends AgentAction { action: "append_to_file"; path: string; content: string; }
interface ReplaceInFileAction extends AgentAction { action: "replace_in_file"; path: string; find_string?: string; find_regex?: string; start_line?: number; end_line?: number; replace_content: string; replace_all?: boolean; }
interface ReadFileAction extends AgentAction { action: "read_file"; path: string; }
interface ListFilesAction extends AgentAction { action: "list_files"; path: string; }
interface ExecuteShellCommandAction extends AgentAction { action: "execute_shell_command"; command: string; cwd?: string; }
interface AgentMessageAction extends AgentAction { action: "agent_message"; message: string; message_type?: "info" | "warning" | "error"; }

type AnyAgentAction = CreateFileAction | AppendToFileAction | ReplaceInFileAction | ReadFileAction | ListFilesAction | ExecuteShellCommandAction | AgentMessageAction;

let currentCancellationTokenSource: vscode.CancellationTokenSource | null = null;

// Moved plannerSystemPromptCore to be a global constant in this module scope
const plannerSystemPromptCore = `
You are an expert software development project planner. Your task is to take a user's project request and break it down into a sequence of concrete, executable actions. You must output these actions as a JSON array, where each object in the array conforms to the action schema provided below.

**Action Schema:**
*   \`{ "action": "create_file", "path": "relative/path/to/file.ext", "content": "file content", "description": "Why this file is created", "id": "unique_action_id_1" }\`
*   \`{ "action": "append_to_file", "path": "relative/path/to/file.ext", "content": "content to append", "description": "Reason for appending", "id": "unique_action_id_2" }\`
*   \`{ "action": "replace_in_file", "path": "path/to/file.ext", "find_string": "string to find", "replace_content": "new content", "description": "Reason for replacement", "id": "unique_action_id_3" }\` (Can also use "find_regex", or "start_line" and "end_line" (1-indexed, inclusive) for targeting)
*   \`{ "action": "execute_shell_command", "command": "shell command to run", "cwd": "./relative/path", "description": "Purpose of command", "id": "unique_action_id_4" }\`
*   \`{ "action": "read_file", "path": "path/to/file.ext", "description": "Reason for reading (output will be provided back to you in a subsequent step if requested)", "id": "unique_action_id_5" }\`
*   \`{ "action": "list_files", "path": "path/to/directory", "description": "Reason for listing files (output will be provided back to you in a subsequent step if requested)", "id": "unique_action_id_6" }\`
*   \`{ "action": "agent_message", "message": "message to user", "message_type": "info|warning|error", "description": "Communicating status or asking for clarification", "id": "unique_action_id_7" }\`

**Important Rules:**
*   All file paths MUST be relative to the project's root directory. Do not use absolute paths.
*   Ensure 'content' for file operations is a valid JSON string (e.g., newlines as \\n, quotes escaped as \\").
*   Each action object in the JSON array MUST have a unique "id" field (e.g., "action_1", "action_2").
*   Use the "description" field for each action to explain its purpose. This helps the user understand the plan.
*   Be methodical. For a new project, common steps are creating directories (implicitly via create_file with nested paths), creating main files, then helper files, configuration, tests, etc.
*   If you need to install dependencies, use "execute_shell_command" (e.g., for "pip install X" or "npm install Y").
*   Output ONLY the JSON array of actions. Do not include any other text or explanation before or after the JSON.

**Example Interaction:**

User Request: "Create a simple Python Flask app with a single route that returns 'Hello, World!'. Create a requirements.txt file for Flask."

Your Output (JSON array of actions):
[
  {
    "action": "create_file",
    "path": "app.py",
    "content": "from flask import Flask\\n\\napp = Flask(__name__)\\n\\n@app.route('/')\\ndef hello_world():\\n    return 'Hello, World!'\\n\\nif __name__ == '__main__':\\n    app.run(debug=True)",
    "description": "Create the main Flask application file.",
    "id": "flask_app_create"
  },
  {
    "action": "create_file",
    "path": "requirements.txt",
    "content": "Flask>=2.0",
    "description": "Create requirements file listing Flask as a dependency.",
    "id": "req_txt_create"
  },
  {
    "action": "agent_message",
    "message": "Project structure for Flask 'Hello, World' app and requirements.txt has been planned. Consider creating a virtual environment and running 'pip install -r requirements.txt'.",
    "message_type": "info",
    "description": "Inform user about completion and next potential steps.",
    "id": "inform_user_done"
  }
]
`;

async function executeActionSequence(actions: AnyAgentAction[], panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    if (currentCancellationTokenSource) {
        currentCancellationTokenSource.cancel();
    }
    currentCancellationTokenSource = new vscode.CancellationTokenSource();
    const token = currentCancellationTokenSource.token;

    panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'started', totalActions: actions.length });

    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        if (token.isCancellationRequested) {
            panel.webview.postMessage({ command: 'actionStatus', id: action.id, action: action.action, status: 'cancelled', description: action.description, index: i, totalActions: actions.length });
            panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'cancelled_by_user', completedActions: i, totalActions: actions.length });
            currentCancellationTokenSource = null;
            return;
        }

        panel.webview.postMessage({ command: 'actionStatus', id: action.id, action: action.action, status: 'in_progress', description: action.description, index: i, totalActions: actions.length });
        let success = false;
        let message = '';
        let actionOutput: string | string[] | null = null;

        const workspaceRootUri = workspaceModifier.getWorkspaceRootUri();
        if (!workspaceRootUri && ['create_file', 'append_to_file', 'replace_in_file', 'read_file', 'list_files', 'execute_shell_command'].includes(action.action)) {
            success = false;
            message = `Action '${action.action}' requires an open workspace folder.`;
            panel.webview.postMessage({ command: 'actionStatus', id: action.id, action: action.action, status: 'failed', description: action.description, message, index: i, totalActions: actions.length });
            panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'error', completedActions: i, totalActions: actions.length, error: message });
            currentCancellationTokenSource = null;
            return;
        }

        const resolvePath = (relativePath: string) => workspaceRootUri ? vscode.Uri.joinPath(workspaceRootUri, relativePath) : vscode.Uri.file(relativePath);

        try {
            switch (action.action) {
                case 'create_file':
                    const createFileAction = action as CreateFileAction;
                    const autoOpenConfigCreate = vscode.workspace.getConfiguration('ollamaCollaborators.files').get('autoOpenCreatedFiles', true);
                    success = await workspaceModifier.createNewFileWithCode(resolvePath(createFileAction.path), createFileAction.content, { overwrite: createFileAction.overwrite, autoOpen: autoOpenConfigCreate });
                    message = success ? `File created: ${createFileAction.path}` : `Failed to create file: ${createFileAction.path}`;
                    break;
                case 'append_to_file':
                    const appendAction = action as AppendToFileAction;
                    success = await workspaceModifier.appendToFile(resolvePath(appendAction.path), appendAction.content);
                    message = success ? `Appended to: ${appendAction.path}` : `Failed to append to: ${appendAction.path}`;
                    break;
                case 'replace_in_file':
                    const replaceAction = action as ReplaceInFileAction;
                    success = await workspaceModifier.replaceInFile(resolvePath(replaceAction.path), replaceAction.find_string, replaceAction.find_regex, replaceAction.start_line, replaceAction.end_line, replaceAction.replace_content, replaceAction.replace_all);
                    message = success ? `Content replaced in: ${replaceAction.path}` : `Failed to replace in: ${replaceAction.path}`;
                    break;
                case 'read_file':
                    const readFileAction = action as ReadFileAction;
                    actionOutput = await workspaceModifier.readFileContent(resolvePath(readFileAction.path));
                    success = actionOutput !== null;
                    message = success ? `Read file: ${readFileAction.path}` : `Failed to read file: ${readFileAction.path}`;
                    break;
                case 'list_files':
                    const listFilesAction = action as ListFilesAction;
                    actionOutput = await workspaceModifier.listFiles(resolvePath(listFilesAction.path));
                    success = actionOutput !== null;
                    message = success ? `Listed files in: ${listFilesAction.path}` : `Failed to list files in: ${listFilesAction.path}`;
                    break;
                case 'execute_shell_command': {
                    const shellAction = action as ExecuteShellCommandAction;
                    message = `Executing: ${shellAction.command}`;

                    const autonomousModeEnabled = vscode.workspace.getConfiguration('ollamaCollaborators').get('enableAutonomousMode', false);
                    const shellExecutionEnabled = vscode.workspace.getConfiguration('ollamaCollaborators.autonomous').get('enableShellExecution', false);

                    if (!autonomousModeEnabled || !shellExecutionEnabled) {
                        message = "Shell command execution is disabled. Enable 'enableAutonomousMode' and 'autonomous.enableShellExecution' in settings.";
                        success = false;
                        actionOutput = message;
                        break;
                    }

                    const userConfirmation = await vscode.window.showWarningMessage(
                        `Allow agent to execute the following command in '${shellAction.cwd || workspaceRootUri?.fsPath || 'current directory'}'?\n\n${shellAction.command}`,
                        { modal: true },
                        "Allow",
                        "Deny"
                    );

                    if (userConfirmation !== "Allow") {
                        message = "Shell command execution denied by user.";
                        success = false;
                        actionOutput = message;
                        break;
                    }

                    const commandCwdUri = shellAction.cwd ? resolvePath(shellAction.cwd) : (workspaceRootUri || vscode.Uri.file('.'));

                    const result = await workspaceModifier.executeShellCommand(shellAction.command, commandCwdUri);
                    success = result.success;
                    actionOutput = `Stdout:\n${result.stdout}\nStderr:\n${result.stderr}${result.error ? `\nError: ${result.error.message}` : ''}`;
                    message = success ? `Command '${shellAction.command}' executed.` : `Command '${shellAction.command}' failed.`;
                    if (result.error) {
                        console.error("Shell command execution error:", result.error);
                    }
                    if (result.stderr && !result.success) {
                        console.warn("Shell command stderr:", result.stderr);
                    }
                    break;
                }
                case 'agent_message':
                    const agentMsgAction = action as AgentMessageAction;
                    panel.webview.postMessage({ command: 'displayAgentMessage', text: agentMsgAction.message, type: agentMsgAction.message_type || 'info' });
                    success = true;
                    message = `Agent message sent: ${agentMsgAction.message.substring(0, 50)}...`;
                    break;
                default:
                    const unknownAction = action as any;
                    console.warn(`Unknown agent action: ${unknownAction.action}`);
                    message = `Unknown action type: ${unknownAction.action}`;
                    success = false;
            }
        } catch (e: any) {
            success = false;
            message = `Error executing action '${action.action}': ${e.message}`;
            console.error(message, e);
        }
        panel.webview.postMessage({ command: 'actionStatus', id: action.id, action: action.action, status: success ? 'completed' : 'failed', description: action.description, message, output: actionOutput, index: i, totalActions: actions.length });

        if (!success) {
            panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'error', completedActions: i, totalActions: actions.length, error: message });
            currentCancellationTokenSource = null;
            return;
        }
    }
    panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'completed_all', completedActions: actions.length, totalActions: actions.length });
    currentCancellationTokenSource = null;
}


export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "ollama-collaborators" is now active!');

    let startCollaborationCommand = vscode.commands.registerCommand('ollama-collaborators.startCollaboration', () => {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        const panel = vscode.window.createWebviewPanel(
            'ollamaCollaboratorsWebview',
            'Ollama Collaborators',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
            }
        );

        panel.webview.html = getWebviewContent(panel.webview, context.extensionUri);

        const sendCurrentSettings = () => {
            const autoModeConfig = vscode.workspace.getConfiguration('ollamaCollaborators');
            panel.webview.postMessage({
                command: 'settingsUpdate',
                isAutonomousModeEnabled: autoModeConfig.get('enableAutonomousMode', false),
                isShellExecutionEnabled: autoModeConfig.get('autonomous.enableShellExecution', false)
            }).then(sent => {
                if (!sent) console.warn("Failed to send initial settings to webview.");
            }, err => {
                console.error("Error sending initial settings to webview:", err);
            });
        };
        sendCurrentSettings();

        const configChangeListener = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ollamaCollaborators.enableAutonomousMode') ||
                e.affectsConfiguration('ollamaCollaborators.autonomous.enableShellExecution')) {
                sendCurrentSettings();
            }
        });
        context.subscriptions.push(configChangeListener);

        let agentOneContext: number[] | undefined = undefined;
        let agentTwoContext: number[] | undefined = undefined;

        panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.command) {
                    case 'userPrompt':
                        const userPromptText = message.text;
                        const config = message.config;

                        if (!config || !config.agent1 || !config.agent2) {
                            panel.webview.postMessage({ command: 'showError', text: 'Agent configuration is missing.' });
                            return;
                        }

                        const agent1Config: ollamaClient.OllamaConfig = { baseURL: config.agent1.baseURL, model: config.agent1.model };
                        const agent2Config: ollamaClient.OllamaConfig = { baseURL: config.agent2.baseURL, model: config.agent2.model };

                        agentOneContext = undefined;
                        agentTwoContext = undefined;

                        panel.webview.postMessage({ command: 'agentResponse', agentName: agent1Config.model + ' (Agent 1)', text: 'Thinking...' });
                        let agentOneFullResponse = "";
                        try {
                            await new Promise<void>((resolve, reject) => {
                                ollamaClient.streamOllamaResponse(
                                    agent1Config,
                                    userPromptText,
                                    agentOneContext,
                                    (chunk) => {
                                        if (chunk.response) {
                                            agentOneFullResponse += chunk.response;
                                            panel.webview.postMessage({ command: 'agentResponse', agentName: agent1Config.model + ' (Agent 1)', text: chunk.response, streaming: true, fullResponseSoFar: agentOneFullResponse });
                                        }
                                        if (chunk.done) {
                                            agentOneContext = chunk.context;
                                        }
                                    },
                                    (error) => {
                                        console.error('Agent 1 Error:', error);
                                        panel.webview.postMessage({ command: 'showError', text: `Agent 1 (${agent1Config.model}) error: ${error.message}` });
                                        reject(error);
                                    },
                                    () => {
                                        panel.webview.postMessage({ command: 'agentResponseDone', agentName: agent1Config.model + ' (Agent 1)'});
                                        resolve();
                                    }
                                );
                            });

                            if (agentOneFullResponse) {
                                panel.webview.postMessage({ command: 'agentResponse', agentName: agent2Config.model + ' (Agent 2)', text: 'Thinking...' });
                                const reviewPrompt = `The user's request was: "${userPromptText}". \n\nAgent 1 (${agent1Config.model}) responded: "${agentOneFullResponse}". \n\nPlease review Agent 1's response. Provide feedback, identify potential issues, and suggest improvements or alternative approaches. If the response is code, check for correctness and efficiency.`;
                                let agentTwoFullResponse = "";
                                await new Promise<void>((resolve, reject) => {
                                    ollamaClient.streamOllamaResponse(
                                        agent2Config,
                                        reviewPrompt,
                                        agentTwoContext,
                                        (chunk) => {
                                            if (chunk.response) {
                                                agentTwoFullResponse += chunk.response;
                                                panel.webview.postMessage({ command: 'agentResponse', agentName: agent2Config.model + ' (Agent 2)', text: chunk.response, streaming: true, fullResponseSoFar: agentTwoFullResponse });
                                            }
                                            if (chunk.done) {
                                                agentTwoContext = chunk.context;
                                            }
                                        },
                                        (error) => {
                                            console.error('Agent 2 Error:', error);
                                            panel.webview.postMessage({ command: 'showError', text: `Agent 2 (${agent2Config.model}) error: ${error.message}` });
                                            reject(error);
                                        },
                                        () => {
                                            panel.webview.postMessage({ command: 'agentResponseDone', agentName: agent2Config.model + ' (Agent 2)'});
                                            resolve();
                                        }
                                    );
                                });
                            }
                        } catch (error: any) {
                            console.error("Error during agent interaction:", error);
                            panel.webview.postMessage({ command: 'showError', text: "Error during agent interaction: " + error.message });
                        }
                        return;

                    case 'applyCode':
                        try {
                            const success = await workspaceModifier.applyCodeToActiveEditor(message.code, message.strategy);
                            if (success) {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: true, message: `Code ${message.strategy === 'insertAtCursor' ? 'inserted' : 'replaced'} successfully.` });
                            }
                        } catch (e_apply) {
                            if (e_apply instanceof Error) {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'Error applying code: ' + e_apply.message });
                            } else {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'Unknown error applying code.' });
                            }
                        }
                        return;

                    case 'createFileWithCode':
                        try {
                            const autoOpenConfig = vscode.workspace.getConfiguration('ollamaCollaborators.files').get('autoOpenCreatedFiles', true);
                            const workspaceRoot = workspaceModifier.getWorkspaceRootUri();
                            if (!workspaceRoot) {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'No workspace folder open to create file in.' });
                                return;
                            }
                            const suggestedFileName = message.suggestedFileName || 'ollama-output.txt';
                            const defaultPathUri = vscode.Uri.joinPath(workspaceRoot, suggestedFileName);

                            const filePathString = await vscode.window.showInputBox({
                                prompt: 'Enter file path relative to workspace root, or an absolute path.',
                                value: vscode.workspace.asRelativePath(defaultPathUri, false),
                                placeHolder: 'e.g., src/myNewFile.ts or /abs/path/to/file.txt'
                            });

                            if (filePathString) {
                                let fileUri;
                                if (path.isAbsolute(filePathString)) {
                                    fileUri = vscode.Uri.file(filePathString);
                                } else {
                                    fileUri = vscode.Uri.joinPath(workspaceRoot, filePathString);
                                }

                                const success = await workspaceModifier.createNewFileWithCode(fileUri, message.code, { autoOpen: autoOpenConfig });
                                if (success) {
                                    panel.webview.postMessage({ command: 'fileOperationStatus', success: true, message: `File created: ${vscode.workspace.asRelativePath(fileUri)}`});
                                }
                            } else {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'File creation cancelled: No path provided.' });
                            }
                        } catch (e_create) {
                             if (e_create instanceof Error) {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'Error creating file: ' + e_create.message });
                            } else {
                                panel.webview.postMessage({ command: 'fileOperationStatus', success: false, message: 'Unknown error creating file.' });
                            }
                        }
                        return;

                    case 'showInfo':
                        if (message.text) vscode.window.showInformationMessage(message.text);
                        return;

                    case 'startAutonomousTask': { // Added block scope
                        const projectPrompt = message.projectPrompt;
                        panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'planning' });

                        (async () => {
                            try {
                                const agentOneConfigRaw = vscode.workspace.getConfiguration('ollamaCollaborators.agentOne');
                                const plannerAgentConfig: ollamaClient.OllamaConfig = {
                                    baseURL: agentOneConfigRaw.get('baseURL', 'http://localhost:11434'),
                                    model: agentOneConfigRaw.get('model', 'llama2')
                                };

                                if (!plannerAgentConfig.model) {
                                    throw new Error("Planner agent model is not configured (check ollamaCollaborators.agentOne.model).");
                                }

                                const fullPlannerPrompt = `${plannerSystemPromptCore}\n\nUser Request for this turn:\n${projectPrompt}\n\nYour Output (JSON array of actions):`;

                                panel.webview.postMessage({ command: 'actionStatus', action: 'LLM Plan Generation', status: 'in_progress', description: 'Asking Planner Agent to generate action sequence...', index: -1, totalActions: 0 });

                                const plannerResponse = await ollamaClient.getOllamaResponse(plannerAgentConfig, fullPlannerPrompt);
                                panel.webview.postMessage({ command: 'actionStatus', action: 'LLM Plan Generation', status: 'completed', description: 'Planner Agent responded.', index: -1, totalActions: 0 });

                                let receivedActions: AnyAgentAction[];
                                try {
                                    const jsonMatch = plannerResponse.response.match(/\\[([\\s\\S]*?)\\]/s);
                                    if (jsonMatch && jsonMatch[0]) {
                                        receivedActions = JSON.parse(jsonMatch[0]);
                                    } else {
                                        receivedActions = JSON.parse(plannerResponse.response);
                                    }
                                } catch (e: any) {
                                    console.error("Failed to parse planner response JSON:", e);
                                    console.error("Raw planner response:", plannerResponse.response);
                                    panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'failed_to_plan', error: `Failed to parse plan from Planner Agent: ${e.message}. Check agent's output format.` });
                                    return;
                                }

                                if (!Array.isArray(receivedActions) || !receivedActions.every(act => typeof act.action === 'string' && typeof act.id === 'string')) {
                                    console.error("Invalid action sequence structure:", receivedActions);
                                    panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'failed_to_plan', error: 'Planner Agent returned an invalid action sequence structure (not an array or actions missing type/id).' });
                                    return;
                                }

                                executeActionSequence(receivedActions, panel, context).catch(e_exec => {
                                     console.error("Error in executeActionSequence from planner:", e_exec);
                                     if (e_exec instanceof Error) {
                                        panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'error', error: "Critical error in action engine: " + e_exec.message });
                                     } else {
                                        panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'error', error: "Unknown critical error in action engine." });
                                     }
                                });
                            } catch (e_plan: any) {
                                console.error("Error during planning stage:", e_plan);
                                panel.webview.postMessage({ command: 'autonomousPlanStatus', status: 'failed_to_plan', error: `Error during planning: ${e_plan.message}` });
                            }
                        })();
                        return;
                    }
                    case 'stopAutonomousTask':
                        if (currentCancellationTokenSource) {
                            currentCancellationTokenSource.cancel();
                            console.log("Autonomous task cancellation requested.");
                        }
                        return;
                }
            },
            undefined,
            context.subscriptions
        );

        panel.onDidDispose(
            () => {
                console.log('Ollama Collaborators panel closed.');
                if (currentCancellationTokenSource) {
                    currentCancellationTokenSource.cancel();
                    currentCancellationTokenSource = null;
                }
                configChangeListener.dispose();
            },
            null,
            context.subscriptions
        );
    });

    context.subscriptions.push(startCollaborationCommand);
}

export function deactivate() {
    if (currentCancellationTokenSource) {
        currentCancellationTokenSource.cancel();
    }
}