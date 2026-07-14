import * as Clipboard from "./clipboard"

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

export function copy(renderer: Renderer, options: { clear?: boolean; onError?: (error: unknown) => void } = {}): boolean {
  const text = renderer.getSelection()?.getSelectedText()
  if (!text) return false

  Clipboard.copy(text).catch((error) => options.onError?.(error))

  if (options.clear ?? true) renderer.clearSelection()
  return true
}

export * as Selection from "./selection"
