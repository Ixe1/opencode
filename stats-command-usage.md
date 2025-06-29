# How to Use the /stats Command

The `/stats` command is implemented in the backend and will show session statistics including token usage, costs, and message counts.

## Usage Instructions

1. In the opencode TUI, type `/stats` in the message input
2. **Important**: When you type `/`, a command completion dialog will appear, but `/stats` won't be listed (it's a backend command, not a TUI command)
3. Either:
   - Continue typing `stats` to complete `/stats` and press Enter
   - Press Escape to dismiss the completion dialog, then press Enter
4. The backend will process the command and return statistics instead of sending it to the AI

## What You'll See

The `/stats` command returns:

- Session information (title, ID, timestamps, duration)
- Model information (provider and model name)
- Message statistics (user vs assistant counts)
- Token usage breakdown (input, output, cache read/write)
- Total cost and cost analysis
- Tool usage statistics (if any)
- Average tokens per message

## Note

The `/stats` command is processed by the backend, not the TUI. This is why it doesn't appear in the TUI's command completion list. Just type it and press Enter!
