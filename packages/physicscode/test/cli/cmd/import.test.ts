import { describe, expect, test } from "bun:test"
import { parseShareUrl, shouldAttachShareAuthHeaders, transformShareData, type ShareData } from "@/cli/cmd/import"

describe("cli.cmd.import.parseShareUrl", () => {
  test("extracts the slug from an https share URL", () => {
    expect(parseShareUrl("https://opncd.ai/share/abc123")).toBe("abc123")
  })

  test("extracts the slug from an http share URL", () => {
    expect(parseShareUrl("http://opncd.ai/share/abc123")).toBe("abc123")
  })

  test("allows underscores and hyphens in the slug", () => {
    expect(parseShareUrl("https://opncd.ai/share/abc_123-xyz")).toBe("abc_123-xyz")
  })

  test("returns null for a URL missing the /share/ prefix", () => {
    expect(parseShareUrl("https://opncd.ai/abc123")).toBeNull()
  })

  test("returns null for a URL with extra path segments after the slug", () => {
    expect(parseShareUrl("https://opncd.ai/share/abc123/extra")).toBeNull()
  })

  test("returns null for a non-URL string", () => {
    expect(parseShareUrl("not a url")).toBeNull()
  })

  test("returns null for an empty slug", () => {
    expect(parseShareUrl("https://opncd.ai/share/")).toBeNull()
  })
})

describe("cli.cmd.import.shouldAttachShareAuthHeaders", () => {
  test("returns true when the share URL and account base URL share an origin", () => {
    expect(shouldAttachShareAuthHeaders("https://opncd.ai/share/abc", "https://opncd.ai")).toBe(true)
  })

  test("returns true when origins match despite different paths", () => {
    expect(shouldAttachShareAuthHeaders("https://opncd.ai/share/abc", "https://opncd.ai/api")).toBe(true)
  })

  test("returns false for different hosts", () => {
    expect(shouldAttachShareAuthHeaders("https://evil.example.com/share/abc", "https://opncd.ai")).toBe(false)
  })

  test("returns false for the same host but different scheme", () => {
    expect(shouldAttachShareAuthHeaders("http://opncd.ai/share/abc", "https://opncd.ai")).toBe(false)
  })

  test("returns false for the same host but different port", () => {
    expect(shouldAttachShareAuthHeaders("https://opncd.ai:8443/share/abc", "https://opncd.ai")).toBe(false)
  })

  test("returns false when the share URL is malformed", () => {
    expect(shouldAttachShareAuthHeaders("not a url", "https://opncd.ai")).toBe(false)
  })

  test("returns false when the account base URL is malformed", () => {
    expect(shouldAttachShareAuthHeaders("https://opncd.ai/share/abc", "not a url")).toBe(false)
  })
})

describe("cli.cmd.import.transformShareData", () => {
  function session(id: string): ShareData {
    return { type: "session", data: { id } as any }
  }
  function message(id: string, sessionID = "s1"): ShareData {
    return { type: "message", data: { id, sessionID } as any }
  }
  function part(id: string, messageID: string): ShareData {
    return { type: "part", data: { id, messageID } as any }
  }

  test("returns null when there is no session item", () => {
    expect(transformShareData([message("m1")])).toBeNull()
  })

  test("returns null when there are no messages", () => {
    expect(transformShareData([session("s1")])).toBeNull()
  })

  test("groups parts under their owning message by messageID", () => {
    const result = transformShareData([session("s1"), message("m1"), part("p1", "m1"), part("p2", "m1")])
    expect(result?.info).toEqual({ id: "s1" } as any)
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0].info).toEqual({ id: "m1", sessionID: "s1" } as any)
    expect(result?.messages[0].parts.map((p: any) => p.id)).toEqual(["p1", "p2"])
  })

  test("gives a message with no parts an empty parts array", () => {
    const result = transformShareData([session("s1"), message("m1")])
    expect(result?.messages[0].parts).toEqual([])
  })

  test("keeps multiple messages separate with their own parts", () => {
    const result = transformShareData([
      session("s1"),
      message("m1"),
      message("m2"),
      part("p1", "m1"),
      part("p2", "m2"),
    ])
    expect(result?.messages).toHaveLength(2)
    const byId = Object.fromEntries(result!.messages.map((m: any) => [m.info.id, m.parts.map((p: any) => p.id)]))
    expect(byId.m1).toEqual(["p1"])
    expect(byId.m2).toEqual(["p2"])
  })

  test("ignores unrelated item types (session_diff, model)", () => {
    const result = transformShareData([
      session("s1"),
      message("m1"),
      { type: "session_diff", data: {} },
      { type: "model", data: {} },
    ])
    expect(result?.messages).toHaveLength(1)
  })

  test("drops parts whose messageID doesn't match any known message", () => {
    const result = transformShareData([session("s1"), message("m1"), part("orphan", "does-not-exist")])
    expect(result?.messages).toHaveLength(1)
    expect(result?.messages[0].parts).toEqual([])
  })
})
