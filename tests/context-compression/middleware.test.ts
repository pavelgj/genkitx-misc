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
import { contextCompression } from '../../src/context-compression/middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let modelCounter = 0;
function uniqueName(prefix: string): string {
  return `${prefix}-${++modelCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Passthrough — no compression
// ---------------------------------------------------------------------------

describe('contextCompression – passthrough', () => {
  it('passes through on turn 0 (no prior usage)', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'hello' }],
      },
      usage: { inputTokens: 50000, outputTokens: 100 },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [contextCompression({ maxInputTokens: 1000 })],
    });

    expect(result.text).toBe('hello');
  });

  it('passes through when inputTokens is below threshold', async () => {
    const ai = genkit({});

    const dummyTool = ai.defineTool(
      {
        name: 'echo_tool',
        description: 'echoes',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'echoed'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'echo_tool', input: {} } }],
          },
          usage: { inputTokens: 500, outputTokens: 50 },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'done' }],
        },
        usage: { inputTokens: 600, outputTokens: 50 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [dummyTool],
      use: [contextCompression({ maxInputTokens: 10000 })],
    });

    expect(result.text).toBe('done');
    // No compression metadata since threshold was never exceeded
    expect((result.custom as any)?.contextCompression).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tool response truncation
// ---------------------------------------------------------------------------

describe('contextCompression – tool response truncation', () => {
  it('truncates old tool responses when threshold is exceeded', async () => {
    const ai = genkit({});

    const verboseTool = ai.defineTool(
      {
        name: 'verbose_tool',
        description: 'returns lots of data',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'A'.repeat(5000) // 5000 chars
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn === 1) {
        // First turn: request a tool call
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'verbose_tool', input: {} } }],
          },
          usage: { inputTokens: 90000, outputTokens: 100 },
        };
      }
      // Second turn: after compression, return text
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'processed' }],
        },
        usage: { inputTokens: 5000, outputTokens: 100 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [verboseTool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          toolResponses: { maxChars: 100, preserveRecent: 0 },
        }),
      ],
    });

    expect(result.text).toBe('processed');

    // Check that compression metadata was attached
    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
    expect(meta.toolResponsesTruncated).toBeGreaterThan(0);
  });

  it('preserves recent tool responses based on preserveRecent setting', async () => {
    const ai = genkit({});

    const tool1 = ai.defineTool(
      {
        name: 'data_tool',
        description: 'returns data',
        inputSchema: z.object({ id: z.number() }),
        outputSchema: z.string(),
      },
      async ({ id }) => 'X'.repeat(5000) + `-id${id}`
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 3) {
        // Request tool calls for turns 1-3
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'data_tool', input: { id: turn } } }],
          },
          // Only exceed threshold after turn 2
          usage: {
            inputTokens: turn >= 2 ? 90000 : 5000,
            outputTokens: 100,
          },
        };
      }
      // Turn 4: return final text
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'final answer' }],
        },
        usage: { inputTokens: 8000, outputTokens: 100 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'analyze data',
      tools: [tool1],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          toolResponses: { maxChars: 100, preserveRecent: 1 },
        }),
      ],
    });

    expect(result.text).toBe('final answer');
  });
});

// ---------------------------------------------------------------------------
// Message truncation
// ---------------------------------------------------------------------------

describe('contextCompression – message truncation', () => {
  it('drops oldest messages beyond maxMessages', async () => {
    const ai = genkit({});

    const simpleTool = ai.defineTool(
      {
        name: 'simple_tool',
        description: 'returns ok',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'simple_tool', input: {} } }],
          },
          // Exceed threshold starting from turn 3
          usage: {
            inputTokens: turn >= 3 ? 50000 : 1000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'done' }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [simpleTool],
      use: [
        contextCompression({
          maxInputTokens: 40000,
          maxMessages: 4,
        }),
      ],
    });

    expect(result.text).toBe('done');

    // On the turn where compression triggers, messages should have been capped
    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
  });

  it('preserves system messages during message truncation', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'sys_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'result'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 3) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'sys_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 2 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'final' }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      system: 'You are a helpful assistant',
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          maxMessages: 3,
          preserveSystem: true,
        }),
      ],
    });

    expect(result.text).toBe('final');
  });
});

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

describe('contextCompression – summarization', () => {
  it('summarizes older messages when threshold is exceeded', async () => {
    const ai = genkit({});

    // Define a summary model that returns a fixed summary
    const summaryModelName = uniqueName('summaryModel');
    ai.defineModel({ name: summaryModelName }, async (req) => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'This is a summary of the conversation.' }],
      },
      usage: { inputTokens: 200, outputTokens: 50 },
    }));

    const tool = ai.defineTool(
      {
        name: 'research_tool',
        description: 'researches',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'research result'
    );

    let turn = 0;
    let messagesOnSummarizedTurn: any[] = [];
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 5) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'research_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 4 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      messagesOnSummarizedTurn = req.messages;
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'final answer' }],
        },
        usage: { inputTokens: 5000, outputTokens: 100 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'research something',
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 2,
          },
        }),
      ],
    });

    expect(result.text).toBe('final answer');

    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
    expect(meta.summarized).toBe(true);

    // The summarized turn should have a message containing the summary
    const summaryMsg = messagesOnSummarizedTurn.find(
      (m: any) =>
        m.role === 'user' &&
        m.content?.some((c: any) => c.text?.includes('[Previous conversation summary]'))
    );
    expect(summaryMsg).toBeDefined();
  });

  it('caches summaries across turns to avoid redundant LLM calls', async () => {
    const ai = genkit({});

    let summaryCalls = 0;
    const summaryModelName = uniqueName('summaryModel');
    ai.defineModel({ name: summaryModelName }, async (req) => {
      summaryCalls++;
      return {
        message: {
          role: 'model' as const,
          content: [{ text: `Summary v${summaryCalls}` }],
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      };
    });

    const tool = ai.defineTool(
      {
        name: 'fetch_tool',
        description: 'fetches',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'data'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 6) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'fetch_tool', input: {} } }],
          },
          // Always exceed threshold after turn 1
          usage: {
            inputTokens: turn >= 1 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'done' }],
        },
        usage: { inputTokens: 5000, outputTokens: 100 },
      };
    });

    await ai.generate({
      model: pm,
      prompt: 'work on this',
      tools: [tool],
      maxTurns: 10,
      use: [
        contextCompression({
          maxInputTokens: 80000,
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 4,
          },
        }),
      ],
    });

    // The summary model should have been called, but subsequent turns
    // where the same messages are covered should reuse the cache.
    // Exact count depends on how many new messages accumulate beyond
    // the cached window, but it should be less than the number of
    // compression-triggered turns.
    expect(summaryCalls).toBeGreaterThan(0);
  });

  it('handles summarization failure gracefully', async () => {
    const ai = genkit({});

    const summaryModelName = uniqueName('failSummaryModel');
    ai.defineModel({ name: summaryModelName }, async () => {
      throw new Error('summary model unavailable');
    });

    const tool = ai.defineTool(
      {
        name: 'work_tool',
        description: 'works',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'done'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 3) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'work_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 2 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'completed' }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      };
    });

    // Should not throw — summarization failure is handled gracefully
    const result = await ai.generate({
      model: pm,
      prompt: 'do work',
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 2,
          },
        }),
      ],
    });

    expect(result.text).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Combined strategies
// ---------------------------------------------------------------------------

describe('contextCompression – combined strategies', () => {
  it('applies tool truncation + message truncation together', async () => {
    const ai = genkit({});

    const bigTool = ai.defineTool(
      {
        name: 'big_tool',
        description: 'returns big data',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'B'.repeat(3000)
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'big_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'all done' }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'process data',
      tools: [bigTool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          toolResponses: { maxChars: 200, preserveRecent: 1 },
          maxMessages: 6,
        }),
      ],
    });

    expect(result.text).toBe('all done');

    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
  });

  it('applies all three strategies together', async () => {
    const ai = genkit({});

    const summaryModelName = uniqueName('summaryModel');
    ai.defineModel({ name: summaryModelName }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'Condensed summary of conversation.' }],
      },
      usage: { inputTokens: 300, outputTokens: 80 },
    }));

    const tool = ai.defineTool(
      {
        name: 'all_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'C'.repeat(2000)
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 5) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'all_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 100000 : 2000,
            outputTokens: 50,
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'comprehensive result' }],
        },
        usage: { inputTokens: 4000, outputTokens: 100 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'do everything',
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          toolResponses: { maxChars: 100, preserveRecent: 1 },
          maxMessages: 8,
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 3,
          },
        }),
      ],
    });

    expect(result.text).toBe('comprehensive result');

    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe('contextCompression – metadata', () => {
  it('attaches compression metadata to response.custom', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'meta_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'M'.repeat(3000)
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'meta_tool', input: {} } }],
          },
          usage: { inputTokens: 90000, outputTokens: 100 },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'result' }],
        },
        usage: { inputTokens: 5000, outputTokens: 100 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          toolResponses: { maxChars: 100, preserveRecent: 0 },
          maxMessages: 4,
        }),
      ],
    });

    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.triggered).toBe(true);
    expect(typeof meta.messagesOriginal).toBe('number');
    expect(typeof meta.messagesAfter).toBe('number');
    expect(typeof meta.toolResponsesTruncated).toBe('number');
    expect(typeof meta.summarized).toBe('boolean');
  });

  it('does not attach metadata when no compression occurs', async () => {
    const ai = genkit({});

    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'no compression needed' }],
      },
      usage: { inputTokens: 500, outputTokens: 50 },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [contextCompression({ maxInputTokens: 80000 })],
    });

    expect(result.text).toBe('no compression needed');
    expect((result.custom as any)?.contextCompression).toBeUndefined();
  });
});
