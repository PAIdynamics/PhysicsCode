import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import * as EffectZod from "@/util/effect-zod"
import { ProviderID, ModelID } from "@/provider/schema"
import { ToolRegistry } from "@/tool/registry"
import { Worktree } from "@/worktree"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { MCP } from "@/mcp"
import { Session } from "@/session/session"
import { Config } from "@/config/config"
import { ConsoleState } from "@/config/console-state"
import { Account } from "@/account/account"
import { AccountID, OrgID } from "@/account/schema"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Duration, Effect, Option } from "effect"
import { Agent } from "@/agent/agent"
import { jsonRequest, runRequest } from "./trace"

const ConsoleOrgOption = z.object({
  accountID: z.string(),
  accountEmail: z.string(),
  accountUrl: z.string(),
  orgID: z.string(),
  orgName: z.string(),
  active: z.boolean(),
})

const ConsoleOrgList = z.object({
  orgs: z.array(ConsoleOrgOption),
})

const ConsoleSwitchBody = z.object({
  accountID: z.string(),
  orgID: z.string(),
})

// Account.Login/PollResult carry Effect Duration/Defect fields that the
// Effect-Schema -> Zod walker can't derive a JSON schema for, so these routes
// use hand-rolled wire shapes (ms instead of Duration, string instead of
// Defect) rather than deriving directly from the Effect Schema classes.
const ConsoleLoginStart = z.object({
  code: z.string(),
  user: z.string(),
  url: z.string(),
  server: z.string(),
  expiryMs: z.number(),
  intervalMs: z.number(),
})

function toWireLogin(login: Account.Login) {
  return {
    code: login.code,
    user: login.user,
    url: login.url,
    server: login.server,
    expiryMs: Duration.toMillis(login.expiry),
    intervalMs: Duration.toMillis(login.interval),
  }
}

function fromWireLogin(body: z.infer<typeof ConsoleLoginStart>): Account.Login {
  return Account.Login.make({
    code: Account.DeviceCode.make(body.code),
    user: Account.UserCode.make(body.user),
    url: body.url,
    server: body.server,
    expiry: Duration.millis(body.expiryMs),
    interval: Duration.millis(body.intervalMs),
  })
}

const ConsoleLoginPollResult = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), email: z.string() }),
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("slow") }),
  z.object({ status: z.literal("expired") }),
  z.object({ status: z.literal("denied") }),
  z.object({ status: z.literal("error"), message: z.string() }),
])

function toWirePollResult(result: Account.PollResult): z.infer<typeof ConsoleLoginPollResult> {
  switch (result._tag) {
    case "PollSuccess":
      return { status: "success", email: result.email }
    case "PollPending":
      return { status: "pending" }
    case "PollSlow":
      return { status: "slow" }
    case "PollExpired":
      return { status: "expired" }
    case "PollDenied":
      return { status: "denied" }
    case "PollError":
      return { status: "error", message: String(result.cause) }
  }
}

const ConsoleAccount = z.object({
  id: z.string(),
  email: z.string(),
  url: z.string(),
  activeOrgID: z.string().nullable(),
})

function toWireAccount(info: Account.Info): z.infer<typeof ConsoleAccount> {
  return {
    id: info.id,
    email: info.email,
    url: info.url,
    activeOrgID: info.active_org_id,
  }
}

const QueryBoolean = z.union([
  z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean()),
  z.enum(["true", "false"]),
])

function queryBoolean(value: z.infer<typeof QueryBoolean> | undefined) {
  if (value === undefined) return
  return value === true || value === "true"
}

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/console",
      describeRoute({
        summary: "Get active Console provider metadata",
        description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
        operationId: "experimental.console.get",
        responses: {
          200: {
            description: "Active Console provider metadata",
            content: {
              "application/json": {
                schema: resolver(ConsoleState.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.get", c, function* () {
          const config = yield* Config.Service
          const account = yield* Account.Service
          const [state, groups] = yield* Effect.all([config.getConsoleState(), account.orgsByAccount()], {
            concurrency: "unbounded",
          })
          return {
            ...state,
            switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
          }
        }),
    )
    .get(
      "/console/orgs",
      describeRoute({
        summary: "List switchable Console orgs",
        description: "Get the available Console orgs across logged-in accounts, including the current active org.",
        operationId: "experimental.console.listOrgs",
        responses: {
          200: {
            description: "Switchable Console orgs",
            content: {
              "application/json": {
                schema: resolver(ConsoleOrgList),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.listOrgs", c, function* () {
          const account = yield* Account.Service
          const [groups, active] = yield* Effect.all([account.orgsByAccount(), account.active()], {
            concurrency: "unbounded",
          })
          const info = Option.getOrUndefined(active)
          const orgs = groups.flatMap((group) =>
            group.orgs.map((org) => ({
              accountID: group.account.id,
              accountEmail: group.account.email,
              accountUrl: group.account.url,
              orgID: org.id,
              orgName: org.name,
              active: !!info && info.id === group.account.id && info.active_org_id === org.id,
            })),
          )
          return { orgs }
        }),
    )
    .post(
      "/console/switch",
      describeRoute({
        summary: "Switch active Console org",
        description: "Persist a new active Console account/org selection for the current local PhysicsCode state.",
        operationId: "experimental.console.switchOrg",
        responses: {
          200: {
            description: "Switch success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", ConsoleSwitchBody),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.switchOrg", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          yield* account.use(AccountID.make(body.accountID), Option.some(OrgID.make(body.orgID)))
          return true
        }),
    )
    .post(
      "/console/login",
      describeRoute({
        summary: "Start Console device-code login",
        description:
          "Begin an OAuth device-code login against a Console server. Returns a URL and user code to present to " +
          "the user, plus the poll interval/expiry (in ms) -- pass the returned object as-is to /console/login/poll.",
        operationId: "experimental.console.login",
        responses: {
          200: {
            description: "Device code login started",
            content: {
              "application/json": {
                schema: resolver(ConsoleLoginStart),
              },
            },
          },
        },
      }),
      validator("json", z.object({ url: z.string() })),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.login", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          return toWireLogin(yield* account.login(body.url))
        }),
    )
    .post(
      "/console/login/poll",
      describeRoute({
        summary: "Poll Console device-code login",
        description:
          "Poll the status of a device-code login started via /console/login. Pass the exact object returned by " +
          "that endpoint. Call repeatedly (respecting `intervalMs`, and the longer interval on a `slow` result) " +
          "until the status is no longer `pending`/`slow`.",
        operationId: "experimental.console.loginPoll",
        responses: {
          200: {
            description: "Poll result",
            content: {
              "application/json": {
                schema: resolver(ConsoleLoginPollResult),
              },
            },
          },
        },
      }),
      validator("json", ConsoleLoginStart),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.loginPoll", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          return toWirePollResult(yield* account.poll(fromWireLogin(body)))
        }),
    )
    .post(
      "/console/login/api-key",
      describeRoute({
        summary: "Log in to Console with a personal API key",
        description: "Log in to a Console server using a personal API key instead of the device-code flow.",
        operationId: "experimental.console.loginApiKey",
        responses: {
          200: {
            description: "Logged in account",
            content: {
              "application/json": {
                schema: resolver(ConsoleAccount),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", z.object({ url: z.string(), apiKey: z.string() })),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.loginApiKey", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          return toWireAccount(yield* account.loginWithApiKey(body.url, body.apiKey))
        }),
    )
    .post(
      "/console/logout",
      describeRoute({
        summary: "Log out of a Console account",
        description: "Remove a logged-in Console account.",
        operationId: "experimental.console.logout",
        responses: {
          200: {
            description: "Logout success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ accountID: z.string() })),
      async (c) =>
        jsonRequest("ExperimentalRoutes.console.logout", c, function* () {
          const body = c.req.valid("json")
          const account = yield* Account.Service
          yield* account.remove(AccountID.make(body.accountID))
          return true
        }),
    )
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.tool.ids", c, function* () {
          const registry = yield* ToolRegistry.Service
          return yield* registry.ids()
        }),
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await runRequest(
          "ExperimentalRoutes.tool.list",
          c,
          Effect.gen(function* () {
            const agents = yield* Agent.Service
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({
              providerID: ProviderID.make(provider),
              modelID: ModelID.make(model),
              agent: yield* agents.get(yield* agents.defaultAgent()),
            })
          }),
        )
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            parameters: EffectZod.toJsonSchema(t.parameters),
          })),
        )
      },
    )
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info.zod),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.CreateInput.zod.optional()),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.create", c, function* () {
          const body = c.req.valid("json")
          const svc = yield* Worktree.Service
          return yield* svc.create(body)
        }),
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.list", c, function* () {
          const svc = yield* Project.Service
          return yield* svc.sandboxes(Instance.project.id)
        }),
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.RemoveInput.zod),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.remove", c, function* () {
          const body = c.req.valid("json")
          const worktree = yield* Worktree.Service
          const project = yield* Project.Service
          yield* worktree.remove(body)
          yield* project.removeSandbox(Instance.project.id, body.directory)
          return true
        }),
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.ResetInput.zod),
      async (c) =>
        jsonRequest("ExperimentalRoutes.worktree.reset", c, function* () {
          const body = c.req.valid("json")
          const svc = yield* Worktree.Service
          yield* svc.reset(body)
          return true
        }),
    )
    .get(
      "/session",
      describeRoute({
        summary: "List sessions",
        description:
          "Get a list of all PhysicsCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
        operationId: "experimental.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.GlobalInfo.zod.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: QueryBoolean.optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          cursor: z.coerce
            .number()
            .optional()
            .meta({ description: "Return sessions updated before this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: QueryBoolean.optional().meta({ description: "Include archived sessions (default false)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const limit = query.limit ?? 100
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          directory: query.directory,
          roots: queryBoolean(query.roots),
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: queryBoolean(query.archived),
        })) {
          sessions.push(session)
        }
        const hasMore = sessions.length > limit
        const list = hasMore ? sessions.slice(0, limit) : sessions
        if (hasMore && list.length > 0) {
          c.header("x-next-cursor", String(list[list.length - 1].time.updated))
        }
        return c.json(list)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource.zod)),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ExperimentalRoutes.resource.list", c, function* () {
          const mcp = yield* MCP.Service
          return yield* mcp.resources()
        }),
    ),
)
