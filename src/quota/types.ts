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

export interface QuotaOptions {
  /**
   * The storage backend for keeping track of quotas.
   */
  store: QuotaStore;

  /**
   * The maximum number of requests allowed within the window.
   */
  limit: number;

  /**
   * The duration of the quota window in milliseconds.
   * @example 60000 // 1 minute
   */
  windowMs: number;

  /**
   * Key to use for the quota. Can be a static string or a function derived from the request.
   * Defaults to 'global'.
   */
  key?: string | ((args: { request: GenerateRequest }) => string);

  /**
   * If true, only logs a warning when quota is exceeded, instead of throwing an error.
   * Defaults to false.
   */
  logOnly?: boolean;

  /**
   * Whether to allow the request to proceed if the quota check fails (e.g. storage down).
   * Defaults to false (block request on error).
   */
  failOpen?: boolean;
}
