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

import type { Database } from 'firebase-admin/database';
import { QuotaStore } from './types.js';

export class RTDBQuotaStore implements QuotaStore {
  constructor(
    private db: Database,
    private rootPath: string = 'quotas'
  ) {}

  private sanitizeKey(key: string): string {
    // Replace characters forbidden in RTDB keys: . $ # [ ] /
    return key.replace(/[.#$\/\[\]]/g, '_');
  }

  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    const safeKey = this.sanitizeKey(key);
    const ref = this.db.ref(`${this.rootPath}/${safeKey}`);

    const result = await ref.transaction((currentData) => {
      const now = Date.now();
      let usage = 0;
      let expiresAt = now + windowMs;

      if (currentData) {
        if (currentData.expiresAt && currentData.expiresAt > now) {
          usage = currentData.count || 0;
          expiresAt = currentData.expiresAt;
        } else {
          // Window expired, reset
          usage = 0;
          expiresAt = now + windowMs;
        }
      }

      if (limit !== undefined && usage >= limit) {
        // Abort transaction if limit exceeded to avoid write.
        // Returning undefined aborts the transaction.
        return;
      }

      usage += delta;

      return {
        count: usage,
        expiresAt,
        lastUpdated: now,
      };
    });

    if (result.committed) {
      const val = result.snapshot.val();
      return val ? val.count : 0;
    }

    // If transaction was aborted (committed is false), it means we returned undefined (limit exceeded)
    if (!result.committed) {
      // We need to fetch the current value to return simulated usage?
      // Or just assume it was at least limit?
      // We need to return a number.
      // If we aborted, we know `usage >= limit`.
      // We should probably return `usage + delta` but we don't have `usage` here easily unless we read it again or rely on snapshot?
      // snapshot might be the data before transaction?
      // result.snapshot is "The snapshot of the data at the location."
      // "If the transaction was aborted, the snapshot contains the data at the location."
      const currentData = result.snapshot.val();
      let usage = 0;
      if (currentData) {
        const now = Date.now();
        // Re-verify expiration logic?
        // Since we just ran transaction logic, we know `usage >= limit` happened.
        // But let's be safe.
        if (currentData.expiresAt && currentData.expiresAt > now) {
          usage = currentData.count || 0;
        }
      }
      return usage + delta;
    }

    throw new Error(`Failed to update quota in RTDB for key ${safeKey}`);
  }
}
