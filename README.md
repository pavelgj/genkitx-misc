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
  plugins: [
    quota.plugin({ store: new InMemoryQuotaStore() }),
  ],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [
      quota({ limit: 10, windowMs: 60000 }),
    ],
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
  plugins: [
    cache.plugin({ store: new InMemoryCacheStore() }),
  ],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    // ...
    use: [
      cache({ ttlMs: 60000 }),
    ],
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

## Examples

Check the `examples/` directory for complete sample projects:

- [Quota Examples](examples/quota/)
- [Cache Examples](examples/cache/)
- [Router Examples](examples/router/)
