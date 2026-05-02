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

import { GenerateRequest } from 'genkit/model';

export interface CacheStore {
  /**
   * Get a value from the cache.
   * @param key The cache key.
   * @returns The cached value or null if not found.
   */
  get(key: string): Promise<any | null>;

  /**
   * Set a value in the cache.
   * @param key The cache key.
   * @param value The value to cache.
   * @param ttlMs Time to live in milliseconds.
   */
  set(key: string, value: any, ttlMs: number): Promise<void>;
}

/**
 * A function that generates a cache key from the request.
 */
export type CacheKeyFn = (args: { request: GenerateRequest }) => string;

/**
 * Plugin options for the cache middleware (non-serializable).
 * These are provided when registering the middleware plugin.
 */
export interface CachePluginOptions {
  /**
   * The storage backend for the cache.
   */
  store: CacheStore;

  /**
   * Named key generation functions.
   * Register custom key functions here, then reference them by name in the config.
   */
  keyFns?: Record<string, CacheKeyFn>;
}
