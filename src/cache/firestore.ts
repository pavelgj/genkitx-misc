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
import { CacheStore } from './types.js';

export class FirestoreCacheStore implements CacheStore {
  constructor(
    private firestore: Firestore,
    private collection: string = 'cache'
  ) {}

  async get(key: string): Promise<any | null> {
    const docRef = this.firestore.collection(this.collection).doc(key);
    const doc = await docRef.get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data();
    if (!data) {
      return null;
    }

    if (data.expiresAt && data.expiresAt < Date.now()) {
      // Expired, clean up asynchronously
      docRef.delete().catch(e => console.error(`[FirestoreCacheStore] Failed to delete expired key '${key}':`, e));
      return null;
    }

    return data.value;
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    const docRef = this.firestore.collection(this.collection).doc(key);
    const cleanValue = removeUndefined(value);
    await docRef.set({
      value: cleanValue === undefined ? null : cleanValue,
      expiresAt: Date.now() + ttlMs
    });
  }
}

function removeUndefined(obj: any): any {
  if (obj === undefined) {
    return undefined;
  }
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((v) => {
      const cleaned = removeUndefined(v);
      return cleaned === undefined ? null : cleaned;
    });
  }

  // Only iterate over plain objects
  const proto = Object.getPrototypeOf(obj);
  if (proto !== null && proto !== Object.prototype) {
    return obj;
  }

  const result: any = {};
  for (const key in obj) {
    const val = removeUndefined(obj[key]);
    if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}
