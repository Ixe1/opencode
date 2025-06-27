import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { Permission } from "../permission"
import DESCRIPTION from "./write.txt"
import { App } from "../app/app"
import { Checkpoint } from "../checkpoint"
import { Config } from "../config/config"
import { Bus } from "../bus"
import { File } from "../file"
import { FileTime } from "../file/time"
import { Session } from "../session"

export const WriteTool = Tool.define({
  id: "write",
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z
      .string()
      .describe(
        "The absolute path to the file to write (must be absolute, not relative)",
      ),
    content: z.string().describe("The content to write to the file"),
  }),
  async execute(params, ctx) {
    // Check if we're in planning mode
    const session = await Session.get(ctx.sessionID)
    if (session.mode === "planning") {
      throw new Error(
        "Cannot write files in planning mode. Please present your plan first and wait for approval before making any file changes.",
      )
    }

    const app = App.info()
    const filepath = path.isAbsolute(params.filePath)
      ? params.filePath
      : path.join(app.path.cwd, params.filePath)

    const file = Bun.file(filepath)
    const exists = await file.exists()
    if (exists) await FileTime.assert(ctx.sessionID, filepath)

    await Permission.ask({
      id: "write",
      sessionID: ctx.sessionID,
      title: exists
        ? "Overwrite this file: " + filepath
        : "Create new file: " + filepath,
      metadata: {
        filePath: filepath,
        content: params.content,
        exists,
      },
    })

    // Create checkpoint before modifying the file (if enabled)
    const config = await Config.get()
    if (config.checkpointing?.enabled) {
      await Checkpoint.create({
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        description: exists
          ? `Overwriting ${path.basename(filepath)}`
          : `Creating ${path.basename(filepath)}`,
        toolCall: {
          tool: "write",
          params: params,
        },
      })
    }

    await Bun.write(filepath, params.content)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })
    FileTime.read(ctx.sessionID, filepath)

    let output = ""
    await LSP.touchFile(filepath, true)
    const diagnostics = await LSP.diagnostics()
    for (const [file, issues] of Object.entries(diagnostics)) {
      if (issues.length === 0) continue
      if (file === filepath) {
        output += `\nThis file has errors, please fix\n<file_diagnostics>\n${issues.map(LSP.Diagnostic.pretty).join("\n")}\n</file_diagnostics>\n`
        continue
      }
      output += `\n<project_diagnostics>\n${file}\n${issues.map(LSP.Diagnostic.pretty).join("\n")}\n</project_diagnostics>\n`
    }

    return {
      metadata: {
        diagnostics,
        filepath,
        exists: exists,
        title: path.relative(app.path.root, filepath),
      },
      output,
    }
  },
})
