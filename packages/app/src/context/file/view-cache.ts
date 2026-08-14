import { createEffect, createRoot } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Persist, persisted } from "@/utils/persist"
import { createScopedCache } from "@/utils/scoped-cache"
import type { FileViewState, SelectedLineRange } from "./types"

const WORKSPACE_KEY = "__workspace__"
const MAX_FILE_VIEW_SESSIONS = 20
const MAX_VIEW_FILES = 500

function normalizeSelectedLines(range: SelectedLineRange): SelectedLineRange {
  if (range.start <= range.end) return { ...range }

  const startSide = range.side
  const endSide = range.endSide ?? startSide

  return {
    ...range,
    start: range.end,
    end: range.start,
    side: endSide,
    endSide: startSide !== endSide ? startSide : undefined,
  }
}

function equalSelectedLines(a: SelectedLineRange | null | undefined, b: SelectedLineRange | null | undefined) {
  if (!a && !b) return true
  if (!a || !b) return false
  const left = normalizeSelectedLines(a)
  const right = normalizeSelectedLines(b)
  return (
    left.start === right.start && left.end === right.end && left.side === right.side && left.endSide === right.endSide
  )
}

function createViewSession(dir: string, id: string | undefined) {
  const legacyViewKey = `${dir}/file${id ? "/" + id : ""}.v1`

  const [view, setView, _, ready] = persisted(
    Persist.scoped(dir, id, "file-view", [legacyViewKey]),
    createStore<{
      file: Record<string, FileViewState>
    }>({
      file: {},
    }),
  )

  const meta = { pruned: false }

  const pruneView = (keep?: string) => {
    const keys = Object.keys(view.file)
    if (keys.length <= MAX_VIEW_FILES) return

    const drop = keys.filter((key) => key !== keep).slice(0, keys.length - MAX_VIEW_FILES)
    if (drop.length === 0) return

    setView(
      produce((draft) => {
        for (const key of drop) {
          delete draft.file[key]
        }
      }),
    )
  }

  createEffect(() => {
    if (!ready()) return
    if (meta.pruned) return
    meta.pruned = true
    pruneView()
  })

  const scrollTop = (path: string) => view.file[path]?.scrollTop
  const scrollLeft = (path: string) => view.file[path]?.scrollLeft
  const selectedLines = (path: string) => view.file[path]?.selectedLines

  // Scroll setters fire on every scroll event, so they bail out before touching
  // the store when nothing changed, and only walk the key set when a new file
  // entry is actually added.
  const edit = (path: string, apply: (file: FileViewState) => void) => {
    const added = view.file[path] === undefined
    setView(
      produce((draft) => {
        apply(draft.file[path] ?? (draft.file[path] = {}))
      }),
    )
    if (added) pruneView(path)
  }

  const setScrollTop = (path: string, top: number) => {
    if (view.file[path]?.scrollTop === top) return
    edit(path, (file) => {
      file.scrollTop = top
    })
  }

  const setScrollLeft = (path: string, left: number) => {
    if (view.file[path]?.scrollLeft === left) return
    edit(path, (file) => {
      file.scrollLeft = left
    })
  }

  const setSelectedLines = (path: string, range: SelectedLineRange | null) => {
    const next = range ? normalizeSelectedLines(range) : null
    if (equalSelectedLines(view.file[path]?.selectedLines, next)) return
    edit(path, (file) => {
      file.selectedLines = next
    })
  }

  return {
    ready,
    scrollTop,
    scrollLeft,
    selectedLines,
    setScrollTop,
    setScrollLeft,
    setSelectedLines,
  }
}

export function createFileViewCache() {
  const cache = createScopedCache(
    (key) => {
      const split = key.lastIndexOf("\n")
      const dir = split >= 0 ? key.slice(0, split) : key
      const id = split >= 0 ? key.slice(split + 1) : WORKSPACE_KEY
      return createRoot((dispose) => ({
        value: createViewSession(dir, id === WORKSPACE_KEY ? undefined : id),
        dispose,
      }))
    },
    {
      maxEntries: MAX_FILE_VIEW_SESSIONS,
      dispose: (entry) => entry.dispose(),
    },
  )

  return {
    load: (dir: string, id: string | undefined) => {
      const key = `${dir}\n${id ?? WORKSPACE_KEY}`
      return cache.get(key).value
    },
    clear: () => cache.clear(),
  }
}
