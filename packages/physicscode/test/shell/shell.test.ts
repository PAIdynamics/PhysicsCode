import { describe, expect, test } from "bun:test"
import path from "path"
import { Shell } from "../../src/shell/shell"
import { Filesystem } from "@/util/filesystem"
import { which } from "../../src/util/which"

const withShell = async (shell: string | undefined, fn: () => void | Promise<void>) => {
  const prev = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  Shell.acceptable.reset()
  Shell.preferred.reset()
  try {
    await fn()
  } finally {
    if (prev === undefined) delete process.env.SHELL
    else process.env.SHELL = prev
    Shell.acceptable.reset()
    Shell.preferred.reset()
  }
}

describe("shell", () => {
  test("normalizes shell names", () => {
    expect(Shell.name("/bin/bash")).toBe("bash")
    if (process.platform === "win32") {
      expect(Shell.name("C:/tools/NU.EXE")).toBe("nu")
      expect(Shell.name("C:/tools/PWSH.EXE")).toBe("pwsh")
    }
  })

  test("detects login shells", () => {
    expect(Shell.login("/bin/bash")).toBe(true)
    expect(Shell.login("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects posix shells", () => {
    expect(Shell.posix("/bin/bash")).toBe(true)
    expect(Shell.posix("/bin/fish")).toBe(false)
    expect(Shell.posix("C:/tools/pwsh.exe")).toBe(false)
  })

  test("detects PowerShell shells via ps()", () => {
    expect(Shell.ps("/usr/local/bin/pwsh")).toBe(true)
    expect(Shell.ps("/usr/local/bin/powershell")).toBe(true)
    if (process.platform === "win32") {
      expect(Shell.ps("C:/tools/powershell.exe")).toBe(true)
    }
    expect(Shell.ps("/bin/bash")).toBe(false)
  })

  describe("args()", () => {
    test("passes the command through as-is for nu and fish", () => {
      expect(Shell.args("/usr/bin/nu", "echo hi", "/work")).toEqual(["-c", "echo hi"])
      expect(Shell.args("/usr/bin/fish", "echo hi", "/work")).toEqual(["-c", "echo hi"])
    })

    test("builds a login zsh invocation that sources rc files and cds into the workdir", () => {
      const result = Shell.args("/bin/zsh", "echo hi", "/work/dir")
      expect(result[0]).toBe("-l")
      expect(result[1]).toBe("-c")
      expect(result[2]).toContain(".zshrc")
      expect(result[2]).toContain(JSON.stringify("echo hi"))
      expect(result[3]).toBe("physicscode")
      expect(result[4]).toBe("/work/dir")
    })

    test("builds a login bash invocation that sources .bashrc and cds into the workdir", () => {
      const result = Shell.args("/bin/bash", "echo hi", "/work/dir")
      expect(result[0]).toBe("-l")
      expect(result[1]).toBe("-c")
      expect(result[2]).toContain(".bashrc")
      expect(result[2]).toContain("shopt -s expand_aliases")
      expect(result[2]).toContain(JSON.stringify("echo hi"))
      expect(result[3]).toBe("physicscode")
      expect(result[4]).toBe("/work/dir")
    })

    test("uses /c for cmd", () => {
      // name() only strips the .exe extension via path.win32.parse on real
      // Windows - on other platforms the basename (incl. extension) is used
      // as-is, so only an extensionless name matches the "cmd" check there.
      expect(Shell.args("cmd", "dir", "/work")).toEqual(["/c", "dir"])
      if (process.platform === "win32") {
        expect(Shell.args("cmd.exe", "dir", "/work")).toEqual(["/c", "dir"])
        expect(Shell.args("C:/Windows/System32/cmd.exe", "dir", "/work")).toEqual(["/c", "dir"])
      }
    })

    test("uses -NoProfile -Command for PowerShell variants", () => {
      expect(Shell.args("pwsh", "Get-Item .", "/work")).toEqual(["-NoProfile", "-Command", "Get-Item ."])
      expect(Shell.args("powershell", "Get-Item .", "/work")).toEqual(["-NoProfile", "-Command", "Get-Item ."])
      if (process.platform === "win32") {
        expect(Shell.args("powershell.exe", "Get-Item .", "/work")).toEqual(["-NoProfile", "-Command", "Get-Item ."])
      }
    })

    test("falls back to a plain -c invocation for unrecognized shells", () => {
      expect(Shell.args("/bin/dash", "echo hi", "/work")).toEqual(["-c", "echo hi"])
    })

    test("safely embeds a command containing quotes and special characters", () => {
      const command = `echo "hello 'world'" && $(rm -rf /)`
      const result = Shell.args("/bin/bash", command, "/work")
      expect(result[2]).toContain(JSON.stringify(command))
    })
  })

  test("falls back when configured shell cannot be resolved", async () => {
    await withShell(undefined, async () => {
      const preferred = Shell.preferred()
      const acceptable = Shell.acceptable()
      expect(Shell.preferred("physicscode-missing-shell")).toBe(preferred)
      expect(Shell.acceptable("physicscode-missing-shell")).toBe(acceptable)
    })
  })

  test("falls back for terminal-only acceptable shells", () => {
    expect(Shell.name(Shell.acceptable("fish"))).not.toBe("fish")
    expect(Shell.name(Shell.acceptable("nu"))).not.toBe("nu")
  })

  if (process.platform === "win32") {
    test("rejects blacklisted shells case-insensitively", async () => {
      await withShell("NU.EXE", async () => {
        expect(Shell.name(Shell.acceptable())).not.toBe("nu")
      })
    })

    test("normalizes Git Bash shell paths from env", async () => {
      const shell = "/cygdrive/c/Program Files/Git/bin/bash.exe"
      await withShell(shell, async () => {
        expect(Shell.preferred()).toBe(Filesystem.windowsPath(shell))
      })
    })

    test("resolves /usr/bin/bash from env to Git Bash", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      await withShell("/usr/bin/bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare bash to Git Bash before PATH", async () => {
      const bash = Shell.gitbash()
      if (!bash) return
      expect(Shell.acceptable("bash")).toBe(bash)
      expect(Shell.preferred("bash")).toBe(bash)
      await withShell("bash", async () => {
        expect(Shell.acceptable()).toBe(bash)
        expect(Shell.preferred()).toBe(bash)
      })
    })

    test("resolves bare PowerShell shells", async () => {
      const shell = which("pwsh") || which("powershell")
      if (!shell) return
      await withShell(path.win32.basename(shell), async () => {
        expect(Shell.preferred()).toBe(shell)
      })
    })
  }
})

const unix = process.platform !== "win32" ? describe : describe.skip

unix("shell.killTree", () => {
  test("terminates a running process and its children", async () => {
    const { spawn } = await import("child_process")
    // Spawn as its own process group leader (detached) so killTree's
    // process.kill(-pid, ...) - which signals the whole group - can reach
    // a spawned grandchild too, not just this direct child.
    const proc = spawn("sh", ["-c", "sleep 30 & wait"], { detached: true, stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", () => resolve())
      proc.once("error", reject)
    })

    let exited = false
    proc.once("exit", () => {
      exited = true
    })

    await Shell.killTree(proc)
    // SIGTERM is sent first; give the process a moment to actually exit
    // before asserting (killTree itself only waits out the SIGKILL escalation
    // window when the process hasn't exited yet).
    for (let i = 0; i < 20 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(exited).toBe(true)
  })

  test("does nothing when the process has no pid", async () => {
    // Should resolve immediately without throwing.
    await Shell.killTree({ pid: undefined } as any)
  })

  test("does nothing when opts.exited() already reports true", async () => {
    const { spawn } = await import("child_process")
    const proc = spawn("sh", ["-c", "sleep 30"], { detached: true, stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", () => resolve())
      proc.once("error", reject)
    })

    try {
      // exited() reporting true short-circuits killTree before it signals
      // anything - the process should still be alive afterward.
      await Shell.killTree(proc, { exited: () => true })
      expect(() => process.kill(proc.pid!, 0)).not.toThrow()
    } finally {
      proc.kill("SIGKILL")
    }
  })

  test("escalates to SIGKILL when the process ignores SIGTERM", async () => {
    const { spawn } = await import("child_process")
    // trap SIGTERM and ignore it, forcing killTree's SIGKILL escalation path
    const proc = spawn("sh", ["-c", "trap '' TERM; sleep 30"], { detached: true, stdio: "ignore" })
    await new Promise<void>((resolve, reject) => {
      proc.once("spawn", () => resolve())
      proc.once("error", reject)
    })

    let exited = false
    proc.once("exit", () => {
      exited = true
    })

    await Shell.killTree(proc)
    for (let i = 0; i < 20 && !exited; i++) {
      await new Promise((r) => setTimeout(r, 50))
    }
    expect(exited).toBe(true)
  }, 10000)
})
