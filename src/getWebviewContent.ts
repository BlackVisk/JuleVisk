import * as vscode from 'vscode';

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // Helper function to get resource URI
    const getNonce = () => {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    };
    const nonce = getNonce();

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

    // Initial configuration values (these would eventually be loaded from settings)
    // For now, just placeholders or use vscode.workspace.getConfiguration()
    const config = vscode.workspace.getConfiguration('ollamaCollaborators');
    const agentOneBaseURL = config.get('agentOne.baseURL', 'http://localhost:11434');
    const agentOneModel = config.get('agentOne.model', 'llama2');
    const agentTwoBaseURL = config.get('agentTwo.baseURL', 'http://localhost:11434');
    const agentTwoModel = config.get('agentTwo.model', 'mistral');

    return \`<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src \${webview.cspSource} 'unsafe-inline'; script-src 'nonce-\${nonce}' \${webview.cspSource}; img-src \${webview.cspSource} https: data:;">
        <link href="\${styleUri}" rel="stylesheet">
        <title>Ollama Collaborators</title>
    </head>
    <body>
        <h1>Ollama Collaborators</h1>

        <div class="config-section">
            <h2>Agent 1 Configuration</h2>
            <label for="agentOneBaseURL">Base URL:</label>
            <input type="text" id="agentOneBaseURL" value="\${agentOneBaseURL}">
            <label for="agentOneModel">Model:</label>
            <input type="text" id="agentOneModel" value="\${agentOneModel}">

            <h2>Agent 2 Configuration</h2>
            <label for="agentTwoBaseURL">Base URL:</label>
            <input type="text" id="agentTwoBaseURL" value="\${agentTwoBaseURL}">
            <label for="agentTwoModel">Model:</label>
            <input type="text" id="agentTwoModel" value="\${agentTwoModel}">
        </div>

        <div class="chat-area">
            <div id="conversation" class="conversation-display">
                <!-- Messages will appear here -->
            </div>
            <div class="input-area">
                <textarea id="userPrompt" placeholder="Enter your prompt here..."></textarea>
                <button id="sendPromptButton">Send</button>
            </div>
        </div>
        <hr>
        <h2>Autonomous Mode</h2>
        <div class="config-section">
            <p>Status:
                <span id="autonomousModeStatus">Disabled</span> (VSCode Setting: <code>ollamaCollaborators.enableAutonomousMode</code>)
            </p>
            <p>Shell Execution:
                <span id="shellExecutionStatus">Disabled</span> (VSCode Setting: <code>ollamaCollaborators.autonomous.enableShellExecution</code>)
            </p>
        </div>
        <div id="autonomousTaskSection">
            <label for="autonomousProjectPrompt">Project or Task Prompt:</label>
            <textarea id="autonomousProjectPrompt" placeholder="Describe the project or complex task for the agents... e.g., 'Create a Python Flask app with a to-do API'"></textarea>
            <button id="startAutonomousTaskButton">Start Autonomous Task</button>
            <button id="stopAutonomousTaskButton" style="display:none; background-color: var(--vscode-button-secondaryBackground);">Stop Task</button>
        </div>
        <div id="autonomousPlanDisplay" class="conversation-display" style="height: 200px; margin-top:10px; padding: 5px; border: 1px solid var(--vscode-editorWidget-border); background-color: var(--vscode-input-background);">
             <!-- Autonomous actions and their status will appear here -->
        </div>


        <script nonce="\${nonce}" src="\${scriptUri}"></script>
    </body>
    </html>\`;
}
