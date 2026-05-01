import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.PHYSICSCODE_CHANNEL ?? "dev"}`

await $`cd ../physicscode && bun script/build-node.ts`
