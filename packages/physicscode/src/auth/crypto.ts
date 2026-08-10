import { createCipheriv, createDecipheriv, randomBytes } from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const PREFIX = "v1:"

export const KEY_LENGTH = 32

export function generateKey() {
  return randomBytes(KEY_LENGTH)
}

export function encrypt(plaintext: string, key: Buffer) {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64")
}

export function decrypt(envelope: string, key: Buffer) {
  const raw = Buffer.from(envelope.slice(PREFIX.length), "base64")
  const iv = raw.subarray(0, IV_LENGTH)
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX)
}
