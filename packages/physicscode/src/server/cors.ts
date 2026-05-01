const physicscodeOrigin = /^https:\/\/([a-z0-9-]+\.)*physicscode\.ai$/

export type CorsOptions = { readonly cors?: ReadonlyArray<string> }

export function isAllowedCorsOrigin(input: string | undefined, opts?: CorsOptions) {
  if (!input) return true
  if (input.startsWith("http://localhost:")) return true
  if (input.startsWith("http://127.0.0.1:")) return true
  if (input.startsWith("oc://renderer")) return true
  if (input === "tauri://localhost" || input === "http://tauri.localhost" || input === "https://tauri.localhost")
    return true
  if (physicscodeOrigin.test(input)) return true
  return opts?.cors?.includes(input) ?? false
}
