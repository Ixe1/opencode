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
import { Log } from "../util/log"
import { PathValidation } from "../util/path-validation"

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

    // Check for relative paths and throw error
    if (PathValidation.isRelativePath(params.filePath)) {
      throw new Error(PathValidation.getRelativePathError(params.filePath))
    }

    const app = App.info()
    const filepath = params.filePath

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
    let checkpointMessage = ""
    const config = await Config.get()
    if (config.checkpointing?.enabled) {
      // Find the git root for this specific file
      const gitRoot = await Checkpoint.findGitRoot(filepath)
      if (gitRoot) {
        if (exists) {
          // For existing files, check if tracked
          const isTracked = await Checkpoint.isFileTracked(filepath, gitRoot)
          if (isTracked) {
            const relativePath = path.relative(gitRoot, filepath)
            const contentPreview = params.content.split('\n')[0].substring(0, 50)
            const description = `Overwrite ${relativePath}: "${contentPreview}${params.content.length > 50 ? '...' : ''}"`
            
            const checkpoint = await Checkpoint.create({
              sessionID: ctx.sessionID,
              messageID: ctx.messageID,
              description,
              gitRoot,
              toolCall: {
                tool: "write",
                params: params,
              },
            })
            
            if (checkpoint) {
              checkpointMessage = `\n<checkpoint>\n✓ Checkpoint created: ${description}\n</checkpoint>\n`
            }
          } else {
            // Try to stage the file first
            const staged = await Checkpoint.stageFile(filepath, gitRoot)
            if (staged) {
              const relativePath = path.relative(gitRoot, filepath)
              const description = `Overwrite ${relativePath} (auto-staged)`
              
              const checkpoint = await Checkpoint.create({
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                description,
                gitRoot,
                toolCall: {
                  tool: "write",
                  params: params,
                },
              })
              
              if (checkpoint) {
                checkpointMessage = `\n<checkpoint>\n✓ Checkpoint created: ${description}\n</checkpoint>\n`
              }
            } else {
              Log.create({ service: "write" }).info(
                "skipping checkpoint - file is not tracked and could not be staged",
                { file: filepath },
              )
            }
          }
        }
        // For new files, we'll stage them after creation
      } else {
        Log.create({ service: "write" }).info(
          "skipping checkpoint - file is not in a git repository",
          { file: filepath },
        )
      }
    }

    await Bun.write(filepath, params.content)
    await Bus.publish(File.Event.Edited, {
      file: filepath,
    })
    FileTime.read(ctx.sessionID, filepath)

    // If checkpointing is enabled and this is a new file, stage it and create initial checkpoint
    if (config.checkpointing?.enabled && !exists) {
      const gitRoot = await Checkpoint.findGitRoot(filepath)
      if (gitRoot) {
        const staged = await Checkpoint.stageFile(filepath, gitRoot)
        if (staged) {
          const relativePath = path.relative(gitRoot, filepath)
          const description = `Create ${relativePath} (auto-staged)`
          
          const checkpoint = await Checkpoint.create({
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            description,
            gitRoot,
            toolCall: {
              tool: "write",
              params: params,
            },
          })
          
          if (checkpoint && !checkpointMessage) {
            checkpointMessage = `\n<checkpoint>\n✓ Checkpoint created: ${description}\n</checkpoint>\n`
          }
        }
      }
    }

    let output = checkpointMessage
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
