# Soft Fail Middleware

The Soft Fail middleware prevents `generate()` from throwing in common failure scenarios, returning an aborted `GenerateResponse` instead. This is especially useful in agentic tool-calling loops where a late failure would otherwise lose all accumulated progress.

## Installation

```bash
npm install genkitx-misc
```

## Setup

Register the middleware as a plugin:

```typescript
import { genkit } from 'genkit';
import { softFail } from 'genkitx-misc/soft-fail';

const ai = genkit({
  plugins: [softFail.plugin()],
});
```

## Usage

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Do something complex',
  tools: [riskyTool],
  use: [softFail()],
});
```

## What It Catches

### 1. Model Errors

If the model call throws (even after retries/fallbacks), the error is caught and a synthetic response with `finishReason: 'aborted'` is returned.

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'hello',
  use: [softFail()],
});

if (response.finishReason === 'aborted') {
  console.log('Model failed:', response.finishMessage);
}
```

### 2. Tool Errors

If a tool throws during execution, the error text is returned to the model as a normal tool response. This gives the model a chance to recover, retry, or finish without that tool.

`ToolInterruptError`s are **never** caught — they are intentional control flow.

### 3. Max Turns Exceeded

When the maximum number of tool-call turns is reached, instead of throwing, the model's last response (including any pending tool requests) is returned with `finishReason: 'aborted'`.

## Inspecting the Result

When softFail catches a model error or max-turns error, structured metadata is attached to `response.custom.softFail`:

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: 'Do something complex',
  tools: [riskyTool],
  use: [softFail()],
});

if (response.finishReason === 'aborted') {
  const details = (response.custom as any)?.softFail;
  if (details) {
    console.log('Failure reason:', details.reason);
    console.log('Error message:', details.error);
    console.log('Error status:', details.status);
  }
}
```

| Field    | Type                             | Description                                        |
| -------- | -------------------------------- | -------------------------------------------------- |
| `reason` | `'model-error'` \| `'max-turns'` | Which failure scenario triggered the soft fail.    |
| `error`  | `string`                         | The original error message.                        |
| `status` | `string \| undefined`            | The `GenkitError` status code (model errors only). |

> **Note:** Tool errors do not produce `custom.softFail` metadata because the error is returned to the model as a tool response — the model may recover and produce a successful final response.

## Configuration

The `softFail()` function accepts an optional config object. All fields default to `true` — pass `false` to disable specific behaviors.

| Option         | Type       | Default     | Description                                                                                                   |
| -------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------- |
| `model`        | `boolean`  | `true`      | Catch model call errors and return an aborted response.                                                       |
| `tools`        | `boolean`  | `true`      | Catch tool execution errors and return them as tool responses.                                                |
| `maxTurns`     | `boolean`  | `true`      | Handle max turns gracefully instead of throwing.                                                              |
| `modelStatuses`| `string[]` | `undefined` | Only catch model errors with these `GenkitError` statuses. When `undefined`, all model errors are caught.     |

### Examples

```typescript
// Catch everything (default)
use: [softFail()]

// Only catch model errors with specific statuses
use: [softFail({ modelStatuses: ['UNAVAILABLE', 'RESOURCE_EXHAUSTED'] })]

// Disable tool error catching
use: [softFail({ tools: false })]

// Only handle max turns, let model/tool errors throw
use: [softFail({ model: false, tools: false })]

// Disable everything (middleware becomes a no-op)
use: [softFail({ model: false, tools: false, maxTurns: false })]
```

## Interaction with Other Middleware

### With `retry()` and `fallback()`

`softFail` is designed to work alongside `retry()` and `fallback()` middleware. The typical ordering is:

```typescript
use: [
  softFail(),       // Outermost — catches anything that still throws
  retry({ ... }),   // Retry transient errors
  fallback({ ... }),// Try alternate models
]
```

With this ordering, `retry()` and `fallback()` get their chance to recover from errors first. If they exhaust their attempts and still throw, `softFail()` catches the final error and returns an aborted response.

### With `quota()` and `cache()`

`softFail` can catch quota exhaustion errors as aborted responses:

```typescript
use: [
  softFail({ modelStatuses: ['RESOURCE_EXHAUSTED'] }),
  quota({ limit: 10, windowMs: 60000 }),
]
```

## Behavior Notes

- **Non-GenkitError handling with `modelStatuses`**: When `modelStatuses` is set, errors that are not instances of `GenkitError` (e.g., raw `TypeError` or network errors from model plugins) are always caught, since they have no status to match against. A warning is logged when this happens. This is intentional because model plugins don't consistently wrap errors in `GenkitError`.

- **Schema validation recovery**: If the model hook catches an error and returns a synthetic response, but that response fails downstream schema validation, the generate hook re-surfaces the original aborted response instead of throwing the validation error.
