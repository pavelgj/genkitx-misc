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

import { CacheStore } from './types.js';

interface CacheEntry {
  value: any;
  expires: number;
}

export class InMemoryCacheStore implements CacheStore {
  private cache = new Map<string, CacheEntry>();

  constructor(cleanupIntervalMs: number = 60000) {
    if (cleanupIntervalMs > 0) {
      const interval = setInterval(() => {
        this.cleanup();
      }, cleanupIntervalMs);
      if (interval.unref) interval.unref();
    }
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }

  async get(key: string): Promise<any | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    this.cache.set(key, {
      value,
      expires: Date.now() + ttlMs,
    });
  }
}
