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
import { quota } from '../../src/quota/middleware.js';
import { InMemoryQuotaStore } from '../../src/quota/memory.js';
import { genkit, GenkitError } from 'genkit';
import { defineEchoModel } from '../helpers.js';
import { QuotaStore } from '../../src/quota/index.js';

describe('Quota Middleware Integration', () => {
  let ai: ReturnType<typeof genkit>;
  let store: InMemoryQuotaStore;

  beforeEach(() => {
    store = new InMemoryQuotaStore();
    ai = genkit({
      plugins: [quota.plugin({ store })],
    });
    defineEchoModel(ai);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should allow requests within quota', async () => {
    const response = await ai.generate({
      model: 'echoModel',
      prompt: 'hi',
      use: [quota({ limit: 2, windowMs: 1000 })],
    });
    expect(response.text).toContain('Echo: hi');

    const response2 = await ai.generate({
      model: 'echoModel',
      prompt: 'hi',
      use: [quota({ limit: 2, windowMs: 1000 })],
    });
    expect(response2.text).toContain('Echo: hi');
  });

  it('should block requests exceeding quota', async () => {
    await ai.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000 })],
    });

    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '2',
        use: [quota({ limit: 1, windowMs: 1000 })],
      })
    ).rejects.toThrow(GenkitError);
  });

  it('should reset quota after window expiration', async () => {
    await ai.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000 })],
    });
    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '2',
        use: [quota({ limit: 1, windowMs: 1000 })],
      })
    ).rejects.toThrow();

    jest.advanceTimersByTime(1001);

    const response = await ai.generate({
      model: 'echoModel',
      prompt: '3',
      use: [quota({ limit: 1, windowMs: 1000 })],
    });
    expect(response.text).toContain('Echo: 3');
  });

  it('should use custom string key', async () => {
    await ai.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000, key: 'my-custom-key' })],
    });
    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '2',
        use: [quota({ limit: 1, windowMs: 1000, key: 'my-custom-key' })],
      })
    ).rejects.toThrow();

    // Verify it was stored under 'my-custom-key'
    const current = await store.increment('my-custom-key', 0, 1000);
    expect(current).toBe(1);
  });

  it('should not block if logOnly is true', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await ai.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000, logOnly: true })],
    });
    await ai.generate({
      model: 'echoModel',
      prompt: '2',
      use: [quota({ limit: 1, windowMs: 1000, logOnly: true })],
    });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[Genkit Quota Warning]'));
    consoleSpy.mockRestore();
  });

  it('should block all requests if limit is 0', async () => {
    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '1',
        use: [quota({ limit: 0, windowMs: 1000 })],
      })
    ).rejects.toThrow(GenkitError);
  });

  it('should fail open (allow request) if store throws error', async () => {
    const failingStore = {
      increment: (_, __, ___): Promise<number> => {
        throw new Error('Store down');
      },
    } as QuotaStore;

    const aiFailOpen = genkit({
      plugins: [quota.plugin({ store: failingStore })],
    });
    defineEchoModel(aiFailOpen);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await aiFailOpen.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000, failOpen: true })],
    });
    expect(response.text).toContain('Echo: 1');
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to check quota'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('should fail closed (block request) if store throws error and failOpen is false', async () => {
    const failingStore = {
      increment: (_, __, ___): Promise<number> => {
        throw new Error('Store down');
      },
    } as QuotaStore;

    const aiFailClosed = genkit({
      plugins: [quota.plugin({ store: failingStore })],
    });
    defineEchoModel(aiFailClosed);

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      aiFailClosed.generate({
        model: 'echoModel',
        prompt: '1',
        use: [quota({ limit: 1, windowMs: 1000, failOpen: false })],
      })
    ).rejects.toThrow(GenkitError);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to check quota'),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('should use named key function', async () => {
    const aiWithKeyFn = genkit({
      plugins: [
        quota.plugin({
          store,
          keyFns: {
            byUserId: ({ request }) =>
              (request.messages[0]?.content[0]?.metadata?.userId as string) || 'anon',
          },
        }),
      ],
    });
    defineEchoModel(aiWithKeyFn);

    await aiWithKeyFn.generate({
      model: 'echoModel',
      prompt: [{ text: 'hi', metadata: { userId: 'alice' } }],
      use: [quota({ limit: 1, windowMs: 1000, keyFn: 'byUserId' })],
    });

    await expect(
      aiWithKeyFn.generate({
        model: 'echoModel',
        prompt: [{ text: 'hi', metadata: { userId: 'alice' } }],
        use: [quota({ limit: 1, windowMs: 1000, keyFn: 'byUserId' })],
      })
    ).rejects.toThrow();

    // Bob should be allowed
    await aiWithKeyFn.generate({
      model: 'echoModel',
      prompt: [{ text: 'hi', metadata: { userId: 'bob' } }],
      use: [quota({ limit: 1, windowMs: 1000, keyFn: 'byUserId' })],
    });
  });

  it('should not increment store count if limit exceeded (optimization)', async () => {
    await ai.generate({
      model: 'echoModel',
      prompt: '1',
      use: [quota({ limit: 1, windowMs: 1000 })],
    }); // Count 1

    // Blocked
    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '2',
        use: [quota({ limit: 1, windowMs: 1000 })],
      })
    ).rejects.toThrow();
    await expect(
      ai.generate({
        model: 'echoModel',
        prompt: '3',
        use: [quota({ limit: 1, windowMs: 1000 })],
      })
    ).rejects.toThrow();

    // Verify store count is still 1 (optimization prevents writing)
    const current = await store.increment('global', 0, 1000);
    expect(current).toBe(1);
  });
});
