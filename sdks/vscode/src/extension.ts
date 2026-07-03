// This method is called when your extension is deactivated
export function deactivate() {}

import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import * as vscode from "vscode"

const TERMINAL_NAME = "physicscode"
const PAI_API_KEY_SECRET = "physicscode.paiDynamicsApiKey"
const PAI_PROVIDER_ID = "paidynamics"
const PAI_MODEL_ID = "gpt-oss-120b-pai"
const PAI_DEFAULT_BASE_URL = "https://www.paidynamics.ch/llm/v1"
const execFileAsync = promisify(execFile)

export function activate(context: vscode.ExtensionContext) {
  const openNewTerminalDisposable = vscode.commands.registerCommand("physicscode.openNewTerminal", async () => {
    await openTerminal()
  })

  const openTerminalDisposable = vscode.commands.registerCommand("physicscode.openTerminal", async () => {
    // An physicscode terminal already exists => focus it
    const existingTerminal = vscode.window.terminals.find((t) => t.name === TERMINAL_NAME)
    if (existingTerminal) {
      existingTerminal.show()
      return
    }

    await openTerminal()
  })

  let addFilepathDisposable = vscode.commands.registerCommand("physicscode.addFilepathToTerminal", async () => {
    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    const terminal = vscode.window.activeTerminal
    if (!terminal) {
      return
    }

    if (terminal.name === TERMINAL_NAME) {
      // @ts-ignore
      const port = terminal.creationOptions.env?.["_EXTENSION_PHYSICSCODE_PORT"]
      port ? await appendPrompt(parseInt(port), fileRef) : terminal.sendText(fileRef, false)
      terminal.show()
    }
  })

  const setPaiApiKeyDisposable = vscode.commands.registerCommand("physicscode.setPaiApiKey", async () => {
    const key = await vscode.window.showInputBox({
      title: "Set PAI Dynamics API Key",
      prompt: "Enter the API key for PAI Dynamics hosted models.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : "API key is required."),
    })
    if (key === undefined) return
    await context.secrets.store(PAI_API_KEY_SECRET, key.trim())
    vscode.window.showInformationMessage("PAI Dynamics API key saved for PhysicsCode.")
  })

  const clearPaiApiKeyDisposable = vscode.commands.registerCommand("physicscode.clearPaiApiKey", async () => {
    await context.secrets.delete(PAI_API_KEY_SECRET)
    vscode.window.showInformationMessage("PAI Dynamics API key removed from VS Code secret storage.")
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    setPaiApiKeyDisposable,
    clearPaiApiKeyDisposable,
  )

  async function openTerminal() {
    // Create a new terminal in split screen
    const port = Math.floor(Math.random() * (65535 - 16384 + 1)) + 16384
    const cliPath = await resolveCliPath()
    if (!cliPath) {
      const action = await vscode.window.showErrorMessage(
        "PhysicsCode CLI was not found. Install it as 'physicscode' or set physicscode.cliPath.",
        "Set CLI Path",
        "Open Install Page",
      )
      if (action === "Set CLI Path") {
        await vscode.commands.executeCommand("workbench.action.openSettings", "physicscode.cliPath")
      } else if (action === "Open Install Page") {
        await vscode.env.openExternal(vscode.Uri.parse("https://www.paidynamics.ch/physicscode"))
      }
      return
    }

    const terminal = vscode.window.createTerminal({
      name: TERMINAL_NAME,
      iconPath: {
        light: vscode.Uri.file(context.asAbsolutePath("images/button-dark.svg")),
        dark: vscode.Uri.file(context.asAbsolutePath("images/button-light.svg")),
      },
      location: {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: false,
      },
      env: {
        _EXTENSION_PHYSICSCODE_PORT: port.toString(),
        PHYSICSCODE_CALLER: "vscode",
        ...(await paiHostedEnvironment()),
      },
    })

    terminal.show()
    terminal.sendText(`${quoteShell(cliPath)} --port ${port}`)

    const fileRef = getActiveFile()
    if (!fileRef) {
      return
    }

    // Wait for the terminal to be ready
    let tries = 10
    let connected = false
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      try {
        await fetch(`http://localhost:${port}/app`)
        connected = true
        break
      } catch {}

      tries--
    } while (tries > 0)

    // If connected, append the prompt to the terminal
    if (connected) {
      await appendPrompt(port, `In ${fileRef}`)
      terminal.show()
    }
  }

  async function appendPrompt(port: number, text: string) {
    await fetch(`http://localhost:${port}/tui/append-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    })
  }

  function getActiveFile() {
    const activeEditor = vscode.window.activeTextEditor
    if (!activeEditor) {
      return
    }

    const document = activeEditor.document
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    if (!workspaceFolder) {
      return
    }

    // Get the relative path from workspace root
    const relativePath = vscode.workspace.asRelativePath(document.uri)
    let filepathWithAt = `@${relativePath}`

    // Check if there's a selection and add line numbers
    const selection = activeEditor.selection
    if (!selection.isEmpty) {
      // Convert to 1-based line numbers
      const startLine = selection.start.line + 1
      const endLine = selection.end.line + 1

      if (startLine === endLine) {
        // Single line selection
        filepathWithAt += `#L${startLine}`
      } else {
        // Multi-line selection
        filepathWithAt += `#L${startLine}-${endLine}`
      }
    }

    return filepathWithAt
  }

  async function resolveCliPath() {
    const configured = vscode.workspace.getConfiguration("physicscode").get<string>("cliPath")?.trim()
    if (configured) {
      return configured
    }

    for (const candidate of candidateCliPaths()) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }

    return (await executableOnPath("physicscode")) ? "physicscode" : undefined
  }

  function candidateCliPaths() {
    const home = os.homedir()
    const executable = process.platform === "win32" ? "physicscode.exe" : "physicscode"
    return [
      path.join(home, ".local", "bin", executable),
      path.join(home, "bin", executable),
      "/usr/local/bin/physicscode",
      "/opt/homebrew/bin/physicscode",
    ]
  }

  async function executableOnPath(name: string) {
    try {
      const command = process.platform === "win32" ? "where" : "which"
      await execFileAsync(command, [name])
      return true
    } catch {
      return false
    }
  }

  async function paiHostedEnvironment() {
    const baseURL =
      vscode.workspace.getConfiguration("physicscode").get<string>("paiBaseUrl")?.trim() || PAI_DEFAULT_BASE_URL
    const apiKey = (await context.secrets.get(PAI_API_KEY_SECRET))?.trim()
    const config = {
      enabled_providers: [PAI_PROVIDER_ID],
      model: `${PAI_PROVIDER_ID}/${PAI_MODEL_ID}`,
      small_model: `${PAI_PROVIDER_ID}/${PAI_MODEL_ID}`,
    }

    return {
      PAIDYNAMICS_BASE_URL: baseURL,
      ...(apiKey ? { PAIDYNAMICS_API_KEY: apiKey } : {}),
      PHYSICSCODE_CONFIG_CONTENT: JSON.stringify(config),
    }
  }

  function quoteShell(value: string) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value
    }

    return `'${value.replaceAll("'", "'\\''")}'`
  }
}
