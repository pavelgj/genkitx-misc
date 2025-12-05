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

import type { Firestore } from '@google-cloud/firestore';
import { QuotaStore } from './types.js';

export class FirestoreQuotaStore implements QuotaStore {
  constructor(
    private firestore: Firestore,
    private collection: string = 'quotas'
  ) {}

  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    const docRef = this.firestore.collection(this.collection).doc(key);
    
    return this.firestore.runTransaction(async (t) => {
      const doc = await t.get(docRef);
      const now = Date.now();
      
      let usage = 0;
      let expiresAt = now + windowMs;
      
      if (doc.exists) {
        const data = doc.data();
        // Check if window expired
        if (data && data.expiresAt && data.expiresAt > now) {
          // Window active
          usage = (data.count || 0);
          expiresAt = data.expiresAt;
        } else {
          // Window expired, reset
          usage = 0;
          expiresAt = now + windowMs;
        }
      }

      // Optimization: If limit provided and exceeded, don't write
      if (limit !== undefined && usage >= limit) {
        return usage + delta;
      }
      
      usage += delta;
      
      t.set(docRef, {
        count: usage,
        expiresAt: expiresAt,
        lastUpdated: now
      });
      
      return usage;
    });
  }
}
