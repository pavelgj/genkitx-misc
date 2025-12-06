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

This package has peer dependencies that are required only for specific features:

-   **Firestore Quota Store**: Requires `@google-cloud/firestore`.
-   **Realtime Database Quota Store**: Requires `firebase-admin`.

## Features

### Quota Middleware

A flexible rate-limiting middleware for Genkit models.

-   **Pluggable Storage**: Supports Firestore, Realtime Database, and In-Memory storage.
-   **Configurable**: Set limits, window size, and custom keys (e.g., per-user).
-   **Fail-Safe**: Configurable behavior when storage is unavailable (fail open or closed).
-   **Optimized**: Minimizes database writes when limits are exceeded.

## Basic Usage

```typescript
import { genkit } from 'genkit';
import { quota, FirestoreQuotaStore } from 'genkitx-misc';
import { Firestore } from '@google-cloud/firestore';

const ai = genkit({ plugins: [/* ... */] });
const firestore = new Firestore();
const quotaStore = new FirestoreQuotaStore(firestore, 'quotas');

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'gemini-2.5-flash',
    prompt: input,
    use: [
      quota({
        store: quotaStore,
        limit: 10,
        windowMs: 60000, // 1 minute
      })
    ]
  });
  return response.text;
});
```

For detailed documentation on the Quota middleware, including per-user limits and storage configuration, see [docs/quota.md](docs/quota.md).
