declare global {
  const PHYSICSCODE_VERSION: string
  const PHYSICSCODE_CHANNEL: string
}

export const InstallationVersion = typeof PHYSICSCODE_VERSION === "string" ? PHYSICSCODE_VERSION : "local"
export const InstallationChannel = typeof PHYSICSCODE_CHANNEL === "string" ? PHYSICSCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
