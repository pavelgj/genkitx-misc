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
import { genkit, z } from 'genkit';
import { router } from '../../src/router/middleware.js';

describe('Router Middleware', () => {
  let ai: ReturnType<typeof genkit>;

  beforeEach(() => {
    ai = genkit({
      plugins: [router.plugin()],
    });

    ai.defineModel({ name: 'modelA' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Model A' }] },
    }));

    ai.defineModel({ name: 'modelB' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Model B' }] },
    }));

    ai.defineModel({ name: 'defaultModel' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Default Model' }] },
    }));
  });

  it('should route based on rules using built-in matcher', async () => {
    const response = await ai.generate({
      model: 'defaultModel',
      prompt: [
        { text: 'look at this' },
        { media: { url: 'http://example.com/image.jpg', contentType: 'image/jpeg' } },
      ],
      use: [
        router({
          rules: [{ when: 'hasMedia', use: { name: 'modelA' } }],
        }),
      ],
    });

    expect(response.text).toContain('Model A');
  });

  it('should fallback to default if no rules match', async () => {
    const response = await ai.generate({
      model: 'defaultModel',
      prompt: 'hello',
      use: [
        router({
          rules: [{ when: 'hasMedia', use: { name: 'modelA' } }],
        }),
      ],
    });

    expect(response.text).toContain('Default Model');
  });

  it('should prioritize rules in order', async () => {
    const response = await ai.generate({
      model: 'defaultModel',
      prompt: [
        { text: 'look at this' },
        { media: { url: 'http://example.com/image.jpg', contentType: 'image/jpeg' } },
      ],
      use: [
        router({
          rules: [
            { when: 'hasMedia', use: { name: 'modelA' } },
            { when: 'hasTools', use: { name: 'modelB' } },
          ],
        }),
      ],
    });

    expect(response.text).toContain('Model A');
  });

  it('should support hasTools matcher', async () => {
    // Without tools
    const resp1 = await ai.generate({
      model: 'defaultModel',
      prompt: 'hello',
      use: [
        router({
          rules: [{ when: 'hasTools', use: { name: 'modelB' } }],
        }),
      ],
    });
    expect(resp1.text).toContain('Default Model');

    // With tools
    const tool = ai.defineTool(
      { name: 'testTool', description: 'does stuff', inputSchema: z.object({}) },
      async () => 'done'
    );
    const resp2 = await ai.generate({
      model: 'defaultModel',
      prompt: 'hello',
      tools: [tool],
      use: [
        router({
          rules: [{ when: 'hasTools', use: { name: 'modelB' } }],
        }),
      ],
    });
    expect(resp2.text).toContain('Model B');
  });
});

describe('Router Middleware with custom matchers', () => {
  it('should use custom matchers from plugin options', async () => {
    const ai = genkit({
      plugins: [
        router.plugin({
          matchers: {
            alwaysTrue: () => true,
          },
        }),
      ],
    });

    ai.defineModel({ name: 'modelA' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Model A' }] },
    }));
    ai.defineModel({ name: 'defaultModel' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Default Model' }] },
    }));

    const response = await ai.generate({
      model: 'defaultModel',
      prompt: 'hello',
      use: [
        router({
          rules: [{ when: 'alwaysTrue', use: { name: 'modelA' } }],
        }),
      ],
    });

    expect(response.text).toContain('Model A');
  });
});

describe('Router Middleware with classifier', () => {
  it('should use classifier from plugin options', async () => {
    const ai = genkit({
      plugins: [
        router.plugin({
          classifiers: {
            byLength: async ({ request }) => {
              const text = request.messages
                .map((m: any) => m.content.map((c: any) => c.text).join(''))
                .join('');
              return text.length > 20 ? 'complex' : 'simple';
            },
          },
        }),
      ],
    });

    ai.defineModel({ name: 'simpleModel' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Simple Model' }] },
    }));
    ai.defineModel({ name: 'complexModel' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Complex Model' }] },
    }));
    ai.defineModel({ name: 'defaultModel' }, async () => ({
      message: { role: 'model', content: [{ text: 'Response from Default Model' }] },
    }));

    const resp1 = await ai.generate({
      model: 'defaultModel',
      prompt: 'short',
      use: [
        router({
          classifier: 'byLength',
          models: {
            simple: { name: 'simpleModel' },
            complex: { name: 'complexModel' },
          },
        }),
      ],
    });
    expect(resp1.text).toContain('Simple Model');

    const resp2 = await ai.generate({
      model: 'defaultModel',
      prompt: 'This is a much longer prompt that should be classified as complex',
      use: [
        router({
          classifier: 'byLength',
          models: {
            simple: { name: 'simpleModel' },
            complex: { name: 'complexModel' },
          },
        }),
      ],
    });
    expect(resp2.text).toContain('Complex Model');
  });
});
