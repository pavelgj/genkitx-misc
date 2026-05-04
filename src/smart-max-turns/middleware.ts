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

import { z, type GenerateResponseData, type MessageData } from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';
import { detectExactLoops, detectResponseRepetition, type DetectorResult } from './detectors.js';

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

const ExactLoopsConfigSchema = z.union([z.boolean(), z.object({ threshold: z.number() })]);

const ResponseRepetitionConfigSchema = z.union([z.boolean(), z.object({ threshold: z.number() })]);

const LlmJudgeConfigSchema = z.union([z.boolean(), z.object({ every: z.number() })]);

export const SmartMaxTurnsConfigSchema = z
  .object({
    /**
     * Hard ceiling on the number of tool-calling turns. The middleware takes
     * full ownership of turn management — the framework's own `maxTurns` is
     * overridden to effectively infinite.
     * @default 20
     */
    maxTurns: z.number().optional().describe('Hard ceiling on tool-calling turns. Default: 20.'),

    /**
     * Don't start running detectors until this many turns have elapsed.
     * Allows the agent some runway before checking for loops.
     * @default 3
     */
    minTurns: z.number().optional().describe("Don't start checking until this turn. Default: 3."),

    /**
     * What to do when a loop or stall is detected.
     * - `'abort'` — return an aborted response immediately (default).
     * - `'wrapUp'` — remove tools and ask the model to synthesize a final answer.
     * - `'pruneTools'` — remove only the looping tools and let the model continue.
     * @default 'abort'
     */
    onDetection: z
      .enum(['abort', 'wrapUp', 'pruneTools'])
      .optional()
      .describe("Action on detection: 'abort', 'wrapUp', or 'pruneTools'. Default: 'abort'."),

    /**
     * Custom instruction injected when `onDetection` is `'wrapUp'`. The model
     * receives this as a user message with all tools removed, prompting it to
     * produce a final answer from what it has gathered so far.
     * @default 'You have spent several turns working on this task. Please provide your best final answer now based on what you have learned so far.'
     */
    wrapUpPrompt: z.string().optional().describe('Custom wrap-up instruction for the model.'),

    /**
     * Custom prompt template for the LLM judge. The string `{messages}` will
     * be replaced with a text rendering of the conversation. Must instruct the
     * judge to respond with exactly `PROGRESSING` or `STUCK`.
     */
    judgePrompt: z.string().optional().describe('Custom prompt for the LLM judge.'),

    /**
     * Detection strategies to enable.
     */
    detect: z
      .object({
        /**
         * Detect identical tool calls repeated across consecutive turns.
         * Pass `true` for default threshold (2), or `{ threshold: N }`.
         * @default true
         */
        exactLoops: ExactLoopsConfigSchema.optional(),

        /**
         * Detect identical tool responses across consecutive turns.
         * Pass `true` for default threshold (2), or `{ threshold: N }`.
         * @default true
         */
        responseRepetition: ResponseRepetitionConfigSchema.optional(),

        /**
         * Use an LLM judge to analyze conversation trajectory.
         * Requires `judgeModel` in plugin options.
         * Pass `true` to check every turn (after minTurns), or `{ every: N }`
         * to check every N turns.
         * @default false
         */
        llmJudge: LlmJudgeConfigSchema.optional(),
      })
      .optional()
      .describe('Detection strategies to enable.'),
  })
  .passthrough();

export type SmartMaxTurnsConfig = z.infer<typeof SmartMaxTurnsConfigSchema>;

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface SmartMaxTurnsPluginOptions {
  /**
   * Model name for the LLM judge strategy. Only required if
   * `detect.llmJudge` is enabled in per-use config.
   */
  judgeModel?: string;

  /**
   * Default judge prompt template (can be overridden per-use).
   */
  judgePrompt?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MIN_TURNS = 3;
const DEFAULT_EXACT_LOOP_THRESHOLD = 2;
const DEFAULT_RESPONSE_REPETITION_THRESHOLD = 2;
const DEFAULT_WRAP_UP_PROMPT =
  'You have spent several turns working on this task. Please provide your best final answer now based on what you have learned so far.';
const DEFAULT_JUDGE_PROMPT = `Analyze this AI agent conversation. Is the agent making meaningful progress toward the user's goal, or is it stuck in a loop repeating similar actions without advancing?

Respond with exactly one word: PROGRESSING or STUCK

Conversation:
{messages}`;

// Effectively disables the framework's own maxTurns check.
const INFINITE_TURNS = 999999;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Creates a middleware that intelligently manages tool-calling turn limits.
 *
 * Instead of a rigid turn counter, `smartMaxTurns` uses heuristic detectors
 * (and optionally an LLM judge) to identify when an agent is stuck in a loop
 * or making no progress, and terminates early.
 *
 * By default, only cheap heuristic detectors are enabled:
 * - **Exact loop detection** — catches identical tool calls repeated across turns.
 * - **Response repetition** — catches tools returning identical outputs across turns.
 *
 * An optional LLM judge can be enabled for deeper semantic analysis by
 * providing a `judgeModel` in plugin options and enabling `detect.llmJudge`.
 *
 * ```ts
 * import { smartMaxTurns } from 'genkitx-misc/smart-max-turns';
 *
 * const ai = genkit({
 *   plugins: [smartMaxTurns.plugin()],
 * });
 *
 * const response = await ai.generate({
 *   model: 'googleai/gemini-flash-latest',
 *   prompt: 'Research and summarize...',
 *   tools: [searchTool, analyzeTool],
 *   use: [smartMaxTurns()],
 * });
 *
 * const meta = (response.custom as any)?.smartMaxTurns;
 * if (meta) {
 *   console.log(`Terminated: ${meta.reason}, turns: ${meta.turnsUsed}`);
 * }
 * ```
 */
export const smartMaxTurns: GenerateMiddleware<
  typeof SmartMaxTurnsConfigSchema,
  SmartMaxTurnsPluginOptions | void
> = generateMiddleware(
  {
    name: 'smartMaxTurns',
    description:
      'Intelligently manages tool-calling turn limits using loop detection ' +
      'heuristics and an optional LLM judge, replacing rigid maxTurns counters.',
    configSchema: SmartMaxTurnsConfigSchema,
  },
  ({ config, pluginConfig, ai }) => {
    const maxTurns = config?.maxTurns ?? DEFAULT_MAX_TURNS;
    const minTurns = config?.minTurns ?? DEFAULT_MIN_TURNS;
    const onDetection = config?.onDetection ?? 'abort';
    const wrapUpPrompt = config?.wrapUpPrompt ?? DEFAULT_WRAP_UP_PROMPT;

    // Resolve detection config
    const detectConfig = config?.detect ?? {};
    const exactLoopsEnabled = detectConfig.exactLoops !== false;
    const exactLoopThreshold =
      typeof detectConfig.exactLoops === 'object' && 'threshold' in detectConfig.exactLoops
        ? detectConfig.exactLoops.threshold
        : DEFAULT_EXACT_LOOP_THRESHOLD;

    const responseRepEnabled = detectConfig.responseRepetition !== false;
    const responseRepThreshold =
      typeof detectConfig.responseRepetition === 'object' &&
      'threshold' in detectConfig.responseRepetition
        ? detectConfig.responseRepetition.threshold
        : DEFAULT_RESPONSE_REPETITION_THRESHOLD;

    const llmJudgeEnabled = !!detectConfig.llmJudge;
    const llmJudgeEvery =
      typeof detectConfig.llmJudge === 'object' && 'every' in detectConfig.llmJudge
        ? detectConfig.llmJudge.every
        : 1;

    const judgeModel = pluginConfig?.judgeModel;
    const judgePromptTemplate =
      config?.judgePrompt ?? pluginConfig?.judgePrompt ?? DEFAULT_JUDGE_PROMPT;

    if (llmJudgeEnabled && !judgeModel) {
      throw new Error(
        'smartMaxTurns: detect.llmJudge is enabled but no judgeModel was provided in plugin options.'
      );
    }

    // -----------------------------------------------------------------------
    // Detection runner
    // -----------------------------------------------------------------------

    async function runDetectors(
      messages: MessageData[],
      currentTurn: number
    ): Promise<DetectorResult> {
      // 1. Exact loop detection
      if (exactLoopsEnabled) {
        const result = detectExactLoops(messages, exactLoopThreshold);
        if (result.status !== 'ok') return result;
      }

      // 2. Response repetition
      if (responseRepEnabled) {
        const result = detectResponseRepetition(messages, responseRepThreshold);
        if (result.status !== 'ok') return result;
      }

      // 3. LLM judge (only on the right cadence)
      if (llmJudgeEnabled && judgeModel) {
        const turnsSinceMin = currentTurn - minTurns;
        if (turnsSinceMin >= 0 && turnsSinceMin % llmJudgeEvery === 0) {
          const result = await runLlmJudge(messages);
          if (result.status !== 'ok') return result;
        }
      }

      return { status: 'ok' };
    }

    async function runLlmJudge(messages: MessageData[]): Promise<DetectorResult> {
      try {
        // Render messages as text for the judge
        const rendered = messages
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

        const prompt = judgePromptTemplate.replace('{messages}', rendered);

        const response = await ai.generate({
          model: judgeModel!,
          prompt,
        });

        const verdict = response.text.trim().toUpperCase();
        if (verdict.includes('STUCK')) {
          return {
            status: 'stuck',
            detail: 'LLM judge determined the agent is stuck',
          };
        }
        return { status: 'ok' };
      } catch (e) {
        // If the judge fails, don't block the main agent — just warn and proceed
        console.warn(
          `[smartMaxTurns] LLM judge call failed, proceeding without judgment: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
        return { status: 'ok' };
      }
    }

    // -----------------------------------------------------------------------
    // Termination strategies
    // -----------------------------------------------------------------------

    function buildAbortResponse(
      currentTurn: number,
      detection: DetectorResult,
      lastModelMessage?: MessageData
    ): GenerateResponseData {
      return {
        finishReason: 'aborted',
        finishMessage: `smartMaxTurns: ${detection.detail ?? detection.status}`,
        message: lastModelMessage ?? {
          role: 'model',
          content: [{ text: `Agent terminated: ${detection.detail ?? detection.status}` }],
        },
        custom: {
          smartMaxTurns: {
            reason: detection.status,
            detail: detection.detail,
            turnsUsed: currentTurn,
          },
        },
      };
    }

    // -----------------------------------------------------------------------
    // Generate hook
    // -----------------------------------------------------------------------

    return {
      generate: async (envelope, ctx, next) => {
        const { currentTurn } = envelope;

        // Take ownership: override the framework's maxTurns to infinite
        const modifiedEnvelope = {
          ...envelope,
          request: {
            ...envelope.request,
            maxTurns: INFINITE_TURNS,
          },
        };

        // Hard ceiling — always enforce
        if (currentTurn >= maxTurns) {
          const lastModel = [...(envelope.request.messages || [])]
            .reverse()
            .find((m) => m.role === 'model');
          return buildAbortResponse(
            currentTurn,
            {
              status: 'loop',
              detail: `Hard turn limit reached (${maxTurns})`,
            },
            lastModel
          );
        }

        // Below minimum — proceed without checking
        if (currentTurn < minTurns) {
          return next(modifiedEnvelope, ctx);
        }

        // Run detectors on the conversation history
        const messages = envelope.request.messages || [];
        const detection = await runDetectors(messages, currentTurn);

        if (detection.status === 'ok') {
          return next(modifiedEnvelope, ctx);
        }

        // Problem detected — apply termination strategy
        if (onDetection === 'wrapUp') {
          // Remove tools and ask the model to wrap up
          const wrapUpEnvelope = {
            ...modifiedEnvelope,
            request: {
              ...modifiedEnvelope.request,
              tools: [],
              messages: [
                ...messages,
                {
                  role: 'user' as const,
                  content: [{ text: wrapUpPrompt }],
                },
              ],
            },
          };
          const response = await next(wrapUpEnvelope, ctx);
          return {
            ...response,
            custom: {
              ...((response.custom as Record<string, unknown>) ?? {}),
              smartMaxTurns: {
                reason: detection.status,
                detail: detection.detail,
                turnsUsed: currentTurn,
                action: 'wrapUp',
              },
            },
          };
        }

        if (onDetection === 'pruneTools') {
          // Remove tools that appear in the detected loop
          const loopingToolNames = new Set<string>();
          // Extract tool names from recent model messages
          for (let i = messages.length - 1; i >= 0 && loopingToolNames.size < 10; i--) {
            const msg = messages[i];
            if (msg.role === 'model') {
              for (const part of msg.content) {
                if (part.toolRequest) {
                  loopingToolNames.add(part.toolRequest.name);
                }
              }
              // Only look at the last few model messages
              if (loopingToolNames.size > 0) break;
            }
          }

          const prunedTools = (modifiedEnvelope.request.tools || []).filter((t: any) => {
            // Tools in the envelope can be strings ("/tool/name") or objects ({ name })
            const toolName = typeof t === 'string' ? t.replace(/^\/tool\//, '') : t.name;
            return !loopingToolNames.has(toolName);
          });

          if (prunedTools.length === 0) {
            // All tools pruned — fall back to wrapUp behavior
            const wrapUpEnvelope = {
              ...modifiedEnvelope,
              request: {
                ...modifiedEnvelope.request,
                tools: [],
                messages: [
                  ...messages,
                  {
                    role: 'user' as const,
                    content: [{ text: wrapUpPrompt }],
                  },
                ],
              },
            };
            const response = await next(wrapUpEnvelope, ctx);
            return {
              ...response,
              custom: {
                ...((response.custom as Record<string, unknown>) ?? {}),
                smartMaxTurns: {
                  reason: detection.status,
                  detail: detection.detail,
                  turnsUsed: currentTurn,
                  action: 'pruneTools-fallbackWrapUp',
                  prunedTools: [...loopingToolNames],
                },
              },
            };
          }

          const prunedEnvelope = {
            ...modifiedEnvelope,
            request: {
              ...modifiedEnvelope.request,
              tools: prunedTools,
            },
          };
          const response = await next(prunedEnvelope, ctx);
          return {
            ...response,
            custom: {
              ...((response.custom as Record<string, unknown>) ?? {}),
              smartMaxTurns: {
                reason: detection.status,
                detail: detection.detail,
                turnsUsed: currentTurn,
                action: 'pruneTools',
                prunedTools: [...loopingToolNames],
              },
            },
          };
        }

        // Default: abort
        const lastModel = [...messages].reverse().find((m) => m.role === 'model');
        return buildAbortResponse(currentTurn, detection, lastModel);
      },
    };
  }
);
