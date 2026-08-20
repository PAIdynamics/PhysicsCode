import { Button } from "@physicscode-ai/ui/button"
import { useDialog } from "@physicscode-ai/ui/context/dialog"
import { Dialog } from "@physicscode-ai/ui/dialog"
import { IconButton } from "@physicscode-ai/ui/icon-button"
import { ProviderIcon } from "@physicscode-ai/ui/provider-icon"
import { TextField } from "@physicscode-ai/ui/text-field"
import { showToast } from "@physicscode-ai/ui/toast"
import { useQueryClient } from "@tanstack/solid-query"
import { createSignal, Show } from "solid-js"
import { useParams } from "@solidjs/router"
import { useGlobalSDK } from "@/context/global-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { decode64 } from "@/utils/base64"
import { directoryKey } from "@/context/global-sync/utils"
import { DialogSelectProvider } from "./dialog-select-provider"

const PAIDYNAMICS_LOGIN_SERVER = "https://www.physicscode.ai"

type View = "start" | "device-code" | "api-key"
type Status = "idle" | "pending" | "error"

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error) return error
  if (typeof error === "object" && error !== null) {
    // httpapi failures (ConsoleActionError, see groups/experimental.ts)
    // decode to a plain object shaped `{ error: "message" }`.
    const tagged = (error as { error?: unknown }).error
    if (typeof tagged === "string" && tagged) return tagged
    // Legacy backend failures decode to NamedError's wire shape,
    // `{ name, data: { message } }` (see server/middleware.ts).
    const data = (error as { data?: unknown }).data
    const named = data && typeof data === "object" ? (data as { message?: unknown }).message : undefined
    if (typeof named === "string" && named) return named
  }
  return fallback
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function DialogPaidynamicsLogin(props: { back?: "providers" | "close" }) {
  const dialog = useDialog()
  const globalSDK = useGlobalSDK()
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const params = useParams<{ dir?: string }>()

  const [view, setView] = createSignal<View>("start")
  const [status, setStatus] = createSignal<Status>("idle")
  const [message, setMessage] = createSignal("")
  const [deviceUrl, setDeviceUrl] = createSignal("")
  const [userCode, setUserCode] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")

  let cancelled = false

  const goBack = () => {
    cancelled = true
    if (props.back === "close" || !props.back) {
      dialog.close()
      return
    }
    dialog.show(() => <DialogSelectProvider />)
  }

  const onLoggedIn = async (email: string) => {
    setMessage(`Logged in as ${email}. Refreshing...`)
    // The global "bootstrap" refetch below only covers the directory-less provider
    // query. When this dialog is opened from an active project (e.g. the inline
    // login prompt in chat), that project's own provider query is a SEPARATE cache
    // entry that never gets touched by it -- refresh it too, or the model/provider
    // selector keeps showing stale "not connected" state until a manual reload.
    const directory = decode64(params.dir)
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ["bootstrap"] }),
      directory ? queryClient.refetchQueries({ queryKey: [directoryKey(directory), "providers"] }) : Promise.resolve(),
    ])
    showToast({
      variant: "success",
      icon: "circle-check",
      title: "Logged in to PhysicsCode",
      description: `Logged in as ${email}`,
    })
    dialog.close()
  }

  const startDeviceLogin = async () => {
    cancelled = false
    setView("device-code")
    setStatus("pending")
    setMessage("Starting login...")
    setDeviceUrl("")
    setUserCode("")

    try {
      const { data: login, error } = await globalSDK.client.experimental.console.login({
        url: PAIDYNAMICS_LOGIN_SERVER,
      })
      if (!login || error) throw new Error(errorMessage(error, "Failed to start login"))
      if (cancelled) return

      setDeviceUrl(login.url)
      setUserCode(login.user)
      setMessage("Approve the page that opened in your browser, then return here.")
      platform.openLink(login.url)

      let wait = login.intervalMs
      const expiresAt = Date.now() + login.expiryMs
      while (Date.now() < expiresAt) {
        if (cancelled) return
        await sleep(wait)
        if (cancelled) return

        const { data: result, error: pollError } = await globalSDK.client.experimental.console.loginPoll(login)
        if (!result || pollError) throw new Error(errorMessage(pollError, "Login failed"))

        if (result.status === "pending") continue
        if (result.status === "slow") {
          wait += 5000
          continue
        }
        if (result.status === "success") {
          await onLoggedIn(result.email)
          return
        }
        if (result.status === "denied") {
          setStatus("error")
          setMessage("Authorization was denied.")
          return
        }
        if (result.status === "expired") {
          setStatus("error")
          setMessage("Login code expired. Start again.")
          return
        }
        setStatus("error")
        setMessage(result.status === "error" ? result.message : "Login failed. Start again.")
        return
      }
      setStatus("error")
      setMessage("Login code expired. Start again.")
    } catch (e) {
      if (cancelled) return
      setStatus("error")
      setMessage(errorMessage(e, "Login failed"))
    }
  }

  const submitApiKey = async (e: SubmitEvent) => {
    e.preventDefault()
    if (status() === "pending") return
    const value = apiKey().trim()
    if (!value) return

    setStatus("pending")
    setMessage("Verifying API key...")

    try {
      const { data: account, error } = await globalSDK.client.experimental.console.loginApiKey({
        url: PAIDYNAMICS_LOGIN_SERVER,
        apiKey: value,
      })
      if (!account || error) throw new Error(errorMessage(error, "That API key didn't work"))
      await onLoggedIn(account.email)
    } catch (e) {
      setStatus("error")
      setMessage(errorMessage(e, "That API key didn't work"))
    }
  }

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div class="flex flex-col gap-6 px-2.5 pb-6">
        <div class="px-2.5 flex gap-4 items-center">
          <ProviderIcon id="paidynamics" class="size-5 shrink-0 icon-strong-base" />
          <div class="text-16-medium text-text-strong">Log in to PhysicsCode</div>
        </div>

        <div class="px-2.5 flex flex-col gap-4">
          <p class="text-14-regular text-text-base">
            PAI-hosted models and the science agent need a PhysicsCode account. Log in with your browser, or paste a
            personal API key from your account page.
          </p>

          <Show when={view() === "start"}>
            <div class="flex gap-3">
              <Button type="button" size="large" variant="primary" onClick={() => void startDeviceLogin()}>
                Continue with browser
              </Button>
              <Button type="button" size="large" variant="secondary" onClick={() => setView("api-key")}>
                Paste API key
              </Button>
            </div>
          </Show>

          <Show when={view() === "device-code"}>
            <div class="flex flex-col gap-3">
              <p class="text-14-regular text-text-base">{message()}</p>
              <Show when={userCode()}>
                <div class="flex flex-col gap-1">
                  <span class="text-12-regular text-text-weak">Code</span>
                  <span class="text-16-medium text-text-strong">{userCode()}</span>
                </div>
              </Show>
              <Show when={deviceUrl()}>
                <Button type="button" size="small" variant="ghost" onClick={() => platform.openLink(deviceUrl())}>
                  Reopen browser page
                </Button>
              </Show>
              <Show when={status() === "error"}>
                <Button type="button" size="large" variant="secondary" onClick={() => void startDeviceLogin()}>
                  Try again
                </Button>
              </Show>
            </div>
          </Show>

          <Show when={view() === "api-key"}>
            <form onSubmit={submitApiKey} class="flex flex-col gap-4">
              <TextField
                autofocus
                label="API key"
                placeholder="pc_key_..."
                description="Generate a key from your PhysicsCode account page, then paste it here."
                value={apiKey()}
                onChange={setApiKey}
                validationState={status() === "error" ? "invalid" : undefined}
                error={status() === "error" ? message() : undefined}
              />
              <Button
                class="w-auto self-start"
                type="submit"
                size="large"
                variant="primary"
                disabled={status() === "pending" || !apiKey().trim()}
              >
                {status() === "pending" ? "Verifying..." : "Log in"}
              </Button>
            </form>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
