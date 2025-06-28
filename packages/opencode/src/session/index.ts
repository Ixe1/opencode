import path from "path"
import { App } from "../app/app"
import { Identifier } from "../id/id"
import { Storage } from "../storage/storage"
import { Log } from "../util/log"
import {
  generateText,
  LoadAPIKeyError,
  convertToCoreMessages,
  streamText,
  tool,
  type Tool as AITool,
  type LanguageModelUsage,
  type CoreMessage,
  type UIMessage,
  type ProviderMetadata,
  wrapLanguageModel,
} from "ai"
import { z, ZodSchema } from "zod"
import { Decimal } from "decimal.js"

import PROMPT_INITIALIZE from "../session/prompt/initialize.txt"

import { Share } from "../share/share"
import { Message } from "./message"
import { Bus } from "../bus"
import { Provider } from "../provider/provider"
import { MCP } from "../mcp"
import { NamedError } from "../util/error"
import type { Tool } from "../tool/tool"
import { SystemPrompt } from "./system"
import { Flag } from "../flag/flag"
import type { ModelsDev } from "../provider/models"
import { Installation } from "../installation"
import { Config } from "../config/config"
import { ProviderTransform } from "../provider/transform"

export namespace Session {
  const log = Log.create({ service: "session" })

  export const Info = z
    .object({
      id: Identifier.schema("session"),
      parentID: Identifier.schema("session").optional(),
      share: z
        .object({
          url: z.string(),
        })
        .optional(),
      title: z.string(),
      version: z.string(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
      }),
      mode: z.enum(["normal", "planning", "review"]).default("normal"),
      lastPlan: z
        .object({
          plan: z.any(),
          status: z.enum(["pending", "approved", "rejected"]),
          timestamp: z.number(),
        })
        .optional(),
      reviewState: z
        .object({
          issues: z.array(z.any()),
          currentIndex: z.number(),
          fixed: z.array(z.string()),
          skipped: z.array(z.string()),
          timestamp: z.number(),
        })
        .optional(),
    })
    .openapi({
      ref: "Session",
    })
  export type Info = z.output<typeof Info>

  export const ShareInfo = z
    .object({
      secret: z.string(),
      url: z.string(),
    })
    .openapi({
      ref: "SessionShare",
    })
  export type ShareInfo = z.output<typeof ShareInfo>

  export const Event = {
    Updated: Bus.event(
      "session.updated",
      z.object({
        info: Info,
      }),
    ),
    Deleted: Bus.event(
      "session.deleted",
      z.object({
        info: Info,
      }),
    ),
    Idle: Bus.event(
      "session.idle",
      z.object({
        sessionID: z.string(),
      }),
    ),
    Error: Bus.event(
      "session.error",
      z.object({
        error: Message.ErrorSchema,
      }),
    ),
    ModeChanged: Bus.event(
      "session.mode.changed",
      z.object({
        sessionID: z.string(),
        mode: z.enum(["normal", "planning", "review"]),
      }),
    ),
  }

  const state = App.state(
    "session",
    () => {
      const sessions = new Map<string, Info>()
      const messages = new Map<string, Message.Info[]>()
      const pending = new Map<string, AbortController>()

      return {
        sessions,
        messages,
        pending,
      }
    },
    async (state) => {
      for (const [_, controller] of state.pending) {
        controller.abort()
      }
    },
  )

  export async function create(parentID?: string) {
    const result: Info = {
      id: Identifier.descending("session"),
      version: Installation.VERSION,
      parentID,
      title:
        (parentID ? "Child session - " : "New Session - ") +
        new Date().toISOString(),
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
      mode: "normal",
    }
    log.info("created", result)
    state().sessions.set(result.id, result)
    await Storage.writeJSON("session/info/" + result.id, result)
    const cfg = await Config.get()
    if (!result.parentID && (Flag.OPENCODE_AUTO_SHARE || cfg.autoshare))
      share(result.id).then((share) => {
        update(result.id, (draft) => {
          draft.share = share
        })
      })
    Bus.publish(Event.Updated, {
      info: result,
    })
    return result
  }

  export async function get(id: string) {
    const result = state().sessions.get(id)
    if (result) {
      return result
    }
    const read = await Storage.readJSON<Info>("session/info/" + id)
    state().sessions.set(id, read)
    return read as Info
  }

  export async function getShare(id: string) {
    return Storage.readJSON<ShareInfo>("session/share/" + id)
  }

  export async function share(id: string) {
    const session = await get(id)
    if (session.share) return session.share
    const share = await Share.create(id)
    await update(id, (draft) => {
      draft.share = {
        url: share.url,
      }
    })
    await Storage.writeJSON<ShareInfo>("session/share/" + id, share)
    await Share.sync("session/info/" + id, session)
    for (const msg of await messages(id)) {
      await Share.sync("session/message/" + id + "/" + msg.id, msg)
    }
    return share
  }

  export async function unshare(id: string) {
    await Storage.remove("session/share/" + id)
    await update(id, (draft) => {
      draft.share = undefined
    })
    await Share.remove(id)
  }

  export async function update(id: string, editor: (session: Info) => void) {
    const { sessions } = state()
    const session = await get(id)
    if (!session) return
    editor(session)
    session.time.updated = Date.now()
    sessions.set(id, session)
    await Storage.writeJSON("session/info/" + id, session)
    Bus.publish(Event.Updated, {
      info: session,
    })
    return session
  }

  export async function setMode(
    id: string,
    mode: "normal" | "planning" | "review",
  ) {
    const session = await update(id, (session) => {
      session.mode = mode
    })
    if (session) {
      Bus.publish(Event.ModeChanged, {
        sessionID: id,
        mode: mode,
      })
    }
    return session
  }

  export async function updateLastPlan(
    id: string,
    plan: any,
    status: "pending" | "approved" | "rejected",
  ) {
    const session = await update(id, (session) => {
      session.lastPlan = {
        plan: plan,
        status: status,
        timestamp: Date.now(),
      }
    })
    return session
  }

  export async function updateReviewState(
    id: string,
    reviewState: Partial<Info["reviewState"]>,
  ) {
    const session = await update(id, (session) => {
      if (!session.reviewState) {
        session.reviewState = {
          issues: [],
          currentIndex: 0,
          fixed: [],
          skipped: [],
          timestamp: Date.now(),
        }
      }
      Object.assign(session.reviewState, reviewState)
    })
    return session
  }

  export async function messages(sessionID: string) {
    const result = [] as Message.Info[]
    const list = Storage.list("session/message/" + sessionID)
    for await (const p of list) {
      const read = await Storage.readJSON<Message.Info>(p)
      result.push(read)
    }
    result.sort((a, b) => (a.id > b.id ? 1 : -1))
    return result
  }

  export async function getMessage(sessionID: string, messageID: string) {
    return Storage.readJSON<Message.Info>(
      "session/message/" + sessionID + "/" + messageID,
    )
  }

  export async function* list() {
    for await (const item of Storage.list("session/info")) {
      const sessionID = path.basename(item, ".json")
      yield get(sessionID)
    }
  }

  export async function children(parentID: string) {
    const result = [] as Session.Info[]
    for await (const item of Storage.list("session/info")) {
      const sessionID = path.basename(item, ".json")
      const session = await get(sessionID)
      if (session.parentID !== parentID) continue
      result.push(session)
    }
    return result
  }

  export function abort(sessionID: string) {
    const controller = state().pending.get(sessionID)
    if (!controller) return false
    controller.abort()
    state().pending.delete(sessionID)
    return true
  }

  export async function remove(sessionID: string, emitEvent = true) {
    try {
      abort(sessionID)
      const session = await get(sessionID)
      for (const child of await children(sessionID)) {
        await remove(child.id, false)
      }
      await unshare(sessionID).catch(() => {})
      await Storage.remove(`session/info/${sessionID}`).catch(() => {})
      await Storage.removeDir(`session/message/${sessionID}/`).catch(() => {})
      state().sessions.delete(sessionID)
      state().messages.delete(sessionID)
      if (emitEvent) {
        Bus.publish(Event.Deleted, {
          info: session,
        })
      }
    } catch (e) {
      log.error(e)
    }
  }

  function detectPlan(msg: Message.Info): boolean {
    if (msg.role !== "assistant") return false
    
    // Check if message contains plan markers
    const textContent = msg.parts
      .filter(p => p.type === "text")
      .map(p => p.text)
      .join("\n")
    
    // Must have both start and end markers for a valid plan
    const hasPlanStart = textContent.includes("## Plan:")
    const hasPlanEnd = textContent.includes("Would you like me to proceed with this implementation?") ||
                       textContent.includes("Would you like me to proceed?") ||
                       textContent.includes("Do you want me to proceed with this plan?")
    
    return hasPlanStart && hasPlanEnd
  }

  function extractPlanContent(msg: Message.Info): string {
    if (msg.role !== "assistant") return ""
    
    // Get full message content
    const textContent = msg.parts
      .filter(p => p.type === "text")
      .map(p => p.text)
      .join("\n")
    
    // Find plan start marker
    const planStartIndex = textContent.indexOf("## Plan:")
    if (planStartIndex === -1) return ""
    
    // Find plan end markers
    const endMarkers = [
      "Would you like me to proceed with this implementation?",
      "Would you like me to proceed?",
      "Do you want me to proceed with this plan?"
    ]
    
    let planEndIndex = -1
    for (const marker of endMarkers) {
      const index = textContent.indexOf(marker, planStartIndex)
      if (index !== -1) {
        planEndIndex = index + marker.length
        break
      }
    }
    
    if (planEndIndex === -1) return ""
    
    // Extract plan content between markers
    return textContent.substring(planStartIndex, planEndIndex).trim()
  }

  function detectClarificationQuestion(msg: Message.Info): boolean {
    if (msg.role !== "assistant") return false
    
    const textContent = msg.parts
      .filter(p => p.type === "text")
      .map(p => p.text)
      .join("\n")
    
    // Look for clarification indicators
    const clarificationIndicators = [
      "Before I create a plan, I need to clarify",
      "**Clarification needed:**",
      "I need to clarify a few things:",
      "Could you clarify",
      "Can you clarify",
    ]
    
    return clarificationIndicators.some(indicator => textContent.includes(indicator))
  }

  async function updateMessage(msg: Message.Info) {
    // Check if this is a plan or clarification question
    const session = await get(msg.metadata.sessionID)
    if (session.mode === "planning") {
      msg.metadata.planDetected = detectPlan(msg)
      if (msg.metadata.planDetected) {
        msg.metadata.planContent = extractPlanContent(msg)
      }
      msg.metadata.clarificationQuestion = detectClarificationQuestion(msg)
    }
    
    await Storage.writeJSON(
      "session/message/" + msg.metadata.sessionID + "/" + msg.id,
      msg,
    )
    Bus.publish(Message.Event.Updated, {
      info: msg,
    })
  }

  export async function chat(input: {
    sessionID: string
    providerID: string
    modelID: string
    parts: Message.Part[]
    system?: string[]
    tools?: Tool.Info[]
  }) {
    const l = log.clone().tag("session", input.sessionID)
    l.info("chatting")
    const model = await Provider.getModel(input.providerID, input.modelID)
    let msgs = await messages(input.sessionID)
    const previous = msgs.at(-1)

    // auto summarize if too long
    if (previous?.metadata.assistant) {
      const tokens =
        previous.metadata.assistant.tokens.input +
        previous.metadata.assistant.tokens.cache.read +
        previous.metadata.assistant.tokens.cache.write +
        previous.metadata.assistant.tokens.output
      if (
        model.info.limit.context &&
        tokens >
          Math.max(
            (model.info.limit.context - (model.info.limit.output ?? 0)) * 0.9,
            0,
          )
      ) {
        await summarize({
          sessionID: input.sessionID,
          providerID: input.providerID,
          modelID: input.modelID,
        })
        return chat(input)
      }
    }

    using abort = lock(input.sessionID)

    const lastSummary = msgs.findLast(
      (msg) => msg.metadata.assistant?.summary === true,
    )
    if (lastSummary) msgs = msgs.filter((msg) => msg.id >= lastSummary.id)

    const app = App.info()
    const session = await get(input.sessionID)
    if (msgs.length === 0 && !session.parentID) {
      generateText({
        maxTokens: input.providerID === "google" ? 1024 : 20,
        providerOptions: model.info.options,
        messages: [
          ...SystemPrompt.title(input.providerID).map(
            (x): CoreMessage => ({
              role: "system",
              content: x,
            }),
          ),
          ...convertToCoreMessages([
            {
              role: "user",
              content: "",
              parts: toParts(input.parts),
            },
          ]),
        ],
        model: model.language,
      })
        .then((result) => {
          if (result.text)
            return Session.update(input.sessionID, (draft) => {
              draft.title = result.text
            })
        })
        .catch(() => {})
    }
    const msg: Message.Info = {
      role: "user",
      id: Identifier.ascending("message"),
      parts: input.parts,
      metadata: {
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
        tool: {},
      },
    }
    await updateMessage(msg)
    msgs.push(msg)

    // Check if this is a /stats command
    const textPart = input.parts.find((part) => part.type === "text") as
      | Message.TextPart
      | undefined
    if (textPart && textPart.text.trim().toLowerCase() === "/stats") {
      return calculateAndReturnStats(
        input.sessionID,
        input.providerID,
        input.modelID,
        msgs,
      )
    }

    // Get session to check mode
    const sessionInfo = await get(input.sessionID)

    const system =
      input.system ??
      (sessionInfo.mode === "planning"
        ? SystemPrompt.planMode(input.providerID)
        : sessionInfo.mode === "review"
          ? SystemPrompt.reviewMode(input.providerID)
          : SystemPrompt.provider(input.providerID))
    system.push(...(await SystemPrompt.environment()))
    system.push(...(await SystemPrompt.custom()))

    // Add last plan context if in planning mode and a plan exists
    if (sessionInfo.mode === "planning" && sessionInfo.lastPlan) {
      const planStatus = sessionInfo.lastPlan.status
      const planContent = JSON.stringify(sessionInfo.lastPlan.plan, null, 2)
      system.push(
        `\n# Previous Plan Context\nThe user previously ${planStatus} the following plan:\n\`\`\`json\n${planContent}\n\`\`\`\n${planStatus === "rejected" ? "Please take this feedback into account when creating a new plan." : ""}`,
      )
    }

    const next: Message.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      metadata: {
        assistant: {
          system,
          path: {
            cwd: app.path.cwd,
            root: app.path.root,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
          modelID: input.modelID,
          providerID: input.providerID,
        },
        time: {
          created: Date.now(),
        },
        sessionID: input.sessionID,
        tool: {},
      },
    }
    await updateMessage(next)
    const tools: Record<string, AITool> = {}

    for (const item of await Provider.tools(
      input.providerID,
      sessionInfo.mode,
    )) {
      tools[item.id.replaceAll(".", "_")] = tool({
        id: item.id as any,
        description: item.description,
        parameters: item.parameters as ZodSchema,
        async execute(args, opts) {
          const start = Date.now()
          try {
            const result = await item.execute(args, {
              sessionID: input.sessionID,
              abort: abort.signal,
              messageID: next.id,
              metadata: async (val) => {
                next.metadata.tool[opts.toolCallId] = {
                  ...val,
                  time: {
                    start: 0,
                    end: 0,
                  },
                }
                await updateMessage(next)
              },
            })
            next.metadata!.tool![opts.toolCallId] = {
              ...result.metadata,
              time: {
                start,
                end: Date.now(),
              },
            }
            await updateMessage(next)
            return result.output
          } catch (e: any) {
            next.metadata!.tool![opts.toolCallId] = {
              error: true,
              message: e.toString(),
              title: e.toString(),
              time: {
                start,
                end: Date.now(),
              },
            }
            await updateMessage(next)
            return e.toString()
          }
        },
      })
    }

    for (const [key, item] of Object.entries(await MCP.tools())) {
      const execute = item.execute
      if (!execute) continue
      item.execute = async (args, opts) => {
        const start = Date.now()
        try {
          const result = await execute(args, opts)
          next.metadata!.tool![opts.toolCallId] = {
            ...result.metadata,
            time: {
              start,
              end: Date.now(),
            },
          }
          await updateMessage(next)
          return result.content
            .filter((x: any) => x.type === "text")
            .map((x: any) => x.text)
            .join("\n\n")
        } catch (e: any) {
          next.metadata!.tool![opts.toolCallId] = {
            error: true,
            message: e.toString(),
            title: "mcp",
            time: {
              start,
              end: Date.now(),
            },
          }
          await updateMessage(next)
          return e.toString()
        }
      }
      tools[key] = item
    }

    let text: Message.TextPart | undefined
    const result = streamText({
      onStepFinish: async (step) => {
        log.info("step finish", { finishReason: step.finishReason })
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, step.usage, step.providerMetadata)
        assistant.cost += usage.cost
        assistant.tokens = usage.tokens
        await updateMessage(next)
        if (text) {
          Bus.publish(Message.Event.PartUpdated, {
            part: text,
            messageID: next.id,
            sessionID: next.metadata.sessionID,
          })
        }
        text = undefined
      },
      async onFinish(input) {
        log.info("message finish", {
          reason: input.finishReason,
        })
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, input.usage, input.providerMetadata)
        assistant.cost = usage.cost
        await updateMessage(next)
      },
      onError(err) {
        log.error("callback error", err)
        switch (true) {
          case LoadAPIKeyError.isInstance(err.error):
            next.metadata.error = new Provider.AuthError(
              {
                providerID: input.providerID,
                message: err.error.message,
              },
              { cause: err.error },
            ).toObject()
            break
          case err.error instanceof Error:
            next.metadata.error = new NamedError.Unknown(
              { message: err.error.toString() },
              { cause: err.error },
            ).toObject()
            break
          default:
            next.metadata.error = new NamedError.Unknown(
              { message: JSON.stringify(err.error) },
              { cause: err.error },
            )
        }
        Bus.publish(Event.Error, {
          error: next.metadata.error,
        })
      },
      // async prepareStep(step) {
      //   next.parts.push({
      //     type: "step-start",
      //   })
      //   await updateMessage(next)
      //   return step
      // },
      toolCallStreaming: true,
      maxTokens: model.info.limit.output || undefined,
      abortSignal: abort.signal,
      maxSteps: 1000,
      providerOptions: model.info.options,
      messages: [
        ...system.map(
          (x): CoreMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...convertToCoreMessages(
          msgs.map(toUIMessage).filter((x) => x.parts.length > 0),
        ),
      ],
      temperature: model.info.temperature ? 0 : undefined,
      tools: model.info.tool_call === false ? undefined : tools,
      model: wrapLanguageModel({
        model: model.language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                args.params.prompt = ProviderTransform.message(
                  args.params.prompt,
                  input.providerID,
                  input.modelID,
                )
              }
              return args.params
            },
          },
        ],
      }),
    })
    try {
      for await (const value of result.fullStream) {
        l.info("part", {
          type: value.type,
        })
        switch (value.type) {
          case "step-start":
            next.parts.push({
              type: "step-start",
            })
            break
          case "text-delta":
            if (!text) {
              text = {
                type: "text",
                text: value.textDelta,
              }
              next.parts.push(text)
              break
            } else text.text += value.textDelta
            break

          case "tool-call": {
            const [match] = next.parts.flatMap((p) =>
              p.type === "tool-invocation" &&
              p.toolInvocation.toolCallId === value.toolCallId
                ? [p]
                : [],
            )
            if (!match) break
            match.toolInvocation.args = value.args
            match.toolInvocation.state = "call"
            Bus.publish(Message.Event.PartUpdated, {
              part: match,
              messageID: next.id,
              sessionID: next.metadata.sessionID,
            })
            break
          }

          case "tool-call-streaming-start":
            next.parts.push({
              type: "tool-invocation",
              toolInvocation: {
                state: "partial-call",
                toolName: value.toolName,
                toolCallId: value.toolCallId,
                args: {},
              },
            })
            Bus.publish(Message.Event.PartUpdated, {
              part: next.parts[next.parts.length - 1],
              messageID: next.id,
              sessionID: next.metadata.sessionID,
            })
            break

          case "tool-call-delta":
            continue

          // for some reason ai sdk claims to not send this part but it does
          // @ts-expect-error
          case "tool-result":
            const match = next.parts.find(
              (p) =>
                p.type === "tool-invocation" &&
                // @ts-expect-error
                p.toolInvocation.toolCallId === value.toolCallId,
            )
            if (match && match.type === "tool-invocation") {
              match.toolInvocation = {
                // @ts-expect-error
                args: value.args,
                // @ts-expect-error
                toolCallId: value.toolCallId,
                // @ts-expect-error
                toolName: value.toolName,
                state: "result",
                // @ts-expect-error
                result: value.result as string,
              }
              Bus.publish(Message.Event.PartUpdated, {
                part: match,
                messageID: next.id,
                sessionID: next.metadata.sessionID,
              })
            }
            break

          case "finish":
            log.info("message finish", {
              reason: value.finishReason,
            })
            const assistant = next.metadata!.assistant!
            const usage = getUsage(
              model.info,
              value.usage,
              value.providerMetadata,
            )
            assistant.cost = usage.cost
            await updateMessage(next)
            if (value.finishReason === "length")
              throw new Message.OutputLengthError({})
            break
          default:
            l.info("unhandled", {
              type: value.type,
            })
            continue
        }
        await updateMessage(next)
      }
    } catch (e: any) {
      log.error("stream error", {
        error: e,
      })
      switch (true) {
        case Message.OutputLengthError.isInstance(e):
          next.metadata.error = e
          break
        case LoadAPIKeyError.isInstance(e):
          next.metadata.error = new Provider.AuthError(
            {
              providerID: input.providerID,
              message: e.message,
            },
            { cause: e },
          ).toObject()
          break
        case e instanceof Error:
          next.metadata.error = new NamedError.Unknown(
            { message: e.toString() },
            { cause: e },
          ).toObject()
          break
        default:
          next.metadata.error = new NamedError.Unknown(
            { message: JSON.stringify(e) },
            { cause: e },
          )
      }
      Bus.publish(Event.Error, {
        error: next.metadata.error,
      })
    }
    next.metadata!.time.completed = Date.now()
    for (const part of next.parts) {
      if (
        part.type === "tool-invocation" &&
        part.toolInvocation.state !== "result"
      ) {
        part.toolInvocation = {
          ...part.toolInvocation,
          state: "result",
          result: "request was aborted",
        }
      }
    }
    await updateMessage(next)
    return next
  }

  export async function summarize(input: {
    sessionID: string
    providerID: string
    modelID: string
  }) {
    using abort = lock(input.sessionID)
    const msgs = await messages(input.sessionID)
    const lastSummary = msgs.findLast(
      (msg) => msg.metadata.assistant?.summary === true,
    )?.id
    const filtered = msgs.filter((msg) => !lastSummary || msg.id >= lastSummary)
    const model = await Provider.getModel(input.providerID, input.modelID)
    const app = App.info()
    const system = SystemPrompt.summarize(input.providerID)

    const next: Message.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [],
      metadata: {
        tool: {},
        sessionID: input.sessionID,
        assistant: {
          system,
          path: {
            cwd: app.path.cwd,
            root: app.path.root,
          },
          summary: true,
          cost: 0,
          modelID: input.modelID,
          providerID: input.providerID,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
        time: {
          created: Date.now(),
        },
      },
    }
    await updateMessage(next)

    let text: Message.TextPart | undefined
    const result = streamText({
      abortSignal: abort.signal,
      model: model.language,
      messages: [
        ...system.map(
          (x): CoreMessage => ({
            role: "system",
            content: x,
          }),
        ),
        ...convertToCoreMessages(filtered.map(toUIMessage)),
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Provide a detailed but concise summary of our conversation above. Focus on information that would be helpful for continuing the conversation, including what we did, what we're doing, which files we're working on, and what we're going to do next.",
            },
          ],
        },
      ],
      onStepFinish: async (step) => {
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, step.usage, step.providerMetadata)
        assistant.cost += usage.cost
        assistant.tokens = usage.tokens
        await updateMessage(next)
        if (text) {
          Bus.publish(Message.Event.PartUpdated, {
            part: text,
            messageID: next.id,
            sessionID: next.metadata.sessionID,
          })
        }
        text = undefined
      },
      async onFinish(input) {
        const assistant = next.metadata!.assistant!
        const usage = getUsage(model.info, input.usage, input.providerMetadata)
        assistant.cost = usage.cost
        assistant.tokens = usage.tokens
        next.metadata!.time.completed = Date.now()
        await updateMessage(next)
      },
    })

    for await (const value of result.fullStream) {
      switch (value.type) {
        case "text-delta":
          if (!text) {
            text = {
              type: "text",
              text: value.textDelta,
            }
            next.parts.push(text)
          } else text.text += value.textDelta

          await updateMessage(next)
          break
      }
    }
  }

  function lock(sessionID: string) {
    log.info("locking", { sessionID })
    if (state().pending.has(sessionID)) throw new BusyError(sessionID)
    const controller = new AbortController()
    state().pending.set(sessionID, controller)
    return {
      signal: controller.signal,
      [Symbol.dispose]() {
        log.info("unlocking", { sessionID })
        state().pending.delete(sessionID)
        Bus.publish(Event.Idle, {
          sessionID,
        })
      },
    }
  }

  function getUsage(
    model: ModelsDev.Model,
    usage: LanguageModelUsage,
    metadata?: ProviderMetadata,
  ) {
    const tokens = {
      input: usage.promptTokens ?? 0,
      output: usage.completionTokens ?? 0,
      reasoning: 0,
      cache: {
        write: (metadata?.["anthropic"]?.["cacheCreationInputTokens"] ??
          0) as number,
        read: (metadata?.["anthropic"]?.["cacheReadInputTokens"] ??
          0) as number,
      },
    }
    return {
      cost: new Decimal(0)
        .add(new Decimal(tokens.input).mul(model.cost.input).div(1_000_000))
        .add(new Decimal(tokens.output).mul(model.cost.output).div(1_000_000))
        .add(
          new Decimal(tokens.cache.read)
            .mul(model.cost.cache_read ?? 0)
            .div(1_000_000),
        )
        .add(
          new Decimal(tokens.cache.write)
            .mul(model.cost.cache_write ?? 0)
            .div(1_000_000),
        )
        .toNumber(),
      tokens,
    }
  }

  export class BusyError extends Error {
    constructor(public readonly sessionID: string) {
      super(`Session ${sessionID} is busy`)
    }
  }

  export async function initialize(input: {
    sessionID: string
    modelID: string
    providerID: string
  }) {
    const app = App.info()
    await Session.chat({
      sessionID: input.sessionID,
      providerID: input.providerID,
      modelID: input.modelID,
      parts: [
        {
          type: "text",
          text: PROMPT_INITIALIZE.replace("${path}", app.path.root),
        },
      ],
    })
    await App.initialize()
  }

  async function calculateAndReturnStats(
    sessionID: string,
    providerID: string,
    modelID: string,
    msgs: Message.Info[],
  ): Promise<Message.Info> {
    const session = await get(sessionID)
    const model = await Provider.getModel(providerID, modelID)

    // Filter out the /stats command message itself
    const messagesForStats = msgs.filter((msg) => {
      if (msg.role === "user") {
        const textPart = msg.parts.find((p) => p.type === "text") as
          | Message.TextPart
          | undefined
        return !(textPart && textPart.text.trim().toLowerCase() === "/stats")
      }
      return true
    })

    // Calculate statistics
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCacheReadTokens = 0
    let totalCacheWriteTokens = 0
    let totalCost = 0
    let userMessageCount = 0
    let assistantMessageCount = 0
    const toolUsage: Record<string, number> = {}
    let firstMessageTime: number | undefined
    let lastMessageTime: number | undefined

    for (const msg of messagesForStats) {
      if (msg.metadata.time.created) {
        if (!firstMessageTime || msg.metadata.time.created < firstMessageTime) {
          firstMessageTime = msg.metadata.time.created
        }
        if (!lastMessageTime || msg.metadata.time.created > lastMessageTime) {
          lastMessageTime = msg.metadata.time.created
        }
      }

      if (msg.role === "user") {
        userMessageCount++
      } else if (msg.role === "assistant" && msg.metadata.assistant) {
        assistantMessageCount++
        const assistant = msg.metadata.assistant
        totalInputTokens += assistant.tokens.input
        totalOutputTokens += assistant.tokens.output
        totalCacheReadTokens += assistant.tokens.cache.read
        totalCacheWriteTokens += assistant.tokens.cache.write
        totalCost += assistant.cost

        // Count tool usage by type
        for (const [toolCallId, toolData] of Object.entries(
          msg.metadata.tool,
        )) {
          // Try to determine the tool type from the call ID or title
          let toolType = "unknown"

          // Check the tool call ID pattern (e.g., "read_abc123" -> "read")
          const toolMatch = toolCallId.match(/^([a-z_]+)_/)
          if (toolMatch) {
            toolType = toolMatch[1]
          } else if (toolData.title) {
            // Fallback to analyzing the title
            const title = toolData.title.toLowerCase()
            if (title.includes("error")) {
              toolType = "error"
            } else if (title.includes("plan approved")) {
              toolType = "plan_approved"
            } else {
              toolType = "other"
            }
          }

          toolUsage[toolType] = (toolUsage[toolType] || 0) + 1
        }
      }
    }

    const totalTokens =
      totalInputTokens +
      totalOutputTokens +
      totalCacheReadTokens +
      totalCacheWriteTokens
    const sessionDuration =
      firstMessageTime && lastMessageTime
        ? (lastMessageTime - firstMessageTime) / 1000 / 60 // in minutes
        : 0

    // Format the statistics
    const statsText = formatStats({
      sessionID,
      sessionTitle: session.title,
      providerID,
      modelID,
      modelName: model.info.name,
      userMessageCount,
      assistantMessageCount,
      totalInputTokens,
      totalOutputTokens,
      totalCacheReadTokens,
      totalCacheWriteTokens,
      totalTokens,
      totalCost,
      toolUsage,
      sessionDuration,
      sessionCreated: new Date(session.time.created).toLocaleString(),
      sessionUpdated: new Date(session.time.updated).toLocaleString(),
    })

    // Create a stats message
    const statsMessage: Message.Info = {
      id: Identifier.ascending("message"),
      role: "assistant",
      parts: [
        {
          type: "text",
          text: statsText,
        },
      ],
      metadata: {
        time: {
          created: Date.now(),
          completed: Date.now(),
        },
        sessionID,
        tool: {},
        assistant: {
          system: [],
          modelID,
          providerID,
          path: {
            cwd: App.info().path.cwd,
            root: App.info().path.root,
          },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      },
    }

    await updateMessage(statsMessage)
    return statsMessage
  }

  function formatStats(stats: {
    sessionID: string
    sessionTitle: string
    providerID: string
    modelID: string
    modelName: string
    userMessageCount: number
    assistantMessageCount: number
    totalInputTokens: number
    totalOutputTokens: number
    totalCacheReadTokens: number
    totalCacheWriteTokens: number
    totalTokens: number
    totalCost: number
    toolUsage: Record<string, number>
    sessionDuration: number
    sessionCreated: string
    sessionUpdated: string
  }): string {
    const lines: string[] = []

    // Header with key metrics
    lines.push("📊 **Session Statistics**")
    lines.push("")

    // Quick summary
    const totalMessages = stats.userMessageCount + stats.assistantMessageCount
    lines.push(
      `**Summary**: ${totalMessages} messages • ${stats.totalTokens.toLocaleString()} tokens • $${stats.totalCost.toFixed(4)}`,
    )
    lines.push("")

    // Session details
    lines.push("**Session**")
    lines.push(`• ${stats.sessionTitle}`)
    lines.push(`• Duration: ${stats.sessionDuration.toFixed(1)} minutes`)
    lines.push(`• Model: ${stats.modelName}`)
    lines.push("")

    // Message breakdown
    lines.push("**Messages**")
    lines.push(`• User: ${stats.userMessageCount}`)
    lines.push(`• Assistant: ${stats.assistantMessageCount}`)
    lines.push("")

    // Token usage
    lines.push("**Tokens**")
    lines.push(`• Input: ${stats.totalInputTokens.toLocaleString()}`)
    lines.push(`• Output: ${stats.totalOutputTokens.toLocaleString()}`)
    if (stats.totalCacheReadTokens > 0 || stats.totalCacheWriteTokens > 0) {
      lines.push(`• Cache read: ${stats.totalCacheReadTokens.toLocaleString()}`)
      lines.push(
        `• Cache write: ${stats.totalCacheWriteTokens.toLocaleString()}`,
      )
    }
    lines.push(`• Total: ${stats.totalTokens.toLocaleString()}`)
    lines.push("")

    // Cost breakdown
    lines.push("**Cost**")
    lines.push(`• Total: $${stats.totalCost.toFixed(4)}`)
    if (stats.assistantMessageCount > 0 && stats.totalCost > 0) {
      lines.push(
        `• Per message: $${(stats.totalCost / stats.assistantMessageCount).toFixed(4)}`,
      )
      lines.push(
        `• Per 1K tokens: $${((stats.totalCost / stats.totalTokens) * 1000).toFixed(4)}`,
      )
    }
    lines.push("")

    // Tool usage (if any)
    if (Object.keys(stats.toolUsage).length > 0) {
      lines.push("**Tools Used**")
      const sortedTools = Object.entries(stats.toolUsage)
        .sort((a, b) => b[1] - a[1])
        .filter(([tool]) => tool !== "unknown" && tool !== "error") // Hide unknown/error tools

      for (const [tool, count] of sortedTools) {
        const toolName = tool.replace(/_/g, " ") // Replace underscores with spaces
        lines.push(`• ${toolName}: ${count}×`)
      }

      // Show errors separately if any
      const errorCount = stats.toolUsage["error"] || 0
      if (errorCount > 0) {
        lines.push(`• errors: ${errorCount}×`)
      }
      lines.push("")
    }

    // Session metadata (collapsed)
    lines.push("**Details**")
    lines.push(`• ID: ${stats.sessionID}`)
    lines.push(`• Created: ${stats.sessionCreated}`)
    lines.push(`• Updated: ${stats.sessionUpdated}`)

    return lines.join("\n")
  }
}

function toUIMessage(msg: Message.Info): UIMessage {
  if (msg.role === "assistant") {
    return {
      id: msg.id,
      role: "assistant",
      content: "",
      parts: toParts(msg.parts),
    }
  }

  if (msg.role === "user") {
    return {
      id: msg.id,
      role: "user",
      content: "",
      parts: toParts(msg.parts),
    }
  }

  throw new Error("not implemented")
}

function toParts(parts: Message.Part[]): UIMessage["parts"] {
  const result: UIMessage["parts"] = []
  for (const part of parts) {
    switch (part.type) {
      case "text":
        result.push({ type: "text", text: part.text })
        break
      case "file":
        result.push({
          type: "file",
          data: part.url,
          mimeType: part.mediaType,
        })
        break
      case "tool-invocation":
        result.push({
          type: "tool-invocation",
          toolInvocation: part.toolInvocation,
        })
        break
      case "step-start":
        result.push({
          type: "step-start",
        })
        break
      default:
        break
    }
  }
  return result
}
