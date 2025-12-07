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

import Redis from 'ioredis';
import { CacheStore } from './types.js';

export interface RedisCacheOptions {
  /**
   * Redis instance or connection string or options.
   * If passing a string or options, a new Redis instance will be created.
   */
  client: Redis | string | any;
  /**
   * Prefix for keys. Defaults to 'cache:'.
   */
  prefix?: string;
}

export class RedisCacheStore implements CacheStore {
  private client: Redis;
  private prefix: string;

  constructor(options: RedisCacheOptions) {
    if (
      options.client instanceof Redis ||
      (typeof options.client === 'object' && typeof options.client.eval === 'function')
    ) {
      this.client = options.client;
    } else {
      this.client = new Redis(options.client);
    }
    this.prefix = options.prefix || 'cache:';
  }

  async get(key: string): Promise<any | null> {
    const val = await this.client.get(this.prefix + key);
    if (!val) {
      return null;
    }
    try {
      return JSON.parse(val);
    } catch (e) {
      console.error(`[RedisCacheStore] Failed to parse cache value for '${key}'`, e);
      return null;
    }
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    await this.client.set(this.prefix + key, JSON.stringify(value), 'PX', ttlMs);
  }
}
