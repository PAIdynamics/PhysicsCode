import { useProject } from "@tui/context/project"
import { useSync } from "@tui/context/sync"
import { createMemo, createResource, For, Show } from "solid-js"
import { useTheme } from "../../context/theme"
import { useTuiConfig } from "../../context/tui-config"
import { InstallationChannel, InstallationVersion } from "@physicscode-ai/core/installation/version"
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

const PAIDYNAMICS_LOGIN_URL = "https://www.paidynamics.ch/physicscode/login"

export function Sidebar(props: { sessionID: string; expanded: boolean; onToggle: () => void; overlay?: boolean }) {
  const project = useProject()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const { theme } = useTheme()
  const tuiConfig = useTuiConfig()
  const session = createMemo(() => sync.session.get(props.sessionID))
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
    dialog.replace(() => <DialogSessionRename session={props.sessionID} />)
  }
  const openRecent = (sessionID: string) => {
    const now = Date.now()
    const previous = historyClickAt.get(sessionID) ?? 0
    historyClickAt.set(sessionID, now)
    if (now - previous < 500) route.navigate({ type: "session", sessionID })
  }

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={props.expanded ? 42 : 5}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={props.expanded ? 2 : 1}
        paddingRight={props.expanded ? 2 : 1}
        position={props.overlay ? "absolute" : "relative"}
      >
        <Show when={!props.expanded}>
          <box alignItems="center" gap={1}>
            <text fg={theme.primary} onMouseUp={props.onToggle}>
              ⚙
            </text>
            <text fg={theme.textMuted} onMouseUp={() => route.navigate({ type: "home" })}>
              +
            </text>
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
          <box flexShrink={0} gap={1} paddingRight={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.primary} onMouseUp={props.onToggle}>
                ⚙
              </text>
              <text fg={theme.textMuted} onMouseUp={() => route.navigate({ type: "home" })}>
                +
              </text>
            </box>
            <TuiPluginRuntime.Slot
              name="sidebar_title"
              mode="single_winner"
              session_id={props.sessionID}
              title={session()!.title}
              share_url={session()!.share?.url}
            >
              <box paddingRight={1}>
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text}>
                    <b>{session()!.title}</b>
                  </text>
                  <text fg={theme.primary} onMouseUp={rename}>
                    ✎
                  </text>
                </box>
                <Show when={InstallationChannel !== "latest"}>
                  <text fg={theme.textMuted}>{props.sessionID}</text>
                </Show>
                <Show when={session()!.workspaceID}>
                  <text fg={theme.textMuted}>
                    <span style={{ fg: workspaceStatus() === "connected" ? theme.success : theme.error }}>●</span>{" "}
                    {workspaceLabel()}
                  </text>
                </Show>
                <Show when={session()!.share?.url}>
                  <text fg={theme.textMuted}>{session()!.share!.url}</text>
                </Show>
              </box>
            </TuiPluginRuntime.Slot>
            <box gap={1} paddingTop={1} paddingBottom={1}>
              <SidebarAction label="+ New conversation" onClick={() => route.navigate({ type: "home" })} />
              <SidebarAction label="Connect providers" onClick={() => dialog.replace(() => <DialogProvider />)} />
            </box>
            <box gap={1} paddingTop={1} paddingBottom={1}>
              <text fg={theme.text}>
                <b>History</b>
              </text>
              <For each={recentSessions()}>
                {(item) => (
                  <box flexDirection="row" gap={1} onMouseUp={() => openRecent(item.id)}>
                    <text fg={item.id === props.sessionID ? theme.primary : theme.textMuted} flexShrink={0}>
                      {item.id === props.sessionID ? "●" : "•"}
                    </text>
                    <box>
                      <text fg={item.id === props.sessionID ? theme.text : theme.textMuted}>
                        {Locale.truncate(item.title, 31)}
                      </text>
                      <text fg={theme.textMuted}>{Locale.time(item.time.updated)}</text>
                    </box>
                  </box>
                )}
              </For>
            </box>
            <box gap={1} paddingTop={1} paddingBottom={1}>
              <text fg={theme.text}>
                <b>Account</b>
              </text>
              <Show
                when={account()}
                fallback={
                  <box gap={1}>
                    <Link href={PAIDYNAMICS_LOGIN_URL} fg={theme.primary}>
                      Sign in
                    </Link>
                    <text fg={theme.textMuted}>Create or manage your PhysicsCode account.</text>
                  </box>
                }
              >
                {(active) => (
                  <box gap={1}>
                    <text fg={theme.textMuted}>{active().email}</text>
                    <text fg={theme.primary} onMouseUp={() => void logout()}>
                      Log out
                    </text>
                  </box>
                )}
              </Show>
            </box>
            <TuiPluginRuntime.Slot name="sidebar_content" session_id={props.sessionID} />
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <TuiPluginRuntime.Slot name="sidebar_footer" mode="single_winner" session_id={props.sessionID}>
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
    </Show>
  )
}

function SidebarAction(props: { label: string; onClick: () => void }) {
  const { theme } = useTheme()
  return (
    <text fg={theme.primary} onMouseUp={props.onClick}>
      {props.label}
    </text>
  )
}
