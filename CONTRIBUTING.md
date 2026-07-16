# Contribution Guide 🤝

Thanks for your interest in contributing to **cYHBer Console**! This is an open-source project built for the developer and hacker community. All contributions (bug reports, new tools, UI improvements) are welcome.

## 🛠 Development Environment

The project has a **Zero-Dependency** architecture. You don't need to run `npm install`.

1. Fork the repository.
2. Clone your fork locally: `git clone https://github.com/YOUR_USERNAME/cYHBeriteratus.git`
3. Make sure you have Node.js and Ollama installed.
4. Run the project locally: `node server.js`

## 🧠 Adding New Tools

If you want to teach the autonomous agent to do new things (e.g. read databases, scan ports, etc.), follow these steps:

1. Open the `tools.js` file.
2. Add the OpenAI-compatible definition of your tool to the `toolDefinitions` array.
3. Create the async function that runs the tool, making sure it returns the format: `{ success: boolean, result?: string, error?: string }`.
4. Add your function to the `toolExecutors` object at the end of the file.
5. Open `server.js` and make sure you mention your tool in the `agentSystemPrompt` so the model knows it exists.

> **Important**: We keep a native philosophy. If your tool can be built using Node's built-in modules (`http`, `fs`, `crypto`, `child_process`), don't use external dependencies.

## 🐛 Bug Reports and Pull Requests

- **Issues:** If you find a bug or have an idea, open an *Issue* clearly describing the problem or proposal.
- **Pull Requests (PR):**
  - Create a branch for your feature: `git checkout -b feature/new-tool`.
  - Make sure the code doesn't break the interface streaming.
  - Write a clear commit: `git commit -m "Add port-scanning tool"`.
  - Push and open the PR against the `main` branch.

Let's keep the code fast, lightweight and dangerous! 💀
