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

export interface CacheOptions {
  /**
   * The storage backend for the cache.
   */
  store: CacheStore;

  /**
   * The time to live for cached entries in milliseconds.
   * @example 60000 // 1 minute
   */
  ttlMs: number;

  /**
   * Key to use for the cache. Can be a static string or a function derived from the request.
   * If not provided, a hash of the request will be used.
   */
  key?: string | ((args: { request: GenerateRequest }) => string);
}
