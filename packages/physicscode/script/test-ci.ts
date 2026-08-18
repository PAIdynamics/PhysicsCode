#!/usr/bin/env bun

import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

// Runs `bun test` directly via Bun.spawn instead of a package.json shell
// string, so this works identically on Windows/macOS/Linux. Package.json
// script strings go through Bun's own cross-platform shell, which does not
// support the `> file 2>&1; code=$?; ...` redirection/chaining needed to
// capture the coverage report to a file while still propagating bun test's
// exit code.

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

const unitDir = path.join(dir, ".artifacts", "unit")
const coverageDir = path.join(dir, ".artifacts", "coverage")
fs.mkdirSync(unitDir, { recursive: true })
fs.mkdirSync(coverageDir, { recursive: true })

const summaryPath = path.join(coverageDir, "summary.txt")

const proc = Bun.spawn(
  [
    "bun",
    "test",
    "--timeout",
    "30000",
    "--reporter=junit",
    `--reporter-outfile=${path.join(unitDir, "junit.xml")}`,
    "--coverage",
    "--coverage-reporter=text",
  ],
  {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  },
)

const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
const combined = stdout + stderr

process.stdout.write(combined)
fs.writeFileSync(summaryPath, combined)

const code = await proc.exited
process.exit(code)
