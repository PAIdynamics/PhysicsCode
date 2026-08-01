export const normalizeServerUrl = (input: string): string => {
  const url = new URL(input)
  if (url.hostname === "physicscode.ai") url.hostname = "www.physicscode.ai"
  url.search = ""
  url.hash = ""

  const pathname = url.pathname.replace(/\/+$/, "")
  return pathname.length === 0 ? url.origin : `${url.origin}${pathname}`
}
