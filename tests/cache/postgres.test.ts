import { describe, it, expect, beforeEach } from '@jest/globals';
import { PostgresCacheStore } from '../../src/cache/postgres.js';
import { newDb } from 'pg-mem';

describe('Postgres Cache Store', () => {
  let pool: any;
  let store: PostgresCacheStore;

  beforeEach(async () => {
    const db = newDb();
    pool = db.adapters.createPg().Pool;
    const p = new pool();
    store = new PostgresCacheStore({ pool: p });
  });

  it('should set and get values', async () => {
    await store.set('key1', { foo: 'bar' }, 1000);
    const val = await store.get('key1');
    expect(val).toEqual({ foo: 'bar' });
  });

  it('should return null for missing key', async () => {
    const val = await store.get('missing');
    expect(val).toBeNull();
  });

  it('should expire keys', async () => {
    await store.set('key2', 'value', 200);

    await new Promise((r) => setTimeout(r, 300));

    const val = await store.get('key2');
    expect(val).toBeNull();
  });
});
