import { LocalContext } from "@/util/local-context"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

/**
 * The instance ALS. Lives in its own module (no runtime imports beyond
 * LocalContext) so low-level modules like storage/db can bind to it
 * without pulling in project/instance -> project/project -> storage/db.
 */
export const context = LocalContext.create<InstanceContext>("instance")
