#!/usr/bin/env bun
import { $, Glob } from "bun"
import { createHash } from "node:crypto"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const dist = path.join(root, "packages/physicscode/dist")
const site = process.env.PAIDYNAMICS_SITE_DIR ?? "/Users/mohsensadr/Codes/GitHub/paidynamics"
const releaseBaseUrl = process.env.PHYSICSCODE_RELEASE_BASE_URL ?? "https://paidynamics.ch/physicscode/releases"

const arg = (name: string) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

const versionFromArgs = arg("--version")?.replace(/^v/, "")
const packages = (
  await Promise.all(
    Array.from(new Glob("physicscode-*/package.json").scanSync({ cwd: dist })).map(async (file) => ({
      dir: path.dirname(file),
      pkg: await Bun.file(path.join(dist, file)).json(),
    })),
  )
).sort((a, b) => a.dir.localeCompare(b.dir))

const version = versionFromArgs ?? packages[0]?.pkg.version
if (!version) {
  throw new Error("No PhysicsCode dist packages found. Run packages/physicscode/script/build.ts first.")
}

const releaseDir = path.join(site, "physicscode/releases", `v${version}`)
const latestDir = path.join(site, "physicscode/releases/latest")
await $`mkdir -p ${path.join(releaseDir, "download")} ${path.join(latestDir, "download")}`

const archiveFor = async (dir: string) => {
  const archive = path.join(dist, `${dir}${dir.includes("linux") ? ".tar.gz" : ".zip"}`)
  if (await Bun.file(archive).exists()) return archive
  if (dir.includes("linux")) {
    await $`tar -czf ${archive} *`.cwd(path.join(dist, dir, "bin"))
    return archive
  }
  await $`zip -qr ${archive} *`.cwd(path.join(dist, dir, "bin"))
  return archive
}

const assets = await Promise.all(
  packages.map(async (item) => {
    const archive = await archiveFor(item.dir)
    const name = path.basename(archive)
    const bytes = await Bun.file(archive).arrayBuffer()
    await Bun.write(path.join(releaseDir, "download", name), bytes)
    await Bun.write(path.join(latestDir, "download", name), bytes)
    return {
      name,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      url: `${releaseBaseUrl}/v${version}/download/${name}`,
    }
  }),
)

const manifest = {
  version,
  generated_at: new Date().toISOString(),
  assets,
}

await Bun.write(path.join(releaseDir, "version.txt"), `${version}\n`)
await Bun.write(path.join(latestDir, "version.txt"), `${version}\n`)
await Bun.write(path.join(releaseDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
await Bun.write(path.join(latestDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)

const releasesPath = path.join(site, "physicscode/releases/releases.json")
const existing = await Bun.file(releasesPath)
  .json()
  .catch(() => [])
const releases = [
  {
    tag_name: `v${version}`,
    name: `v${version}`,
    body: "",
    published_at: new Date().toISOString(),
    html_url: `${releaseBaseUrl}/v${version}/`,
  },
  ...existing.filter((item: { tag_name?: string }) => item.tag_name !== `v${version}`),
]
await Bun.write(releasesPath, `${JSON.stringify(releases, null, 2)}\n`)

console.log(`Exported PhysicsCode ${version} to ${releaseDir}`)
