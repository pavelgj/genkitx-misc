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

import { ModelReferenceSchema, z, type MessageData, type Part } from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const ToolResponsesConfigSchema = z.object({
  /**
   * Maximum character length for each tool response content.
   * Responses exceeding this will be truncated with a `…[truncated]` marker.
   */
  maxChars: z
    .number()
    .describe('Max chars per tool response. Responses beyond this are truncated.'),

  /**
   * Number of most recent tool responses to leave untouched.
   * @default 2
   */
  preserveRecent: z
    .number()
    .optional()
    .describe("Don't truncate the last N tool responses. Default: 2."),
});

const SummarizeConfigSchema = z.object({
  /**
   * Model to use for summarization. A model reference with name and
   * optional config, e.g. `{ name: 'googleai/gemini-flash-lite-latest' }`.
   */
  model: ModelReferenceSchema.describe('Model to use for summarization.'),

  /**
   * Number of most recent messages to keep un-summarized.
   * Everything before this window is replaced with a summary.
   * @default 6
   */
  preserveRecent: z.number().optional().describe('Keep last N messages un-summarized. Default: 6.'),

  /**
   * Custom summarization prompt. The string `{conversation}` will be
   * replaced with a text rendering of the messages to summarize.
   */
  prompt: z
    .string()
    .optional()
    .describe('Custom summarization prompt. Use {conversation} placeholder.'),
});

export const ContextCompressionConfigSchema = z
  .object({
    /**
     * Compression triggers when the previous turn's `inputTokens` exceeds
     * this threshold. On turn 0 (no prior usage data), compression is skipped.
     */
    maxInputTokens: z
      .number()
      .describe('Compress when previous turn inputTokens exceeds this threshold.'),

    /**
     * Number of most recent messages to never compress or drop.
     * @default 4
     */
    preserveRecent: z
      .number()
      .optional()
      .describe('Number of recent messages to always keep intact. Default: 4.'),

    /**
     * Always keep system/instructions messages.
     * @default true
     */
    preserveSystem: z.boolean().optional().describe('Always keep system messages. Default: true.'),

    /**
     * Truncate tool response content that exceeds a character limit.
     * This is a cheap strategy that requires no LLM call.
     */
    toolResponses: ToolResponsesConfigSchema.optional().describe(
      'Truncate verbose tool response content.'
    ),

    /**
     * Hard cap on message count. Messages beyond this (oldest first) are
     * dropped, preserving system messages and recent messages.
     */
    maxMessages: z
      .number()
      .optional()
      .describe('Hard cap on message count. Drop oldest beyond this.'),

    /**
     * Use an LLM to summarize older messages into a condensed form.
     * The summary replaces the original messages, preserving recent context.
     */
    summarize: SummarizeConfigSchema.optional().describe('Summarize older messages using an LLM.'),
  })
  .passthrough();

export type ContextCompressionConfig = z.infer<typeof ContextCompressionConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_RESPONSE_PRESERVE_RECENT = 2;
const DEFAULT_SUMMARIZE_PRESERVE_RECENT = 6;
const DEFAULT_SUMMARIZE_PROMPT = `Summarize the following conversation between a user, an AI assistant, and tool calls/responses. Preserve all important facts, decisions, data retrieved from tools, and the current state of the task. Be concise but do not lose critical information.

Conversation:
{conversation}

Summary:`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Render messages as text for summarization.
 */
function renderMessages(messages: MessageData[]): string {
  return messages
    .map((m) => {
      const parts = m.content
        .map((p) => {
          if (p.text) return p.text;
          if (p.toolRequest)
            return `[Tool call: ${p.toolRequest.name}(${JSON.stringify(p.toolRequest.input)})]`;
          if (p.toolResponse)
            return `[Tool response: ${p.toolResponse.name} → ${JSON.stringify(p.toolResponse.output)}]`;
          return '[other content]';
        })
        .join(' ');
      return `${m.role}: ${parts}`;
    })
    .join('\n');
}

/**
 * Truncate a string to maxChars with a truncation marker.
 */
function truncateString(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + '…[truncated]';
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Creates a middleware that compresses conversation context when it grows
 * too large, reducing token usage and costs in long-running agentic loops.
 *
 * Compression triggers based on the previous turn's `inputTokens` from the
 * model response — no custom token counter needed. When triggered, the
 * middleware applies configured strategies in order:
 *
 * 1. **Tool response truncation** — Trim verbose tool outputs (cheapest).
 * 2. **Message truncation** — Drop oldest messages beyond a cap.
 * 3. **Summarization** — Replace old messages with an LLM-generated summary.
 *
 * ```ts
 * import { contextCompression } from 'genkitx-misc/context-compression';
 *
 * const ai = genkit({
 *   plugins: [contextCompression.plugin()],
 * });
 *
 * const response = await ai.generate({
 *   model: 'googleai/gemini-flash-latest',
 *   prompt: 'Research and summarize...',
 *   tools: [searchTool],
 *   use: [contextCompression({
 *     maxInputTokens: 80000,
 *     toolResponses: { maxChars: 2000 },
 *     summarize: {
 *       model: { name: 'googleai/gemini-flash-lite-latest' },
 *     },
 *   })],
 * });
 * ```
 */
export const contextCompression: GenerateMiddleware<typeof ContextCompressionConfigSchema> =
  generateMiddleware(
    {
      name: 'contextCompression',
      description:
        'Compresses conversation context when it grows too large, using ' +
        'tool response truncation, message dropping, and optional LLM summarization.',
      configSchema: ContextCompressionConfigSchema,
    },
    ({ config, ai }) => {
      const maxInputTokens = config?.maxInputTokens ?? Infinity;
      const preserveSystem = config?.preserveSystem !== false;

      // Tool response config
      const toolResponseConfig = config?.toolResponses;
      const toolMaxChars = toolResponseConfig?.maxChars;
      const toolPreserveRecent =
        toolResponseConfig?.preserveRecent ?? DEFAULT_TOOL_RESPONSE_PRESERVE_RECENT;

      // Message truncation
      const maxMessages = config?.maxMessages;

      // Summarization config
      const summarizeConfig = config?.summarize;
      const summaryPreserveRecent =
        summarizeConfig?.preserveRecent ?? DEFAULT_SUMMARIZE_PRESERVE_RECENT;
      const summaryPromptTemplate = summarizeConfig?.prompt ?? DEFAULT_SUMMARIZE_PROMPT;
      const summaryModelRef = summarizeConfig?.model;

      // -----------------------------------------------------------------------
      // Closure state — persists across turns within one ai.generate() call.
      //
      // IMPORTANT: The generate hook is called RECURSIVELY (each turn's hook
      // runs inside the previous turn's `next()`). Therefore we track token
      // usage in the MODEL hook, which runs BEFORE the recursive generate hook
      // call for the next turn. This ensures `lastInputTokens` is available
      // when the next turn's generate hook checks whether to compress.
      // -----------------------------------------------------------------------

      /** Updated by the model hook after each model call. */
      let lastInputTokens: number | undefined;

      /** Set by the generate hook before calling next(); read by the model hook
       *  to attach compression metadata to the model response's `custom`. */
      let pendingCompressionMeta: Record<string, unknown> | null = null;

      /** Cached summary text for incremental summarization. */
      let cachedSummary: string | null = null;

      /** Number of messages covered by the cached summary. */
      let summarizedUpToIndex: number = 0;

      // -----------------------------------------------------------------------
      // Compression strategies
      // -----------------------------------------------------------------------

      /**
       * Strategy 1: Truncate tool response content.
       * Returns a new messages array with tool responses truncated.
       */
      function applyToolResponseTruncation(messages: MessageData[]): {
        messages: MessageData[];
        truncated: number;
      } {
        if (!toolMaxChars) return { messages, truncated: 0 };

        // Find tool response messages (by index from the end)
        let toolMsgCount = 0;
        const toolMsgIndices: number[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.role === 'tool') {
            toolMsgCount++;
            if (toolMsgCount > toolPreserveRecent) {
              toolMsgIndices.push(i);
            }
          }
        }

        if (toolMsgIndices.length === 0) return { messages, truncated: 0 };

        let truncatedCount = 0;
        const result = messages.map((msg, idx) => {
          if (!toolMsgIndices.includes(idx)) return msg;

          const newContent = msg.content.map((part): Part => {
            if (part.toolResponse) {
              const outputStr = JSON.stringify(part.toolResponse.output ?? '');
              if (outputStr.length > toolMaxChars) {
                truncatedCount++;
                return {
                  toolResponse: {
                    ...part.toolResponse,
                    output: truncateString(outputStr, toolMaxChars),
                  },
                };
              }
            }
            return part;
          });
          return { ...msg, content: newContent };
        });

        return { messages: result, truncated: truncatedCount };
      }

      /**
       * Strategy 2: Drop oldest messages beyond maxMessages.
       * Preserves system messages and recent messages.
       */
      function applyMessageTruncation(messages: MessageData[]): MessageData[] {
        if (!maxMessages || messages.length <= maxMessages) return messages;

        // Separate system messages (always kept)
        const systemMessages: MessageData[] = [];
        const nonSystemMessages: MessageData[] = [];

        for (const msg of messages) {
          if (preserveSystem && msg.role === 'system') {
            systemMessages.push(msg);
          } else {
            nonSystemMessages.push(msg);
          }
        }

        // Keep the most recent N non-system messages
        const keepCount = Math.max(0, maxMessages - systemMessages.length);
        const kept = nonSystemMessages.slice(-keepCount);

        return [...systemMessages, ...kept];
      }

      /**
       * Strategy 3: Summarize older messages using an LLM.
       * Replaces messages before `preserveRecent` with a summary.
       */
      async function applySummarization(
        messages: MessageData[]
      ): Promise<{ messages: MessageData[]; summarized: boolean }> {
        if (!summaryModelRef) return { messages, summarized: false };

        // Separate system messages
        const systemMessages: MessageData[] = [];
        const nonSystemMessages: MessageData[] = [];

        for (const msg of messages) {
          if (preserveSystem && msg.role === 'system') {
            systemMessages.push(msg);
          } else {
            nonSystemMessages.push(msg);
          }
        }

        // Need enough messages to warrant summarization
        if (nonSystemMessages.length <= summaryPreserveRecent) {
          return { messages, summarized: false };
        }

        const toSummarize = nonSystemMessages.slice(
          0,
          nonSystemMessages.length - summaryPreserveRecent
        );
        const toKeep = nonSystemMessages.slice(-summaryPreserveRecent);

        // Check if we already have a cached summary covering these messages.
        // After compression restructures messages, summarizedUpToIndex is
        // relative to the post-compression context (1 = the summary message).
        // A cache hit means toSummarize contains only the cached summary
        // message itself — no new messages have shifted into the window.
        if (cachedSummary && summarizedUpToIndex >= toSummarize.length) {
          // Reuse cached summary — no new LLM call needed
          const summaryMessage: MessageData = {
            role: 'user',
            content: [
              {
                text: `[Previous conversation summary]\n${cachedSummary}`,
              },
            ],
          };
          return {
            messages: [...systemMessages, summaryMessage, ...toKeep],
            summarized: true, // summarization was applied (from cache)
          };
        }

        // Generate a new summary
        try {
          const conversationText = cachedSummary
            ? `[Previous summary]\n${cachedSummary}\n\n[New messages]\n${renderMessages(toSummarize.slice(summarizedUpToIndex))}`
            : renderMessages(toSummarize);

          const prompt = summaryPromptTemplate.replace('{conversation}', conversationText);

          const response = await ai.generate({
            model: summaryModelRef.name,
            config: summaryModelRef.config,
            prompt,
          });
          cachedSummary = response.text;
          // After compression, messages are restructured: the summary message
          // replaces all old messages. Set to 1 so subsequent turns detect
          // when new messages shift into the toSummarize window.
          summarizedUpToIndex = 1;

          const summaryMessage: MessageData = {
            role: 'user',
            content: [
              {
                text: `[Previous conversation summary]\n${cachedSummary}`,
              },
            ],
          };

          return {
            messages: [...systemMessages, summaryMessage, ...toKeep],
            summarized: true,
          };
        } catch (e) {
          // If summarization fails, warn and proceed without it
          console.warn(
            `[contextCompression] Summarization failed, proceeding without compression: ${
              e instanceof Error ? e.message : String(e)
            }`
          );
          return { messages, summarized: false };
        }
      }

      // -----------------------------------------------------------------------
      // Hooks
      // -----------------------------------------------------------------------

      return {
        // --- Model hook: track token usage & attach compression metadata ---
        //
        // The model hook runs for each model call, BEFORE the framework
        // resolves tool requests and recursively calls the generate hook for
        // the next turn. This makes it the right place to:
        //   (a) Record inputTokens so the next turn's generate hook knows
        //       whether to compress.
        //   (b) Attach compression metadata to the model response's `custom`
        //       field, which the framework preserves through to the final
        //       GenerateResponse.
        model: async (req, ctx, next) => {
          const result = await next(req, ctx);

          // (a) Track token usage for the next turn's compression decision
          if (result.usage?.inputTokens !== undefined) {
            lastInputTokens = result.usage.inputTokens;
          }

          // (b) Attach pending compression metadata from the generate hook
          if (pendingCompressionMeta) {
            const meta = pendingCompressionMeta;
            pendingCompressionMeta = null;
            return {
              ...result,
              custom: {
                ...((result.custom as Record<string, unknown>) ?? {}),
                ...meta,
              },
            };
          }

          return result;
        },

        // --- Generate hook: apply compression strategies ---
        generate: async (envelope, ctx, next) => {
          const messages = envelope.request.messages || [];
          const { currentTurn } = envelope;

          // Determine if compression should trigger.
          // `lastInputTokens` is set by the model hook after each model call,
          // so it reflects the PREVIOUS turn's usage.
          const shouldCompress = lastInputTokens !== undefined && lastInputTokens > maxInputTokens;

          if (!shouldCompress || currentTurn === 0) {
            // Pass through — the model hook will track usage
            return next(envelope, ctx);
          }

          // Apply compression strategies in order
          let compressedMessages = [...messages];
          let toolResponsesTruncated = 0;
          let summarized = false;
          const originalCount = messages.length;

          // 1. Tool response truncation
          if (toolMaxChars) {
            const truncResult = await ai.run(
              'contextCompression-applyToolResponseTruncation',
              compressedMessages,
              async () => applyToolResponseTruncation(compressedMessages)
            );
            compressedMessages = truncResult.messages;
            toolResponsesTruncated = truncResult.truncated;
          }

          // 2. Message truncation
          if (maxMessages) {
            compressedMessages = await ai.run(
              'contextCompression-applyMessageTruncation',
              compressedMessages,
              async () => applyMessageTruncation(compressedMessages)
            );
          }

          // 3. Summarization
          if (summaryModelRef) {
            const sumResult = await ai.run(
              'contextCompression-applySummarization',
              compressedMessages,
              () => applySummarization(compressedMessages)
            );
            compressedMessages = sumResult.messages;
            summarized = sumResult.summarized;
          }

          const compressedCount = compressedMessages.length;
          const wasCompressed =
            toolResponsesTruncated > 0 || compressedCount < originalCount || summarized;

          // Set pending metadata for the model hook to attach
          if (wasCompressed) {
            pendingCompressionMeta = {
              contextCompression: {
                triggered: true,
                inputTokensBefore: lastInputTokens,
                messagesOriginal: originalCount,
                messagesAfter: compressedCount,
                toolResponsesTruncated,
                summarized,
              },
            };
          }

          // Build modified envelope
          const modifiedEnvelope = {
            ...envelope,
            request: {
              ...envelope.request,
              messages: compressedMessages,
            },
          };

          return next(modifiedEnvelope, ctx);
        },
      };
    }
  );
