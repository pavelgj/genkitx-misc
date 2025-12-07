import { describe, it, expect, beforeEach } from '@jest/globals';
import { RedisCacheStore } from '../../src/cache/redis.js';
import RedisMock from 'ioredis-mock';

describe('Redis Cache Store', () => {
  let redis: any;
  let store: RedisCacheStore;

  beforeEach(() => {
    redis = new RedisMock();
    store = new RedisCacheStore({ client: redis });
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
    
    await new Promise(r => setTimeout(r, 300));
    
    const val = await store.get('key2');
    expect(val).toBeNull();
  });
});
