import { z } from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { Message } from "../session/message"

export const ExitPlanModeTool = Tool.define({
  id: "exit_plan_mode",
  description:
    "Use this tool when the user has approved a plan. This will switch the session from planning mode to code mode and prepare for implementation.",
  parameters: z.object({
    planSummary: z.string().describe("Brief summary of the approved plan"),
    implementationContext: z
      .string()
      .describe(
        "Key context and details from the plan that the AI needs to remember during implementation",
      ),
  }),
  async execute(params, opts) {
    // Get current session and messages
    const session = await Session.get(opts.sessionID)
    if (!session) {
      throw new Error("Session not found")
    }

    // Get all messages to find the plan
    const messages = await Session.messages(opts.sessionID)

    // Find the last assistant message that contains the plan
    let planMessage: Message.Info | undefined
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        // Check if this message contains a plan (look for plan structure)
        const content = messages[i].parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("")
        if (
          content.includes("## Plan:") ||
          content.includes("### Overview") ||
          content.includes("Would you like me to proceed")
        ) {
          planMessage = messages[i]
          break
        }
      }
    }

    // Switch session mode from planning to normal
    await Session.setMode(opts.sessionID, "normal")

    // Update the last plan status to approved
    if (session.lastPlan) {
      await Session.updateLastPlan(
        opts.sessionID,
        session.lastPlan.plan,
        "approved",
      )
    }

    // Create a context message that summarizes the plan and key details
    const contextMessage = `# Implementation Context

## Approved Plan Summary
${params.planSummary}

## Implementation Details
${params.implementationContext}

${
  planMessage
    ? `## Full Plan Reference
The complete plan that was approved is available in the conversation history above.`
    : ""
}

---
You are now in implementation mode. Please proceed with implementing the approved plan step by step, using the todo list as your guide.`

    return {
      output: contextMessage,
      metadata: {
        title: "Plan Approved - Implementation Mode Active",
        modeChanged: true,
        newMode: "normal",
        planSummary: params.planSummary,
      },
    }
  },
})
