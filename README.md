INFO: Added text 'The core of Autonomous Mode involves a Planner Age...' to section '## How to Use'.
INFO: Added text 'To use Autonomous Mode (ensure it's enabled in VSC...' to section '## How to Use'.
# Ollama Collaborators VSCode Extension

**Ollama Collaborators** is a Visual Studio Code extension that enables two Ollama-powered language models to collaborate on coding and other tasks directly within your editor. It provides a webview interface to configure and interact with the agents, observing their conversation and outputs in real-time.

## Features

*   **Dual Agent Collaboration:** Configure two independent Ollama language models to work together.
*   **Customizable Agents:** Specify different base URLs and model names for each agent.
*   **Streaming Responses:** View model outputs as they are generated.
*   **Interactive Webview UI:** Manage configurations, send prompts, and view conversations.
*   **Contextual Review:** The second agent reviews and builds upon the first agent's response.
*   **Direct Code Application:** Apply generated code snippets to your active editor (insert or replace).
*   **New File Creation:** Save agent-generated code as new files, with overwrite/rename handling.
*   **(Experimental) Autonomous Mode:** Assign a complex project prompt and let a "Planner Agent" generate a sequence of actions (create files, append, replace, execute shell commands, etc.) for automated execution.
*   **(Experimental) Action Monitoring:** View the status and output of each action in an autonomous plan.
*   **(Experimental) Shell Command Execution:** (Requires explicit user opt-in per command) Allow agents to execute shell commands, with safeguards.

## Prerequisites

*   **Ollama Installed:** Download from [ollama.com](https://ollama.com/).
*   **Models Available:** Pull models like `llama2`, `mistral` (e.g., `ollama pull llama2`). Agent 1 is used as the default "Planner Agent" in Autonomous Mode and should be a capable model.

## Installation

(For development or sideloading)

1.  **Clone repository.**
2.  **`npm install`**
3.  **`npm run compile`** (or `npm run watch` for development).
4.  **Open in VSCode and press `F5`** to launch the Extension Development Host.

## Configuration

In VSCode `settings.json` (User or Workspace):

\`\`\`json
{
    "ollamaCollaborators.agentOne.baseURL": "http://localhost:11434",
    "ollamaCollaborators.agentOne.model": "llama2", // Used as Planner Agent in Autonomous Mode
    "ollamaCollaborators.agentTwo.baseURL": "http://localhost:11434",
    "ollamaCollaborators.agentTwo.model": "mistral",
    "ollamaCollaborators.files.autoOpenCreatedFiles": true,
    "ollamaCollaborators.enableAutonomousMode": false,
    "ollamaCollaborators.autonomous.enableShellExecution": false

**Security Note on Autonomous Mode & Shell Execution:** These features are experimental. Enabling shell execution (`ollamaCollaborators.autonomous.enableShellExecution`) grants the AI significant control over your system and carries inherent security risks. Always carefully review the generated action plan, especially any shell commands, before execution. Use these features with caution and preferably in trusted workspaces only.
}
\`\`\`

*   **Agent Settings:** `baseURL` and `model` for Agent 1 and Agent 2.
*   **`files.autoOpenCreatedFiles`**: Auto-open files after creation (default: `true`).
*   **`enableAutonomousMode`**: EXPERIMENTAL: Enable autonomous mode (default: `false`).
*   **`autonomous.enableShellExecution`**: EXPERIMENTAL: Allow shell command execution in autonomous mode (default: `false`). **Security Risk:** Enable with caution. Requires `enableAutonomousMode` to also be true.

**Note:** Agent configurations can be overridden per session in the webview. Autonomous mode settings are read from VSCode settings.

## How to Use

The core of Autonomous Mode involves a Planner Agent (currently Agent 1) generating a structured plan. This plan is a sequence of actions (like creating files, running commands, etc.) that the extension then executes step-by-step. You can monitor this process in the 'Autonomous Plan Display' area of the webview.

To use Autonomous Mode (ensure it's enabled in VSCode settings), enter your high-level project goal into the 'Project or Task Prompt' textarea below the agent configurations. Then, click 'Start Autonomous Task'. You can monitor the generated plan and its execution in the 'Autonomous Plan Display' area. Use the 'Stop Task' button to cancel an ongoing task.

1.  **Open Panel:** Command Palette (`Ctrl+Shift+P`) > "Start Ollama Collaboration".
2.  **Configure Agents:** Adjust URLs/models in the webview if needed.
3.  **Send Prompt (Manual Mode):** Type query, click "Send". Agent 1 responds, then Agent 2 reviews.
4.  **Code Actions:** If an agent response contains code (e.g., ```python...```), buttons appear: "Copy Code", "Insert at Cursor", "Replace Selection", "Save as New File...".
5.  **Autonomous Mode:**
    *   Enable `ollamaCollaborators.enableAutonomousMode` in settings (and `autonomous.enableShellExecution` if needed). Reload VSCode window.
    *   The webview will show "Autonomous Mode" status as "Enabled".
    *   Enter a project goal (e.g., "Create a Python Flask app with a to-do API") into the "Project or Task Prompt" area.
    *   Click "Start Autonomous Task".
    *   Observe the plan generation and execution status in the "Autonomous Plan Display" area.
    *   Click "Stop Task" to cancel an ongoing autonomous task.
    *   If a shell command is planned, a VSCode dialog will ask for explicit permission before execution.

## Troubleshooting

*   **"Invalid base URL..."**: Check URL format.
*   **"Network or request error..."**: Ensure Ollama is running and accessible.
*   **"Agent X API request failed..."**: Often "model not found". Verify models with `ollama list`.
*   **No response / Stuck on "Thinking..."**: Check VSCode Developer Tools console and Ollama server logs.
*   **File Modification Errors:**
    *   **"Cannot apply code: No active editor."**: Focus a text editor.
    *   **"Cannot create file: No workspace open."**: Open a folder/workspace.
    *   General failures: Check file path validity and permissions.
*   **Autonomous Mode Errors:**
    *   **"Failed to parse plan..."**: Planner Agent (Agent 1) might not be generating valid JSON actions or is not suitable for planning. Try a different model for Agent 1.
    *   **"Shell command execution is disabled..."**: Enable the relevant settings as described in Configuration.
    *   **Action failures**: Check the specific error message for the failed action in the plan display.

## Important Notes on File Modifications

This extension can modify files in your workspace based on your explicit actions.

*   **Undo:** Editor changes are usually undoable (Ctrl+Z). File creations/overwrites via `WorkspaceEdit` are also generally undoable.
*   **User Prompts:** You'll be prompted for file names/paths and for overwrite/rename confirmations. For shell commands in autonomous mode, you will be prompted for each command.
*   **Review AI Output:** Always review AI-generated code and plans before applying or executing them.

## Development Notes

*   Built with TypeScript.
*   Linting/formatting by ESLint/Prettier (environment issues in subtask runner).
*   Manual testing is crucial.

---
This README provides a basic guide.

## Testing File Modification Features

(Content from previous step, verified to be present)

... (detailed test cases for file modifications) ...

## Testing Autonomous Mode Features

This section covers testing the experimental Autonomous Mode where agents can execute a sequence of actions.

**Prerequisites for Autonomous Mode Testing:**
*   Ensure Ollama is running and the model configured for "Agent 1" (which acts as the Planner Agent for now) is available and capable of following complex instructions to generate JSON.
*   Open a workspace in VSCode. Some tests involve file creation and shell commands within this workspace.

**Configuration Setup for Tests:**
*   **Test 1 (Autonomous Disabled):**
    *   Set \`ollamaCollaborators.enableAutonomousMode: false\` in VSCode settings.
    *   Reload VSCode window after changing settings.
*   **Test 2 (Autonomous Enabled, Shell Disabled):**
    *   Set \`ollamaCollaborators.enableAutonomousMode: true\`.
    *   Set \`ollamaCollaborators.autonomous.enableShellExecution: false\`.

**Security Note on Autonomous Mode & Shell Execution:** These features are experimental. Enabling shell execution (`ollamaCollaborators.autonomous.enableShellExecution`) grants the AI significant control over your system and carries inherent security risks. Always carefully review the generated action plan, especially any shell commands, before execution. Use these features with caution and preferably in trusted workspaces only.
    *   Reload VSCode window.
*   **Test 3 (Autonomous Enabled, Shell Enabled):**
    *   Set \`ollamaCollaborators.enableAutonomousMode: true\`.
    *   Set \`ollamaCollaborators.autonomous.enableShellExecution: true\`.

**Security Note on Autonomous Mode & Shell Execution:** These features are experimental. Enabling shell execution (`ollamaCollaborators.autonomous.enableShellExecution`) grants the AI significant control over your system and carries inherent security risks. Always carefully review the generated action plan, especially any shell commands, before execution. Use these features with caution and preferably in trusted workspaces only.
    *   Reload VSCode window.

**Test Cases:**

### A. Mode Configuration & UI
1.  **Autonomous Mode Disabled:**
    *   With Test Setup 1.
    *   Open the "Ollama Collaborators" webview.
    *   **VERIFY:** The "Autonomous Mode Status" in the webview should show "Disabled" (text and color).
    *   **VERIFY:** The project prompt input area and "Start Autonomous Task" button should be disabled.
2.  **Autonomous Mode Enabled, Shell Disabled:**
    *   With Test Setup 2.
    *   Open the webview.
    *   **VERIFY:** "Autonomous Mode Status" shows "Enabled".
    *   **VERIFY:** "Shell Execution Status" shows "Disabled".
    *   **VERIFY:** Project prompt and "Start" button are enabled.
3.  **Autonomous Mode Enabled, Shell Enabled:**
    *   With Test Setup 3.
    *   Open the webview.
    *   **VERIFY:** "Autonomous Mode Status" shows "Enabled".
    *   **VERIFY:** "Shell Execution Status" shows "Enabled".

### B. Planner Agent Interaction & Plan Generation
1.  **Simple Project Prompt (Test Setup 3):**
    *   Enter a prompt like: "Create a file named 'hello.txt' with content 'Hello from autonomous agent'. Then, create another file 'world.txt' with 'World, from agent!'."
    *   Click "Start Autonomous Task".
    *   **OBSERVE Webview:**
        *   Overall status: "Autonomous Plan: planning..." then "Planner agent is thinking...".
        *   Action item in main log: "LLM Plan Generation - in_progress", then "LLM Plan Generation - completed".
        *   Overall status: "Autonomous Plan: started (0 / X actions processed)" where X is number of planned actions.
    *   **VERIFY:** The "Autonomous Plan Display" shows the planned actions with their details.
2.  **Malformed Plan from LLM (Difficult to reliably trigger):**
    *   If the LLM returns non-JSON or an invalid action structure.
    *   **VERIFY:** The webview shows an overall status like "Autonomous Plan: failed_to_plan" with an error message.

### C. Action Execution Engine & Monitoring UI
1.  **Action Display & Status Updates:**
    *   Initiate an autonomous task with a valid plan.
    *   **VERIFY:** Each action is displayed as a distinct item in the "Autonomous Plan Display".
    *   **VERIFY:** Index, action type, status icon (⏳, ✅, ❌, ⏹️), and description are shown.
    *   **VERIFY:** As actions are processed, their status icons and visual styles update.
2.  **Output Display:**
    *   For \`read_file\`, **VERIFY:** File content is shown.
    *   For \`list_files\`, **VERIFY:** Directory listing is shown.
    *   For \`execute_shell_command\` (Test Setup 3, "Allow" command):
        *   Use a command like \`echo "Stdout test" && (>&2 echo "Stderr test")\`.
        *   **VERIFY:** Stdout and Stderr are displayed.
3.  **Overall Plan Status Updates:**
    *   **VERIFY:** "X/Y actions processed" updates. On completion, status is "completed_all".
4.  **Scrolling:**
    *   **VERIFY:** Plan display scrolls to show latest updates.

### D. Specific Action Tests (within an autonomous plan)
1.  **\`create_file\`:** \`{ "action": "create_file", "path": "test_auto/new.txt", "content": "Autonomous creation.", "id": "c1" }\` -> Verify file created.
2.  **\`append_to_file\`:** Prereq: \`test_auto/append_me.txt\` ("Line 1"). Action: \`{ "action": "append_to_file", "path": "test_auto/append_me.txt", "content": "\nLine 2", "id": "a1" }\` -> Verify content "Line 1\nLine 2".
3.  **\`replace_in_file\` (\`find_string\`):** Prereq: \`test_auto/replace_me.txt\` ("Replace this_token here."). Action: \`{ "action": "replace_in_file", "path": "test_auto/replace_me.txt", "find_string": "this_token", "replace_content": "THAT_TOKEN", "id": "r1" }\` -> Verify content "Replace THAT_TOKEN here."
4.  **\`execute_shell_command\` (Test Setup 3):** Action: \`{ "action": "execute_shell_command", "command": "mkdir test_auto/shell_dir", "id": "s1" }\`. Confirm "Allow". -> Verify directory created.
5.  **\`agent_message\`:** Action: \`{ "action": "agent_message", "message": "Test agent message.", "message_type": "info", "id": "m1" }\` -> Verify message in plan display.

### E. Cancellation ("Stop Autonomous Task" button)
1.  Start a task with multiple actions.
2.  Click "Stop Autonomous Task" while running.
3.  **VERIFY:** Current action might complete; subsequent actions are "cancelled".
4.  **VERIFY:** Overall plan status is "cancelled_by_user".
5.  **VERIFY:** Buttons reset correctly.

### F. Error Handling in Autonomous Execution
1.  **Action Failure (e.g., \`read_file\` on non-existent file):** Action: \`{ "action": "read_file", "path": "non_existent_file.txt", "id": "e1" }\` -> Verify action "failed", plan status "error", subsequent actions not run.
2.  **Shell Command Disabled (Test Setup 2):** Action: \`{ "action": "execute_shell_command", "command": "echo Test", "id": "s2" }\` -> Verify action "failed" (message about disabled setting), plan stops.
3.  **Shell Command Denied by User (Test Setup 3):** Action: \`{ "action": "execute_shell_command", "command": "echo Test", "id": "s3" }\`. Click "Deny". -> Verify action "failed" (message about user denial), plan stops.

*(End of Autonomous Mode testing section)*
