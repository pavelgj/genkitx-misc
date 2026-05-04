# Context Compression Middleware

The Context Compression middleware compresses conversation context when it grows too large, reducing token usage and costs in long-running agentic tool-calling loops. It triggers based on the previous turn's `inputTokens` from the model response — no custom token counter needed.

## Installation

```bash
npm install genkitx-misc
```

## Setup

Register the middleware as a plugin:

```typescript
import { genkit } from 'genkit';
import { contextCompression } from 'genkitx-misc/context-compression';

const ai = genkit({
  plugins: [contextCompression.plugin()],
});
```

## Usage

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Research and summarize the latest AI papers',
  tools: [searchTool, readTool],
  use: [
    contextCompression({
      maxInputTokens: 80000,
      toolResponses: { maxChars: 2000 },
      summarize: {
        model: { name: 'googleai/gemini-flash-lite-latest' },
      },
    }),
  ],
});
```

## How It Works

The middleware runs on **each turn** of a tool-calling loop. It tracks the `inputTokens` from the previous turn's model response and triggers compression when the threshold is exceeded.

On each turn where compression triggers, strategies are applied in order:

1. **Tool response truncation** — Trim verbose tool outputs (cheapest, no LLM call).
2. **Message truncation** — Drop oldest messages beyond a hard cap.
3. **Summarization** — Replace old messages with an LLM-generated summary.

Turn 0 is always passed through since there is no prior usage data.

## Compression Strategies

### 1. Tool Response Truncation

Truncates the text content of older tool responses to a maximum character length. This is the cheapest strategy — no LLM call required.

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    toolResponses: {
      maxChars: 2000, // Truncate tool responses beyond 2000 chars
      preserveRecent: 2, // Leave the 2 most recent tool responses untouched
    },
  }),
];
```

### 2. Message Truncation

Drops the oldest messages when the total message count exceeds a hard cap. System messages are preserved by default.

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    maxMessages: 20, // Keep at most 20 messages
  }),
];
```

### 3. LLM Summarization

Uses a separate (typically cheaper/faster) model to summarize older messages into a condensed form. The summary replaces the original messages, preserving recent context. Summaries are cached across turns to avoid redundant LLM calls.

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    summarize: {
      model: { name: 'googleai/gemini-flash-lite-latest' },
      preserveRecent: 6, // Keep last 6 messages un-summarized
      prompt: 'Custom summarization prompt. {conversation}', // Optional
    },
  }),
];
```

## Inspecting the Result

When compression is applied, metadata is attached to `response.custom.contextCompression`:

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Research this topic thoroughly',
  tools: [searchTool],
  use: [
    contextCompression({
      maxInputTokens: 80000,
      toolResponses: { maxChars: 2000 },
    }),
  ],
});

const meta = (response.custom as any)?.contextCompression;
if (meta) {
  console.log('Compression triggered:', meta.triggered);
  console.log('Messages before:', meta.messagesOriginal);
  console.log('Messages after:', meta.messagesAfter);
  console.log('Tool responses truncated:', meta.toolResponsesTruncated);
  console.log('Summarized:', meta.summarized);
}
```

| Field                    | Type      | Description                                        |
| ------------------------ | --------- | -------------------------------------------------- |
| `triggered`              | `boolean` | Whether compression was triggered.                 |
| `inputTokensBefore`      | `number`  | The input token count that triggered compression.  |
| `messagesOriginal`       | `number`  | Message count before compression.                  |
| `messagesAfter`          | `number`  | Message count after compression.                   |
| `toolResponsesTruncated` | `number`  | Number of tool responses that were truncated.      |
| `summarized`             | `boolean` | Whether LLM summarization was performed this turn. |

## Configuration

| Option           | Type      | Default | Description                                                                       |
| ---------------- | --------- | ------- | --------------------------------------------------------------------------------- |
| `maxInputTokens` | `number`  | —       | **Required.** Compress when previous turn's `inputTokens` exceeds this threshold. |
| `preserveRecent` | `number`  | `4`     | Number of recent messages to always keep intact.                                  |
| `preserveSystem` | `boolean` | `true`  | Always keep system/instructions messages.                                         |
| `toolResponses`  | `object`  | —       | Tool response truncation config (see below).                                      |
| `maxMessages`    | `number`  | —       | Hard cap on message count. Drop oldest beyond this.                               |
| `summarize`      | `object`  | —       | LLM summarization config (see below).                                             |

### `toolResponses` options

| Option           | Type     | Default | Description                                          |
| ---------------- | -------- | ------- | ---------------------------------------------------- |
| `maxChars`       | `number` | —       | Max chars per tool response. Beyond this, truncated. |
| `preserveRecent` | `number` | `2`     | Don't truncate the last N tool responses.            |

### `summarize` options

| Option           | Type     | Default | Description                                                   |
| ---------------- | -------- | ------- | ------------------------------------------------------------- |
| `model`          | `object` | —       | Model reference `{ name, config? }` for summarization.        |
| `preserveRecent` | `number` | `6`     | Keep last N messages un-summarized.                           |
| `prompt`         | `string` | —       | Custom prompt. Use `{conversation}` placeholder for messages. |

## Examples

### Cheap: Tool Response Truncation Only

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    toolResponses: { maxChars: 1000 },
  }),
];
```

### Moderate: Truncation + Message Cap

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    toolResponses: { maxChars: 2000, preserveRecent: 3 },
    maxMessages: 30,
  }),
];
```

### Full: All Strategies

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    toolResponses: { maxChars: 2000 },
    maxMessages: 40,
    summarize: {
      model: { name: 'googleai/gemini-flash-lite-latest' },
      preserveRecent: 6,
    },
  }),
];
```

## Behavior Notes

- **Turn 0 passthrough**: Compression never triggers on the first turn since there is no prior usage data.
- **Summary caching**: When summarization is enabled, the generated summary is cached across turns. If subsequent turns don't add new messages beyond the cached window, the cached summary is reused without an additional LLM call.
- **Summarization failure**: If the summarization LLM call fails, a warning is logged and the middleware proceeds without summarization. The other strategies still apply.
- **System messages**: System messages are always preserved by default (`preserveSystem: true`). They are excluded from message truncation and summarization.

## Interaction with Other Middleware

### With `softFail()`

Context compression works well with `softFail()` — if the summarization model fails, the middleware handles it gracefully. For extra safety:

```typescript
use: [
  softFail(),
  contextCompression({
    maxInputTokens: 80000,
    summarize: { model: { name: 'googleai/gemini-flash-lite-latest' } },
  }),
];
```

### With `smartMaxTurns()`

Combine with `smartMaxTurns()` for comprehensive loop control — compression keeps context manageable while smart max turns detects when the agent is stuck:

```typescript
use: [
  smartMaxTurns(),
  contextCompression({
    maxInputTokens: 80000,
    toolResponses: { maxChars: 2000 },
  }),
];
```
