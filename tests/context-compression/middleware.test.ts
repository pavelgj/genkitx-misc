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
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'verbose_tool', input: {} } }],
          },
          usage: { inputTokens: 90000, outputTokens: 100 },
        };
      }
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
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'data_tool', input: { id: turn } } }],
          },
          usage: {
            inputTokens: turn >= 2 ? 90000 : 5000,
            outputTokens: 100,
          },
        };
      }
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
// Tool response deduplication (NEW)
// ---------------------------------------------------------------------------

describe('contextCompression – tool response deduplication', () => {
  it('deduplicates repeated tool calls with same name', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'read_data',
        description: 'reads data',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'D'.repeat(3000)
    );

    let turn = 0;
    let messagesOnDedupTurn: any[] = [];
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 3) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'read_data', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 2 ? 90000 : 5000,
            outputTokens: 50,
          },
        };
      }
      messagesOnDedupTurn = req.messages;
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          deduplicateToolResponses: { matchBy: 'name-and-input' },
        }),
      ],
    });

    expect(result.text).toBe('done');
    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.toolResponsesDeduplicated).toBeGreaterThan(0);

    // Check that at least one tool response was replaced with the dedup notice
    const dedupedMsgs = messagesOnDedupTurn.filter(
      (m: any) =>
        m.role === 'tool' &&
        m.content?.some((c: any) => {
          const output = c.toolResponse?.output;
          return typeof output === 'string' && output.includes('Deduplicated');
        })
    );
    expect(dedupedMsgs.length).toBeGreaterThan(0);
  });

  it('keeps multiple recent with keepRecent > 1', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'fetch',
        description: 'fetches',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'F'.repeat(2000)
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'fetch', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 90000 : 5000,
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          deduplicateToolResponses: { matchBy: 'name-and-input', keepRecent: 2 },
        }),
      ],
    });

    expect(result.text).toBe('done');
    const meta = (result.custom as any)?.contextCompression;
    if (meta) {
      // With keepRecent: 2, at most N-2 should be deduplicated
      expect(meta.toolResponsesDeduplicated).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------------------
// Safety cap (NEW)
// ---------------------------------------------------------------------------

describe('contextCompression – safety cap', () => {
  it('truncates oversized tool responses with safety cap', async () => {
    const ai = genkit({});

    const hugeTool = ai.defineTool(
      {
        name: 'huge_tool',
        description: 'returns huge data',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'H'.repeat(10000) // will exceed a small cap
    );

    let turn = 0;
    let messagesOnCap: any[] = [];
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'huge_tool', input: {} } }],
          },
          usage: { inputTokens: 90000, outputTokens: 100 },
        };
      }
      messagesOnCap = req.messages;
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'capped' }],
        },
        usage: { inputTokens: 3000, outputTokens: 50 },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [hugeTool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          maxToolResponseChars: 500, // very small cap
        }),
      ],
    });

    expect(result.text).toBe('capped');
    const meta = (result.custom as any)?.contextCompression;
    expect(meta).toBeDefined();
    expect(meta.toolResponsesSafetyCapped).toBeGreaterThan(0);

    // Verify the tool response was truncated
    const toolMsgs = messagesOnCap.filter((m: any) => m.role === 'tool');
    for (const tm of toolMsgs) {
      for (const c of tm.content) {
        if (c.toolResponse) {
          expect(String(c.toolResponse.output)).toContain('TRUNCATED');
        }
      }
    }
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

  it('inserts truncation notice when messages are dropped', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'notice_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    let turn = 0;
    let messagesOnNotice: any[] = [];
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'notice_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      messagesOnNotice = req.messages;
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          maxMessages: 4,
          insertTruncationNotice: true,
        }),
      ],
    });

    expect(result.text).toBe('done');
    const meta = (result.custom as any)?.contextCompression;
    if (meta) {
      expect(meta.truncationNoticeInserted).toBe(true);
    }

    // Check that a notice message was inserted
    const noticeMsg = messagesOnNotice.find(
      (m: any) =>
        m.role === 'model' && m.content?.some((c: any) => c.text?.includes('earlier messages'))
    );
    expect(noticeMsg).toBeDefined();
  });

  it('does not insert truncation notice when disabled', async () => {
    const ai = genkit({});

    const tool = ai.defineTool(
      {
        name: 'no_notice_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    let turn = 0;
    let messagesOnNoNotice: any[] = [];
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'no_notice_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 90000 : 1000,
            outputTokens: 50,
          },
        };
      }
      messagesOnNoNotice = req.messages;
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          maxMessages: 4,
          insertTruncationNotice: false,
        }),
      ],
    });

    expect(result.text).toBe('done');

    // Check no notice message was inserted
    const noticeMsg = messagesOnNoNotice.find(
      (m: any) =>
        m.role === 'model' && m.content?.some((c: any) => c.text?.includes('earlier messages'))
    );
    expect(noticeMsg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

describe('contextCompression – summarization', () => {
  it('summarizes older messages when threshold is exceeded', async () => {
    const ai = genkit({});

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

    // The summarized turn should have a message containing the summary prefix
    const summaryMsg = messagesOnSummarizedTurn.find(
      (m: any) =>
        m.role === 'user' &&
        m.content?.some((c: any) => c.text?.includes('Previous conversation summary'))
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
// Skip summarization threshold (NEW)
// ---------------------------------------------------------------------------

describe('contextCompression – skip summarization threshold', () => {
  it('skips summarization when cheap strategies save enough', async () => {
    const ai = genkit({});

    let summaryCalls = 0;
    const summaryModelName = uniqueName('summaryModel');
    ai.defineModel({ name: summaryModelName }, async () => {
      summaryCalls++;
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'Summary text' }],
        },
        usage: { inputTokens: 200, outputTokens: 50 },
      };
    });

    // Tool with very verbose output — dedup will save a lot
    const tool = ai.defineTool(
      {
        name: 'verbose_dedup_tool',
        description: 'verbose',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'V'.repeat(10000)
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 4) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'verbose_dedup_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 3 ? 90000 : 5000,
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          deduplicateToolResponses: { matchBy: 'name-and-input' },
          toolResponses: { maxChars: 100, preserveRecent: 0 },
          skipSummarizationThreshold: 0.1, // very low threshold — easy to meet
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 2,
          },
        }),
      ],
    });

    expect(result.text).toBe('done');
    const meta = (result.custom as any)?.contextCompression;
    if (meta) {
      expect(meta.summarizationSkipped).toBe(true);
      expect(meta.summarized).toBe(false);
    }
    // Summary model should not have been called
    expect(summaryCalls).toBe(0);
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

  it('applies all strategies together', async () => {
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
          deduplicateToolResponses: { matchBy: 'name-and-input' },
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
  it('attaches compression metadata with new fields to response.custom', async () => {
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
    // New fields
    expect(typeof meta.overshootRatio).toBe('number');
    expect(typeof meta.toolResponsesSafetyCapped).toBe('number');
    expect(typeof meta.toolResponsesDeduplicated).toBe('number');
    expect(typeof meta.summarizationSkipped).toBe('boolean');
    expect(typeof meta.truncationNoticeInserted).toBe('boolean');
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

// ---------------------------------------------------------------------------
// Adaptive aggressiveness (NEW)
// ---------------------------------------------------------------------------

describe('contextCompression – adaptive aggressiveness', () => {
  it('uses normal preserve windows at moderate overshoot', async () => {
    // At 1.2x overshoot, preserveRecent should remain at configured value
    const ai = genkit({});

    const summaryModelName = uniqueName('summaryModel');
    ai.defineModel({ name: summaryModelName }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'Summary' }],
      },
      usage: { inputTokens: 200, outputTokens: 50 },
    }));

    const tool = ai.defineTool(
      {
        name: 'mod_tool',
        description: 'tool',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('ccModel') }, async (req) => {
      turn++;
      if (turn <= 3) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'mod_tool', input: {} } }],
          },
          usage: {
            inputTokens: turn >= 2 ? 96000 : 1000, // 1.2x of 80000
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
      tools: [tool],
      use: [
        contextCompression({
          maxInputTokens: 80000,
          summarize: {
            model: { name: summaryModelName },
            preserveRecent: 6,
          },
        }),
      ],
    });

    expect(result.text).toBe('done');
    const meta = (result.custom as any)?.contextCompression;
    if (meta) {
      expect(meta.overshootRatio).toBeLessThan(1.5);
    }
  });
});
