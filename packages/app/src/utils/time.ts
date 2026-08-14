type TimeKey =
  | "common.time.justNow"
  | "common.time.minutesAgo.short"
  | "common.time.hoursAgo.short"
  | "common.time.daysAgo.short"

type Translate = (key: TimeKey, params?: Record<string, string | number>) => string

export function getRelativeTime(dateString: string, t: Translate): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return t("common.time.justNow")
  if (diffMinutes < 60) return t("common.time.minutesAgo.short", { count: diffMinutes })
  if (diffHours < 24) return t("common.time.hoursAgo.short", { count: diffHours })
  return t("common.time.daysAgo.short", { count: diffDays })
}

export const MS_PER_MONTH = 30.436875 * 24 * 60 * 60 * 1000

const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ["year", 365.2425 * 24 * 60 * 60 * 1000],
  ["month", MS_PER_MONTH],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
  ["second", 1000],
]

// Intl formatters are expensive to construct and these run inside render paths,
// so keep one per locale.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

/** Locale-aware "3 days ago", matching the previous luxon `toRelative()` output. */
export function formatRelative(value: number, locale: string, now = Date.now()) {
  const delta = value - now
  const magnitude = Math.abs(delta)

  const [unit, ms] = RELATIVE_UNITS.find(([, size]) => magnitude >= size) ?? RELATIVE_UNITS[RELATIVE_UNITS.length - 1]

  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    relativeFormatters.set(locale, formatter)
  }
  return formatter.format(Math.trunc(delta / ms), unit)
}

/** Locale-aware medium date + short time, matching luxon's `DATETIME_MED`. */
export function formatDateTime(value: number, locale: string) {
  let formatter = dateTimeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
    dateTimeFormatters.set(locale, formatter)
  }
  return formatter.format(value)
}
