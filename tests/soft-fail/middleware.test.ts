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
import { GenkitError, ToolInterruptError, genkit, z } from 'genkit';
import { softFail } from '../../src/soft-fail/middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let modelCounter = 0;
function uniqueName(prefix: string): string {
  return `${prefix}-${++modelCounter}-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Model error handling
// ---------------------------------------------------------------------------

describe('softFail – model errors', () => {
  it('returns an aborted response instead of throwing on model error', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new GenkitError({ status: 'UNAVAILABLE', message: 'server down' });
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [softFail()],
    });

    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('server down');
    expect(result.text).toContain('server down');

    // Verify error details in custom metadata
    const softFailMeta = (result.custom as any)?.softFail;
    expect(softFailMeta).toBeDefined();
    expect(softFailMeta.reason).toBe('model-error');
    expect(softFailMeta.error).toContain('server down');
    expect(softFailMeta.status).toBe('UNAVAILABLE');
  });

  it('catches non-GenkitError model errors', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new Error('network timeout');
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [softFail()],
    });

    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('network timeout');

    // Non-GenkitError has no status
    const softFailMeta = (result.custom as any)?.softFail;
    expect(softFailMeta).toBeDefined();
    expect(softFailMeta.reason).toBe('model-error');
    expect(softFailMeta.error).toContain('network timeout');
    expect(softFailMeta.status).toBeUndefined();
  });

  it('filters model errors by modelStatuses — catches matching status', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new GenkitError({
        status: 'RESOURCE_EXHAUSTED',
        message: 'quota exceeded',
      });
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [softFail({ modelStatuses: ['RESOURCE_EXHAUSTED', 'UNAVAILABLE'] })],
    });

    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('quota exceeded');
  });

  it('filters model errors by modelStatuses — re-throws non-matching status', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new GenkitError({
        status: 'INVALID_ARGUMENT',
        message: 'bad input',
      });
    });

    await expect(
      ai.generate({
        model: pm,
        prompt: 'test',
        use: [softFail({ modelStatuses: ['UNAVAILABLE'] })],
      })
    ).rejects.toThrow(/INVALID_ARGUMENT.*bad input/);
  });

  it('non-GenkitError passes through modelStatuses filter (always caught)', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new TypeError('something weird');
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [softFail({ modelStatuses: ['UNAVAILABLE'] })],
    });

    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('something weird');
  });

  it('does not catch model errors when model: false', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new GenkitError({ status: 'UNAVAILABLE', message: 'oops' });
    });

    await expect(
      ai.generate({
        model: pm,
        prompt: 'test',
        use: [softFail({ model: false })],
      })
    ).rejects.toThrow(/oops/);
  });
});

// ---------------------------------------------------------------------------
// Tool error handling
// ---------------------------------------------------------------------------

describe('softFail – tool errors', () => {
  it('returns tool error as a tool response instead of throwing', async () => {
    const ai = genkit({});

    const failingTool = ai.defineTool(
      {
        name: 'exploding_tool',
        description: 'always fails',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => {
        throw new Error('tool went boom');
      }
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('toolModel') }, async () => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'exploding_tool', input: {} } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'recovered from tool error' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [failingTool],
      use: [softFail()],
    });

    // The model should have recovered
    expect(result.text).toBe('recovered from tool error');
    expect(turn).toBe(2);

    // Check the tool response in message history contains the error
    const toolMessage = result.messages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeTruthy();
    const toolResponsePart = toolMessage!.content.find((p) => 'toolResponse' in p);
    expect(toolResponsePart).toBeTruthy();
    if (toolResponsePart && 'toolResponse' in toolResponsePart && toolResponsePart.toolResponse) {
      expect(String(toolResponsePart.toolResponse.output)).toContain('tool went boom');
    }
  });

  it('does not catch ToolInterruptError', async () => {
    const ai = genkit({});

    const interruptingTool = ai.defineTool(
      {
        name: 'interrupt_tool',
        description: 'interrupts',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => {
        throw new ToolInterruptError({ reason: 'needs approval' });
      }
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('toolModel') }, async () => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'interrupt_tool', input: {} } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'should not reach here' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [interruptingTool],
      use: [softFail()],
    });

    expect(result.finishReason).toBe('interrupted');
  });

  it('does not catch tool errors when tools: false', async () => {
    const ai = genkit({});

    const failingTool = ai.defineTool(
      {
        name: 'boom_tool',
        description: 'fails',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => {
        throw new Error('uncaught tool error');
      }
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('toolModel') }, async () => {
      turn++;
      if (turn === 1) {
        return {
          message: {
            role: 'model' as const,
            content: [{ toolRequest: { name: 'boom_tool', input: {} } }],
          },
        };
      }
      return {
        message: {
          role: 'model' as const,
          content: [{ text: 'done' }],
        },
      };
    });

    await expect(
      ai.generate({
        model: pm,
        prompt: 'test',
        tools: [failingTool],
        use: [softFail({ tools: false })],
      })
    ).rejects.toThrow(/uncaught tool error/);
  });
});

// ---------------------------------------------------------------------------
// Max turns handling
// ---------------------------------------------------------------------------

describe('softFail – max turns', () => {
  it('returns aborted response when max turns exceeded', async () => {
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

    // Model always requests a tool call — never returns text
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
      maxTurns: 1,
      use: [softFail()],
    });

    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('Exceeded maximum tool call iterations');

    // Verify error details in custom metadata
    const softFailMeta = (result.custom as any)?.softFail;
    expect(softFailMeta).toBeDefined();
    expect(softFailMeta.reason).toBe('max-turns');
    expect(softFailMeta.error).toContain('Exceeded maximum tool call iterations');
  });

  it('throws on max turns when maxTurns: false', async () => {
    const ai = genkit({});

    const dummyTool = ai.defineTool(
      {
        name: 'dummy_tool2',
        description: 'does nothing',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'ok'
    );

    const pm = ai.defineModel({ name: uniqueName('loopModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ toolRequest: { name: 'dummy_tool2', input: {} } }],
      },
    }));

    await expect(
      ai.generate({
        model: pm,
        prompt: 'test',
        tools: [dummyTool],
        maxTurns: 1,
        use: [softFail({ maxTurns: false })],
      })
    ).rejects.toThrow(/Exceeded maximum tool call iterations/);
  });
});

// ---------------------------------------------------------------------------
// Passthrough (no errors)
// ---------------------------------------------------------------------------

describe('softFail – passthrough', () => {
  it('is transparent when no errors occur', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('okModel') }, async () => ({
      message: {
        role: 'model' as const,
        content: [{ text: 'all good' }],
      },
    }));

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      use: [softFail()],
    });

    expect(result.text).toBe('all good');
    expect(result.finishReason).not.toBe('aborted');
  });

  it('is transparent with successful tool calls', async () => {
    const ai = genkit({});

    const goodTool = ai.defineTool(
      {
        name: 'good_tool',
        description: 'works fine',
        inputSchema: z.object({}),
        outputSchema: z.string(),
      },
      async () => 'tool result'
    );

    let turn = 0;
    const pm = ai.defineModel({ name: uniqueName('toolModel') }, async () => {
      turn++;
      if (turn === 1) {
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
          content: [{ text: 'used the tool successfully' }],
        },
      };
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'test',
      tools: [goodTool],
      use: [softFail()],
    });

    expect(result.text).toBe('used the tool successfully');
    expect(result.finishReason).not.toBe('aborted');
  });
});

// ---------------------------------------------------------------------------
// Secondary error recovery (model soft-fail + schema validation)
// ---------------------------------------------------------------------------

describe('softFail – secondary error recovery', () => {
  it('recovers from schema validation failure after model soft-fail', async () => {
    const ai = genkit({});

    // Model throws on every call — the soft-fail model hook catches it and
    // returns a synthetic response, but that response won't match the output
    // schema, causing the framework to throw a secondary validation error.
    // The generate hook should catch that and re-surface the stashed response.
    const pm = ai.defineModel({ name: uniqueName('schemaFailModel') }, async () => {
      throw new GenkitError({ status: 'UNAVAILABLE', message: 'model is down' });
    });

    const result = await ai.generate({
      model: pm,
      prompt: 'give me structured data',
      output: { schema: z.object({ name: z.string(), age: z.number() }) },
      use: [softFail()],
    });

    // The generate hook should have caught the schema validation error and
    // returned the stashed model-error response instead of throwing.
    expect(result.finishReason).toBe('aborted');
    expect(result.finishMessage).toContain('model is down');

    const softFailMeta = (result.custom as any)?.softFail;
    expect(softFailMeta).toBeDefined();
    expect(softFailMeta.reason).toBe('model-error');
    expect(softFailMeta.status).toBe('UNAVAILABLE');
  });
});

// ---------------------------------------------------------------------------
// All features disabled
// ---------------------------------------------------------------------------

describe('softFail – all disabled', () => {
  it('behaves like no middleware when all features are disabled', async () => {
    const ai = genkit({});
    const pm = ai.defineModel({ name: uniqueName('failModel') }, async () => {
      throw new GenkitError({ status: 'UNAVAILABLE', message: 'down' });
    });

    await expect(
      ai.generate({
        model: pm,
        prompt: 'test',
        use: [softFail({ model: false, tools: false, maxTurns: false })],
      })
    ).rejects.toThrow(/down/);
  });
});
