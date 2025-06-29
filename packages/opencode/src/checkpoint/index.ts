import { z } from "zod"
import { App } from "../app/app"
import { Log } from "../util/log"
import { Bus } from "../bus"
import { Identifier } from "../id/id"
import * as path from "node:path"
import * as os from "node:os"
import * as crypto from "node:crypto"
import * as fs from "node:fs/promises"
import { Filesystem } from "../util/filesystem"
import { Storage } from "../storage/storage"
import { Config } from "../config/config"

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

  async function loadPersistedCheckpoints(
    checkpoints: Map<string, Info[]>,
    shadowRepos: Map<string, string>
  ) {
    try {
      const data = await Storage.readJSON<{
        checkpoints: [string, Info[]][]
        shadowRepos: [string, string][]
      }>("checkpoints")
      
      // Restore checkpoints map
      for (const [key, value] of data.checkpoints) {
        checkpoints.set(key, value)
      }
      
      // Restore shadow repos map
      for (const [key, value] of data.shadowRepos) {
        shadowRepos.set(key, value)
      }
      
      log.info("loaded persisted checkpoints", {
        checkpointCount: data.checkpoints.length,
        shadowRepoCount: data.shadowRepos.length
      })
    } catch (error) {
      // No persisted checkpoints or error loading them
      log.info("no persisted checkpoints found")
    }
  }

  async function persistCheckpoints() {
    const checkpointState = state()
    const data = {
      checkpoints: Array.from(checkpointState.checkpoints.entries()),
      shadowRepos: Array.from(checkpointState.shadowRepos.entries())
    }
    
    await Storage.writeJSON("checkpoints", data)
    log.info("persisted checkpoints", {
      checkpointCount: data.checkpoints.length,
      shadowRepoCount: data.shadowRepos.length
    })
  }

  async function cleanupOldCheckpoints(sessionID: string, projectPath: string) {
    const config = await Config.get()
    const maxCheckpoints = config.checkpointing?.maxCheckpoints || 150
    
    const checkpointState = state()
    const sessionCheckpoints = checkpointState.checkpoints.get(sessionID) || []
    
    if (sessionCheckpoints.length <= maxCheckpoints) {
      return
    }
    
    // Sort by creation time (oldest first)
    const sortedCheckpoints = [...sessionCheckpoints].sort(
      (a, b) => a.time.created - b.time.created
    )
    
    // Calculate how many to remove
    const toRemove = sortedCheckpoints.length - maxCheckpoints
    const checkpointsToRemove = sortedCheckpoints.slice(0, toRemove)
    
    log.info("cleaning up old checkpoints", {
      total: sortedCheckpoints.length,
      maxAllowed: maxCheckpoints,
      removing: toRemove
    })
    
    // Remove from shadow repo
    const shadowRepoPath = checkpointState.shadowRepos.get(projectPath)
    if (shadowRepoPath) {
      for (const checkpoint of checkpointsToRemove) {
        try {
          // Remove the commit from git history (this is complex, so we'll just log for now)
          log.info("would remove checkpoint from shadow repo", {
            checkpointId: checkpoint.id,
            commitHash: checkpoint.commitHash
          })
          // TODO: Implement git history rewriting to remove old commits
        } catch (error) {
          log.warn("failed to remove checkpoint from shadow repo", {
            checkpointId: checkpoint.id,
            error
          })
        }
      }
    }
    
    // Remove from state
    const remainingCheckpoints = sortedCheckpoints.slice(toRemove)
    checkpointState.checkpoints.set(sessionID, remainingCheckpoints)
    
    // Persist the updated state
    await persistCheckpoints()
  }

  async function runGitGC(shadowRepoPath: string) {
    try {
      log.info("running git gc on shadow repo", { shadowRepoPath })
      
      const gcProcess = Bun.spawn({
        cmd: ["git", "gc", "--auto"],
        cwd: shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      
      // Don't wait for it to complete - let it run in background
      gcProcess.exited.then(() => {
        log.info("git gc completed", { shadowRepoPath })
      }).catch((error) => {
        log.warn("git gc failed", { shadowRepoPath, error })
      })
    } catch (error) {
      log.warn("failed to start git gc", { shadowRepoPath, error })
    }
  }

  const state = App.state("checkpoint", () => {
    const checkpoints = new Map<string, Info[]>()
    const shadowRepos = new Map<string, string>()
    
    // Load persisted checkpoints on startup
    loadPersistedCheckpoints(checkpoints, shadowRepos)
    
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

  export async function isFileTracked(
    filePath: string,
    projectPath: string,
  ): Promise<boolean> {
    try {
      const relativePath = path.relative(projectPath, filePath)
      const checkProcess = Bun.spawn({
        cmd: ["git", "ls-files", "--error-unmatch", relativePath],
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await checkProcess.exited
      return checkProcess.exitCode === 0
    } catch {
      return false
    }
  }

  export async function findGitRoot(filePath: string): Promise<string | undefined> {
    const dir = path.dirname(filePath)
    const gitPath = await Filesystem.findUp(".git", dir)
    if (gitPath && gitPath.length > 0) {
      return path.dirname(gitPath[0])
    }
    return undefined
  }

  export async function stageFile(
    filePath: string,
    projectPath: string,
  ): Promise<boolean> {
    try {
      const relativePath = path.relative(projectPath, filePath)
      const addProcess = Bun.spawn({
        cmd: ["git", "add", relativePath],
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await addProcess.exited
      if (addProcess.exitCode === 0) {
        log.info("staged file for checkpointing", { file: relativePath })
        return true
      } else {
        log.warn("failed to stage file", { file: relativePath, exitCode: addProcess.exitCode })
        return false
      }
    } catch (error) {
      log.error("error staging file", { file: filePath, error })
      return false
    }
  }

  export async function create(input: {
    sessionID: string
    messageID: string
    description: string
    conversationSnapshot?: any
    toolCall?: any
    gitRoot?: string
  }): Promise<Info | undefined> {
    const app = App.info()
    
    // Use provided gitRoot or fall back to app's git root
    const projectPath = input.gitRoot || (app.git ? app.path.root : undefined)
    
    if (!projectPath) {
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
      
      // Always create a checkpoint when requested, even if git status shows no changes
      // This is important for newly staged files where the shadow repo might be in sync
      // We used to check for changes here, but that caused issues with newly staged files

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
      
      // Persist checkpoints to storage
      await persistCheckpoints()
      
      // Clean up old checkpoints if we exceed the limit
      await cleanupOldCheckpoints(sessionID, projectPath)
      
      // Run git gc periodically (every 50 checkpoints)
      if (sessionCheckpoints.length % 50 === 0) {
        runGitGC(shadowRepoPath)
      }

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
      // Checkout the checkpoint commit in shadow repo
      const checkoutProcess = Bun.spawn({
        cmd: ["git", "checkout", checkpoint.commitHash],
        cwd: checkpoint.shadowRepoPath,
        stdout: "pipe",
        stderr: "pipe",
      })
      await checkoutProcess.exited

      // Copy files from shadow repo back to project
      log.info("starting file restoration", {
        fileCount: checkpoint.files.length,
        files: checkpoint.files,
        shadowRepoPath: checkpoint.shadowRepoPath,
        projectPath: checkpoint.projectPath
      })
      
      for (const file of checkpoint.files) {
        const srcPath = path.join(checkpoint.shadowRepoPath, file)
        const destPath = path.join(checkpoint.projectPath, file)

        try {
          log.info("restoring file", { file, srcPath, destPath })
          await fs.copyFile(srcPath, destPath)
          log.info("file restored successfully", { file })
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
      const sessionCheckpoints = checkpointState.checkpoints.get(sessionID) || []
      // Sort by creation time, newest first
      return sessionCheckpoints.sort((a, b) => b.time.created - a.time.created)
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
