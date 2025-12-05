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

import { QuotaStore } from './types.js';

interface QuotaData {
  count: number;
  expiresAt: number;
}

export class InMemoryQuotaStore implements QuotaStore {
  private store = new Map<string, QuotaData>();

  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    const now = Date.now();
    let data = this.store.get(key);
    
    if (!data || data.expiresAt <= now) {
      data = {
        count: 0,
        expiresAt: now + windowMs
      };
    }
    
    if (limit !== undefined && data.count >= limit) {
      return data.count + delta;
    }

    data.count += delta;
    this.store.set(key, data);
    
    return data.count;
  }
}
