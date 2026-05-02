/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createHash } from 'crypto';
import { z } from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';
import type { CacheKeyFn, CachePluginOptions } from './types.js';

export const CacheConfigSchema = z
  .object({
    /**
     * The time to live for cached entries in milliseconds.
     */
    ttlMs: z.number().describe('The time to live for cached entries in milliseconds.'),

    /**
     * Static string key to use for the cache.
     * If not provided and no keyFn is specified, a hash of the request is used.
     */
    key: z.string().optional().describe('Static string key to use for the cache.'),

    /**
     * Name of a registered key generation function (from plugin options).
     * Takes precedence over the static `key` if both are provided.
     */
    keyFn: z
      .string()
      .optional()
      .describe('Name of a registered key generation function from plugin options.'),
  })
  .passthrough();

export type CacheConfig = z.infer<typeof CacheConfigSchema>;

/**
 * Creates a middleware that caches model responses.
 *
 * The storage backend (`store`) and custom key functions (`keyFns`) are provided
 * via plugin options (non-serializable), while serializable config like `ttlMs`
 * and `key`/`keyFn` are provided per-use.
 *
 * ```ts
 * // Register the plugin:
 * const ai = genkit({
 *   plugins: [cache.plugin({ store: new InMemoryCacheStore() })],
 * });
 *
 * // Use in generate:
 * const response = await ai.generate({
 *   model: 'my-model',
 *   prompt: 'hello',
 *   use: [cache({ ttlMs: 60000 })],
 * });
 * ```
 */
export const cache: GenerateMiddleware<typeof CacheConfigSchema, CachePluginOptions> =
  generateMiddleware(
    {
      name: 'cache',
      description: 'Caches model responses to reduce costs and latency for identical requests.',
      configSchema: CacheConfigSchema,
    },
    ({ config, pluginConfig }) => {
      const store = pluginConfig?.store;
      if (!store) {
        throw new Error('Cache middleware requires a store in plugin options.');
      }

      const { ttlMs = 60000, key: staticKey, keyFn: keyFnName } = config || {};
      const keyFns = pluginConfig?.keyFns || {};

      // Resolve key function
      let resolvedKeyFn: CacheKeyFn | undefined;
      if (keyFnName) {
        resolvedKeyFn = keyFns[keyFnName];
        if (!resolvedKeyFn) {
          throw new Error(
            `Cache key function '${keyFnName}' not found. Available: ${Object.keys(keyFns).join(', ') || '(none)'}`
          );
        }
      }

      return {
        model: async (req, ctx, next) => {
          let cacheKey: string;

          if (resolvedKeyFn) {
            cacheKey = resolvedKeyFn({ request: req });
          } else if (staticKey) {
            cacheKey = staticKey;
          } else {
            // Default key generation: hash of the request
            const stableReq = {
              messages: req.messages,
              config: req.config,
              tools: req.tools,
              output: req.output,
            };
            cacheKey = createHash('sha256').update(JSON.stringify(stableReq)).digest('hex');
          }

          try {
            const cached = await store.get(cacheKey);
            if (cached) {
              return cached;
            }
          } catch (e) {
            console.error(`[Genkit Cache Error] Failed to read cache for '${cacheKey}':`, e);
          }

          const response = await next(req, ctx);

          try {
            await store.set(cacheKey, response, ttlMs);
          } catch (e) {
            console.error(`[Genkit Cache Error] Failed to write cache for '${cacheKey}':`, e);
          }

          return response;
        },
      };
    }
  );
