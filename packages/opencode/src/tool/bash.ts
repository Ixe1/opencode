import { z } from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./bash.txt"
import { Session } from "../session"

const MAX_OUTPUT_LENGTH = 30000
const BANNED_COMMANDS = [
  "alias",
  "curl",
  "curlie",
  "wget",
  "axel",
  "aria2c",
  "nc",
  "telnet",
  "lynx",
  "w3m",
  "links",
  "httpie",
  "xh",
  "http-prompt",
  "chrome",
  "firefox",
  "safari",
]
const DEFAULT_TIMEOUT = 1 * 60 * 1000
const MAX_TIMEOUT = 10 * 60 * 1000

export const BashTool = Tool.define({
  id: "bash",
  description: DESCRIPTION,
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z
      .number()
      .min(0)
      .max(MAX_TIMEOUT)
      .describe("Optional timeout in milliseconds")
      .optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    // Check if we're in planning mode
    const session = await Session.get(ctx.sessionID)
    if (session.mode === "planning") {
      // Allow read-only commands in planning mode
      const readOnlyCommands = [
        "ls",
        "find",
        "grep",
        "cat",
        "head",
        "tail",
        "wc",
        "du",
        "df",
        "git status",
        "git log",
        "git diff",
        "git branch",
        "git remote",
        "pwd",
        "whoami",
        "date",
        "echo",
        "which",
        "type",
        "file",
        "npm list",
        "yarn list",
        "pip list",
        "gem list",
        "node --version",
        "python --version",
        "ruby --version",
      ]

      const isReadOnly = readOnlyCommands.some(
        (cmd) => params.command.startsWith(cmd) || params.command === cmd,
      )

      if (!isReadOnly) {
        throw new Error(
          "Cannot execute write/modify commands in planning mode. Only read-only commands are allowed. Please present your plan first and wait for approval before making any system changes.",
        )
      }
    }

    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    if (BANNED_COMMANDS.some((item) => params.command.startsWith(item)))
      throw new Error(`Command '${params.command}' is not allowed`)

    const process = Bun.spawn({
      cmd: ["bash", "-c", params.command],
      maxBuffer: MAX_OUTPUT_LENGTH,
      signal: ctx.abort,
      timeout: timeout,
      stdout: "pipe",
      stderr: "pipe",
    })
    await process.exited
    const stdout = await new Response(process.stdout).text()
    const stderr = await new Response(process.stderr).text()

    return {
      metadata: {
        stderr,
        stdout,
        exit: process.exitCode,
        description: params.description,
        title: params.command,
      },
      output: [
        `<stdout>`,
        stdout ?? "",
        `</stdout>`,
        `<stderr>`,
        stderr ?? "",
        `</stderr>`,
      ].join("\n"),
    }
  },
})
