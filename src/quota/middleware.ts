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

import { GenkitError, z } from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';
import type { QuotaKeyFn, QuotaPluginOptions } from './types.js';

export const QuotaConfigSchema = z
  .object({
    /**
     * The maximum number of requests allowed within the window.
     */
    limit: z.number().describe('The maximum number of requests allowed within the window.'),

    /**
     * The duration of the quota window in milliseconds.
     */
    windowMs: z.number().describe('The duration of the quota window in milliseconds.'),

    /**
     * Static string key to use for the quota. Defaults to 'global'.
     */
    key: z.string().optional().describe("Static string key for the quota. Defaults to 'global'."),

    /**
     * Name of a registered key generation function (from plugin options).
     * Takes precedence over the static `key` if both are provided.
     */
    keyFn: z
      .string()
      .optional()
      .describe('Name of a registered key generation function from plugin options.'),

    /**
     * If true, only logs a warning when quota is exceeded, instead of throwing an error.
     */
    logOnly: z
      .boolean()
      .optional()
      .describe(
        'If true, only logs a warning when quota is exceeded instead of throwing an error.'
      ),

    /**
     * Whether to allow the request to proceed if the quota check fails (e.g. storage down).
     */
    failOpen: z
      .boolean()
      .optional()
      .describe(
        'Whether to allow the request to proceed if the quota check fails (e.g. storage down).'
      ),
  })
  .passthrough();

export type QuotaConfig = z.infer<typeof QuotaConfigSchema>;

/**
 * Creates a middleware that enforces rate limits using a configurable storage backend.
 *
 * The storage backend (`store`) and custom key functions (`keyFns`) are provided
 * via plugin options (non-serializable), while serializable config like `limit`,
 * `windowMs`, `key`/`keyFn`, `logOnly`, and `failOpen` are provided per-use.
 *
 * ```ts
 * // Register the plugin:
 * const ai = genkit({
 *   plugins: [quota.plugin({ store: new InMemoryQuotaStore() })],
 * });
 *
 * // Use in generate:
 * const response = await ai.generate({
 *   model: 'my-model',
 *   prompt: 'hello',
 *   use: [quota({ limit: 10, windowMs: 60000 })],
 * });
 * ```
 */
export const quota: GenerateMiddleware<typeof QuotaConfigSchema, QuotaPluginOptions> =
  generateMiddleware(
    {
      name: 'quota',
      description: 'Enforces rate limits using a configurable storage backend.',
      configSchema: QuotaConfigSchema,
    },
    ({ config, pluginConfig }) => {
      const store = pluginConfig?.store;
      if (!store) {
        throw new Error('Quota middleware requires a store in plugin options.');
      }

      const {
        limit,
        windowMs,
        key: staticKey = 'global',
        keyFn: keyFnName,
        logOnly = false,
        failOpen = false,
      } = config || { limit: 0, windowMs: 0 };

      const keyFns = pluginConfig?.keyFns || {};

      // Resolve key function
      let resolvedKeyFn: QuotaKeyFn | undefined;
      if (keyFnName) {
        resolvedKeyFn = keyFns[keyFnName];
        if (!resolvedKeyFn) {
          throw new Error(
            `Quota key function '${keyFnName}' not found. Available: ${Object.keys(keyFns).join(', ') || '(none)'}`
          );
        }
      }

      return {
        model: async (req, ctx, next) => {
          const k = resolvedKeyFn ? resolvedKeyFn({ request: req }) : staticKey;

          try {
            const usage = await store.increment(k, 1, windowMs, limit);

            if (usage > limit) {
              const msg = `Quota exceeded for key '${k}'. Usage: ${usage}/${limit} in ${windowMs}ms`;

              if (!logOnly) {
                throw new GenkitError({
                  status: 'RESOURCE_EXHAUSTED',
                  message: msg,
                  detail: {
                    usage,
                    limit,
                    windowMs,
                    key: k,
                  },
                });
              } else {
                console.warn(`[Genkit Quota Warning] ${msg}`);
              }
            }
          } catch (e) {
            // Always rethrow RESOURCE_EXHAUSTED as it means quota was checked and exceeded
            if (e instanceof GenkitError && e.status === 'RESOURCE_EXHAUSTED') {
              throw e;
            }

            const errorMsg = `[Genkit Quota Error] Failed to check quota for '${k}': ${e instanceof Error ? e.message : String(e)}`;
            console.error(errorMsg, e);

            if (!failOpen) {
              if (e instanceof GenkitError) {
                throw e;
              }
              throw new GenkitError({
                status: 'INTERNAL',
                message: `Failed to check quota: ${e}`,
              });
            }
          }

          return next(req, ctx);
        },
      };
    }
  );
