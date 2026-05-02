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

export interface QuotaStore {
  /**
   * Increment the usage counter for the given key.
   * @param key unique identifier for the quota (e.g. 'global', 'user:123')
   * @param delta amount to increment (default 1)
   * @param windowMs duration of the window in milliseconds (for expiration/reset)
   * @param limit optional limit. If provided, the store can optimize by not incrementing if limit is already exceeded.
   * @returns The current usage count (or simulated usage if limit exceeded).
   */
  increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number>;
}

/**
 * A function that generates a quota key from the request.
 */
export type QuotaKeyFn = (args: { request: GenerateRequest }) => string;

/**
 * Plugin options for the quota middleware (non-serializable).
 * These are provided when registering the middleware plugin.
 */
export interface QuotaPluginOptions {
  /**
   * The storage backend for keeping track of quotas.
   */
  store: QuotaStore;

  /**
   * Named key generation functions.
   * Register custom key functions here, then reference them by name in the config.
   */
  keyFns?: Record<string, QuotaKeyFn>;
}
