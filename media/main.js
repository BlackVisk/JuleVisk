// Ensure vscode API is acquired only once
const vscode = acquireVsCodeApi();

// Helper function to sanitize text for HTML display
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}

// Helper function to create or update action elements in the plan display
function getOrCreateActionElement(actionId, index, planDisplay) {
    const elementId = `action-${actionId || index}`;
    let actionDiv = document.getElementById(elementId);
    if (!actionDiv) {
        actionDiv = document.createElement('div');
        actionDiv.id = elementId;
        actionDiv.className = 'action-item';
        planDisplay.appendChild(actionDiv); // Append new actions
    }
    return actionDiv;
}

// Keep track of ongoing streaming messages for regular agent chat
let agentStreamingMessages = {};

window.addEventListener('load', () => {
    const sendButton = document.getElementById('sendPromptButton');
    const userPromptInput = document.getElementById('userPrompt');

    const autonomousModeStatusSpan = document.getElementById('autonomousModeStatus'); // For settingsUpdate
    const shellExecutionStatusSpan = document.getElementById('shellExecutionStatus'); // For settingsUpdate
    const autonomousProjectPromptInput = document.getElementById('autonomousProjectPrompt');
    const startAutonomousTaskButton = document.getElementById('startAutonomousTaskButton');
    const stopAutonomousTaskButton = document.getElementById('stopAutonomousTaskButton');
    const autonomousPlanDisplay = document.getElementById('autonomousPlanDisplay');

    if (sendButton && userPromptInput) {
        sendButton.addEventListener('click', () => {
            const promptText = userPromptInput.value;
            const agentOneBaseURL = document.getElementById('agentOneBaseURL').value;
            const agentOneModel = document.getElementById('agentOneModel').value;
            const agentTwoBaseURL = document.getElementById('agentTwoBaseURL').value;
            const agentTwoModel = document.getElementById('agentTwoModel').value;

            if (promptText) {
                vscode.postMessage({
                    command: 'userPrompt',
                    text: promptText,
                    config: {
                        agent1: { baseURL: agentOneBaseURL, model: agentOneModel },
                        agent2: { baseURL: agentTwoBaseURL, model: agentTwoModel }
                    }
                });
                const conversationDisplay = document.getElementById('conversation');
                const userMessageDiv = document.createElement('div');
                userMessageDiv.className = 'message user-message';
                userMessageDiv.textContent = `You: ${promptText}`;
                if (conversationDisplay) {
                    conversationDisplay.appendChild(userMessageDiv);
                    conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
                }
                userPromptInput.value = '';
            }
        });
    } else {
        console.warn('Main prompt UI elements (sendButton, userPromptInput) not all found on load.');
    }

    if (startAutonomousTaskButton && autonomousProjectPromptInput && stopAutonomousTaskButton && autonomousPlanDisplay) {
        startAutonomousTaskButton.addEventListener('click', () => {
            const projectPrompt = autonomousProjectPromptInput.value;
            if (projectPrompt) {
                vscode.postMessage({ command: 'startAutonomousTask', projectPrompt: projectPrompt });
                startAutonomousTaskButton.disabled = true;
                stopAutonomousTaskButton.style.display = 'inline-block';
                autonomousPlanDisplay.innerHTML = ''; // Clear previous plan display
            } else {
                vscode.postMessage({ command: 'showError', text: 'Please enter a project prompt for autonomous mode.'});
            }
        });

        stopAutonomousTaskButton.addEventListener('click', () => {
            vscode.postMessage({ command: 'stopAutonomousTask' });
        });
    } else {
        console.warn("Autonomous mode UI elements (start/stop buttons, prompt, display) not all found on load.");
    }
});

window.addEventListener('message', event => {
    const message = event.data;
    const conversationDisplay = document.getElementById('conversation');
    const autonomousPlanDisplay = document.getElementById('autonomousPlanDisplay');

    if (!conversationDisplay || !autonomousPlanDisplay) {
        console.error("Required display areas (conversation or autonomousPlanDisplay) not found!");
        return;
    }

    switch (message.command) {
        case 'agentResponse':
            let agentMessageDiv;
            const agentKey = message.agentName;
            if (message.text === 'Thinking...' && !message.streaming) {
                if (agentStreamingMessages[agentKey]) {
                    agentMessageDiv = agentStreamingMessages[agentKey];
                    agentMessageDiv.innerHTML = `<span class="agent-name">${sanitizeHTML(message.agentName)}: </span><span class="agent-response-text" style="font-style: italic;">Thinking...</span>`;
                } else {
                    agentMessageDiv = document.createElement('div');
                    agentMessageDiv.className = 'message agent-message';
                    agentMessageDiv.innerHTML = `<span class="agent-name">${sanitizeHTML(message.agentName)}: </span><span class="agent-response-text" style="font-style: italic;">Thinking...</span>`;
                    conversationDisplay.appendChild(agentMessageDiv);
                    agentStreamingMessages[agentKey] = agentMessageDiv;
                }
            } else if (message.streaming && agentStreamingMessages[agentKey]) {
                agentMessageDiv = agentStreamingMessages[agentKey];
                const responseSpan = agentMessageDiv.querySelector('.agent-response-text');
                if (responseSpan) {
                    responseSpan.style.fontStyle = 'normal';
                    responseSpan.textContent = message.fullResponseSoFar;
                }
            } else {
                if (agentStreamingMessages[agentKey] && message.streaming) {
                     agentMessageDiv = agentStreamingMessages[agentKey];
                     const responseSpan = agentMessageDiv.querySelector('.agent-response-text');
                     if(responseSpan) {
                        responseSpan.style.fontStyle = 'normal';
                        responseSpan.textContent = message.fullResponseSoFar;
                     }
                } else {
                    agentMessageDiv = document.createElement('div');
                    agentMessageDiv.className = 'message agent-message';
                    const agentNameSpan = document.createElement('span');
                    agentNameSpan.className = 'agent-name';
                    agentNameSpan.textContent = `${sanitizeHTML(message.agentName)}: `;
                    agentMessageDiv.appendChild(agentNameSpan);
                    const agentResponseSpan = document.createElement('span');
                    agentResponseSpan.className = 'agent-response-text';
                    agentResponseSpan.textContent = message.streaming ? message.fullResponseSoFar : message.text;
                    agentMessageDiv.appendChild(agentResponseSpan);
                    conversationDisplay.appendChild(agentMessageDiv);
                    if (message.streaming) {
                         agentStreamingMessages[agentKey] = agentMessageDiv;
                    } else {
                        const textContent = message.text || message.fullResponseSoFar || "";
                        if (textContent.includes('```')) {
                            addCodeActionButtons(agentMessageDiv, textContent);
                        }
                    }
                }
            }
            conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
            break;
        case 'agentResponseDone':
            if (agentStreamingMessages[message.agentName]) {
                const doneDiv = agentStreamingMessages[message.agentName];
                const responseSpan = doneDiv.querySelector('.agent-response-text');
                if (responseSpan) {
                    doneDiv.style.fontStyle = 'normal';
                    const textContent = responseSpan.textContent || "";
                    if (!doneDiv.querySelector('.code-actions') && textContent.includes('```')) {
                         addCodeActionButtons(doneDiv, textContent);
                    }
                }
            }
            delete agentStreamingMessages[message.agentName];
            conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
            break;
        case 'fileOperationStatus':
            const statusMessageDiv = document.createElement('div');
            statusMessageDiv.className = `message ${message.success ? 'file-op-success' : 'file-op-error'}`;
            statusMessageDiv.textContent = message.message;
            conversationDisplay.appendChild(statusMessageDiv);
            conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
            break;
        case 'showError':
             const errorMessageDiv = document.createElement('div');
             errorMessageDiv.className = 'message error-message';
             errorMessageDiv.style.color = 'red';
             errorMessageDiv.textContent = `ERROR: ${sanitizeHTML(message.text)}`;
             conversationDisplay.appendChild(errorMessageDiv);
             conversationDisplay.scrollTop = conversationDisplay.scrollHeight;
             break;
        case 'settingsUpdate':
            const autoModeStatusSpan = document.getElementById('autonomousModeStatus');
            const shellExecStatusSpan = document.getElementById('shellExecutionStatus');
            const autoProjectPromptInput = document.getElementById('autonomousProjectPrompt');
            const startAutoTaskButton = document.getElementById('startAutonomousTaskButton');
            if (autoModeStatusSpan) {
                autoModeStatusSpan.textContent = message.isAutonomousModeEnabled ? 'Enabled' : 'Disabled';
                autoModeStatusSpan.style.color = message.isAutonomousModeEnabled ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiRed)';
            }
            if (shellExecStatusSpan) {
                shellExecStatusSpan.textContent = message.isShellExecutionEnabled ? 'Enabled' : 'Disabled';
                shellExecStatusSpan.style.color = message.isShellExecutionEnabled ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-terminal-ansiRed)';
            }
            if (startAutoTaskButton && autoProjectPromptInput) {
                startAutoTaskButton.disabled = !message.isAutonomousModeEnabled;
                autoProjectPromptInput.disabled = !message.isAutonomousModeEnabled;
                if (!message.isAutonomousModeEnabled) {
                     autoProjectPromptInput.placeholder = "Enable 'ollamaCollaborators.enableAutonomousMode' in settings to use this feature.";
                } else {
                    autoProjectPromptInput.placeholder = "Describe the project or complex task for the agents...";
                }
            }
            break;
        case 'autonomousPlanStatus': {
            const startButton = document.getElementById('startAutonomousTaskButton');
            const stopButton = document.getElementById('stopAutonomousTaskButton');
            const projectPromptInput = document.getElementById('autonomousProjectPrompt');

            if (!startButton || !stopButton || !projectPromptInput) break;

            let statusText = `<strong>Autonomous Plan: ${message.status.replace(/_/g, ' ')}</strong>`;
            if (message.status === 'started' || message.status === 'planning') {
                if (message.status === 'planning') {
                    autonomousPlanDisplay.innerHTML = ''; // Clear previous plan
                    statusText = "<strong>Autonomous Plan: Planner agent is thinking...</strong>";
                } else {
                     const existingOverallStatus = autonomousPlanDisplay.querySelector('.overall-plan-status');
                     if (!existingOverallStatus || (existingOverallStatus && !autonomousPlanDisplay.querySelector('.action-item'))) {
                            autonomousPlanDisplay.innerHTML = '';
                     }
                }
                startButton.disabled = true;
                stopButton.style.display = 'inline-block';
                projectPromptInput.disabled = true;
            }

            if (message.completedActions !== undefined && message.totalActions !== undefined) {
                statusText += ` (${message.completedActions} / ${message.totalActions} actions processed)`;
            }
            if (message.error) {
                statusText += `<br><span class="error-output">Error: ${sanitizeHTML(message.error)}</span>`;
            }

            let overallStatusDiv = autonomousPlanDisplay.querySelector('.overall-plan-status');
            if (!overallStatusDiv) {
                overallStatusDiv = document.createElement('div');
                overallStatusDiv.className = 'message overall-plan-status';
                autonomousPlanDisplay.prepend(overallStatusDiv);
            }
            overallStatusDiv.innerHTML = statusText;

            if (message.status === 'completed_all' || message.status === 'error' || message.status === 'cancelled_by_user' || message.status === 'failed_to_plan') {
                const autoModeEnabled = document.getElementById('autonomousModeStatus')?.textContent === 'Enabled';
                startButton.disabled = !autoModeEnabled;
                stopButton.style.display = 'none';
                projectPromptInput.disabled = !autoModeEnabled;
            }
            autonomousPlanDisplay.scrollTop = 0;
            break;
        }
        case 'actionStatus': {
            const actionDiv = getOrCreateActionElement(message.id, message.index, autonomousPlanDisplay);
            actionDiv.className = `action-item action-status-${message.status}`;

            let statusIcon = '';
            switch(message.status) {
                case 'in_progress': statusIcon = '⏳'; break;
                case 'completed': statusIcon = '✅'; break;
                case 'failed': statusIcon = '❌'; break;
                case 'cancelled': statusIcon = '⏹️'; break;
                default: statusIcon = 'ℹ️'; break;
            }

            let outputHtml = '';
            if (message.output) {
                outputHtml = `<pre class="action-output">${sanitizeHTML(typeof message.output === 'string' ? message.output : JSON.stringify(message.output, null, 2))}</pre>`;
            } else if (message.message && message.status !== 'completed' && message.status !== 'in_progress' && message.status !== 'cancelled') {
                 outputHtml = `<pre class="action-output error-output">${sanitizeHTML(message.message)}</pre>`;
            }

            actionDiv.innerHTML = `
                <div class="action-header">
                    <span class="action-index">[${message.index + 1}/${message.totalActions || '?'}]</span>
                    <span class="action-type">${sanitizeHTML(message.action)}</span>
                    <span class="action-status-icon">${statusIcon}</span>
                    <span class="action-description">${sanitizeHTML(message.description || '')}</span>
                </div>
                ${message.message && (message.status === 'completed' || message.status === 'in_progress') ? `<div class="action-message"><small>${sanitizeHTML(message.message)}</small></div>` : ''}
                ${outputHtml}
            `;
            autonomousPlanDisplay.scrollTop = autonomousPlanDisplay.scrollHeight;
            break;
        }
        case 'displayAgentMessage':
            const agentInfoMsgDiv = document.createElement('div');
            agentInfoMsgDiv.className = `message agent-info-${message.type || 'info'}`;
            agentInfoMsgDiv.textContent = `[Agent Message]: ${sanitizeHTML(message.text)}`;
            autonomousPlanDisplay.appendChild(agentInfoMsgDiv);
            autonomousPlanDisplay.scrollTop = autonomousPlanDisplay.scrollHeight;
            break;
    }
});

function addCodeActionButtons(messageDiv, fullTextContent) {
    const codeBlockRegex = /```([a-zA-Z]*)\n([\s\S]*?)```/m;
    const match = codeBlockRegex.exec(fullTextContent);
    let codeToUse = fullTextContent;
    let lang = '';
    if (match && match[2]) {
        codeToUse = match[2].trim();
        lang = match[1] || '';
    } else if (fullTextContent.trim().startsWith('```') && fullTextContent.trim().endsWith('```')) {
        codeToUse = fullTextContent.trim().substring(3, fullTextContent.trim().length - 3).trim();
    }

    const existingActionsContainer = messageDiv.querySelector('.code-actions');
    if (existingActionsContainer) { return; }

    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'code-actions';

    const copyButton = document.createElement('button');
    copyButton.textContent = 'Copy Code';
    copyButton.onclick = () => {
        navigator.clipboard.writeText(codeToUse).then(() => {
            vscode.postMessage({ command: 'showInfo', text: 'Code copied to clipboard!' });
        }, (err) => {
            vscode.postMessage({ command: 'showError', text: 'Failed to copy code: ' + err });
        });
    };
    actionsContainer.appendChild(copyButton);

    const insertButton = document.createElement('button');
    insertButton.textContent = 'Insert at Cursor';
    insertButton.onclick = () => {
        vscode.postMessage({ command: 'applyCode', code: codeToUse, strategy: 'insertAtCursor' });
    };
    actionsContainer.appendChild(insertButton);

    const replaceButton = document.createElement('button');
    replaceButton.textContent = 'Replace Selection';
    replaceButton.onclick = () => {
        vscode.postMessage({ command: 'applyCode', code: codeToUse, strategy: 'replaceSelection' });
    };
    actionsContainer.appendChild(replaceButton);

    const newFileButton = document.createElement('button');
    newFileButton.textContent = 'Save as New File...';
    newFileButton.onclick = () => {
        const fileExtension = lang ? '.' + lang.toLowerCase() : '.txt';
        vscode.postMessage({ command: 'createFileWithCode', code: codeToUse, suggestedFileName: `agent-output${fileExtension}` });
    };
    actionsContainer.appendChild(newFileButton);

    messageDiv.appendChild(actionsContainer);
}
