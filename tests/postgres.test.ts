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

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { newDb } from 'pg-mem';
import { PostgresQuotaStore } from '../src/quota/postgres.js';

describe('Postgres Quota Store', () => {
  let store: PostgresQuotaStore;
  let db: any;

  beforeEach(() => {
    db = newDb();
    // pg-mem supports ON CONFLICT from v1.8+
    
    // Create a pool-like object from pg-mem
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    
    store = new PostgresQuotaStore({ pool });
  });
  
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create table if it does not exist', async () => {
    await store.increment('key1', 1, 1000);
    
    // Check if table exists
    const result = db.public.many(`SELECT * FROM quotas`);
    expect(result).toHaveLength(1);
  });

  it('should not create table if noCreate is true', async () => {
    const { Pool } = db.adapters.createPg();
    const pool = new Pool();
    const noCreateStore = new PostgresQuotaStore({ pool, noCreate: true });

    // Expect error because table doesn't exist
    await expect(noCreateStore.increment('key1', 1, 1000)).rejects.toThrow();
  });

  it('should increment and return new value', async () => {
    const val = await store.increment('key1', 1, 1000);
    expect(val).toBe(1);
    
    const val2 = await store.increment('key1', 1, 1000);
    expect(val2).toBe(2);

    const result = db.public.many(`SELECT * FROM quotas WHERE key = 'key1'`);
    expect(result[0].count).toBe(2);
  });

  it('should reset after window expires', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);

    await store.increment('key2', 5, 1000);
    
    // Advance time
    jest.spyOn(Date, 'now').mockReturnValue(now + 1001);
    
    const val = await store.increment('key2', 1, 1000);
    expect(val).toBe(1);

    const result = db.public.many(`SELECT * FROM quotas WHERE key = 'key2'`);
    expect(result[0].count).toBe(1);
  });

  it('should increment past limit', async () => {
    // Increment to limit (3)
    await store.increment('key3', 3, 1000);
    
    // Try to increment again with limit=3
    // It should increment to 4, which allows the middleware to detect the breach
    const val = await store.increment('key3', 1, 1000, 3);
    
    expect(val).toBe(4);
    
    const result = db.public.many(`SELECT * FROM quotas WHERE key = 'key3'`);
    expect(result[0].count).toBe(4);
  });
});
