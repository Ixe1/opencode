import { z } from "zod"
import { Tool } from "./tool"
import { Session } from "../session"
import { App } from "../app/app"
import { Checkpoint } from "../checkpoint"
import { EditTool } from "./edit"
import DESCRIPTION from "./review.txt"

interface ReviewMetadata {
  title: string
  [key: string]: any
}

export interface ReviewIssue {
  id: string
  severity: "critical" | "high" | "medium" | "low"
  severityIcon: string
  title: string
  file: string
  line: number
  description: string
  suggestedFix: {
    oldString: string
    newString: string
  }
  explanation?: string
}

export const ReviewTool = Tool.define<
  z.ZodObject<{
    action: z.ZodEnum<["start", "fix", "skip", "modify", "explain", "status"]>
    issueId: z.ZodOptional<z.ZodString>
    customFix: z.ZodOptional<z.ZodString>
  }>,
  ReviewMetadata
>({
  id: "review_action",
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["start", "fix", "skip", "modify", "explain", "status"])
      .describe("The review action to perform"),
    issueId: z.string().optional().describe("The ID of the issue to act on"),
    customFix: z
      .string()
      .optional()
      .describe("Custom fix to apply (for modify action)"),
  }),
  execute: async (args, ctx) => {
    const app = App.info()
    const session = await Session.get(ctx.sessionID)

    if (session.mode !== "review") {
      return {
        metadata: {
          title: "Review Mode Not Active",
        },
        output:
          "Review tool can only be used in review mode. Use Shift+Tab to switch to review mode.",
      }
    }

    switch (args.action) {
      case "start": {
        // Get uncommitted changes
        const diffProc = Bun.spawn(["git", "diff", "--no-color"], {
          cwd: app.path.root,
          stdout: "pipe",
          stderr: "pipe",
        })
        const diffOutput = await new Response(diffProc.stdout).text()
        await diffProc.exited

        const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
          cwd: app.path.root,
          stdout: "pipe",
          stderr: "pipe",
        })
        const statusOutput = await new Response(statusProc.stdout).text()
        await statusProc.exited

        if (!diffOutput && !statusOutput) {
          return {
            metadata: {
              title: "No Changes",
            },
            output: "No uncommitted changes found to review.",
          }
        }

        // Initialize review state
        await Session.updateReviewState(ctx.sessionID, {
          issues: [],
          currentIndex: 0,
          fixed: [],
          skipped: [],
          timestamp: Date.now(),
        })

        return {
          metadata: {
            title: "Review Started",
            diff: diffOutput,
            status: statusOutput,
          },
          output: `Starting code review of uncommitted changes...

Git diff:
\`\`\`diff
${diffOutput}
\`\`\`

Please analyze these changes and identify any issues.`,
        }
      }

      case "fix": {
        if (!args.issueId || !session.reviewState) {
          return {
            metadata: {
              title: "Invalid State",
            },
            output: "No issue specified or review state not initialized.",
          }
        }

        const issue = session.reviewState.issues.find(
          (i: any) => i.id === args.issueId,
        )
        if (!issue) {
          return {
            metadata: {
              title: "Issue Not Found",
            },
            output: `Issue ${args.issueId} not found.`,
          }
        }

        // Create checkpoint before fix
        await Checkpoint.create({
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          description: `Before review fix: ${issue.title}`,
        })

        // Apply the fix
        try {
          await EditTool.execute(
            {
              filePath: issue.file,
              oldString: issue.suggestedFix.oldString,
              newString: issue.suggestedFix.newString,
            },
            ctx,
          )

          // Update review state
          const fixed = [...(session.reviewState.fixed || []), args.issueId]
          await Session.updateReviewState(ctx.sessionID, { fixed })

          return {
            metadata: {
              title: "Fix Applied",
              issueId: args.issueId,
            },
            output: `✓ Fixed: ${issue.title}`,
          }
        } catch (error) {
          return {
            metadata: {
              title: "Fix Failed",
              error: String(error),
            },
            output: `Failed to apply fix: ${String(error)}`,
          }
        }
      }

      case "skip": {
        if (!args.issueId || !session.reviewState) {
          return {
            metadata: {
              title: "Invalid State",
            },
            output: "No issue specified or review state not initialized.",
          }
        }

        const skipped = [...(session.reviewState.skipped || []), args.issueId]
        await Session.updateReviewState(ctx.sessionID, { skipped })

        return {
          metadata: {
            title: "Issue Skipped",
            issueId: args.issueId,
          },
          output: `⤳ Skipped issue ${args.issueId}`,
        }
      }

      case "explain": {
        if (!args.issueId || !session.reviewState) {
          return {
            metadata: {
              title: "Invalid State",
            },
            output: "No issue specified or review state not initialized.",
          }
        }

        const issue = session.reviewState.issues.find(
          (i: any) => i.id === args.issueId,
        )
        if (!issue || !issue.explanation) {
          return {
            metadata: {
              title: "No Explanation",
            },
            output: "No additional explanation available for this issue.",
          }
        }

        return {
          metadata: {
            title: "Issue Explanation",
            issueId: args.issueId,
          },
          output: issue.explanation,
        }
      }

      case "status": {
        if (!session.reviewState) {
          return {
            metadata: {
              title: "No Review Active",
            },
            output: "No review currently active.",
          }
        }

        const { issues, fixed, skipped } = session.reviewState
        const remaining = issues.length - fixed.length - skipped.length

        return {
          metadata: {
            title: "Review Status",
          },
          output: `Review Status:
- Total issues: ${issues.length}
- Fixed: ${fixed.length}
- Skipped: ${skipped.length}
- Remaining: ${remaining}`,
        }
      }

      default:
        return {
          metadata: {
            title: "Unknown Action",
          },
          output: `Unknown review action: ${args.action}`,
        }
    }
  },
})
