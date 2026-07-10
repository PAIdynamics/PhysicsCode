import { useRenderer } from "@opentui/solid"
import { onCleanup } from "solid-js"
import { createSimpleContext } from "./helper"
import { FormatError, FormatUnknownError } from "@/cli/error"
import { win32FlushInputBuffer } from "../win32"
type Exit = ((reason?: unknown) => Promise<void>) & {
  message: {
    set: (value?: string) => () => void
    clear: () => void
    get: () => string | undefined
  }
}

export const { use: useExit, provider: ExitProvider } = createSimpleContext({
  name: "Exit",
  init: (input: { onBeforeExit?: () => Promise<void>; onExit?: () => Promise<void> }) => {
    const renderer = useRenderer()
    let message: string | undefined
    let task: Promise<void> | undefined
    const restoreTerminal = () => {
      try {
        if (process.stdin.isTTY) process.stdin.setRawMode?.(false)
      } catch {}
      try {
        process.stdout.write("\x1b[0m\x1b[?25h")
      } catch {}
      win32FlushInputBuffer()
    }
    const store = {
      set: (value?: string) => {
        const prev = message
        message = value
        return () => {
          message = prev
        }
      },
      clear: () => {
        message = undefined
      },
      get: () => message,
    }
    const exit: Exit = Object.assign(
      (reason?: unknown) => {
        if (task) return task
        task = (async () => {
          try {
            await input.onBeforeExit?.()
            // Reset window title before destroying renderer
            renderer.setTerminalTitle("")
            renderer.destroy()
            restoreTerminal()
            if (reason) {
              const formatted = FormatError(reason) ?? FormatUnknownError(reason)
              if (formatted) {
                process.stderr.write(formatted + "\n")
              }
            }
            const text = store.get()
            if (text) process.stdout.write(text + "\n")
            await input.onExit?.()
          } finally {
            restoreTerminal()
          }
        })()
        return task
      },
      {
        message: store,
      },
    )
    const handleSignal = (signal: NodeJS.Signals) => {
      if (signal === "SIGINT") process.exitCode = 130
      if (signal === "SIGTERM") process.exitCode = 143
      void exit()
    }
    process.on("SIGHUP", handleSignal)
    process.on("SIGINT", handleSignal)
    process.on("SIGTERM", handleSignal)
    onCleanup(() => {
      process.off("SIGHUP", handleSignal)
      process.off("SIGINT", handleSignal)
      process.off("SIGTERM", handleSignal)
    })
    return exit
  },
})
