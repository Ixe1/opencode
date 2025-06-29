import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { App } from "../app/app"
import { PathValidation } from "../util/path-validation"

const MAX_READ_SIZE = 250 * 1024
const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000

export const ReadTool = Tool.define({
  id: "read",
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z
      .number()
      .describe("The line number to start reading from (0-based)")
      .optional(),
    limit: z
      .number()
      .describe("The number of lines to read (defaults to 2000)")
      .optional(),
  }),
  async execute(params, ctx) {
    let filePath = params.filePath
    
    // Check for relative paths and throw error
    if (PathValidation.isRelativePath(filePath)) {
      throw new Error(PathValidation.getRelativePathError(filePath))
    }

    const file = Bun.file(filePath)
    if (!(await file.exists())) {
      // Use the new path validation utility for better suggestions
      const errorMsg = await PathValidation.getPathNotFoundError(filePath)
      throw new Error(errorMsg)
    }
    const stats = await file.stat()

    if (stats.size > MAX_READ_SIZE)
      throw new Error(
        `File is too large (${stats.size} bytes). Maximum size is ${MAX_READ_SIZE} bytes`,
      )
    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0
    const isImage = isImageFile(filePath)
    if (isImage)
      throw new Error(
        `This is an image file of type: ${isImage}\nUse a different tool to process images`,
      )
    const lines = await file.text().then((text) => text.split("\n"))
    const raw = lines.slice(offset, offset + limit).map((line) => {
      return line.length > MAX_LINE_LENGTH
        ? line.substring(0, MAX_LINE_LENGTH) + "..."
        : line
    })
    const content = raw.map((line, index) => {
      return `${(index + offset + 1).toString().padStart(5, "0")}| ${line}`
    })
    const preview = raw.slice(0, 20).join("\n")

    let output = "<file>\n"
    output += content.join("\n")

    if (lines.length > offset + content.length) {
      output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${
        offset + content.length
      })`
    }
    output += "\n</file>"

    // just warms the lsp client
    await LSP.touchFile(filePath, true)
    FileTime.read(ctx.sessionID, filePath)

    return {
      output,
      metadata: {
        preview,
        title: path.relative(App.info().path.root, filePath),
      },
    }
  },
})

function isImageFile(filePath: string): string | false {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "JPEG"
    case ".png":
      return "PNG"
    case ".gif":
      return "GIF"
    case ".bmp":
      return "BMP"
    case ".svg":
      return "SVG"
    case ".webp":
      return "WebP"
    default:
      return false
  }
}
