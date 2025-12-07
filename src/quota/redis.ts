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
import { QuotaStore } from './types.js';

export interface RedisQuotaOptions {
  /**
   * Redis instance or connection string or options.
   * If passing a string or options, a new Redis instance will be created.
   */
  client: Redis | string | any;
  /**
   * Prefix for keys. Defaults to 'quota:'.
   */
  prefix?: string;
}

export class RedisQuotaStore implements QuotaStore {
  private client: Redis;
  private prefix: string;

  constructor(options: RedisQuotaOptions) {
    // Check if client is already a Redis instance (or mock)
    if (
      options.client instanceof Redis ||
      (typeof options.client === 'object' && typeof options.client.eval === 'function')
    ) {
      this.client = options.client;
    } else {
      this.client = new Redis(options.client);
    }
    this.prefix = options.prefix || 'quota:';
  }

  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    const redisKey = this.prefix + key;

    // Lua script to ensure atomicity
    // ARGV[1]: windowMs
    // ARGV[2]: limit (string "nil" if undefined, or number)
    // ARGV[3]: delta
    const script = `
      local limit = tonumber(ARGV[2])
      local delta = tonumber(ARGV[3])
      local current = redis.call("GET", KEYS[1])
      
      if current and limit and tonumber(current) >= limit then
        return tonumber(current) + delta
      end
      
      local count = redis.call("INCRBY", KEYS[1], delta)
      
      -- If count == delta, it means the key was just created (or expired and recreated)
      -- So we set the expiration.
      if count == delta then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      
      return count
    `;

    const result = await this.client.eval(
      script,
      1,
      redisKey,
      windowMs,
      limit === undefined ? 'nil' : limit,
      delta
    );

    return Number(result);
  }
}
