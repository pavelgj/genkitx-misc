import { describe, it, expect, beforeEach } from '@jest/globals';
import { FirestoreCacheStore } from '../../src/cache/firestore.js';
import { Firestore } from '@google-cloud/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeRun = emulatorHost ? describe : describe.skip;

describeRun('Firestore Cache Store', () => {
  let firestore: Firestore;
  let store: FirestoreCacheStore;

  beforeEach(async () => {
    firestore = new Firestore({
      projectId: 'test-project',
      host: emulatorHost,
      ssl: false
    });
    const randomCol = `cache-${Date.now()}-${Math.random()}`;
    store = new FirestoreCacheStore(firestore, randomCol);
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

  it('should handle undefined values in nested objects', async () => {
    const data = {
      candidates: [
        {
          finishMessage: undefined,
          valid: 'value'
        }
      ]
    };
    await store.set('key-undefined', data, 1000);
    const val = await store.get('key-undefined');
    expect(val).toBeDefined();
  });
});
