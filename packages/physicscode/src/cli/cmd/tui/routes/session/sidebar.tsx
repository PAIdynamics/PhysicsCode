import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { createMemo, createResource, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { InstallationVersion } from "@physicscode-ai/core/installation/version"
import { TuiPluginRuntime } from "@/cli/cmd/tui/plugin/runtime"
import { getScrollAcceleration } from "../../util/scroll"
import { useDialog } from "../../ui/dialog"
import { DialogSessionRename } from "../../component/dialog-session-rename"
import { DialogProvider } from "../../component/dialog-provider"
import { useRoute } from "../../context/route"
import { Account } from "@/account/account"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect, Option } from "effect"
import { Link } from "../../ui/link"
import { Locale } from "@/util/locale"
import type { RGBA } from "@opentui/core"

const PAIDYNAMICS_LOGIN_URL = "https://www.paidynamics.ch/physicscode/login"
const SIDEBAR_WIDTH = 36
const SIDEBAR_COLLAPSED_WIDTH = 6
const PROVIDERS = [
  { id: "paidynamics", name: "PAI Dynamics" },
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
] as const

export function Sidebar(props: { sessionID?: string; expanded: boolean; onToggle: () => void; overlay?: boolean }) {
  const project = useProject()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => (props.sessionID ? sync.session.get(props.sessionID) : undefined))
  const historyClickAt = new Map<string, number>()
  const workspaceStatus = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return "error"
    return project.workspace.status(workspaceID) ?? "error"
  }
  const workspaceLabel = () => {
    const workspaceID = session()?.workspaceID
    if (!workspaceID) return "unknown"
    const info = project.workspace.get(workspaceID)
    if (!info) return "unknown"
    return `${info.type}: ${info.name}`
  }
  const scrollAcceleration = createMemo(() => getScrollAcceleration(tuiConfig))
  const recentSessions = createMemo(() =>
    sync.data.session
      .filter((item) => item.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .slice(0, 5),
  )
  const connectedProviders = createMemo(() => new Set(sync.data.provider_next.connected))
  const [account, { refetch: refetchAccount }] = createResource(async () => {
    return AppRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* Account.Service
        const active = yield* service.active()
        return Option.getOrUndefined(active)
      }),
    ).catch(() => undefined)
  })
  const logout = async () => {
    const active = account()
    if (!active) return
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const service = yield* Account.Service
        yield* service.remove(active.id)
      }),
    ).catch(() => {})
    void refetchAccount()
  }
  const rename = () => {
    const sessionID = props.sessionID
    if (!sessionID) return
    dialog.replace(() => <DialogSessionRename session={sessionID} />)
  }
  const connectProvider = (providerID: string) => {
    dialog.replace(() => <DialogProvider providerID={providerID} />)
  }
  const openRecent = (sessionID: string) => {
    const now = Date.now()
    const previous = historyClickAt.get(sessionID) ?? 0
    historyClickAt.set(sessionID, now)
    if (now - previous < 500) route.navigate({ type: "session", sessionID })
  }

  return (
      <box
        backgroundColor={theme.backgroundPanel}
        width={props.expanded ? SIDEBAR_WIDTH : SIDEBAR_COLLAPSED_WIDTH}
        height="100%"
        paddingTop={0}
        paddingBottom={0}
        paddingLeft={1}
        paddingRight={1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <Show when={!props.expanded}>
          <box alignItems="center" gap={1}>
            <IconButton label="⚙⚙" color={theme.text} onClick={props.onToggle} />
            <IconButton label="++" color={theme.textMuted} onClick={() => route.navigate({ type: "home" })} />
          </box>
        </Show>
        <Show when={props.expanded}>
        <scrollbox
          flexGrow={1}
          scrollAcceleration={scrollAcceleration()}
          verticalScrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.background,
              foregroundColor: theme.borderActive,
            },
          }}
        >
          <box flexShrink={0} gap={0} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between">
              <IconButton label="⚙⚙" color={theme.text} onClick={props.onToggle} />
            </box>
            <Show when={session()}>
              {(current) => (
                <TuiPluginRuntime.Slot
                  name="sidebar_title"
                  mode="single_winner"
                  session_id={props.sessionID ?? ""}
                  title={current().title}
                  share_url={current().share?.url}
                >
                  <box paddingRight={1}>
                    <box flexDirection="row" gap={1}>
                      <text fg={theme.text}>
                        <b>{current().title}</b>
                      </text>
                      <text fg={theme.text} onMouseUp={rename}>
                        ✎
                      </text>
                    </box>
                    <Show when={current().workspaceID}>
                      <text fg={theme.textMuted}>
                        <span style={{ fg: workspaceStatus() === "connected" ? theme.success : theme.error }}>●</span>{" "}
                        {workspaceLabel()}
                      </text>
                    </Show>
                    <Show when={current().share?.url}>
                      <text fg={theme.textMuted}>{current().share!.url}</text>
                    </Show>
                  </box>
                </TuiPluginRuntime.Slot>
              )}
            </Show>
            <box flexDirection="row" gap={2}>
              <SidebarAction label="+ New" onClick={() => route.navigate({ type: "home" })} />
            </box>
            <box gap={0} paddingTop={1}>
              <text fg={theme.text}>
                <b>History</b>
              </text>
              <For each={recentSessions()}>
                {(item) => (
                  <box flexDirection="row" gap={1} onMouseUp={() => openRecent(item.id)}>
                    <text fg={item.id === props.sessionID ? theme.primary : theme.textMuted} flexShrink={0}>
                      {item.id === props.sessionID ? "●" : "•"}
                    </text>
                    <text fg={item.id === props.sessionID ? theme.text : theme.textMuted}>
                      {Locale.truncate(item.title, 27)}
                    </text>
                  </box>
                )}
              </For>
            </box>
            <box gap={0} paddingTop={1}>
              <text fg={theme.text}>
                <b>Providers</b>
              </text>
              <For each={PROVIDERS}>
                {(provider) => {
                  const connected = () => connectedProviders().has(provider.id)
                  return (
                    <box flexDirection="row" gap={1} onMouseDown={() => connectProvider(provider.id)}>
                      <text fg={connected() ? theme.success : theme.textMuted} flexShrink={0}>
                        {connected() ? "●" : "○"}
                      </text>
                      <text fg={theme.textMuted}>{provider.name}</text>
                    </box>
                  )
                }}
              </For>
            </box>
            <box gap={0} paddingTop={1} paddingBottom={1}>
              <text fg={theme.text}>
                <b>Account</b>
              </text>
              <Show
                when={account()}
                fallback={
                  <box gap={0}>
                    <Link href={PAIDYNAMICS_LOGIN_URL} fg={theme.secondary}>
                      Sign in
                    </Link>
                  </box>
                }
              >
                {(active) => (
                  <box gap={0}>
                    <text fg={theme.textMuted}>{active().email}</text>
                    <text fg={theme.secondary} onMouseUp={() => void logout()}>
                      Log out
                    </text>
                  </box>
                )}
              </Show>
            </box>
            <Show when={props.sessionID}>
              {(sessionID) => <TuiPluginRuntime.Slot name="sidebar_content" session_id={sessionID()} />}
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={0} paddingTop={0}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID ?? ""}>
            <text fg={theme.textMuted}>
              <span style={{ fg: theme.success }}>•</span>{" "}
              <span style={{ fg: theme.text }}>
                <b>PhysicsCode</b>
              </span>{" "}
              <span>{InstallationVersion}</span>
            </text>
          </TuiPluginRuntime.Slot>
        </box>
        </Show>
      </box>
  )
}

function SidebarAction(props: { label: string; onClick: () => void }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.secondary} onMouseDown={props.onClick}>
      {props.label}
    </text>
  )
}

function IconButton(props: { label: string; color: RGBA; onClick: () => void }) {
  return (
    <box width={4} alignItems="center" onMouseDown={props.onClick}>
      <text fg={props.color}>{props.label}</text>
    </box>
  )
}
