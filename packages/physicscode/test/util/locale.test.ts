import { describe, expect, test } from "bun:test"
import { Locale } from "@/util/locale"

describe("util.Locale.titlecase", () => {
  test("capitalizes the first letter of every word", () => {
    expect(Locale.titlecase("hello world")).toBe("Hello World")
  })

  test("leaves already-capitalized letters alone", () => {
    expect(Locale.titlecase("Hello World")).toBe("Hello World")
  })

  test("capitalizes a single word", () => {
    expect(Locale.titlecase("physicscode")).toBe("Physicscode")
  })

  test("capitalizes each word around punctuation", () => {
    expect(Locale.titlecase("it's a test")).toBe("It'S A Test")
  })

  test("handles an empty string", () => {
    expect(Locale.titlecase("")).toBe("")
  })
})

describe("util.Locale.time / datetime / todayTimeOrDateTime", () => {
  // Locale.time/datetime rely on Intl formatting, whose exact output text
  // varies by runner locale/timezone - assert shape and internal
  // consistency instead of a hardcoded string.
  test("time formats a timestamp using the runtime's short time style", () => {
    const now = Date.now()
    expect(Locale.time(now)).toBe(new Date(now).toLocaleTimeString(undefined, { timeStyle: "short" }))
  })

  test("datetime combines time and date with a middle dot separator", () => {
    const now = Date.now()
    const date = new Date(now)
    expect(Locale.datetime(now)).toBe(`${Locale.time(now)} · ${date.toLocaleDateString()}`)
  })

  test("todayTimeOrDateTime returns just the time for a timestamp from today", () => {
    const now = Date.now()
    expect(Locale.todayTimeOrDateTime(now)).toBe(Locale.time(now))
  })

  test("todayTimeOrDateTime returns the full datetime for a timestamp from a different day", () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000 - 60 * 60 * 1000
    expect(Locale.todayTimeOrDateTime(yesterday)).toBe(Locale.datetime(yesterday))
  })
})

describe("util.Locale.number", () => {
  test("formats sub-thousand-scale values in K with one decimal", () => {
    expect(Locale.number(500)).toBe("0.5K")
  })

  test("drops a trailing .0", () => {
    expect(Locale.number(2000)).toBe("2K")
  })

  test("keeps a non-zero decimal", () => {
    expect(Locale.number(1500)).toBe("1.5K")
  })

  test("formats million-scale values in M", () => {
    expect(Locale.number(2500000)).toBe("2.5M")
  })

  test("drops a trailing .0 for whole millions", () => {
    expect(Locale.number(1000000)).toBe("1M")
  })
})

describe("util.Locale.duration", () => {
  test("formats sub-second durations in milliseconds", () => {
    expect(Locale.duration(500)).toBe("500ms")
  })

  test("formats sub-minute durations in seconds with one decimal", () => {
    expect(Locale.duration(1500)).toBe("1.5s")
  })

  test("formats sub-hour durations in minutes and seconds", () => {
    expect(Locale.duration(65000)).toBe("1m 5s")
  })

  test("formats sub-day durations in hours and minutes", () => {
    expect(Locale.duration(3661000)).toBe("1h 1m")
  })

  test("formats multi-day durations in days and hours", () => {
    // 25h -> 1d 1h, not 0d 25h.
    expect(Locale.duration(25 * 60 * 60 * 1000)).toBe("1d 1h")
  })

  test("formats an exact number of days with zero remaining hours", () => {
    expect(Locale.duration(2 * 24 * 60 * 60 * 1000)).toBe("2d 0h")
  })
})

describe("util.Locale.truncate", () => {
  test("returns the string unchanged when within the length limit", () => {
    expect(Locale.truncate("hello", 10)).toBe("hello")
  })

  test("truncates and appends an ellipsis when over the limit", () => {
    expect(Locale.truncate("hello world", 5)).toBe("hell…")
  })

  test("treats a string exactly at the limit as unchanged", () => {
    expect(Locale.truncate("hello", 5)).toBe("hello")
  })
})

describe("util.Locale.truncateMiddle", () => {
  test("returns the string unchanged when within the default max length", () => {
    expect(Locale.truncateMiddle("short")).toBe("short")
  })

  test("truncates the middle and keeps both ends", () => {
    const input = "a".repeat(50)
    const result = Locale.truncateMiddle(input, 11)
    expect(result).toBe("aaaaa…aaaaa")
    expect(result.length).toBe(11)
  })

  test("respects a custom max length", () => {
    const result = Locale.truncateMiddle("0123456789", 6)
    expect(result.length).toBe(6)
    expect(result).toContain("…")
  })
})

describe("util.Locale.pluralize", () => {
  test("uses the singular form for a count of 1", () => {
    expect(Locale.pluralize(1, "{} file", "{} files")).toBe("1 file")
  })

  test("uses the plural form for any other count", () => {
    expect(Locale.pluralize(0, "{} file", "{} files")).toBe("0 files")
    expect(Locale.pluralize(2, "{} file", "{} files")).toBe("2 files")
  })
})
