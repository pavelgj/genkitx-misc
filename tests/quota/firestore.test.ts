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

import { describe, it, expect, beforeEach } from '@jest/globals';
import { FirestoreQuotaStore } from '../../src/quota/firestore.js';
import { Firestore } from '@google-cloud/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

// Conditional describe
const describeRun = emulatorHost ? describe : describe.skip;

describeRun('Firestore Quota Store', () => {
  let firestore: Firestore;
  let store: FirestoreQuotaStore;

  beforeEach(async () => {
    firestore = new Firestore({
      projectId: 'test-project',
      host: emulatorHost,
      ssl: false,
    });
    // Use random collection for isolation
    const randomCol = `quotas-${Date.now()}-${Math.random()}`;
    store = new FirestoreQuotaStore(firestore, randomCol);
  });

  it('should increment and return new value', async () => {
    const val = await store.increment('key1', 1, 1000);
    expect(val).toBe(1);

    const val2 = await store.increment('key1', 1, 1000);
    expect(val2).toBe(2);
  });

  it('should reset after window expires', async () => {
    await store.increment('key2', 5, 200); // 200ms window

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 300));

    // Next increment should reset
    const val = await store.increment('key2', 1, 200);
    expect(val).toBe(1);
  });

  it('should not extend window on subsequent increments', async () => {
    // Start window
    await store.increment('key3', 1, 1000);

    // Get expiration from raw doc (using private access or creating another instance)
    // We can access collection name from our variable
    const colName = (store as any).collection;
    const docRef = firestore.collection(colName).doc('key3');

    const doc1 = await docRef.get();
    const expiresAt1 = doc1.data()?.expiresAt;

    await new Promise((r) => setTimeout(r, 50));

    await store.increment('key3', 1, 1000);

    const doc2 = await docRef.get();
    const expiresAt2 = doc2.data()?.expiresAt;

    expect(expiresAt1).toBeDefined();
    expect(expiresAt1).toBe(expiresAt2);
  });
});
