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

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { cache } from '../../src/cache/middleware.js';
import { InMemoryCacheStore } from '../../src/cache/memory.js';
import { genkit } from 'genkit';
import { defineEchoModel } from '../helpers.js';

describe('Cache Middleware Integration', () => {
  let ai: ReturnType<typeof genkit>;
  let store: InMemoryCacheStore;

  beforeEach(() => {
    store = new InMemoryCacheStore();
    ai = genkit({
      plugins: [cache.plugin({ store })],
    });
    defineEchoModel(ai);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should cache responses', async () => {
    // First call - should be computed
    const response1 = await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000 })],
    });
    expect(response1.text).toContain('Echo: hello');

    // Second call - should hit cache and return same object reference (for InMemoryStore)
    const response2 = await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000 })],
    });
    expect(response2.text).toContain('Echo: hello');

    // Verify it returned the cached object
    expect(response2).toEqual(response1);
  });

  it('should miss cache for different prompts', async () => {
    const response1 = await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000 })],
    });

    const response2 = await ai.generate({
      model: 'echoModel',
      prompt: 'world',
      use: [cache({ ttlMs: 1000 })],
    });

    expect(response2.text).toContain('Echo: world');
    expect(response2).not.toBe(response1);
  });

  it('should expire cache entries', async () => {
    const response1 = await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000 })],
    });

    // Advance time past TTL
    jest.advanceTimersByTime(1001);

    const response2 = await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000 })],
    });

    // Should be a new object because cache expired
    expect(response2).not.toBe(response1);
    expect(response2.text).toContain('Echo: hello');
  });

  it('should use static key', async () => {
    await ai.generate({
      model: 'echoModel',
      prompt: 'hello',
      use: [cache({ ttlMs: 1000, key: 'static-key' })],
    });

    // Even with different prompt, should hit cache if key is static
    const response2 = await ai.generate({
      model: 'echoModel',
      prompt: 'world',
      use: [cache({ ttlMs: 1000, key: 'static-key' })],
    });

    // Should return the cached response for "hello"
    expect(response2.text).toContain('Echo: hello');
  });

  it('should use named key function', async () => {
    const storeWithKeyFn = new InMemoryCacheStore();
    const aiWithKeyFn = genkit({
      plugins: [
        cache.plugin({
          store: storeWithKeyFn,
          keyFns: {
            byFirstWord: ({ request }) => {
              const text = request.messages[0]?.content[0]?.text || '';
              return text.split(' ')[0];
            },
          },
        }),
      ],
    });
    defineEchoModel(aiWithKeyFn);

    await aiWithKeyFn.generate({
      model: 'echoModel',
      prompt: 'hello world',
      use: [cache({ ttlMs: 1000, keyFn: 'byFirstWord' })],
    });

    // Same first word, should hit cache
    const response2 = await aiWithKeyFn.generate({
      model: 'echoModel',
      prompt: 'hello universe',
      use: [cache({ ttlMs: 1000, keyFn: 'byFirstWord' })],
    });

    expect(response2.text).toContain('Echo: hello world');
  });
});
