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
      deduplicateToolResponses: { matchBy: 'name-and-input' },
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

1. **Safety cap** — Hard-truncate any single oversized tool response (prevents context blowup).
2. **Deduplication** — Replace duplicate tool responses with a short notice, keeping only the most recent.
3. **Tool response truncation** — Trim verbose tool outputs to a character limit.
4. **Message truncation** — Drop oldest messages beyond a hard cap, with an optional notice.
5. **Summarization** — Replace old messages with an LLM-generated summary (skipped if cheap strategies saved enough).

Turn 0 is always passed through since there is no prior usage data.

### Adaptive Aggressiveness

The middleware automatically adjusts compression aggressiveness based on how far over budget the context is:

| Overshoot | Behavior                                   |
| --------- | ------------------------------------------ |
| 1.0–1.5×  | Normal: use configured preserve windows    |
| 1.5–2.0×  | Aggressive: halve preserve windows (min 2) |
| 2.0×+     | Emergency: reduce preserve windows to 2    |

This handles edge cases like switching to a model with a smaller context window mid-conversation.

## Compression Strategies

### 1. Safety Cap

Hard-truncates any individual tool response that exceeds a character limit. Applied unconditionally as a safety net. Default: 400,000 characters (~100k tokens).

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    maxToolResponseChars: 400000, // Default. Set to Infinity to disable.
  }),
];
```

### 2. Tool Response Deduplication

When the same tool is called multiple times with the same input (common in agentic loops that repeatedly read the same files or call the same APIs), older responses are replaced with a short notice. Only the most recent response is kept.

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    deduplicateToolResponses: {
      matchBy: 'name-and-input', // or 'name-only'
      keepRecent: 1, // Keep the 1 most recent occurrence
      notice: 'Custom dedup notice', // Optional
    },
  }),
];
```

### 3. Tool Response Truncation

Truncates the text content of older tool responses to a maximum character length. This is a cheap strategy — no LLM call required.

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

### 4. Message Truncation

Drops the oldest messages when the total message count exceeds a hard cap. System messages are preserved by default. A truncation notice is inserted at the boundary so the model knows context was removed.

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    maxMessages: 20, // Keep at most 20 messages
    insertTruncationNotice: true, // Default: true
    truncationNotice: 'Custom notice text', // Optional
  }),
];
```

### 5. LLM Summarization

Uses a separate (typically cheaper/faster) model to summarize older messages into a condensed form. The summary replaces the original messages, preserving recent context. Summaries are cached across turns to avoid redundant LLM calls.

The default prompt produces structured summaries covering: primary request, key decisions, tool interactions, task evolution, current state, and pending work.

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

### Skipping Summarization

If cheap strategies (deduplication + truncation) save enough context, summarization can be skipped to save the cost of an LLM call:

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    deduplicateToolResponses: { matchBy: 'name-and-input' },
    toolResponses: { maxChars: 2000 },
    skipSummarizationThreshold: 0.3, // Skip if 30%+ savings from cheap strategies
    summarize: {
      model: { name: 'googleai/gemini-flash-lite-latest' },
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
      deduplicateToolResponses: { matchBy: 'name-and-input' },
      toolResponses: { maxChars: 2000 },
    }),
  ],
});

const meta = (response.custom as any)?.contextCompression;
if (meta) {
  console.log('Compression triggered:', meta.triggered);
  console.log('Overshoot ratio:', meta.overshootRatio);
  console.log('Messages before:', meta.messagesOriginal);
  console.log('Messages after:', meta.messagesAfter);
  console.log('Safety capped:', meta.toolResponsesSafetyCapped);
  console.log('Deduplicated:', meta.toolResponsesDeduplicated);
  console.log('Truncated:', meta.toolResponsesTruncated);
  console.log('Summarized:', meta.summarized);
  console.log('Summarization skipped:', meta.summarizationSkipped);
  console.log('Notice inserted:', meta.truncationNoticeInserted);
}
```

| Field                       | Type      | Description                                                  |
| --------------------------- | --------- | ------------------------------------------------------------ |
| `triggered`                 | `boolean` | Whether compression was triggered.                           |
| `inputTokensBefore`         | `number`  | The input token count that triggered compression.            |
| `overshootRatio`            | `number`  | How far over the threshold (e.g., 1.5 = 50% over).           |
| `messagesOriginal`          | `number`  | Message count before compression.                            |
| `messagesAfter`             | `number`  | Message count after compression.                             |
| `toolResponsesSafetyCapped` | `number`  | Number of tool responses hard-truncated by safety cap.       |
| `toolResponsesDeduplicated` | `number`  | Number of duplicate tool responses replaced with notices.    |
| `toolResponsesTruncated`    | `number`  | Number of tool responses truncated by character limit.       |
| `summarized`                | `boolean` | Whether LLM summarization was performed this turn.           |
| `summarizationSkipped`      | `boolean` | Whether summarization was skipped due to sufficient savings. |
| `truncationNoticeInserted`  | `boolean` | Whether a truncation notice was inserted.                    |

## Configuration

| Option                       | Type      | Default  | Description                                                                       |
| ---------------------------- | --------- | -------- | --------------------------------------------------------------------------------- |
| `maxInputTokens`             | `number`  | —        | **Required.** Compress when previous turn's `inputTokens` exceeds this threshold. |
| `preserveRecent`             | `number`  | `4`      | Number of recent messages to always keep intact.                                  |
| `preserveSystem`             | `boolean` | `true`   | Always keep system/instructions messages.                                         |
| `maxToolResponseChars`       | `number`  | `400000` | Hard cap on any single tool response size.                                        |
| `deduplicateToolResponses`   | `object`  | —        | Deduplication config (see below).                                                 |
| `toolResponses`              | `object`  | —        | Tool response truncation config (see below).                                      |
| `maxMessages`                | `number`  | —        | Hard cap on message count. Drop oldest beyond this.                               |
| `insertTruncationNotice`     | `boolean` | `true`   | Insert a notice when messages are dropped.                                        |
| `truncationNotice`           | `string`  | —        | Custom notice text for when messages are dropped.                                 |
| `skipSummarizationThreshold` | `number`  | —        | Skip summarization if cheap strategies save this fraction (e.g., `0.3`).          |
| `summarize`                  | `object`  | —        | LLM summarization config (see below).                                             |

### `deduplicateToolResponses` options

| Option       | Type     | Default            | Description                                                  |
| ------------ | -------- | ------------------ | ------------------------------------------------------------ |
| `matchBy`    | `string` | `'name-and-input'` | Match strategy: `'name-and-input'` or `'name-only'`.         |
| `keepRecent` | `number` | `1`                | Keep the N most recent occurrences of each unique tool call. |
| `notice`     | `string` | —                  | Custom replacement notice for deduplicated responses.        |

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

### Moderate: Deduplication + Truncation + Message Cap

```typescript
use: [
  contextCompression({
    maxInputTokens: 80000,
    deduplicateToolResponses: { matchBy: 'name-and-input' },
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
    maxToolResponseChars: 400000,
    deduplicateToolResponses: { matchBy: 'name-and-input' },
    toolResponses: { maxChars: 2000 },
    maxMessages: 40,
    skipSummarizationThreshold: 0.3,
    summarize: {
      model: { name: 'googleai/gemini-flash-lite-latest' },
      preserveRecent: 6,
    },
  }),
];
```

## Behavior Notes

- **Turn 0 passthrough**: Compression never triggers on the first turn since there is no prior usage data.
- **Adaptive aggressiveness**: When context is significantly over budget (1.5–2×+), preserve windows are automatically reduced to compress more aggressively.
- **Deduplication**: Only replaces earlier occurrences — the most recent tool response is always kept intact.
- **Summary caching**: When summarization is enabled, the generated summary is cached across turns. If subsequent turns don't add new messages beyond the cached window, the cached summary is reused without an additional LLM call.
- **Skip summarization**: When `skipSummarizationThreshold` is set, the middleware measures character savings from cheap strategies (dedup + truncation) and skips the expensive LLM summarization call if savings are sufficient.
- **Summarization failure**: If the summarization LLM call fails, a warning is logged and the middleware proceeds without summarization. The other strategies still apply.
- **Truncation notices**: When messages are dropped, a notice is inserted so the model knows context was removed. Disable with `insertTruncationNotice: false`.
- **System messages**: System messages are always preserved by default (`preserveSystem: true`). They are excluded from message truncation and summarization.
- **Safety cap**: The 400k character default safety cap prevents a single massive tool response from consuming the entire context window.

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
    deduplicateToolResponses: { matchBy: 'name-and-input' },
    toolResponses: { maxChars: 2000 },
  }),
];
```
