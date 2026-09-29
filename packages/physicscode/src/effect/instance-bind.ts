import { Fiber, Context } from "effect"
import { LocalContext } from "@/util/local-context"
import { context, type InstanceContext } from "@/project/instance-context"
import { InstanceRef } from "./instance-ref"

// Kept free of project/instance so storage/db can depend on it without an import cycle.

const wrap = <F extends (...args: any[]) => any>(ctx: InstanceContext, fn: F) =>
  ((...args: any[]) => context.provide(ctx, () => fn(...args))) as F

/**
 * Captures the current instance (from ALS, falling back to the current fiber's
 * InstanceRef) and returns a wrapper that restores it when called. Returns `fn`
 * unchanged when there is no instance in scope.
 */
export const bind = <F extends (...args: any[]) => any>(fn: F): F => {
  try {
    return wrap(context.use(), fn)
  } catch (err) {
    if (!(err instanceof LocalContext.NotFound)) throw err
  }
  const fiber = Fiber.getCurrent()
  const ctx = fiber ? Context.getReferenceUnsafe(fiber.context, InstanceRef) : undefined
  if (!ctx) return fn
  return wrap(ctx, fn)
}

export * as InstanceBind from "./instance-bind"
