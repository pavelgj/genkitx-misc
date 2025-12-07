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

-   **Firestore**: Requires `@google-cloud/firestore`.
-   **Realtime Database**: Requires `firebase-admin` (Quota only).
-   **PostgreSQL**: Requires `pg`.
-   **Redis**: Requires `ioredis`.

## Features

### Quota Middleware

A flexible rate-limiting middleware for Genkit models.

-   **Pluggable Storage**: Supports Firestore, Realtime Database, PostgreSQL, Redis, and In-Memory storage.
-   **Configurable**: Set limits, window size, and custom keys (e.g., per-user).
-   **Optimized**: Minimizes database writes when limits are exceeded.

[📚 Read Quota Documentation](docs/quota.md)

#### Example

```typescript
import { quota } from 'genkitx-misc/quota';
import { InMemoryQuotaStore } from 'genkitx-misc/quota/memory';

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [
      quota({ 
        store: new InMemoryQuotaStore(), 
        limit: 10, 
        windowMs: 60000 
      })
    ]
  });
});
```

### Cache Middleware

A caching middleware for Genkit models to reduce costs and latency.

-   **Pluggable Storage**: Supports Firestore, PostgreSQL, Redis, and In-Memory storage.
-   **Flexible**: Customize cache keys and TTL.
-   **Fail-Open**: Ensures application stability even if cache storage fails.

[📚 Read Cache Documentation](docs/cache.md)

#### Example

```typescript
import { cache } from 'genkitx-misc/cache';
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [
      cache({ 
        store: new InMemoryCacheStore(), 
        ttlMs: 60000 
      })
    ]
  });
});
```

### Router Middleware

A middleware that routes requests to different models based on configurable rules or classification strategies.

-   **Rule-Based**: Define prioritized rules (e.g. "if has media, use this model").
-   **Classifier-Based**: Use a function (or LLM) to classify requests and route accordingly.
-   **Built-in Predicates**: Helpers for common checks like `hasMedia`, `hasTools`.

[📚 Read Router Documentation](docs/router.md)

#### Example

```typescript
import { router, hasMedia, hasTools } from 'genkitx-misc/router';

ai.generate({
  model: 'googleai/gemini-2.5-flash', // Default
  use: [
    router(ai, {
      rules: [
        { when: hasMedia, use: 'googleai/gemini-2.5-flash' },
        { when: hasTools, use: 'googleai/gemini-2.5-pro' },
      ]
    })
  ]
});
```

## Examples

Check the `examples/` directory for complete sample projects:
-   [Quota Examples](examples/quota/)
-   [Cache Examples](examples/cache/)
-   [Router Examples](examples/router/)
