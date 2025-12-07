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

import { createHash } from "crypto";
import { ModelMiddleware } from "genkit/model";
import { CacheOptions } from "./types.js";

/**
 * Creates a cache middleware that caches model responses.
 *
 * @param options Configuration options for the cache middleware
 * @returns A ModelMiddleware that checks cache before processing the request
 */
export function cache(options: CacheOptions): ModelMiddleware {
  const { store, ttlMs, key } = options;

  return async (req, next) => {
    let cacheKey: string;

    if (key) {
      if (typeof key === "function") {
        cacheKey = key({ request: req });
      } else {
        cacheKey = key;
      }
    } else {
      // Default key generation: hash of the request
      const stableReq = {
        messages: req.messages,
        config: req.config,
        tools: req.tools,
        output: req.output,
      };
      cacheKey = createHash("sha256")
        .update(JSON.stringify(stableReq))
        .digest("hex");
    }

    try {
      const cached = await store.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.error(
        `[Genkit Cache Error] Failed to read cache for '${cacheKey}':`,
        e
      );
    }

    const response = await next(req);

    try {
      await store.set(cacheKey, response, ttlMs);
    } catch (e) {
      console.error(
        `[Genkit Cache Error] Failed to write cache for '${cacheKey}':`,
        e
      );
    }

    return response;
  };
}
