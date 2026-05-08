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

const DeduplicateToolResponsesConfigSchema = z.object({
  /**
   * How to determine if two tool responses are "the same":
   * - 'name-and-input': Match on tool name + JSON-serialized input (default)
   * - 'name-only': Match on tool name only (useful for tools that always return latest state)
   */
  matchBy: z
    .enum(['name-and-input', 'name-only'])
    .optional()
    .describe('How to match duplicate tool calls. Default: name-and-input.'),

  /**
   * Number of most recent occurrences of each unique tool call to keep.
   * @default 1
   */
  keepRecent: z
    .number()
    .optional()
    .describe('Keep the N most recent responses for each unique tool call. Default: 1.'),

  /**
   * Custom notice to replace deduplicated responses with.
   * If not provided, uses a default notice.
   */
  notice: z
    .string()
    .optional()
    .describe('Custom replacement notice for deduplicated tool responses.'),
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
     * Hard cap on individual tool response size in characters.
     * Applied regardless of other toolResponses config as a safety net.
     * Set to `Infinity` to disable.
     * @default 400000
     */
    maxToolResponseChars: z
      .number()
      .optional()
      .describe('Hard cap on any single tool response size. Default: 400000 chars.'),

    /**
     * Deduplicate repeated tool responses, keeping only the most recent.
     * When the same tool is called multiple times with the same input,
     * older responses are replaced with a short notice.
     */
    deduplicateToolResponses: DeduplicateToolResponsesConfigSchema.optional().describe(
      'Replace duplicate tool responses with a short notice, keeping only the most recent.'
    ),

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

    /**
     * If cheap strategies (deduplication + tool truncation) reduce estimated
     * context by at least this fraction, skip the LLM summarization step.
     * Set to `0` to always summarize when configured.
     * @default undefined (always summarize when configured)
     */
    skipSummarizationThreshold: z
      .number()
      .optional()
      .describe(
        'Skip summarization if cheap strategies save at least this fraction of context. E.g. 0.3 = 30%.'
      ),

    /**
     * Insert a notice message when messages are dropped during message
     * truncation, so the model knows context was removed.
     * @default true
     */
    insertTruncationNotice: z
      .boolean()
      .optional()
      .describe('Insert a notice when messages are dropped. Default: true.'),

    /**
     * Custom truncation notice text. Used when messages are dropped.
     */
    truncationNotice: z
      .string()
      .optional()
      .describe('Custom notice text for when messages are dropped.'),
  })
  .passthrough();

export type ContextCompressionConfig = z.infer<typeof ContextCompressionConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TOOL_RESPONSE_PRESERVE_RECENT = 2;
const DEFAULT_SUMMARIZE_PRESERVE_RECENT = 6;
const DEFAULT_MAX_TOOL_RESPONSE_CHARS = 400_000;
const DEFAULT_DEDUP_KEEP_RECENT = 1;
const DEFAULT_DEDUP_NOTICE =
  '[Deduplicated: This tool response has been removed to save context. ' +
  'A more recent response from the same tool call exists later in the conversation.]';
const DEFAULT_TRUNCATION_NOTICE =
  '[NOTE] Some earlier messages in this conversation have been removed to stay within ' +
  'context limits. The most recent messages are preserved. Pay close attention to the ' +
  'latest messages and any conversation summary above.';
const SUMMARY_PREFIX =
  '[Previous conversation summary — This session continues from a prior conversation ' +
  'that was compressed to save context. The summary below captures all important details:]';
const DEFAULT_SUMMARIZE_PROMPT = `You are summarizing a conversation between a user, an AI assistant, and tool calls/responses. Create a comprehensive summary that preserves all information needed to continue the task seamlessly.

Before providing your summary, analyze the conversation chronologically in a <thinking> block to ensure completeness.

Your summary MUST include the following sections:

1. **Primary Request and Intent**: The user's original request and any modifications to it.
2. **Key Decisions and Facts**: Important decisions made, facts established, and data retrieved from tools.
3. **Tool Interactions**: Summary of tool calls made, their results, and any notable outputs. Include specific data values that were retrieved.
4. **Task Evolution**: If the task changed during the conversation, document the progression:
   - Original task
   - Modifications (with context for why)
   - Current active task
5. **Current State**: What was being worked on immediately before this summary. Include specifics (names, values, identifiers).
6. **Pending Work**: Any remaining tasks or next steps that were discussed but not completed.

Important guidelines:
- Preserve ALL specific data values, names, identifiers, and configuration details
- Include relevant direct quotes from tool responses that contain critical data
- Be thorough — information not in this summary will be permanently lost
- Do NOT include pleasantries or meta-commentary about the summarization process

Conversation to summarize:
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

/**
 * Estimate the total character count across all message content.
 */
function estimateMessageChars(messages: MessageData[]): number {
  return messages.reduce(
    (sum, m) =>
      sum +
      m.content.reduce((pSum, p) => {
        if (p.text) return pSum + p.text.length;
        if (p.toolRequest) return pSum + JSON.stringify(p.toolRequest).length;
        if (p.toolResponse) return pSum + JSON.stringify(p.toolResponse).length;
        return pSum;
      }, 0),
    0
  );
}

/**
 * Adjust preserve windows based on how far over budget we are.
 * Inspired by Cline's half/quarter heuristic.
 */
function adjustForOvershoot(
  overshootRatio: number,
  preserveRecent: number,
  summaryPreserveRecent: number
): { adjustedPreserveRecent: number; adjustedSummaryPreserveRecent: number } {
  if (overshootRatio >= 2.0) {
    return {
      adjustedPreserveRecent: Math.min(preserveRecent, 2),
      adjustedSummaryPreserveRecent: Math.min(summaryPreserveRecent, 2),
    };
  }
  if (overshootRatio >= 1.5) {
    return {
      adjustedPreserveRecent: Math.max(2, Math.floor(preserveRecent / 2)),
      adjustedSummaryPreserveRecent: Math.max(2, Math.floor(summaryPreserveRecent / 2)),
    };
  }
  return {
    adjustedPreserveRecent: preserveRecent,
    adjustedSummaryPreserveRecent: summaryPreserveRecent,
  };
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
 * 1. **Safety cap** — Hard-truncate any single oversized tool response.
 * 2. **Deduplication** — Replace duplicate tool responses with a short notice.
 * 3. **Tool response truncation** — Trim verbose tool outputs (cheapest).
 * 4. **Message truncation** — Drop oldest messages beyond a cap.
 * 5. **Summarization** — Replace old messages with an LLM-generated summary
 *    (skipped if cheap strategies saved enough context).
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
 *     deduplicateToolResponses: { matchBy: 'name-and-input' },
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
        'tool response deduplication, truncation, message dropping, and optional LLM summarization.',
      configSchema: ContextCompressionConfigSchema,
    },
    ({ config, ai }) => {
      const maxInputTokens = config?.maxInputTokens ?? Infinity;
      const preserveSystem = config?.preserveSystem !== false;
      const basePreserveRecent = config?.preserveRecent ?? 4;

      // Safety cap config
      const maxToolResponseChars = config?.maxToolResponseChars ?? DEFAULT_MAX_TOOL_RESPONSE_CHARS;

      // Deduplication config
      const dedupConfig = config?.deduplicateToolResponses;
      const dedupMatchBy = dedupConfig?.matchBy ?? 'name-and-input';
      const dedupKeepRecent = dedupConfig?.keepRecent ?? DEFAULT_DEDUP_KEEP_RECENT;
      const dedupNotice = dedupConfig?.notice ?? DEFAULT_DEDUP_NOTICE;

      // Tool response config
      const toolResponseConfig = config?.toolResponses;
      const toolMaxChars = toolResponseConfig?.maxChars;
      const toolPreserveRecent =
        toolResponseConfig?.preserveRecent ?? DEFAULT_TOOL_RESPONSE_PRESERVE_RECENT;

      // Message truncation
      const maxMessages = config?.maxMessages;

      // Truncation notice config
      const insertTruncationNotice = config?.insertTruncationNotice !== false;
      const truncationNoticeText = config?.truncationNotice ?? DEFAULT_TRUNCATION_NOTICE;

      // Skip summarization threshold
      const skipSummarizationThreshold = config?.skipSummarizationThreshold;

      // Summarization config
      const summarizeConfig = config?.summarize;
      const baseSummaryPreserveRecent =
        summarizeConfig?.preserveRecent ?? DEFAULT_SUMMARIZE_PRESERVE_RECENT;
      const summaryPromptTemplate = summarizeConfig?.prompt ?? DEFAULT_SUMMARIZE_PROMPT;
      const summaryModelRef = summarizeConfig?.model;

      // -----------------------------------------------------------------------
      // Closure state — persists across turns within one ai.generate() call.
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
       * Strategy 0: Safety cap — hard-truncate any single oversized tool response.
       */
      function applyToolResponseSafetyCap(messages: MessageData[]): {
        messages: MessageData[];
        capped: number;
      } {
        if (maxToolResponseChars === Infinity) return { messages, capped: 0 };

        let cappedCount = 0;
        const result = messages.map((msg) => {
          if (msg.role !== 'tool') return msg;

          let changed = false;
          const newContent = msg.content.map((part): Part => {
            if (part.toolResponse) {
              const outputStr = JSON.stringify(part.toolResponse.output ?? '');
              if (outputStr.length > maxToolResponseChars) {
                cappedCount++;
                changed = true;
                return {
                  toolResponse: {
                    ...part.toolResponse,
                    output:
                      outputStr.slice(0, maxToolResponseChars) +
                      `\n\n---\n\n[TRUNCATED: Response was ${outputStr.length} chars ` +
                      `but only first ${maxToolResponseChars} are shown.]`,
                  },
                };
              }
            }
            return part;
          });
          return changed ? { ...msg, content: newContent } : msg;
        });

        return { messages: result, capped: cappedCount };
      }

      /**
       * Strategy 1: Deduplicate tool responses.
       * Groups tool responses by key and replaces all but the most recent
       * with a deduplication notice.
       */
      function applyToolResponseDeduplication(messages: MessageData[]): {
        messages: MessageData[];
        deduplicated: number;
      } {
        if (!dedupConfig) return { messages, deduplicated: 0 };

        // Collect tool response indices grouped by dedup key
        const groups = new Map<string, number[]>();
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role !== 'tool') continue;

          for (const part of msg.content) {
            if (!part.toolResponse) continue;
            const key =
              dedupMatchBy === 'name-only'
                ? part.toolResponse.name
                : JSON.stringify({
                    name: part.toolResponse.name,
                    input: part.toolResponse.ref,
                  });

            const group = groups.get(key) || [];
            group.push(i);
            groups.set(key, group);
          }
        }

        // Determine which indices to deduplicate
        const indicesToDedup = new Set<number>();
        for (const [, indices] of groups) {
          if (indices.length <= dedupKeepRecent) continue;
          // Keep the last `dedupKeepRecent` indices, dedup the rest
          const toDedup = indices.slice(0, indices.length - dedupKeepRecent);
          for (const idx of toDedup) {
            indicesToDedup.add(idx);
          }
        }

        if (indicesToDedup.size === 0) return { messages, deduplicated: 0 };

        const result = messages.map((msg, idx) => {
          if (!indicesToDedup.has(idx)) return msg;

          const newContent = msg.content.map((part): Part => {
            if (part.toolResponse) {
              return {
                toolResponse: {
                  ...part.toolResponse,
                  output: dedupNotice,
                },
              };
            }
            return part;
          });
          return { ...msg, content: newContent };
        });

        return { messages: result, deduplicated: indicesToDedup.size };
      }

      /**
       * Strategy 2: Truncate tool response content.
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
       * Strategy 3: Drop oldest messages beyond maxMessages.
       * Preserves system messages and recent messages.
       * Optionally inserts a truncation notice at the boundary.
       */
      function applyMessageTruncation(
        messages: MessageData[],
        effectiveMaxMessages?: number
      ): { messages: MessageData[]; dropped: number; noticeInserted: boolean } {
        const cap = effectiveMaxMessages ?? maxMessages;
        if (!cap || messages.length <= cap) {
          return { messages, dropped: 0, noticeInserted: false };
        }

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
        const keepCount = Math.max(0, cap - systemMessages.length);
        const kept = nonSystemMessages.slice(-keepCount);
        const dropped = nonSystemMessages.length - kept.length;

        let noticeInserted = false;
        if (dropped > 0 && insertTruncationNotice) {
          const notice: MessageData = {
            role: 'model',
            content: [{ text: truncationNoticeText }],
          };
          noticeInserted = true;
          return {
            messages: [...systemMessages, notice, ...kept],
            dropped,
            noticeInserted,
          };
        }

        return { messages: [...systemMessages, ...kept], dropped, noticeInserted };
      }

      /**
       * Strategy 4: Summarize older messages using an LLM.
       * Replaces messages before `preserveRecent` with a summary.
       */
      async function applySummarization(
        messages: MessageData[],
        effectiveSummaryPreserveRecent?: number
      ): Promise<{ messages: MessageData[]; summarized: boolean }> {
        if (!summaryModelRef) return { messages, summarized: false };

        const summaryPreserveRecent = effectiveSummaryPreserveRecent ?? baseSummaryPreserveRecent;

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
        if (cachedSummary && summarizedUpToIndex >= toSummarize.length) {
          const summaryMessage: MessageData = {
            role: 'user',
            content: [{ text: `${SUMMARY_PREFIX}\n${cachedSummary}` }],
          };
          return {
            messages: [...systemMessages, summaryMessage, ...toKeep],
            summarized: true,
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
          summarizedUpToIndex = 1;

          const summaryMessage: MessageData = {
            role: 'user',
            content: [{ text: `${SUMMARY_PREFIX}\n${cachedSummary}` }],
          };

          return {
            messages: [...systemMessages, summaryMessage, ...toKeep],
            summarized: true,
          };
        } catch (e) {
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
        model: async (req, ctx, next) => {
          const result = await next(req, ctx);

          if (result.usage?.inputTokens !== undefined) {
            lastInputTokens = result.usage.inputTokens;
          }

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

          const shouldCompress = lastInputTokens !== undefined && lastInputTokens > maxInputTokens;

          if (!shouldCompress || currentTurn === 0) {
            return next(envelope, ctx);
          }

          // Compute overshoot ratio for adaptive aggressiveness
          const overshootRatio = lastInputTokens! / maxInputTokens;
          const { adjustedPreserveRecent, adjustedSummaryPreserveRecent } = adjustForOvershoot(
            overshootRatio,
            basePreserveRecent,
            baseSummaryPreserveRecent
          );

          // Apply compression strategies in order
          let compressedMessages = [...messages];
          let toolResponsesSafetyCapped = 0;
          let toolResponsesDeduplicated = 0;
          let toolResponsesTruncated = 0;
          let summarized = false;
          let summarizationSkipped = false;
          let truncationNoticeInserted = false;
          const originalCount = messages.length;
          const charsBefore = estimateMessageChars(messages);

          // 1. Safety cap on oversized tool responses
          if (maxToolResponseChars !== Infinity) {
            const capResult = await ai.run(
              'contextCompression-applyToolResponseSafetyCap',
              compressedMessages,
              async () => applyToolResponseSafetyCap(compressedMessages)
            );
            compressedMessages = capResult.messages;
            toolResponsesSafetyCapped = capResult.capped;
          }

          // 2. Deduplicate tool responses
          if (dedupConfig) {
            const dedupResult = await ai.run(
              'contextCompression-applyToolResponseDeduplication',
              compressedMessages,
              async () => applyToolResponseDeduplication(compressedMessages)
            );
            compressedMessages = dedupResult.messages;
            toolResponsesDeduplicated = dedupResult.deduplicated;
          }

          // 3. Tool response truncation
          if (toolMaxChars) {
            const truncResult = await ai.run(
              'contextCompression-applyToolResponseTruncation',
              compressedMessages,
              async () => applyToolResponseTruncation(compressedMessages)
            );
            compressedMessages = truncResult.messages;
            toolResponsesTruncated = truncResult.truncated;
          }

          // 4. Check if cheap strategies saved enough to skip summarization
          const charsAfterCheap = estimateMessageChars(compressedMessages);
          const charsSaved = charsBefore - charsAfterCheap;
          const savingsRatio = charsBefore > 0 ? charsSaved / charsBefore : 0;

          const shouldSkipSummarization =
            skipSummarizationThreshold !== undefined && savingsRatio >= skipSummarizationThreshold;

          // 5. Message truncation (use adjustedPreserveRecent to compute effective cap)
          const effectiveMaxMessages = maxMessages
            ? Math.max(
                adjustedPreserveRecent + 1,
                maxMessages - (basePreserveRecent - adjustedPreserveRecent)
              )
            : undefined;
          if (effectiveMaxMessages) {
            const truncResult = await ai.run(
              'contextCompression-applyMessageTruncation',
              compressedMessages,
              async () => applyMessageTruncation(compressedMessages, effectiveMaxMessages)
            );
            compressedMessages = truncResult.messages;
            truncationNoticeInserted = truncResult.noticeInserted;
          }

          // 6. Summarization (unless skipped)
          if (summaryModelRef) {
            if (shouldSkipSummarization) {
              summarizationSkipped = true;
            } else {
              const sumResult = await ai.run(
                'contextCompression-applySummarization',
                compressedMessages,
                () => applySummarization(compressedMessages, adjustedSummaryPreserveRecent)
              );
              compressedMessages = sumResult.messages;
              summarized = sumResult.summarized;
            }
          }

          const compressedCount = compressedMessages.length;
          const wasCompressed =
            toolResponsesSafetyCapped > 0 ||
            toolResponsesDeduplicated > 0 ||
            toolResponsesTruncated > 0 ||
            compressedCount < originalCount ||
            summarized;

          // Set pending metadata for the model hook to attach
          if (wasCompressed) {
            pendingCompressionMeta = {
              contextCompression: {
                triggered: true,
                inputTokensBefore: lastInputTokens,
                overshootRatio: Math.round(overshootRatio * 100) / 100,
                messagesOriginal: originalCount,
                messagesAfter: compressedCount,
                toolResponsesSafetyCapped,
                toolResponsesDeduplicated,
                toolResponsesTruncated,
                summarized,
                summarizationSkipped,
                truncationNoticeInserted,
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
