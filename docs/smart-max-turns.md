# Smart Max Turns Middleware

The Smart Max Turns middleware replaces Genkit's rigid `maxTurns` counter with intelligent loop detection. Instead of blindly counting turns, it uses heuristic detectors (and optionally an LLM judge) to identify when an agent is stuck in a loop or making no progress, and terminates early with a clean response.

## Installation

```bash
npm install genkitx-misc
```

## Setup

Register the middleware as a plugin:

```typescript
import { genkit } from 'genkit';
import { smartMaxTurns } from 'genkitx-misc/smart-max-turns';

const ai = genkit({
  plugins: [smartMaxTurns.plugin()],
});
```

### With LLM Judge

To enable the optional LLM judge detector, provide a `judgeModel` in plugin options:

```typescript
const ai = genkit({
  plugins: [
    smartMaxTurns.plugin({
      judgeModel: 'googleai/gemini-flash-lite-latest',
    }),
  ],
});
```

## Usage

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Research and summarize the latest AI news',
  tools: [searchTool, analyzeTool],
  use: [smartMaxTurns()],
});
```

## How It Works

The middleware takes **full ownership** of turn management by overriding the framework's `maxTurns` to effectively infinite. It then runs its own detection logic on each turn:

1. **Hard ceiling** — always enforced regardless of detectors (default: 20 turns).
2. **Minimum turns** — detectors don't run until this many turns have elapsed (default: 3), giving the agent runway to get started.
3. **Detectors** — heuristic analyzers that examine the conversation history for patterns indicating the agent is stuck.
4. **Termination strategy** — what to do when a problem is detected.

## Detection Strategies

### Exact Loop Detection (enabled by default)

Catches identical tool calls repeated across consecutive turns. For example, if the model calls `search("cats")` three times in a row with the same arguments, that's a loop.

```typescript
use: [
  smartMaxTurns({
    detect: {
      exactLoops: { threshold: 3 }, // Require 3 repeats (default: 2)
    },
  }),
];
```

### Response Repetition Detection (enabled by default)

Catches tools returning identical outputs across consecutive turns. Even if the model varies its arguments, if the tool keeps returning the same result, the agent is stalled.

```typescript
use: [
  smartMaxTurns({
    detect: {
      responseRepetition: { threshold: 3 }, // Require 3 repeats (default: 2)
    },
  }),
];
```

### LLM Judge (disabled by default)

Uses a separate LLM to analyze the conversation trajectory and determine if the agent is making meaningful progress. Requires `judgeModel` in plugin options.

```typescript
// Plugin setup
const ai = genkit({
  plugins: [
    smartMaxTurns.plugin({
      judgeModel: 'googleai/gemini-flash-lite-latest',
    }),
  ],
});

// Per-use config
use: [
  smartMaxTurns({
    detect: {
      llmJudge: true, // Check every turn after minTurns
      // or: llmJudge: { every: 3 } // Check every 3rd turn
    },
  }),
];
```

The judge receives a text rendering of the conversation and responds with `PROGRESSING` or `STUCK`. If the judge call fails, the middleware warns and proceeds without judgment — it never blocks the main agent.

## Termination Strategies

When a detector flags a problem, the middleware applies one of three strategies:

### `'abort'` (default)

Returns an aborted response immediately with `finishReason: 'aborted'`. The response includes the last model message and metadata about why termination occurred.

```typescript
use: [smartMaxTurns({ onDetection: 'abort' })];
```

### `'wrapUp'`

Removes all tools and injects a user message asking the model to produce a final answer from what it has gathered so far. This gives the model a chance to synthesize useful output even though it got stuck.

```typescript
use: [
  smartMaxTurns({
    onDetection: 'wrapUp',
    wrapUpPrompt: 'Please summarize what you found so far.',
  }),
];
```

### `'pruneTools'`

Removes only the tools that appear in the detected loop and lets the model continue with the remaining tools. If all tools would be pruned, falls back to `wrapUp` behavior.

```typescript
use: [smartMaxTurns({ onDetection: 'pruneTools' })];
```

## Inspecting the Result

When the middleware terminates or modifies a request, structured metadata is attached to `response.custom.smartMaxTurns`:

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Do something complex',
  tools: [searchTool],
  use: [smartMaxTurns()],
});

const meta = (response.custom as any)?.smartMaxTurns;
if (meta) {
  console.log('Reason:', meta.reason); // 'loop' | 'stalled' | 'stuck'
  console.log('Detail:', meta.detail); // Human-readable description
  console.log('Turns used:', meta.turnsUsed);
  console.log('Action:', meta.action); // 'wrapUp' | 'pruneTools' | ...
  console.log('Pruned:', meta.prunedTools); // Tool names (pruneTools only)
}
```

| Field         | Type                                 | Description                                         |
| ------------- | ------------------------------------ | --------------------------------------------------- |
| `reason`      | `'loop'` \| `'stalled'` \| `'stuck'` | What was detected.                                  |
| `detail`      | `string`                             | Human-readable description of the detection.        |
| `turnsUsed`   | `number`                             | How many turns elapsed before termination.          |
| `action`      | `string \| undefined`                | Which termination strategy was applied.             |
| `prunedTools` | `string[] \| undefined`              | Names of pruned tools (`pruneTools` strategy only). |

## Configuration Reference

| Option                      | Type                                      | Default      | Description                                                              |
| --------------------------- | ----------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| `maxTurns`                  | `number`                                  | `20`         | Hard ceiling on tool-calling turns.                                      |
| `minTurns`                  | `number`                                  | `3`          | Don't start checking until this turn.                                    |
| `onDetection`               | `'abort'` \| `'wrapUp'` \| `'pruneTools'` | `'abort'`    | What to do when a loop/stall is detected.                                |
| `wrapUpPrompt`              | `string`                                  | _(built-in)_ | Custom instruction for the wrapUp strategy.                              |
| `judgePrompt`               | `string`                                  | _(built-in)_ | Custom prompt template for the LLM judge (use `{messages}` placeholder). |
| `detect.exactLoops`         | `boolean` \| `{ threshold: number }`      | `true`       | Detect identical tool calls. Default threshold: 2.                       |
| `detect.responseRepetition` | `boolean` \| `{ threshold: number }`      | `true`       | Detect identical tool responses. Default threshold: 2.                   |
| `detect.llmJudge`           | `boolean` \| `{ every: number }`          | `false`      | Use LLM judge. Requires `judgeModel` in plugin options.                  |

### Plugin Options

| Option        | Type     | Description                                                             |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `judgeModel`  | `string` | Model name for the LLM judge. Required if `detect.llmJudge` is enabled. |
| `judgePrompt` | `string` | Default judge prompt template (can be overridden per-use).              |

## Interaction with Other Middleware

### With `softFail()`

`smartMaxTurns` and `softFail` complement each other. `smartMaxTurns` handles loop detection with graceful termination strategies, while `softFail` catches unexpected errors:

```typescript
use: [
  softFail(), // Outermost — catches unexpected errors
  smartMaxTurns({
    // Handles loop detection
    onDetection: 'wrapUp',
  }),
];
```

### With `retry()` and `fallback()`

```typescript
use: [
  softFail(),           // Catches anything that still throws
  smartMaxTurns(),      // Loop detection
  retry({ ... }),       // Retry transient errors
  fallback({ ... }),    // Try alternate models
]
```

## Detection Status Reference

| Status    | Detector            | Meaning                                          |
| --------- | ------------------- | ------------------------------------------------ |
| `loop`    | Exact loops         | Identical tool calls repeated consecutively.     |
| `stalled` | Response repetition | Tools returning identical outputs consecutively. |
| `stuck`   | LLM judge           | Judge determined the agent is not progressing.   |
| `loop`    | Hard ceiling        | Turn count reached `maxTurns`.                   |
