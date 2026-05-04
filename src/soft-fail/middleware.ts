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

import {
  GenerationResponseError,
  GenkitError,
  ToolInterruptError,
  z,
  type GenerateResponseData,
} from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';

export const SoftFailConfigSchema = z
  .object({
    /**
     * Catch model call errors and return them as aborted responses instead of
     * throwing. When `true` (the default), any error thrown by the model is
     * caught and a synthetic response with `finishReason: 'aborted'` is
     * returned.
     * @default true
     */
    model: z
      .boolean()
      .optional()
      .describe('Catch model call errors and return them as aborted responses.'),
    /**
     * Only catch model errors whose `GenkitError.status` is included in this
     * list. When `undefined` (the default), all model errors are caught.
     */
    modelStatuses: z
      .array(z.string())
      .optional()
      .describe('Only catch model errors with these statuses. Undefined means catch all.'),
    /**
     * Catch tool execution errors and return them as tool response text instead
     * of throwing. The model sees the error and may recover on its own.
     * `ToolInterruptError`s are never caught — they are intentional control
     * flow.
     * @default true
     */
    tools: z
      .boolean()
      .optional()
      .describe('Catch tool execution errors and return them as tool responses.'),
    /**
     * When the maximum number of tool-call turns is reached, return the last
     * model response with `finishReason: 'aborted'` instead of throwing.
     * @default true
     */
    maxTurns: z
      .boolean()
      .optional()
      .describe('Handle max turns gracefully by returning aborted response instead of throwing.'),
  })
  .passthrough();

export type SoftFailConfig = z.infer<typeof SoftFailConfigSchema>;

/**
 * Creates a middleware that prevents `generate()` from throwing in common
 * failure scenarios, returning an aborted `GenerateResponse` instead.
 *
 * Three kinds of failures are handled:
 *
 * 1. **Model errors** — if the model call throws (even after retries /
 *    fallbacks), the error is caught and a synthetic response with
 *    `finishReason: 'aborted'` is returned, preserving any tool-calling
 *    progress accumulated so far.
 *
 * 2. **Tool errors** — if a tool throws, the error text is returned to the
 *    model as a normal tool response so it can recover, retry, or finish
 *    without that tool.
 *
 * 3. **Max turns exceeded** — instead of throwing when the turn limit is
 *    reached, the model's last response (including pending tool requests) is
 *    returned with `finishReason: 'aborted'`.
 *
 * ```ts
 * import { softFail } from 'genkitx-misc/soft-fail';
 *
 * const response = await ai.generate({
 *   model: googleAI.model('gemini-2.5-flash'),
 *   prompt: 'Do something complex',
 *   tools: [riskyTool],
 *   use: [softFail()],
 * });
 *
 * if (response.finishReason === 'aborted') {
 *   console.log('Generation did not complete:', response.finishMessage);
 * }
 * ```
 */
export const softFail: GenerateMiddleware<typeof SoftFailConfigSchema> = generateMiddleware(
  {
    name: 'softFail',
    description:
      'Prevents generate() from throwing on model errors, tool errors, ' +
      'and max-turns limits by returning an aborted response instead.',
    configSchema: SoftFailConfigSchema,
  },
  ({ config }) => {
    const catchModel = config?.model !== false;
    const catchTools = config?.tools !== false;
    const catchMaxTurns = config?.maxTurns !== false;
    const modelStatuses = config?.modelStatuses;

    // Shared across the model and generate hooks within a single middleware
    // instance (which lives for one top-level generate call). The model hook
    // stashes its synthetic response here so the generate hook can re-surface
    // it if a secondary error (e.g. schema validation) occurs downstream.
    let lastModelSoftFailResponse: GenerateResponseData | null = null;

    function shouldCatchModelError(e: unknown): boolean {
      if (!modelStatuses) return true; // catch all
      if (e instanceof GenkitError) {
        return modelStatuses.includes(e.status);
      }
      // Non-GenkitError (e.g. network error) — always catch
      return true;
    }

    return {
      // ----- model hook: catch model call errors -----
      model: catchModel
        ? async (req, ctx, next) => {
            try {
              return await next(req, ctx);
            } catch (e) {
              if (!shouldCatchModelError(e)) throw e;
              const errorMessage = e instanceof Error ? e.message : String(e);
              const response: GenerateResponseData = {
                finishReason: 'aborted',
                finishMessage: `Model call failed: ${errorMessage}`,
                message: {
                  role: 'model',
                  content: [{ text: `Error: ${errorMessage}` }],
                },
                custom: {
                  softFail: {
                    reason: 'model-error',
                    error: errorMessage,
                    status: e instanceof GenkitError ? e.status : undefined,
                  },
                },
              };
              lastModelSoftFailResponse = response;
              return response;
            }
          }
        : undefined,

      // ----- tool hook: catch tool execution errors -----
      tool: catchTools
        ? async (req, ctx, next) => {
            try {
              return await next(req, ctx);
            } catch (e) {
              // Never swallow intentional interrupts
              if (
                e instanceof ToolInterruptError ||
                (e instanceof Error && e.name === 'ToolInterruptError')
              ) {
                throw e;
              }
              const errorMessage = e instanceof Error ? e.message : String(e);
              return {
                toolResponse: {
                  name: req.toolRequest.name,
                  ref: req.toolRequest.ref,
                  output: `Tool '${req.toolRequest.name}' failed: ${errorMessage}`,
                },
              };
            }
          }
        : undefined,

      // ----- generate hook: catch max-turns & safety net for model hook -----
      generate:
        catchMaxTurns || catchModel
          ? async (envelope, ctx, next) => {
              lastModelSoftFailResponse = null;
              try {
                return await next(envelope, ctx);
              } catch (e) {
                // (A) Max turns exceeded — the framework throws a
                //     GenerationResponseError with status ABORTED and embeds
                //     the model's last response in the error detail.
                if (
                  catchMaxTurns &&
                  e instanceof GenerationResponseError &&
                  e.status === 'ABORTED'
                ) {
                  const responseJson = e.detail.response.toJSON();
                  return {
                    ...responseJson,
                    finishReason: 'aborted' as const,
                    finishMessage: e.message,
                    custom: {
                      ...((responseJson.custom as Record<string, unknown>) ?? {}),
                      softFail: {
                        reason: 'max-turns',
                        error: e.message,
                      },
                    },
                  };
                }

                // (B) Secondary error after a model soft-fail (e.g. schema
                //     validation on the synthetic message). Re-surface the
                //     stashed response.
                if (lastModelSoftFailResponse) {
                  const resp = lastModelSoftFailResponse;
                  lastModelSoftFailResponse = null;
                  return resp;
                }

                throw e;
              }
            }
          : undefined,
    };
  }
);
