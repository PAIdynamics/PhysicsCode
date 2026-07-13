import * as Clipboard from "./clipboard"

type Renderer = {
  getSelection: () => { getSelectedText: () => string } | null
  clearSelection: () => void
}

export function copy(renderer: Renderer): boolean {
  const text = renderer.getSelection()?.getSelectedText()
  if (!text) return false

  Clipboard.copy(text).catch(() => {})

  renderer.clearSelection()
  return true
}

export * as Selection from "./selection"
