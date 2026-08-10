import path from "path"
import { Effect, Layer, Record, Result, Schema, Context } from "effect"
import { zod } from "@/util/effect-zod"
import { NonNegativeInt } from "@/util/schema"
import { Global } from "@physicscode-ai/core/global"
import { AppFileSystem } from "@physicscode-ai/core/filesystem"
import { decrypt, encrypt, generateKey, isEncrypted } from "./crypto"

export const OAUTH_DUMMY_KEY = "physicscode-oauth-dummy-key"

const file = path.join(Global.Path.data, "auth.json")
const keyFile = path.join(Global.Path.data, "auth.key")

const fail = (message: string) => (cause: unknown) => new AuthError({ message, cause })

function safeDecrypt(value: unknown, key: Buffer) {
  if (!isEncrypted(value)) return value
  try {
    return JSON.parse(decrypt(value, key))
  } catch {
    return undefined
  }
}

export class Oauth extends Schema.Class<Oauth>("OAuth")({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
}) {}

export class Api extends Schema.Class<Api>("ApiAuth")({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}) {}

export class WellKnown extends Schema.Class<WellKnown>("WellKnownAuth")({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
}) {}

const _Info = Schema.Union([Oauth, Api, WellKnown]).annotate({ discriminator: "type", identifier: "Auth" })
export const Info = Object.assign(_Info, { zod: zod(_Info) })
export type Info = Schema.Schema.Type<typeof _Info>

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export interface Interface {
  readonly get: (providerID: string) => Effect.Effect<Info | undefined, AuthError>
  readonly all: () => Effect.Effect<Record<string, Info>, AuthError>
  readonly set: (key: string, info: Info) => Effect.Effect<void, AuthError>
  readonly remove: (key: string) => Effect.Effect<void, AuthError>
}

export class Service extends Context.Service<Service, Interface>()("@physicscode/Auth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fsys = yield* AppFileSystem.Service
    const decode = Schema.decodeUnknownOption(Info)

    // Credentials are encrypted at rest (AES-256-GCM) with a key kept in a separate
    // file, so a leaked/synced auth.json alone doesn't expose anything. Legacy
    // plaintext entries (written before this existed) still decode as-is here and
    // get rewritten encrypted the next time they're set/removed.
    const getKey = Effect.fn("Auth.getKey")(function* () {
      const existing = yield* fsys.readFileString(keyFile).pipe(Effect.orElseSucceed(() => undefined))
      if (existing) return Buffer.from(existing.trim(), "base64")

      const key = generateKey()
      yield* fsys
        .writeWithDirs(keyFile, key.toString("base64"), 0o600)
        .pipe(Effect.mapError(fail("Failed to write auth key")))
      return key
    })

    const all = Effect.fn("Auth.all")(function* () {
      if (process.env.PHYSICSCODE_AUTH_CONTENT) {
        try {
          return JSON.parse(process.env.PHYSICSCODE_AUTH_CONTENT)
        } catch (err) {}
      }

      const data = (yield* fsys.readJson(file).pipe(Effect.orElseSucceed(() => ({})))) as Record<string, unknown>
      const key = yield* getKey()
      const plain = Record.map(data, (value) => safeDecrypt(value, key))
      return Record.filterMap(plain, (value) => Result.fromOption(decode(value), () => undefined))
    })

    const get = Effect.fn("Auth.get")(function* (providerID: string) {
      return (yield* all())[providerID]
    })

    const persist = Effect.fn("Auth.persist")(function* (data: Record<string, Info>) {
      const key = yield* getKey()
      const encoded = Record.map(data, (info) => encrypt(JSON.stringify(info), key))
      yield* fsys.writeJson(file, encoded, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
    })

    const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      if (norm !== key) delete data[key]
      delete data[norm + "/"]
      yield* persist({ ...data, [norm]: info })
    })

    const remove = Effect.fn("Auth.remove")(function* (key: string) {
      const norm = key.replace(/\/+$/, "")
      const data = yield* all()
      delete data[key]
      delete data[norm]
      yield* persist(data)
    })

    return Service.of({ get, all, set, remove })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

export * as Auth from "."
