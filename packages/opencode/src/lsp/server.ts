import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import type { App } from "../app/app"
import path from "path"
import { Global } from "../global"
import { Log } from "../util/log"
import { BunProc } from "../bun"

export namespace LSPServer {
  const log = Log.create({ service: "lsp.server" })

  export interface Handle {
    process: ChildProcessWithoutNullStreams
    initialization?: Record<string, any>
  }

  export interface Info {
    id: string
    extensions: string[]
    spawn(app: App.Info): Promise<Handle | undefined>
  }

  export const All: Info[] = [
    {
      id: "typescript",
      extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".mts",
        ".cts",
      ],
      async spawn(app) {
        const tsserver = await Bun.resolve(
          "typescript/lib/tsserver.js",
          app.path.cwd,
        ).catch(() => {})
        if (!tsserver) return
        const proc = spawn(
          BunProc.which(),
          ["x", "typescript-language-server", "--stdio"],
          {
            env: {
              ...process.env,
              BUN_BE_BUN: "1",
            },
          },
        )
        return {
          process: proc,
          initialization: {
            tsserver: {
              path: tsserver,
            },
          },
        }
      },
    },
    {
      id: "golang",
      extensions: [".go"],
      async spawn() {
        let bin = Bun.which("gopls", {
          PATH: process.env["PATH"] + ":" + Global.Path.bin,
        })
        if (!bin) {
          log.info("installing gopls")
          const proc = Bun.spawn({
            cmd: ["go", "install", "golang.org/x/tools/gopls@latest"],
            env: { ...process.env, GOBIN: Global.Path.bin },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            log.error("Failed to install gopls")
            return
          }
          bin = path.join(
            Global.Path.bin,
            "gopls" + (process.platform === "win32" ? ".exe" : ""),
          )
          log.info(`installed gopls`, {
            bin,
          })
        }
        return {
          process: spawn(bin!),
        }
      },
    },
    {
      id: "java",
      extensions: [".java"],
      async spawn() {
        let bin = Bun.which("jdtls", {
          PATH: process.env["PATH"] + ":" + Global.Path.bin,
        })
        if (!bin) {
          log.info("jdtls not found - please install Eclipse JDT Language Server")
          return
        }
        return {
          process: spawn(bin),
        }
      },
    },
    {
      id: "python",
      extensions: [".py", ".pyi", ".pyx"],
      async spawn() {
        let bin = Bun.which("pyright-langserver", {
          PATH: process.env["PATH"] + ":" + Global.Path.bin,
        })
        if (!bin) {
          bin = Bun.which("pylsp", {
            PATH: process.env["PATH"] + ":" + Global.Path.bin,
          })
        }
        if (!bin) {
          log.info("installing pyright")
          const proc = Bun.spawn({
            cmd: ["npm", "install", "-g", "pyright"],
            env: { ...process.env, PREFIX: Global.Path.bin.replace("/bin", "") },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            log.error("Failed to install pyright")
            return
          }
          bin = path.join(
            Global.Path.bin,
            "pyright-langserver" + (process.platform === "win32" ? ".cmd" : ""),
          )
          log.info(`installed pyright`, {
            bin,
          })
        }
        return {
          process: spawn(bin!, ["--stdio"]),
        }
      },
    },
    {
      id: "php",
      extensions: [".php", ".phtml", ".php3", ".php4", ".php5", ".phps"],
      async spawn() {
        let bin = Bun.which("intelephense", {
          PATH: process.env["PATH"] + ":" + Global.Path.bin,
        })
        if (!bin) {
          log.info("installing intelephense")
          const proc = Bun.spawn({
            cmd: ["npm", "install", "-g", "intelephense"],
            env: { ...process.env, PREFIX: Global.Path.bin.replace("/bin", "") },
            stdout: "pipe",
            stderr: "pipe",
            stdin: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            log.error("Failed to install intelephense")
            return
          }
          bin = path.join(
            Global.Path.bin,
            "intelephense" + (process.platform === "win32" ? ".cmd" : ""),
          )
          log.info(`installed intelephense`, {
            bin,
          })
        }
        return {
          process: spawn(bin!, ["--stdio"]),
        }
      },
    },
    {
      id: "csharp",
      extensions: [".cs", ".csx"],
      async spawn() {
        let bin = Bun.which("omnisharp", {
          PATH: process.env["PATH"] + ":" + Global.Path.bin,
        })
        if (!bin) {
          bin = Bun.which("OmniSharp", {
            PATH: process.env["PATH"] + ":" + Global.Path.bin,
          })
        }
        if (!bin) {
          log.info("OmniSharp not found - please install OmniSharp language server")
          return
        }
        return {
          process: spawn(bin, ["-lsp"]),
        }
      },
    },
  ]
}
