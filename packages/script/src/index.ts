import { $ } from "bun"
import semver from "semver"
import path from "path"

const rootPkgPath = path.resolve(import.meta.dir, "../../../package.json")
const rootPkg = await Bun.file(rootPkgPath).json()
const expectedBunVersion = rootPkg.packageManager?.split("@")[1]

if (!expectedBunVersion) {
  throw new Error("packageManager field not found in root package.json")
}

// relax version requirement
const expectedBunVersionRange = `^${expectedBunVersion}`

if (!semver.satisfies(process.versions.bun, expectedBunVersionRange)) {
  throw new Error(`This script requires bun@${expectedBunVersionRange}, but you are using bun@${process.versions.bun}`)
}

const env = {
  PHYSICSCODE_CHANNEL: process.env["PHYSICSCODE_CHANNEL"],
  PHYSICSCODE_BUMP: process.env["PHYSICSCODE_BUMP"],
  PHYSICSCODE_VERSION: process.env["PHYSICSCODE_VERSION"],
  PHYSICSCODE_RELEASE: process.env["PHYSICSCODE_RELEASE"],
}
const CHANNEL = await (async () => {
  if (env.PHYSICSCODE_CHANNEL) return env.PHYSICSCODE_CHANNEL
  if (env.PHYSICSCODE_BUMP) return "latest"
  if (env.PHYSICSCODE_VERSION && !env.PHYSICSCODE_VERSION.startsWith("0.0.0-")) return "latest"
  return await $`git branch --show-current`.text().then((x) => x.trim())
})()
const IS_PREVIEW = CHANNEL !== "latest"

// Latest published npm version is the normal baseline to bump from. If the
// package has never been published (404 - e.g. the very first release
// through this pipeline), fall back to the latest GitHub release tag, so
// numbering continues from what's already visible to users instead of
// restarting from scratch. If neither source has anything yet, 0.0.0 is the
// baseline (so a patch bump produces 0.0.1).
async function latestNpmVersion(): Promise<string | undefined> {
  const res = await fetch("https://registry.npmjs.org/physicscode-ai/latest")
  if (!res.ok) return undefined
  const data = (await res.json()) as { version?: string }
  return data.version
}

async function latestGithubReleaseVersion(): Promise<string | undefined> {
  const repo = process.env["GH_REPO"]
  if (!repo) return undefined
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  })
  if (!res.ok) return undefined
  const data = (await res.json()) as { tag_name?: string }
  return data.tag_name?.replace(/^v/, "")
}

const VERSION = await (async () => {
  if (env.PHYSICSCODE_VERSION) return env.PHYSICSCODE_VERSION
  if (IS_PREVIEW) return `0.0.0-${CHANNEL}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`
  const version = (await latestNpmVersion()) ?? (await latestGithubReleaseVersion()) ?? "0.0.0"
  const [major, minor, patch] = version.split(".").map((x: string) => Number(x) || 0)
  const t = env.PHYSICSCODE_BUMP?.toLowerCase()
  if (t === "major") return `${major + 1}.0.0`
  if (t === "minor") return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
})()

const bot = ["actions-user", "physicscode", "physicscode-agent[bot]"]
const teamPath = path.resolve(import.meta.dir, "../../../.github/TEAM_MEMBERS")
const team = [
  ...(await Bun.file(teamPath)
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

export const Script = {
  get channel() {
    return CHANNEL
  },
  get version() {
    return VERSION
  },
  get preview() {
    return IS_PREVIEW
  },
  get release(): boolean {
    return !!env.PHYSICSCODE_RELEASE
  },
  get team() {
    return team
  },
}
console.log(`physicscode script`, JSON.stringify(Script, null, 2))
