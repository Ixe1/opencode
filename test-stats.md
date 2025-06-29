# Testing the /stats Command

## How to Test

1. Start opencode locally:

   ```bash
   ./run-local.sh
   ```

2. In the opencode interface, have a conversation with a few messages

3. Type `/stats` and press Enter

4. You should see statistics including:
   - Session information (title, ID, timestamps, duration)
   - Model information (provider and model name)
   - Message counts (user vs assistant)
   - Token usage breakdown (input, output, cache)
   - Total cost and averages
   - Tool usage statistics (if any tools were used)

## Expected Output Format

The stats command should return a formatted message like:

```
📊 **Session Statistics**

**Session Information**
• Title: New Session - 2025-06-27T10:30:00.000Z
• ID: session_abc123
• Created: 6/27/2025, 10:30:00 AM
• Updated: 6/27/2025, 10:35:00 AM
• Duration: 5.0 minutes

**Model Information**
• Provider: anthropic
• Model: Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)

**Message Statistics**
• User messages: 3
• Assistant messages: 3
• Total messages: 6

**Token Usage**
• Input tokens: 1,234
• Output tokens: 567
• Cache read tokens: 100
• Cache write tokens: 50
• **Total tokens: 1,951**

**Cost Analysis**
• Total cost: $0.0234
• Average cost per message: $0.0078
• Average cost per 1K tokens: $11.9959

**Tool Usage**
• read: 2 invocations
• edit: 1 invocation

**Averages**
• Avg input tokens per message: 411
• Avg output tokens per message: 189
```

## Edge Cases to Test

1. Empty session (type `/stats` as the first message)
2. Session with only user messages
3. Session with tool usage
4. Session without cache tokens (non-Anthropic providers)
