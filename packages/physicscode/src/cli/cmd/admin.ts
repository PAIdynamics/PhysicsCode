import { cmd } from "./cmd"
import { Effect, Option } from "effect"
import { UI } from "../ui"
import { Account } from "@/account/account"
import { AppRuntime } from "@/effect/app-runtime"

// Server administration for physicscode.ai. Only accounts listed in the
// server's ADMIN_EMAILS get anything back. Listing and status need just the
// logged-in account token; a switch only emails a one-time confirmation link
// to the admin inbox and happens when that link is confirmed, so a leaked
// CLI token alone cannot change the served model. The disk/memory preflight
// runs on the DGX (physicscode-model-preflight), never here.

type Check = { name: string; ok: boolean; detail: string }
type ModelReport = { model: string; ok: boolean; footprint_gib?: number; checks: Check[] }
type SwitchStatus = { state?: string; target?: string; phase?: string; error?: string; log_tail?: string[] }

const println = (msg: string) => Effect.sync(() => UI.println(msg))
const dim = (value: string) => UI.Style.TEXT_DIM + value + UI.Style.TEXT_NORMAL

const adminRequest = Effect.fn("admin.request")(function* (path: string, init: RequestInit = {}) {
  const service = yield* Account.Service
  const active = yield* service.active()
  if (Option.isNone(active)) return yield* Effect.fail(new Error("Not logged in. Run: physicscode console login <url>"))
  const accessToken = yield* service.token(active.value.id)
  if (Option.isNone(accessToken)) return yield* Effect.fail(new Error("No access token for the active account"))
  const response = yield* Effect.tryPromise({
    try: () =>
      fetch(`${active.value.url}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${accessToken.value}`, "Content-Type": "application/json" },
      }),
    catch: (error) => new Error(`Could not reach ${active.value.url}: ${error instanceof Error ? error.message : error}`),
  })
  const body = yield* Effect.promise(() => response.json().catch(() => ({}) as Record<string, unknown>))
  if (response.status === 403) {
    return yield* Effect.fail(new Error(`${active.value.email} is not a physicscode.ai administrator`))
  }
  if (!response.ok && response.status !== 202) {
    const error = (body as { error?: { message?: string } | string }).error
    return yield* Effect.fail(new Error(typeof error === "string" ? error : error?.message || `HTTP ${response.status}`))
  }
  return body as Record<string, unknown>
})

const printStatus = (status: SwitchStatus) =>
  Effect.gen(function* () {
    if (!status.state || status.state === "idle") return yield* println("No model switch has run yet")
    yield* println(`Last switch: ${status.target} — ${status.state} (${status.phase})${status.error ? `: ${status.error}` : ""}`)
    for (const line of status.log_tail ?? []) yield* println(dim("  " + line))
  })

const listEffect = Effect.fn("admin.model.list")(function* () {
  const data = yield* adminRequest("/api/admin/models")
  const current = String(data.default)
  for (const report of (data.models as ModelReport[]) ?? []) {
    const marker = report.model === current ? UI.Style.TEXT_SUCCESS + " (serving)" + UI.Style.TEXT_NORMAL : ""
    const ready = report.ok ? "ready" : UI.Style.TEXT_WARNING + "not ready" + UI.Style.TEXT_NORMAL
    yield* println(`${report.model}${marker}  ${dim(`${report.footprint_gib ?? "?"} GiB`)}  ${ready}`)
    for (const check of report.checks ?? []) {
      if (!check.ok || report.model !== current) yield* println(dim(`    [${check.ok ? "ok" : "FAIL"}] ${check.name}: ${check.detail}`))
    }
  }
  yield* println("")
  yield* printStatus((data.switch as SwitchStatus) ?? {})
})

const statusEffect = Effect.fn("admin.model.status")(function* () {
  yield* printStatus((yield* adminRequest("/api/admin/models/switch")) as SwitchStatus)
})

const switchEffect = Effect.fn("admin.model.switch")(function* (model: string, download: boolean) {
  const data = yield* adminRequest("/api/admin/models/switch", {
    method: "POST",
    body: JSON.stringify({ model, download }),
  })
  yield* println(`Confirmation link sent to ${data.confirmation_sent_to}.`)
  yield* println(
    `Open it within ${Math.round(Number(data.expires_in ?? 600) / 60)} minutes to switch to ${model}. ` +
      "The server re-runs its disk and memory preflight before anything is stopped.",
  )
  yield* println(dim("Follow progress with: physicscode admin model status"))
})

const run = (effect: Effect.Effect<void, unknown, Account.Service>) =>
  AppRuntime.runPromise(effect).catch((error: unknown) => {
    UI.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })

export const AdminModelCommand = cmd({
  command: "model",
  describe: "show or change the model physicscode.ai serves (admins only)",
  builder: (yargs) =>
    yargs
      .command({
        command: "list",
        describe: "list chat models with their disk/memory preflight",
        handler: () => run(listEffect()),
      })
      .command({
        command: "status",
        describe: "show the current or last model switch",
        handler: () => run(statusEffect()),
      })
      .command({
        command: "switch <model>",
        describe: "switch the served model (confirmed by an emailed one-time link)",
        builder: (y) =>
          y
            .positional("model", { describe: "public model id, e.g. paidynamics/qwen3.8-flash-next-pai", type: "string", demandOption: true })
            .option("download", {
              describe: "allow the server to download missing weights/images first (after its disk check)",
              type: "boolean",
              default: false,
            }),
        handler: (args) => run(switchEffect(String(args.model), Boolean(args.download))),
      })
      .demandCommand(),
  async handler() {},
})

export const AdminCommand = cmd({
  command: "admin",
  describe: "physicscode.ai server administration (admins only)",
  builder: (yargs) => yargs.command(AdminModelCommand).demandCommand(),
  async handler() {},
})
