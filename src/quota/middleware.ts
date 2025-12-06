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

import { GenkitError } from 'genkit';
import { ModelMiddleware } from 'genkit/model';
import { QuotaOptions } from './types.js';

/**
 * Creates a quota middleware that enforces rate limits using a configurable storage backend.
 * 
 * @param options Configuration options for the quota middleware
 * @returns A ModelMiddleware that checks quota before processing the request
 */
export function quota(options: QuotaOptions): ModelMiddleware {
  const {
    store,
    limit,
    windowMs,
    key = 'global',
    logOnly = false,
    failOpen = false,
  } = options;

  return async (req, next) => {
    const k = typeof key === 'function' ? key({ request: req }) : key;
    
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
              key: k
            }
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
    
    return next(req);
  };
}
