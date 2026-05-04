# genkitx-misc

Miscellaneous middleware and utilities for [Genkit](https://genkit.dev).

## Installation

```bash
npm install genkitx-misc
# or
pnpm add genkitx-misc
# or
yarn add genkitx-misc
# or
bun add genkitx-misc
```

### Optional Dependencies

This package has optional dependencies that are required only for specific storage backends:

- **Firestore**: Requires `@google-cloud/firestore`.
- **Realtime Database**: Requires `firebase-admin` (Quota only).
- **PostgreSQL**: Requires `pg`.
- **Redis**: Requires `ioredis`.

## Features

All middleware in this package uses the new Genkit `generateMiddleware()` API. Non-serializable state (stores, functions) is provided via **plugin options**, while serializable configuration is provided per-use.

### Quota Middleware

A flexible rate-limiting middleware for Genkit models.

- **Pluggable Storage**: Supports Firestore, Realtime Database, PostgreSQL, Redis, and In-Memory storage.
- **Configurable**: Set limits, window size, and custom keys (e.g., per-user).
- **Named Key Functions**: Register custom key extraction logic via plugin options.
- **Optimized**: Minimizes database writes when limits are exceeded.

[📚 Read Quota Documentation](docs/quota.md)

#### Example

```typescript
import { quota } from 'genkitx-misc/quota';
import { InMemoryQuotaStore } from 'genkitx-misc/quota/memory';

const ai = genkit({
  plugins: [quota.plugin({ store: new InMemoryQuotaStore() })],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [quota({ limit: 10, windowMs: 60000 })],
  });
});
```

### Cache Middleware

A caching middleware for Genkit models to reduce costs and latency.

- **Pluggable Storage**: Supports Firestore, PostgreSQL, Redis, and In-Memory storage.
- **Flexible**: Customize cache keys and TTL.
- **Named Key Functions**: Register custom key generation logic via plugin options.
- **Fail-Open**: Ensures application stability even if cache storage fails.

[📚 Read Cache Documentation](docs/cache.md)

#### Example

```typescript
import { cache } from 'genkitx-misc/cache';
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const ai = genkit({
  plugins: [cache.plugin({ store: new InMemoryCacheStore() })],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [cache({ ttlMs: 60000 })],
  });
});
```

### Router Middleware

A middleware that routes requests to different models based on configurable rules or classification strategies.

- **Rule-Based**: Define prioritized rules using named matchers (e.g. `'hasMedia'`, `'hasTools'`).
- **Classifier-Based**: Register named classifier functions to route by request classification.
- **Built-in Matchers**: `'hasMedia'`, `'hasTools'`, `'hasHistory'` are always available.
- **Custom Matchers**: Register your own matchers via plugin options.

[📚 Read Router Documentation](docs/router.md)

#### Example

```typescript
import { router } from 'genkitx-misc/router';

const ai = genkit({
  plugins: [
    router.plugin(), // Built-in matchers are always available
  ],
});

ai.generate({
  model: 'googleai/gemini-flash-latest', // Default
  use: [
    router({
      rules: [
        { when: 'hasMedia', use: { name: 'googleai/gemini-pro-latest' } },
        { when: 'hasTools', use: { name: 'googleai/gemini-pro-latest' } },
      ],
    }),
  ],
});
```

### Soft Fail Middleware

A middleware that prevents `generate()` from throwing in common failure scenarios, returning an aborted response instead. This is especially useful in agentic tool-calling loops where a late failure would otherwise lose all accumulated progress.

- **Model Errors**: Catches model call errors and returns a synthetic response with `finishReason: 'aborted'`.
- **Tool Errors**: Catches tool execution errors and returns them as tool responses so the model can recover.
- **Max Turns**: When the tool-calling turn limit is reached, returns the last response instead of throwing.
- **Configurable**: Enable/disable each behavior independently; filter model errors by status.

[📚 Read Soft Fail Documentation](docs/soft-fail.md)

#### Example

```typescript
import { softFail } from 'genkitx-misc/soft-fail';

const ai = genkit({
  plugins: [softFail.plugin()],
});

const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Do something complex',
  tools: [riskyTool],
  use: [softFail()],
});

if (response.finishReason === 'aborted') {
  console.log('Generation did not complete:', response.finishMessage);

  // Access detailed error information via response.custom
  const details = (response.custom as any)?.softFail;
  if (details) {
    console.log('Failure reason:', details.reason); // 'model-error' | 'max-turns'
    console.log('Error message:', details.error);
    console.log('Error status:', details.status); // GenkitError status (model errors only)
  }
}
```

The `response.custom.softFail` object contains:

| Field    | Type                             | Description                                        |
| -------- | -------------------------------- | -------------------------------------------------- |
| `reason` | `'model-error'` \| `'max-turns'` | Which failure scenario triggered the soft fail.    |
| `error`  | `string`                         | The original error message.                        |
| `status` | `string \| undefined`            | The `GenkitError` status code (model errors only). |

Selectively enable features or filter by error status:

```typescript
// Only catch model errors with specific statuses
use: [softFail({ modelStatuses: ['UNAVAILABLE', 'RESOURCE_EXHAUSTED'] })];

// Disable tool error catching
use: [softFail({ tools: false })];

// Only handle max turns, let model/tool errors throw
use: [softFail({ model: false, tools: false })];
```

### Smart Max Turns Middleware

A middleware that replaces rigid `maxTurns` counters with intelligent loop detection. Uses heuristic detectors (and optionally an LLM judge) to identify when an agent is stuck in a loop or making no progress, and terminates gracefully.

- **Exact Loop Detection**: Catches identical tool calls repeated across consecutive turns.
- **Response Repetition**: Catches tools returning identical outputs consecutively.
- **LLM Judge**: Optional semantic analysis of conversation trajectory using a separate model.
- **Termination Strategies**: Abort, wrap up (ask model for final answer), or prune looping tools.
- **Configurable**: Tune thresholds, minimum turns runway, and termination behavior.

[📚 Read Smart Max Turns Documentation](docs/smart-max-turns.md)

#### Example

```typescript
import { smartMaxTurns } from 'genkitx-misc/smart-max-turns';

const ai = genkit({
  plugins: [smartMaxTurns.plugin()],
});

const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Research and summarize...',
  tools: [searchTool, analyzeTool],
  use: [smartMaxTurns()],
});

const meta = (response.custom as any)?.smartMaxTurns;
if (meta) {
  console.log(`Terminated: ${meta.reason}, turns: ${meta.turnsUsed}`);
}
```

Choose a termination strategy:

```typescript
// Abort immediately (default)
use: [smartMaxTurns({ onDetection: 'abort' })];

// Ask the model to wrap up with a final answer
use: [smartMaxTurns({ onDetection: 'wrapUp' })];

// Remove looping tools, let the model continue with others
use: [smartMaxTurns({ onDetection: 'pruneTools' })];
```

### Context Compression Middleware

A middleware that compresses conversation context when it grows too large, reducing token usage and costs in long-running agentic tool-calling loops. Triggers based on the previous turn's `inputTokens` — no custom token counter needed.

- **Tool Response Truncation**: Trim verbose tool outputs to a character limit (cheapest, no LLM call).
- **Message Truncation**: Drop oldest messages beyond a hard cap, preserving system messages.
- **LLM Summarization**: Replace older messages with a condensed summary using a separate model.
- **Token-Based Triggering**: Compression activates when `inputTokens` from the previous turn exceeds a threshold.
- **Summary Caching**: Cached summaries are reused across turns to avoid redundant LLM calls.

[📚 Read Context Compression Documentation](docs/context-compression.md)

#### Example

```typescript
import { contextCompression } from 'genkitx-misc/context-compression';

const ai = genkit({
  plugins: [contextCompression.plugin()],
});

const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Research and summarize...',
  tools: [searchTool],
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

const meta = (response.custom as any)?.contextCompression;
if (meta) {
  console.log(`Compressed: ${meta.messagesOriginal} → ${meta.messagesAfter} messages`);
}
```

## Examples

Check the `examples/` directory for complete sample projects:

- [Quota Examples](examples/quota/)
- [Cache Examples](examples/cache/)
- [Router Examples](examples/router/)
- [Soft Fail Examples](examples/soft-fail/)
- [Smart Max Turns Examples](examples/smart-max-turns/)
- [Context Compression Examples](examples/context-compression/)
