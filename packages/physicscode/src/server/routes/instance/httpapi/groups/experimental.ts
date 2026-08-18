import { AccountID, OrgID } from "@/account/schema"
import { MCP } from "@/mcp"
import { ProviderID, ModelID } from "@/provider/schema"
import { Session } from "@/session/session"
import { Worktree } from "@/worktree"
import { NonNegativeInt } from "@/util/schema"
import { Schema, SchemaGetter } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware } from "../middleware/workspace-routing"
import { described } from "./metadata"

const ConsoleStateResponse = Schema.Struct({
  consoleManagedProviders: Schema.mutable(Schema.Array(Schema.String)),
  activeOrgName: Schema.optionalKey(Schema.String),
  switchableOrgCount: NonNegativeInt,
}).annotate({ identifier: "ConsoleState" })

const ConsoleOrgOption = Schema.Struct({
  accountID: Schema.String,
  accountEmail: Schema.String,
  accountUrl: Schema.String,
  orgID: Schema.String,
  orgName: Schema.String,
  active: Schema.Boolean,
})

const ConsoleOrgList = Schema.Struct({
  orgs: Schema.Array(ConsoleOrgOption),
})

export const ConsoleSwitchPayload = Schema.Struct({
  accountID: AccountID,
  orgID: OrgID,
})

// Account.Login/PollResult carry Effect Duration/Defect fields that don't
// round-trip through JSON well, so - matching the legacy Hono routes in
// ../../experimental.ts - these use hand-rolled wire shapes (ms instead of
// Duration, string instead of Defect) rather than the Effect Schema classes
// directly.
export const ConsoleLoginPayload = Schema.Struct({
  url: Schema.String,
})

const ConsoleLoginStart = Schema.Struct({
  code: Schema.String,
  user: Schema.String,
  url: Schema.String,
  server: Schema.String,
  expiryMs: Schema.Number,
  intervalMs: Schema.Number,
}).annotate({ identifier: "ConsoleLoginStart" })

export const ConsoleLoginPollPayload = ConsoleLoginStart

const ConsoleLoginPollResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal("success"), email: Schema.String }),
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("slow") }),
  Schema.Struct({ status: Schema.Literal("expired") }),
  Schema.Struct({ status: Schema.Literal("denied") }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
]).annotate({ identifier: "ConsoleLoginPollResult" })

export const ConsoleLoginApiKeyPayload = Schema.Struct({
  url: Schema.String,
  apiKey: Schema.String,
})

const ConsoleAccount = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  url: Schema.String,
  activeOrgID: Schema.NullOr(Schema.String),
}).annotate({ identifier: "ConsoleAccount" })

export const ConsoleLogoutPayload = Schema.Struct({
  accountID: AccountID,
})

const ToolIDs = Schema.Array(Schema.String).annotate({ identifier: "ToolIDs" })
const ToolListItem = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  parameters: Schema.Unknown,
}).annotate({ identifier: "ToolListItem" })
const ToolList = Schema.Array(ToolListItem).annotate({ identifier: "ToolList" })
export const ToolListQuery = Schema.Struct({
  provider: ProviderID,
  model: ModelID,
})

const QueryBoolean = Schema.Literals(["true", "false"]).pipe(
  Schema.decodeTo(Schema.Boolean, {
    decode: SchemaGetter.transform((value) => value === "true"),
    encode: SchemaGetter.transform((value) => (value ? "true" : "false")),
  }),
)
const WorktreeList = Schema.Array(Schema.String)
export const SessionListQuery = Schema.Struct({
  directory: Schema.optional(Schema.String),
  roots: Schema.optional(QueryBoolean),
  start: Schema.optional(Schema.NumberFromString),
  cursor: Schema.optional(Schema.NumberFromString),
  search: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.NumberFromString),
  archived: Schema.optional(QueryBoolean),
})

export const ExperimentalPaths = {
  console: "/experimental/console",
  consoleOrgs: "/experimental/console/orgs",
  consoleSwitch: "/experimental/console/switch",
  consoleLogin: "/experimental/console/login",
  consoleLoginPoll: "/experimental/console/login/poll",
  consoleLoginApiKey: "/experimental/console/login/api-key",
  consoleLogout: "/experimental/console/logout",
  tool: "/experimental/tool",
  toolIDs: "/experimental/tool/ids",
  worktree: "/experimental/worktree",
  worktreeReset: "/experimental/worktree/reset",
  session: "/experimental/session",
  resource: "/experimental/resource",
} as const

export const ExperimentalApi = HttpApi.make("experimental")
  .add(
    HttpApiGroup.make("experimental")
      .add(
        HttpApiEndpoint.get("console", ExperimentalPaths.console, {
          success: described(ConsoleStateResponse, "Active Console provider metadata"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.get",
            summary: "Get active Console provider metadata",
            description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
          }),
        ),
        HttpApiEndpoint.get("consoleOrgs", ExperimentalPaths.consoleOrgs, {
          success: described(ConsoleOrgList, "Switchable Console orgs"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.listOrgs",
            summary: "List switchable Console orgs",
            description: "Get the available Console orgs across logged-in accounts, including the current active org.",
          }),
        ),
        HttpApiEndpoint.post("consoleSwitch", ExperimentalPaths.consoleSwitch, {
          payload: ConsoleSwitchPayload,
          success: described(Schema.Boolean, "Switch success"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.switchOrg",
            summary: "Switch active Console org",
            description: "Persist a new active Console account/org selection for the current local PhysicsCode state.",
          }),
        ),
        HttpApiEndpoint.post("consoleLogin", ExperimentalPaths.consoleLogin, {
          payload: ConsoleLoginPayload,
          success: described(ConsoleLoginStart, "Device code login started"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.login",
            summary: "Start Console device-code login",
            description:
              "Begin an OAuth device-code login against a Console server. Returns a URL and user code to present to " +
              "the user, plus the poll interval/expiry (in ms) -- pass the returned object as-is to /console/login/poll.",
          }),
        ),
        HttpApiEndpoint.post("consoleLoginPoll", ExperimentalPaths.consoleLoginPoll, {
          payload: ConsoleLoginPollPayload,
          success: described(ConsoleLoginPollResult, "Poll result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.loginPoll",
            summary: "Poll Console device-code login",
            description:
              "Poll the status of a device-code login started via /console/login. Pass the exact object returned by " +
              "that endpoint. Call repeatedly (respecting `intervalMs`, and the longer interval on a `slow` result) " +
              "until the status is no longer `pending`/`slow`.",
          }),
        ),
        HttpApiEndpoint.post("consoleLoginApiKey", ExperimentalPaths.consoleLoginApiKey, {
          payload: ConsoleLoginApiKeyPayload,
          success: described(ConsoleAccount, "Logged in account"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.loginApiKey",
            summary: "Log in to Console with a personal API key",
            description: "Log in to a Console server using a personal API key instead of the device-code flow.",
          }),
        ),
        HttpApiEndpoint.post("consoleLogout", ExperimentalPaths.consoleLogout, {
          payload: ConsoleLogoutPayload,
          success: described(Schema.Boolean, "Logout success"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.console.logout",
            summary: "Log out of a Console account",
            description: "Remove a logged-in Console account.",
          }),
        ),
        HttpApiEndpoint.get("tool", ExperimentalPaths.tool, {
          query: ToolListQuery,
          success: described(ToolList, "Tools"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.list",
            summary: "List tools",
            description:
              "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
          }),
        ),
        HttpApiEndpoint.get("toolIDs", ExperimentalPaths.toolIDs, {
          success: described(ToolIDs, "Tool IDs"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "tool.ids",
            summary: "List tool IDs",
            description:
              "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
          }),
        ),
        HttpApiEndpoint.get("worktree", ExperimentalPaths.worktree, {
          success: described(WorktreeList, "List of worktree directories"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.list",
            summary: "List worktrees",
            description: "List all sandbox worktrees for the current project.",
          }),
        ),
        HttpApiEndpoint.post("worktreeCreate", ExperimentalPaths.worktree, {
          payload: Schema.optional(Worktree.CreateInput),
          success: described(Worktree.Info, "Worktree created"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.create",
            summary: "Create worktree",
            description: "Create a new git worktree for the current project and run any configured startup scripts.",
          }),
        ),
        HttpApiEndpoint.delete("worktreeRemove", ExperimentalPaths.worktree, {
          payload: Worktree.RemoveInput,
          success: described(Schema.Boolean, "Worktree removed"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.remove",
            summary: "Remove worktree",
            description: "Remove a git worktree and delete its branch.",
          }),
        ),
        HttpApiEndpoint.post("worktreeReset", ExperimentalPaths.worktreeReset, {
          payload: Worktree.ResetInput,
          success: described(Schema.Boolean, "Worktree reset"),
          error: HttpApiError.BadRequest,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "worktree.reset",
            summary: "Reset worktree",
            description: "Reset a worktree branch to the primary default branch.",
          }),
        ),
        HttpApiEndpoint.get("session", ExperimentalPaths.session, {
          query: SessionListQuery,
          success: described(Schema.Array(Session.GlobalInfo), "List of sessions"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.session.list",
            summary: "List sessions",
            description:
              "Get a list of all PhysicsCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
          }),
        ),
        HttpApiEndpoint.get("resource", ExperimentalPaths.resource, {
          success: described(Schema.Record(Schema.String, MCP.Resource), "MCP resources"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "experimental.resource.list",
            summary: "Get MCP resources",
            description: "Get all available MCP resources from connected servers. Optionally filter by name.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "experimental",
          description: "Experimental HttpApi read-only routes.",
        }),
      )
      .middleware(InstanceContextMiddleware)
      .middleware(WorkspaceRoutingMiddleware)
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "physicscode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )
