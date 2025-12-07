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
import { RTDBQuotaStore } from '../../src/quota/rtdb.js';
import * as admin from 'firebase-admin';

const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;

// Conditional describe
const describeRun = emulatorHost ? describe : describe.skip;

describeRun('RTDB Quota Store', () => {
  let db: admin.database.Database;
  let store: RTDBQuotaStore;

  beforeEach(async () => {
    if (!admin.apps.length) {
      admin.initializeApp({
        projectId: 'test-project',
        databaseURL: `http://${emulatorHost}/?ns=test-ns`
      });
    }
    db = admin.database();
    
    // Use timestamp-based path for isolation
    const randomPath = `quotas/${Date.now()}_${Math.random().toString(36).substring(7)}`;
    store = new RTDBQuotaStore(db, randomPath);
  });

  it('should increment and return new value', async () => {
    const val = await store.increment('key1', 1, 1000);
    expect(val).toBe(1);
    
    const val2 = await store.increment('key1', 1, 1000);
    expect(val2).toBe(2);
  });

  it('should reset after window expires', async () => {
    await store.increment('key2', 5, 200); 
    
    await new Promise(r => setTimeout(r, 300));
    
    const val = await store.increment('key2', 1, 200);
    expect(val).toBe(1);
  });
  
  it('should sanitize keys', async () => {
      const badKey = 'user/123.456';
      const val = await store.increment(badKey, 1, 1000);
      expect(val).toBe(1);
      
      const safeKey = badKey.replace(/[.#$\/\[\]]/g, '_');
      const ref = db.ref(`${(store as any).rootPath}/${safeKey}`);
      const snap = await ref.once('value');
      expect(snap.exists()).toBe(true);
      expect(snap.val().count).toBe(1);
  });
});
