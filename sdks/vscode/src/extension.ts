// This method is called when your extension is deactivated
export function deactivate() {}

import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import * as vscode from "vscode"

const TERMINAL_NAME = "physicscode"
const PAI_DEFAULT_PROVIDER_ID = "paidynamics"
const PAI_DEFAULT_MODEL_ID = "gpt-oss-120b-pai"
const PAI_DEFAULT_API_MODEL_ID = "openai/gpt-oss-120b"
const PAI_DEFAULT_BASE_URL = "https://www.paidynamics.ch/llm/v1"
const PAI_DEFAULT_LOGIN_URL = "https://www.paidynamics.ch"
const PAI_LOCAL_TOOLS_ENV = "PHYSICSCODE_PAI_ENABLE_LOCAL_TOOLS"
const execFileAsync = promisify(execFile)
const PAI_MODEL_ALIASES: Record<string, string> = {
  "deepseek-r1-distil-qwen-32b-pai": "deepseek-r1-distill-qwen-32b-pai",
  "paidynamics/deepseek-r1-distil-qwen-32b-pai": "deepseek-r1-distill-qwen-32b-pai",
}

type PaiModel = {
  apiID: string
  family: string
  reasoning: boolean
  toolCall: boolean
  context: number
  output: number
  reasoningEffort?: string
}

const PAI_MODELS: Record<string, PaiModel> = {
  "gpt-oss-120b-pai": {
    apiID: "openai/gpt-oss-120b",
    family: "gpt-oss",
    reasoning: true,
    toolCall: true,
    context: 131072,
    output: 8192,
    reasoningEffort: "medium",
  },
  "deepseek-r1-distill-qwen-32b-pai": {
    apiID: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    family: "deepseek-r1",
    reasoning: true,
    toolCall: false,
    context: 32768,
    output: 8192,
    reasoningEffort: "medium",
  },
  "gpt-oss-20b-pai": {
    apiID: "openai/gpt-oss-20b",
    family: "gpt-oss",
    reasoning: true,
    toolCall: true,
    context: 131072,
    output: 8192,
    reasoningEffort: "low",
  },
  "qwen3-8b-pai": {
    apiID: "Qwen/Qwen3-8B",
    family: "qwen3",
    reasoning: true,
    toolCall: true,
    context: 32768,
    output: 8192,
    reasoningEffort: "low",
  },
}

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

  const loginDisposable = vscode.commands.registerCommand("physicscode.login", async () => {
    await loginToPhysicsCode()
  })

  const logoutDisposable = vscode.commands.registerCommand("physicscode.logout", async () => {
    await runPhysicsCodeAccountCommand("logout")
  })

  const switchAccountDisposable = vscode.commands.registerCommand("physicscode.switchAccount", async () => {
    await runPhysicsCodeAccountCommand("switch")
  })

  const openAccountDisposable = vscode.commands.registerCommand("physicscode.openAccount", async () => {
    await vscode.env.openExternal(vscode.Uri.parse(`${PAI_DEFAULT_LOGIN_URL}/physicscode/account`))
  })

  context.subscriptions.push(
    openNewTerminalDisposable,
    openTerminalDisposable,
    addFilepathDisposable,
    loginDisposable,
    logoutDisposable,
    switchAccountDisposable,
    openAccountDisposable,
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

    const paiEnv = paiHostedEnvironment()
    if (!paiEnv) {
      return
    }
    const shouldContinue = await ensurePhysicsCodeAccount(cliPath)
    if (!shouldContinue) {
      return
    }

    const cwd = getWorkspaceCwd()
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
      cwd,
      env: {
        _EXTENSION_PHYSICSCODE_PORT: port.toString(),
        PHYSICSCODE_CALLER: "vscode",
        ...paiEnv,
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

  function getWorkspaceCwd() {
    const activeEditor = vscode.window.activeTextEditor
    if (activeEditor) {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeEditor.document.uri)
      if (workspaceFolder) {
        return workspaceFolder.uri.fsPath
      }
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    return workspaceFolder?.uri.fsPath ?? os.homedir()
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
      path.join(home, ".physicscode", "bin", executable),
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

  function paiHostedEnvironment() {
    const baseURL = physicscodeSetting("paiBaseUrl", PAI_DEFAULT_BASE_URL)
    const providerID = physicscodeSetting("paiProviderId", PAI_DEFAULT_PROVIDER_ID)
    const configuredModelID = physicscodeSetting("paiModelId", PAI_DEFAULT_MODEL_ID)
    const modelID = PAI_MODEL_ALIASES[configuredModelID] ?? configuredModelID
    const apiModelID =
      vscode.workspace.getConfiguration("physicscode").get<string>("paiApiModelId")?.trim() || PAI_DEFAULT_API_MODEL_ID
    const enableLocalTools =
      vscode.workspace.getConfiguration("physicscode").get<boolean>("paiEnableLocalTools") !== false
    const models = Object.fromEntries(
      Object.entries(PAI_MODELS).map(([id, model]) => [
        id,
        {
          id: id === PAI_DEFAULT_MODEL_ID ? apiModelID : model.apiID,
          name: id,
          family: model.family,
          reasoning: model.reasoning,
          temperature: true,
          tool_call: enableLocalTools && model.toolCall,
          limit: {
            context: model.context,
            output: model.output,
          },
          modalities: {
            input: ["text"],
            output: ["text"],
          },
          ...(model.reasoningEffort ? { options: { reasoningEffort: model.reasoningEffort } } : {}),
        },
      ]),
    )
    const config = {
      enabled_providers: [providerID],
      model: `${providerID}/${modelID}`,
      small_model: `${providerID}/gpt-oss-20b-pai`,
      default_agent: "build",
      agent: paiAgentConfig(providerID),
      provider: {
        [providerID]: {
          name: "PAI Dynamics Hosted",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          options: {
            baseURL,
          },
          models,
        },
      },
    }

    return {
      PAIDYNAMICS_BASE_URL: baseURL,
      [PAI_LOCAL_TOOLS_ENV]: enableLocalTools ? "true" : "false",
      PHYSICSCODE_CONFIG_CONTENT: JSON.stringify(config),
    }
  }

  async function loginToPhysicsCode(cliPath?: string) {
    const resolved = cliPath ?? (await resolveCliPath())
    if (!resolved) {
      vscode.window.showErrorMessage("PhysicsCode CLI was not found. Install it first, then run PhysicsCode: Log in.")
      return
    }

    const terminal = vscode.window.createTerminal({
      name: "physicscode login",
      cwd: getWorkspaceCwd(),
    })
    terminal.show()
    terminal.sendText(`${quoteShell(resolved)} account login ${quoteShell(PAI_DEFAULT_LOGIN_URL)}`)
  }

  async function ensurePhysicsCodeAccount(cliPath: string) {
    const status = await physicsCodeAccountStatus(cliPath)
    if (status !== "logged-out") {
      return true
    }

    const action = await vscode.window.showWarningMessage(
      "PhysicsCode is not logged in. Log in before starting a hosted model session.",
      "Log in",
      "Continue",
    )
    if (action === "Log in") {
      await loginToPhysicsCode(cliPath)
      return false
    }
    return action === "Continue"
  }

  async function physicsCodeAccountStatus(cliPath: string): Promise<"logged-in" | "logged-out" | "unknown"> {
    try {
      const { stdout } = await execFileAsync(cliPath, ["account", "status", "--json"], { timeout: 8000 })
      let jsonLine: string | undefined
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          jsonLine = trimmed
        }
      }
      if (!jsonLine) {
        return "unknown"
      }
      const parsed = JSON.parse(jsonLine) as { loggedIn?: boolean }
      return parsed.loggedIn ? "logged-in" : "logged-out"
    } catch {
      // Older CLI versions do not have `account status`; let the CLI handle auth prompts.
      return "unknown"
    }
  }

  async function runPhysicsCodeAccountCommand(command: "logout" | "switch", cliPath?: string) {
    const resolved = cliPath ?? (await resolveCliPath())
    if (!resolved) {
      vscode.window.showErrorMessage(`PhysicsCode CLI was not found. Install it first, then run PhysicsCode: ${command}.`)
      return
    }

    const terminal = vscode.window.createTerminal({
      name: `physicscode ${command}`,
      cwd: getWorkspaceCwd(),
    })
    terminal.show()
    terminal.sendText(`${quoteShell(resolved)} account ${command}`)
  }

  function physicscodeSetting(name: string, fallback: string) {
    return vscode.workspace.getConfiguration("physicscode").get<string>(name)?.trim() || fallback
  }

  function paiAgentConfig(providerID: string) {
    return {
      build: {
        model: `${providerID}/gpt-oss-120b-pai`,
        mode: "primary",
        description: "Master coding agent. Delegates narrow tasks to specialized PAI-hosted subagents when useful.",
        prompt:
          "You are the master PhysicsCode coding agent. Use your own judgment for difficult architecture and edits. For hard reasoning, math, numerical debugging, or subtle bug analysis, delegate to the deep-reasoner subagent. For quick summarization, routing, titles, lightweight code review, and inexpensive helper tasks, delegate to small-router. Keep the user-facing answer concise and own the final decision.",
      },
      plan: {
        model: `${providerID}/gpt-oss-120b-pai`,
        mode: "primary",
        description: "Planning agent for larger coding tasks.",
      },
      "deep-reasoner": {
        model: `${providerID}/deepseek-r1-distill-qwen-32b-pai`,
        mode: "subagent",
        description: "Use for hard reasoning, math, algorithm analysis, numerical issues, and debugging second opinions.",
      },
      "small-router": {
        model: `${providerID}/gpt-oss-20b-pai`,
        mode: "subagent",
        description: "Use for quick edits, summaries, routing decisions, titles, and inexpensive helper tasks.",
      },
      summary: {
        model: `${providerID}/gpt-oss-20b-pai`,
      },
      title: {
        model: `${providerID}/gpt-oss-20b-pai`,
      },
      compaction: {
        model: `${providerID}/gpt-oss-20b-pai`,
      },
    }
  }

  function quoteShell(value: string) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
      return value
    }

    return `'${value.replaceAll("'", "'\\''")}'`
  }
}
