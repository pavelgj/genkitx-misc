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
  model: 'googleai/gemini-2.5-flash', // Default
  use: [
    router({
      rules: [
        { when: 'hasMedia', use: { name: 'googleai/gemini-2.5-pro' } },
        { when: 'hasTools', use: { name: 'googleai/gemini-2.5-pro' } },
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
- **No Plugin Required**: Works directly in the `use` array — no plugin registration needed.

#### Example

```typescript
import { softFail } from 'genkitx-misc/soft-fail';

const response = await ai.generate({
  model: 'googleai/gemini-2.5-flash',
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

## Examples

Check the `examples/` directory for complete sample projects:

- [Quota Examples](examples/quota/)
- [Cache Examples](examples/cache/)
- [Router Examples](examples/router/)
