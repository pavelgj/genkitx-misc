# Cache Middleware

The Cache middleware allows you to cache model responses to reduce costs and latency for identical requests.

## Installation

```bash
npm install genkitx-misc
```

## Setup

The cache middleware uses the Genkit `generateMiddleware()` API. You register the storage backend as a plugin, then use the middleware per-request with serializable config.

```typescript
import { genkit } from 'genkit';
import { cache } from 'genkitx-misc/cache';
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const ai = genkit({
  plugins: [cache.plugin({ store: new InMemoryCacheStore() })],
});
```

## Usage

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-2.5-flash',
  prompt: 'Hello world',
  use: [cache({ ttlMs: 60000 })],
});
```

## Configuration

### Per-Use Config (serializable)

The `cache()` function accepts the following config options:

- `ttlMs` _(required)_: The time-to-live for cached entries in milliseconds.
- `key` _(optional)_: A static string key to use for the cache. If not provided, a SHA-256 hash of the request is used.
- `keyFn` _(optional)_: Name of a registered key generation function (from plugin options). Takes precedence over the static `key`.

### Plugin Options (non-serializable)

The `cache.plugin()` function accepts:

- `store` _(required)_: The storage backend instance (`CacheStore`).
- `keyFns` _(optional)_: A `Record<string, CacheKeyFn>` mapping names to key generation functions. These can be referenced by name in the per-use `keyFn` config.

## Custom Key Generation

By default, the middleware hashes the stable parts of the `GenerateRequest` (messages, config, tools, output). You can customize key generation using named key functions:

```typescript
const ai = genkit({
  plugins: [
    cache.plugin({
      store: new InMemoryCacheStore(),
      keyFns: {
        byUser: ({ request }) => {
          return `user:${request.config?.userId}:${request.messages[0]?.content[0]?.text}`;
        },
      },
    }),
  ],
});

// Reference the named key function in config:
const response = await ai.generate({
  model: 'my-model',
  prompt: 'hello',
  use: [cache({ ttlMs: 60000, keyFn: 'byUser' })],
});
```

## Storage Backends

### In-Memory

Uses an in-memory map. Useful for testing or single-instance deployments.

```typescript
import { InMemoryCacheStore } from 'genkitx-misc/cache/memory';

const store = new InMemoryCacheStore();
```

**TTL Management**: Lazy expiration on access and periodic background cleanup (default every 60 seconds).

### Firestore

Uses Cloud Firestore for distributed, persistent caching. Requires `@google-cloud/firestore`.

```typescript
import { FirestoreCacheStore } from 'genkitx-misc/cache/firestore';
import { Firestore } from '@google-cloud/firestore';

const firestore = new Firestore();
const store = new FirestoreCacheStore(firestore, 'cache_collection');
```

**TTL Management**: The middleware checks the `expiresAt` field lazily upon read. To physically delete expired documents, configure a TTL policy in the Google Cloud Console on the `expiresAt` field.

### Redis

Uses Redis for high-performance, in-memory distributed caching. Requires `ioredis`.

```typescript
import { RedisCacheStore } from 'genkitx-misc/cache/redis';
import Redis from 'ioredis';

const redis = new Redis();
const store = new RedisCacheStore({ client: redis });
```

**TTL Management**: Redis natively supports key expiration. The middleware sets expiration using `PX` when writing the key.

### PostgreSQL

Uses a PostgreSQL database table for caching. Requires `pg`.

```typescript
import { PostgresCacheStore } from 'genkitx-misc/cache/postgres';
import { Pool } from 'pg';

const pool = new Pool({ ... });
const store = new PostgresCacheStore({ pool, tableName: 'genkit_cache' });
```

The store automatically creates the table if it doesn't exist:

```sql
CREATE TABLE IF NOT EXISTS genkit_cache (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  expires_at BIGINT NOT NULL
);
```

**TTL Management**: Lazy deletion on access. Set up a background job for cleanup:

```sql
DELETE FROM genkit_cache WHERE expires_at < (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint;
```

## Failure Handling

The cache middleware implements a **fail-open** strategy. If the cache store fails during `get` or `set`, the error is logged and the request proceeds as a cache miss. This ensures cache outages do not disrupt your application.

## Custom Cache Store

Implement the `CacheStore` interface:

```typescript
import { CacheStore } from 'genkitx-misc/cache';

export class MyCustomCache implements CacheStore {
  async get(key: string): Promise<any | null> {
    // Return cached value or null
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    // Store value with expiration
  }
}
```
