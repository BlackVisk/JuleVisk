/**
 * @file src/getWebviewContent.ts
 * This module is responsible for generating the HTML content for the
 * Ollama Collaborators webview panel. It constructs the UI structure,
 * links necessary CSS and JavaScript files, and populates initial form values
 * from VSCode configuration settings.
 */

import * as vscode from 'vscode';

/**
 * Generates the complete HTML content for the Ollama Collaborators webview panel.
 *
 * This function constructs the user interface with sections for agent configuration,
 * the main chat interaction area, and controls for autonomous mode. It ensures
 * that local resources (CSS, JavaScript) are correctly URI-encoded for webview access
 * and populates input fields with default values from the extension's VSCode settings.
 * A Content Security Policy (CSP) is also set to enhance security.
 *
 * @param webview The VSCode Webview instance to which this HTML will be applied.
 *                Used to generate correct URIs for local resources and for CSP.
 * @param extensionUri The URI of the extension, used as a base for resolving paths
 *                     to local media resources (CSS, JavaScript).
 * @returns A string containing the full HTML document for the webview.
 *
 * Key HTML Sections Generated:
 * - Agent Configuration: Inputs for Base URLs and Model names for two Ollama agents.
 * - Chat Area: Display for conversation history and user prompt input.
 * - Autonomous Mode: Status display, project prompt input, Start/Stop buttons, and plan display area.
 *
 * Security Considerations:
 * - Uses `webview.cspSource` in the Content-Security-Policy meta tag to restrict resource loading.
 * - Generates a nonce for inline scripts to comply with CSP.
 * - User-provided content displayed in the webview (e.g., agent responses, file content)
 *   is sanitized in `media/main.js` before being added to the DOM.
 */
export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
    // Helper function to generate a random nonce for Content Security Policy (CSP)
    const getNonce = () => {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    };
    const nonce = getNonce();

    // Get URIs for local resources (scripts, stylesheets) to allow them in the webview
    // These URIs include the webview's scheme and ensure proper access.
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.css'));

    // Load initial agent configurations from VSCode settings to pre-fill UI fields
    const config = vscode.workspace.getConfiguration('ollamaCollaborators');
    const agentOneBaseURL = config.get('agentOne.baseURL', 'http://localhost:11434');
    const agentOneModel = config.get('agentOne.model', 'llama2');
    const agentTwoBaseURL = config.get('agentTwo.baseURL', 'http://localhost:11434');
    const agentTwoModel = config.get('agentTwo.model', 'mistral');

    // Construct the HTML content using a template literal
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        {/* <!-- Content Security Policy: Restricts resource loading, scripts, styles to enhance security. --> */}
        {/* <!-- Uses webview.cspSource and a nonce for scripts. --> */}
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
        <link href="${styleUri}" rel="stylesheet">
        <title>Ollama Collaborators</title>
    </head>
    <body>
        <h1>Ollama Collaborators</h1>

        {/* <!-- Section for configuring Agent 1 (Base URL, Model) --> */}
        <div class="config-section">
            <h2>Agent 1 Configuration</h2>
            <label for="agentOneBaseURL">Base URL:</label>
            <input type="text" id="agentOneBaseURL" value="${agentOneBaseURL}">
            <label for="agentOneModel">Model:</label>
            <input type="text" id="agentOneModel" value="${agentOneModel}">

            <h2>Agent 2 Configuration</h2>
            <label for="agentTwoBaseURL">Base URL:</label>
            <input type="text" id="agentTwoBaseURL" value="${agentTwoBaseURL}">
            <label for="agentTwoModel">Model:</label>
            <input type="text" id="agentTwoModel" value="${agentTwoModel}">
        </div>

        {/* <!-- Main chat interaction area --> */}
        <div class="chat-area">
            {/* <!-- Area where agent and user messages are displayed --> */}
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
        {/* <!-- Section for Autonomous Mode: project prompt, start/stop controls --> */}
        <div id="autonomousTaskSection">
            <label for="autonomousProjectPrompt">Project or Task Prompt:</label>
            <textarea id="autonomousProjectPrompt" placeholder="Describe the project or complex task for the agents... e.g., 'Create a Python Flask app with a to-do API'"></textarea>
            <button id="startAutonomousTaskButton">Start Autonomous Task</button>
            <button id="stopAutonomousTaskButton" style="display:none; background-color: var(--vscode-button-secondaryBackground);">Stop Task</button>
        </div>
        {/* <!-- Display area for the sequence of actions and their status in Autonomous Mode --> */}
        <div id="autonomousPlanDisplay" class="conversation-display" style="height: 200px; margin-top:10px; padding: 5px; border: 1px solid var(--vscode-editorWidget-border); background-color: var(--vscode-input-background);">
             <!-- Autonomous actions and their status will appear here -->
        </div>

        <script nonce="${nonce}" src="${scriptUri}"></script>
    </body>
    </html>`;
}
