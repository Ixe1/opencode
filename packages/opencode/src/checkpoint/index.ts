import { z } from "zod"
import { App } from "../app/app"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import * as path from "node:path"
import * as os from "node:os"
import * as crypto from "node:crypto"
import * as fs from "node:fs/promises"

export namespace Checkpoint {
  const log = Log.create({ service: "checkpoint" })

  export const Info = z.object({
    id: z.string(),
    sessionID: Identifier.schema("session"),
    messageID: Identifier.schema("message"),
    commitHash: z.string(),
    branch: z.string(),
    message: z.string(),
    files: z.array(z.string()),
    projectPath: z.string(),
    shadowRepoPath: z.string(),
    conversationSnapshot: z.any().optional(),
    toolCall: z.any().optional(),
    time: z.object({
      created: z.number(),
    }),
  })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Created: Bus.event(
      "checkpoint.created",
      z.object({
        checkpoint: Info,
      }),
    ),
    Restored: Bus.event(
      "checkpoint.restored",
      z.object({
        checkpoint: Info,
      }),
    ),
  }

  const state = App.state("checkpoint", () => {
    const checkpoints = new Map<string, Info[]>()
    const shadowRepos = new Map<string, string>()
    return {
      checkpoints,
      shadowRepos,
    }
  })

  async function getShadowRepoPath(projectPath: string): Promise<string> {
    const checkpointState = state()

    // Check if we already have a shadow repo for this project
    const existing = checkpointState.shadowRepos.get(projectPath)
    if (existing) {
      return existing
    }

    // Create a hash of the project path for the shadow repo directory
    const projectHash = crypto
      .createHash("sha256")
      .update(projectPath)
      .digest("hex")
      .substring(0, 16)

    const shadowRepoPath = path.join(
      os.homedir(),
      ".opencode",
      "history",
      projectHash,
    )

    // Ensure the shadow repo directory exists
    await fs.mkdir(shadowRepoPath, { recursive: true })

    // Initialize git repo if it doesn't exist
    try {
      await fs.access(path.join(shadowRepoPath, ".git"))
    } catch {
      const initProcess = Bun.spawn({
        cmd: ["git", "init"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await initProcess.exited

      // Configure git user for the shadow repo
      const configNameProcess = Bun.spawn({
        cmd: ["git", "config", "user.name", "opencode checkpoint"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await configNameProcess.exited

      const configEmailProcess = Bun.spawn({
        cmd: ["git", "config", "user.email", "checkpoint@opencode.ai"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await configEmailProcess.exited
    }

    checkpointState.shadowRepos.set(projectPath, shadowRepoPath)
    return shadowRepoPath
  }

  async function copyProjectToShadow(
    projectPath: string,
    shadowRepoPath: string,
    files: string[],
  ): Promise<void> {
    // Clear the shadow repo (except .git)
    const entries = await fs.readdir(shadowRepoPath)
    for (const entry of entries) {
      if (entry !== ".git") {
        const entryPath = path.join(shadowRepoPath, entry)
        const stat = await fs.stat(entryPath)
        if (stat.isDirectory()) {
          await fs.rm(entryPath, { recursive: true })
        } else {
          await fs.unlink(entryPath)
        }
      }
    }

    // Copy all tracked files to shadow repo
    for (const file of files) {
      const srcPath = path.join(projectPath, file)
      const destPath = path.join(shadowRepoPath, file)

      // Ensure destination directory exists
      await fs.mkdir(path.dirname(destPath), { recursive: true })

      try {
        await fs.copyFile(srcPath, destPath)
      } catch (error) {
        log.warn("failed to copy file to shadow repo", { file, error })
      }
    }
  }

  export async function create(input: {
    sessionID: string
    messageID: string
    description: string
    conversationSnapshot?: any
    toolCall?: any
  }): Promise<Info | undefined> {
    const app = App.info()
    if (!app.git) {
      log.info("skipping checkpoint - not a git repository")
      return undefined
    }

    const {
      sessionID,
      messageID,
      description,
      conversationSnapshot,
      toolCall,
    } = input
    const projectPath = app.path.root

    try {
      // Get list of all tracked files in the project
      const lsFilesProcess = Bun.spawn({
        cmd: ["git", "ls-files"],
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await lsFilesProcess.exited
      const lsFilesOutput = await new Response(lsFilesProcess.stdout).text()
      const trackedFiles = lsFilesOutput.trim().split("\n").filter(Boolean)

      // Get current branch
      const branchProcess = Bun.spawn({
        cmd: ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await branchProcess.exited
      const branchOutput = await new Response(branchProcess.stdout).text()
      const branch = branchOutput.trim()

      // Get shadow repo path
      const shadowRepoPath = await getShadowRepoPath(projectPath)

      // Copy project files to shadow repo
      await copyProjectToShadow(projectPath, shadowRepoPath, trackedFiles)

      // Stage all files in shadow repo
      const addProcess = Bun.spawn({
        cmd: ["git", "add", "-A"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await addProcess.exited

      // Create checkpoint commit in shadow repo
      const checkpointId = `chk_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      const message = `[opencode checkpoint] ${description}\n\nCheckpoint ID: ${checkpointId}\nSession: ${sessionID}\nMessage: ${messageID}`

      const commitProcess = Bun.spawn({
        cmd: ["git", "commit", "-m", message, "--allow-empty"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await commitProcess.exited

      // Get commit hash from shadow repo
      const hashProcess = Bun.spawn({
        cmd: ["git", "rev-parse", "HEAD"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await hashProcess.exited
      const hashOutput = await new Response(hashProcess.stdout).text()
      const commitHash = hashOutput.trim()

      const checkpoint: Info = {
        id: checkpointId,
        sessionID,
        messageID,
        commitHash,
        branch,
        message: description,
        files: trackedFiles,
        projectPath,
        shadowRepoPath,
        conversationSnapshot,
        toolCall,
        time: {
          created: Date.now(),
        },
      }

      // Store checkpoint metadata
      const checkpointState = state()
      const sessionCheckpoints =
        checkpointState.checkpoints.get(sessionID) || []
      sessionCheckpoints.push(checkpoint)
      checkpointState.checkpoints.set(sessionID, sessionCheckpoints)

      // Save checkpoint metadata to file in shadow repo
      const metadataPath = path.join(
        shadowRepoPath,
        ".opencode",
        "checkpoints",
        `${checkpointId}.json`,
      )
      await fs.mkdir(path.dirname(metadataPath), { recursive: true })
      await fs.writeFile(metadataPath, JSON.stringify(checkpoint, null, 2))

      Bus.publish(Event.Created, { checkpoint })
      log.info("checkpoint created in shadow repo", {
        checkpointId,
        commitHash,
        files: trackedFiles.length,
        shadowRepoPath,
      })

      return checkpoint
    } catch (error) {
      log.error("failed to create checkpoint", { error })
      return undefined
    }
  }

  export async function restore(checkpointId: string): Promise<boolean> {
    const app = App.info()
    if (!app.git) {
      throw new Error("Not a git repository")
    }

    const checkpointState = state()
    const projectPath = app.path.root

    // Find the checkpoint
    let checkpoint: Info | undefined
    for (const [_, checkpoints] of checkpointState.checkpoints) {
      checkpoint = checkpoints.find((cp) => cp.id === checkpointId)
      if (checkpoint) break
    }

    if (!checkpoint) {
      throw new Error(`Checkpoint ${checkpointId} not found`)
    }

    try {
      // Check for uncommitted changes in the main repo
      const statusProcess = Bun.spawn({
        cmd: ["git", "status", "--porcelain"],
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await statusProcess.exited
      const statusOutput = await new Response(statusProcess.stdout).text()

      if (statusOutput.trim()) {
        throw new Error(
          "Cannot restore checkpoint: uncommitted changes in working directory",
        )
      }

      // Checkout the checkpoint commit in shadow repo
      const checkoutProcess = Bun.spawn({
        cmd: ["git", "checkout", checkpoint.commitHash],
        cwd: checkpoint.shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await checkoutProcess.exited

      // Copy files from shadow repo back to project
      for (const file of checkpoint.files) {
        const srcPath = path.join(checkpoint.shadowRepoPath, file)
        const destPath = path.join(projectPath, file)

        try {
          await fs.copyFile(srcPath, destPath)
        } catch (error) {
          log.warn("failed to restore file from shadow repo", { file, error })
        }
      }

      Bus.publish(Event.Restored, { checkpoint })
      log.info("checkpoint restored from shadow repo", {
        checkpointId: checkpoint.id,
        commitHash: checkpoint.commitHash,
      })

      return true
    } catch (error) {
      log.error("failed to restore checkpoint", { error })
      throw new Error(`Failed to restore checkpoint: ${error}`)
    }
  }

  export function list(sessionID?: string): Info[] {
    const checkpointState = state()

    if (sessionID) {
      return checkpointState.checkpoints.get(sessionID) || []
    }

    // Return all checkpoints across all sessions
    const allCheckpoints: Info[] = []
    for (const [_, checkpoints] of checkpointState.checkpoints) {
      allCheckpoints.push(...checkpoints)
    }

    // Sort by creation time, newest first
    return allCheckpoints.sort((a, b) => b.time.created - a.time.created)
  }

  export function clear(sessionID: string): void {
    const checkpointState = state()
    checkpointState.checkpoints.delete(sessionID)
  }

  export async function getCheckpointMetadata(
    shadowRepoPath: string,
  ): Promise<Info[]> {
    try {
      const metadataDir = path.join(shadowRepoPath, ".opencode", "checkpoints")
      const files = await fs.readdir(metadataDir)
      const checkpoints: Info[] = []

      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(
            path.join(metadataDir, file),
            "utf-8",
          )
          const checkpoint = JSON.parse(content) as Info
          checkpoints.push(checkpoint)
        }
      }

      return checkpoints.sort((a, b) => b.time.created - a.time.created)
    } catch {
      return []
    }
  }
}
