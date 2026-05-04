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

import { describe, it, expect } from '@jest/globals';
import { genkit, z } from 'genkit';
import { smartMaxTurns } from '../../src/smart-max-turns/middleware.js';
import { detectExactLoops, detectResponseRepetition } from '../../src/smart-max-turns/detectors.js';
import type { MessageData } from 'genkit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let modelCounter = 0;
function uniqueName(prefix: string): string {
  return `${prefix}-${++modelCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Detector unit tests
// ---------------------------------------------------------------------------

describe('detectExactLoops', () => {
  it('returns ok when there are no messages', () => {
    expect(detectExactLoops([], 2).status).toBe('ok');
  });

  it('returns ok when no tool calls are repeated', () => {
    const messages: MessageData[] = [
      {
        role: 'model',
        content: [{ toolRequest: { name: 'search', input: { q: 'cats' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result1' } }],
      },
      {
        role: 'model',
        content: [{ toolRequest: { name: 'search', input: { q: 'dogs' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result2' } }],
      },
    ];
    expect(detectExactLoops(messages, 2).status).toBe('ok');
  });

  it('detects identical tool calls repeated consecutively', () => {
    const messages: MessageData[] = [
      {
        role: 'model',
        content: [{ toolRequest: { name: 'search', input: { q: 'cats' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result1' } }],
      },
      {
        role: 'model',
        content: [{ toolRequest: { name: 'search', input: { q: 'cats' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result1' } }],
      },
    ];
    const result = detectExactLoops(messages, 2);
    expect(result.status).toBe('loop');
    expect(result.detail).toContain('search');
    expect(result.detail).toContain('2');
  });

  it('respects threshold parameter', () => {
    const messages: MessageData[] = [
      {
        role: 'model',
        content: [{ toolRequest: { name: 'fetch', input: { url: 'http://example.com' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'fetch', output: 'page' } }],
      },
      {
        role: 'model',
        content: [{ toolRequest: { name: 'fetch', input: { url: 'http://example.com' } } }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'fetch', output: 'page' } }],
      },
    ];
    // threshold=3 — only 2 repeats, should be ok
    expect(detectExactLoops(messages, 3).status).toBe('ok');
    // threshold=2 — 2 repeats, should detect loop
    expect(detectExactLoops(messages, 2).status).toBe('loop');
  });
});

describe('detectResponseRepetition', () => {
  it('returns ok when there are no tool messages', () => {
    expect(detectResponseRepetition([], 2).status).toBe('ok');
  });

  it('returns ok when tool responses differ', () => {
    const messages: MessageData[] = [
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result A' } }],
      },
      {
        role: 'model',
        content: [{ text: 'thinking...' }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'result B' } }],
      },
    ];
    expect(detectResponseRepetition(messages, 2).status).toBe('ok');
  });

  it('detects identical tool responses repeated consecutively', () => {
    const messages: MessageData[] = [
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'same result' } }],
      },
      {
        role: 'model',
        content: [{ text: 'let me try again' }],
      },
      {
        role: 'tool',
        content: [{ toolResponse: { name: 'search', output: 'same result' } }],
      },
    ];
    const result = detectResponseRepetition(messages, 2);
    expect(result.status).toBe('stalled');
    expect(result.detail).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// Middleware integration tests
// ---------------------------------------------------------------------------

describe('smartMaxTurns – hard ceiling', () => {
  it('aborts when hard turn limit is reached', async () => {
    const ai = genkit({});

    const dummyTool = ai.defineTool(
      {
        name: 'dummy_tool',
        description: 'does nothing',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    // Model always requests a tool call — never stops
    const pm = ai.defineModel({ name: uniqueName('loopModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ toolRequest: { name: 'dummy_tool', input: {} } }],
      },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [dummyTool],
      use: [
        smartMaxTurns({
          maxTurns: 4,
          minTurns: 1,
          detect: { exactLoops: false, responseRepetition: false },
        }),
      ],
    });

    expect(result.finishReason).toBe('aborted');
    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(meta.reason).toBe('loop');
    expect(meta.detail).toContain('Hard turn limit');
  });
});

describe('smartMaxTurns – minTurns passthrough', () => {
  it('does not check detectors before minTurns', async () => {
    const ai = genkit({});

    let turnCount = 0;
    const dummyTool = ai.defineTool(
      {
        name: 'count_tool',
        description: 'counts',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => {
        turnCount++;
        return 'ok';
      }
    );

    // Model makes identical calls for 3 turns, then stops
    let modelCalls = 0;
    const pm = ai.defineModel({ name: uniqueName('minTurnsModel') }, async () => {
      modelCalls++;
      if (modelCalls <= 3) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'count_tool', input: {} } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'done after several turns' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [dummyTool],
      use: [smartMaxTurns({ maxTurns: 20, minTurns: 5 })],
    });

    // Should have completed successfully because detectors don't run until turn 5
    expect(result.text).toBe('done after several turns');
    expect(turnCount).toBe(3);
  });
});

describe('smartMaxTurns – exact loop detection with abort', () => {
  it('detects and aborts on exact loop', async () => {
    const ai = genkit({});

    const echoTool = ai.defineTool(
      {
        name: 'echo_tool',
        description: 'echoes',
        inputSchema: z.object({ msg: z.string() }),
        outputSchema: z.string(),
      },
      async ({ msg }) => `echo: ${msg}`
    );

    // Model always makes the same tool call
    const pm = ai.defineModel({ name: uniqueName('loopDetectModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ toolRequest: { name: 'echo_tool', input: { msg: 'hello' } } }],
      },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [echoTool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          onDetection: 'abort',
          detect: { exactLoops: { threshold: 2 }, responseRepetition: false },
        }),
      ],
    });

    expect(result.finishReason).toBe('aborted');
    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(meta.reason).toBe('loop');
    expect(meta.detail).toContain('echo_tool');
  });
});

describe('smartMaxTurns – response repetition detection', () => {
  it('detects and aborts on response repetition', async () => {
    const ai = genkit({});

    const staticTool = ai.defineTool(
      {
        name: 'static_tool',
        description: 'returns the same thing',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'always the same'
    );

    // Model varies its arguments slightly but tool returns the same thing
    let callNum = 0;
    const pm = ai.defineModel({ name: uniqueName('respRepModel') }, async () => {
      callNum++;
      return {
        message: {
          role: 'model' as const,
          content: [{ toolRequest: { name: 'static_tool', input: {} } }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [staticTool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          onDetection: 'abort',
          detect: { exactLoops: false, responseRepetition: { threshold: 2 } },
        }),
      ],
    });

    expect(result.finishReason).toBe('aborted');
    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    // Could be 'loop' (from exact loops since same input too) or 'stalled'
    expect(['loop', 'stalled']).toContain(meta.reason);
  });
});

describe('smartMaxTurns – wrapUp strategy', () => {
  it('removes tools and asks model to wrap up on detection', async () => {
    const ai = genkit({});

    const echoTool = ai.defineTool(
      {
        name: 'wrap_tool',
        description: 'echoes',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'echo'
    );

    let modelCalls = 0;
    const pm = ai.defineModel({ name: uniqueName('wrapUpModel') }, async (req) => {
      modelCalls++;
      // Once tools are removed (wrapUp), return a final answer
      if (!req.tools || req.tools.length === 0) {
        return {
          message: {
            role: 'model' as const,
            content: [{ text: 'Here is my final summary based on what I found.' }],
          },
        };
      }
      // Otherwise keep making tool calls
      return {
        message: {
          role: 'model' as const,
          content: [{ toolRequest: { name: 'wrap_tool', input: {} } }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [echoTool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          onDetection: 'wrapUp',
          detect: { exactLoops: { threshold: 2 }, responseRepetition: false },
        }),
      ],
    });

    // Should have gotten a final answer from the wrap-up call
    expect(result.text).toContain('final summary');
    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(meta.action).toBe('wrapUp');
    expect(meta.reason).toBe('loop');
  });
});

describe('smartMaxTurns – pruneTools strategy', () => {
  it('removes looping tools and lets model continue', async () => {
    const ai = genkit({});

    const loopingTool = ai.defineTool(
      {
        name: 'looping_tool',
        description: 'loops',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'same'
    );

    const goodTool = ai.defineTool(
      {
        name: 'good_tool',
        description: 'works',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'good result'
    );

    let modelCalls = 0;
    const pm = ai.defineModel({ name: uniqueName('pruneModel') }, async (req) => {
      modelCalls++;
      const availableTools = (req.tools || []).map((t: any) => t.name);

      // If looping_tool was pruned, use good_tool or respond
      if (!availableTools.includes('looping_tool')) {
        if (availableTools.includes('good_tool')) {
          return {
            message: {
              role: 'model' as const,
              content: [{ toolRequest: { name: 'good_tool', input: {} } }],
            },
          };
        }
        return {
          message: {
            role: 'model' as const,
            content: [{ text: 'Completed with good tool result.' }],
          },
        };
      }

      // Keep calling looping_tool
      return {
        message: {
          role: 'model' as const,
          content: [{ toolRequest: { name: 'looping_tool', input: {} } }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [loopingTool, goodTool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          onDetection: 'pruneTools',
          detect: { exactLoops: { threshold: 2 }, responseRepetition: false },
        }),
      ],
    });

    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(meta.action).toBe('pruneTools');
    expect(meta.prunedTools).toContain('looping_tool');
  });

  it('falls back to wrapUp when all tools would be pruned', async () => {
    const ai = genkit({});

    const onlyTool = ai.defineTool(
      {
        name: 'only_tool',
        description: 'the only one',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'same'
    );

    let modelCalls = 0;
    const pm = ai.defineModel({ name: uniqueName('pruneAllModel') }, async (req) => {
      modelCalls++;
      if (!req.tools || req.tools.length === 0) {
        return {
          message: {
            role: 'model' as const,
            content: [{ text: 'Wrapping up without tools.' }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ toolRequest: { name: 'only_tool', input: {} } }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [onlyTool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          onDetection: 'pruneTools',
          detect: { exactLoops: { threshold: 2 }, responseRepetition: false },
        }),
      ],
    });

    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(meta.action).toBe('pruneTools-fallbackWrapUp');
    expect(meta.prunedTools).toContain('only_tool');
  });
});

describe('smartMaxTurns – passthrough', () => {
  it('is transparent when no loops are detected', async () => {
    const ai = genkit({});

    const pm = ai.defineModel({ name: uniqueName('okModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'all good, no tools needed' }],
      },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [smartMaxTurns()],
    });

    expect(result.text).toBe('all good, no tools needed');
    expect((result.custom as any)?.smartMaxTurns).toBeUndefined();
  });

  it('passes through when model uses tools and stops naturally', async () => {
    const ai = genkit({});

    const searchTool = ai.defineTool(
      {
        name: 'search',
        description: 'searches',
        inputSchema: z.object({ q: z.string() }),
        outputSchema: z.string(),
      },
      async ({ q }) => `results for ${q}`
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('naturalModel') }, async () => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'search', input: { q: 'cats' } } }],
          },
        };
      }
      if (turn === 2) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'search', input: { q: 'dogs' } } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'Found info about cats and dogs.' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [searchTool],
      use: [smartMaxTurns({ minTurns: 1 })],
    });

    expect(result.text).toBe('Found info about cats and dogs.');
    expect((result.custom as any)?.smartMaxTurns).toBeUndefined();
  });
});

describe('smartMaxTurns – all detectors disabled', () => {
  it('only enforces hard ceiling when all detectors are off', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'repeat_tool',
        description: 'repeats',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'same'
    );

    let modelCalls = 0;
    const pm = ai.defineModel({ name: uniqueName('noneModel') }, async () => {
      modelCalls++;
      if (modelCalls <= 5) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'repeat_tool', input: {} } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'finally done' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [tool],
      use: [
        smartMaxTurns({
          maxTurns: 20,
          minTurns: 1,
          detect: { exactLoops: false, responseRepetition: false },
        }),
      ],
    });

    // With detectors off, the identical tool calls should not trigger abort
    expect(result.text).toBe('finally done');
    expect(modelCalls).toBe(6);
  });
});

describe('smartMaxTurns – metadata', () => {
  it('includes turnsUsed in metadata on abort', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'meta_tool',
        description: 'for metadata test',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'same'
    );

    const pm = ai.defineModel({ name: uniqueName('metaModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ toolRequest: { name: 'meta_tool', input: {} } }],
      },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [tool],
      use: [
        smartMaxTurns({
          maxTurns: 5,
          minTurns: 1,
          onDetection: 'abort',
        }),
      ],
    });

    expect(result.finishReason).toBe('aborted');
    const meta = (result.custom as any)?.smartMaxTurns;
    expect(meta).toBeDefined();
    expect(typeof meta.turnsUsed).toBe('number');
    expect(meta.turnsUsed).toBeGreaterThanOrEqual(1);
  });
});
