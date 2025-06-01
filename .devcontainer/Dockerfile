# Use a Microsoft pre-built dev container image with Node.js and TypeScript
FROM mcr.microsoft.com/vscode/devcontainers/typescript-node:0-18

# Optional: Add additional OS packages or tools needed.
# Example: Install Python, pip, and common build tools.
USER root # Switch to root for installations

RUN apt-get update && export DEBIAN_FRONTEND=noninteractive     && apt-get -y install --no-install-recommends python3 python3-pip git openssh-client     # Clean up
    && apt-get autoremove -y     && apt-get clean -y     && rm -rf /var/lib/apt/lists/*

# Switch back to the non-root user 'node' created by the base image.
# VSCode will run as this user in the container.
USER node

# Optional: Set environment variables if needed
# ENV MY_VARIABLE="my_value"

# [Optional] If your extension needs specific Node.js versions or global packages, install them here.
# Example: RUN su - node -c "npm install -g pnpm"

# The workspace will be mounted at /workspace by devcontainer.json or docker-compose.yml
# So, commands like 'npm install' for the extension will be run there via postCreateCommand.
