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

import { GenkitError, z } from 'genkit';
import { generateMiddleware, type GenerateMiddleware } from 'genkit/beta';
import { BUILTIN_MATCHERS } from './predicates.js';
import type { Classifier, RouterPluginOptions } from './types.js';

// Mirrors genkit's ModelReferenceSchema. Use the canonical export once available.
const ModelRefSchema = z.object({
  name: z.string(),
  config: z.any().optional(),
});

const RoutingRuleSchema = z.object({
  /**
   * Name of a registered matcher (routing condition).
   * Built-in: 'hasMedia', 'hasTools', 'hasHistory'.
   * Custom matchers can be registered via plugin options.
   */
  when: z.string().describe('Name of a registered matcher (routing condition).'),

  /**
   * Model to use if the condition is met.
   */
  use: ModelRefSchema.describe('Model to use if the condition is met.'),
});

export const RouterConfigSchema = z
  .object({
    /**
     * Prioritized list of routing rules.
     * Evaluated in order. The first rule whose `when` matcher returns true will be used.
     */
    rules: z
      .array(RoutingRuleSchema)
      .optional()
      .describe('Prioritized list of routing rules.'),

    /**
     * Name of a registered classifier function (from plugin options).
     * The classifier returns a string key used to look up a model in `models`.
     */
    classifier: z
      .string()
      .optional()
      .describe('Name of a registered classifier function from plugin options.'),

    /**
     * Map of classification keys to models.
     * Required if `classifier` is used.
     */
    models: z
      .record(z.string(), ModelRefSchema)
      .optional()
      .describe('Map of classification keys to models.'),
  })
  .passthrough();

export type RouterConfig = z.infer<typeof RouterConfigSchema>;

/**
 * Creates a router middleware that routes requests to different models based on
 * named matchers or classifiers.
 *
 * Matchers and classifiers are non-serializable functions provided via plugin options.
 * Built-in matchers ('hasMedia', 'hasTools', 'hasHistory') are always available.
 *
 * ```ts
 * // Register the plugin (built-in matchers are always available):
 * const ai = genkit({
 *   plugins: [router.plugin()],
 * });
 *
 * // Or register with custom matchers:
 * const ai = genkit({
 *   plugins: [
 *     router.plugin({
 *       matchers: {
 *         isLongContext: ({ request }) =>
 *           request.messages.some(m => m.content.some(p => p.text && p.text.length > 10000)),
 *       },
 *     }),
 *   ],
 * });
 *
 * // Use in generate:
 * const response = await ai.generate({
 *   model: 'googleai/gemini-2.5-flash',
 *   prompt: 'hello',
 *   use: [
 *     router({
 *       rules: [
 *         { when: 'hasMedia', use: { name: 'googleai/gemini-2.5-pro' } },
 *         { when: 'isLongContext', use: { name: 'googleai/gemini-2.5-pro' } },
 *       ],
 *     }),
 *   ],
 * });
 * ```
 */
export const router: GenerateMiddleware<typeof RouterConfigSchema, RouterPluginOptions | void> =
  generateMiddleware(
    {
      name: 'router',
      description:
        'Routes requests to different models based on named matchers or classifiers.',
      configSchema: RouterConfigSchema,
    },
    ({ config, pluginConfig, ai }) => {
      const { rules, classifier: classifierName, models } = config || {};

      // Merge built-in matchers with custom matchers from plugin options
      const allMatchers = {
        ...BUILTIN_MATCHERS,
        ...(pluginConfig?.matchers || {}),
      };

      // Resolve classifier
      const classifiers = pluginConfig?.classifiers || {};
      let resolvedClassifier: Classifier | undefined;
      if (classifierName) {
        resolvedClassifier = classifiers[classifierName];
        if (!resolvedClassifier) {
          throw new Error(
            `Router classifier '${classifierName}' not found. Available: ${Object.keys(classifiers).join(', ') || '(none)'}`
          );
        }
      }

      return {
        model: async (req, ctx, next) => {
          let targetModelRef: z.infer<typeof ModelRefSchema> | undefined;

          // 1. Check rules first (prioritized)
          if (rules) {
            for (const rule of rules) {
              const matcher = allMatchers[rule.when];
              if (!matcher) {
                console.warn(
                  `[Genkit Router] Matcher '${rule.when}' not found. Available: ${Object.keys(allMatchers).join(', ')}`
                );
                continue;
              }
              try {
                const matches = await matcher({ request: req });
                if (matches) {
                  targetModelRef = rule.use;
                  break;
                }
              } catch (e) {
                console.warn(`[Genkit Router] Matcher '${rule.when}' failed:`, e);
              }
            }
          }

          // 2. Check classifier if no rule matched
          if (!targetModelRef && resolvedClassifier && models) {
            try {
              const key: string = await resolvedClassifier({ request: req });
              if (key in models) {
                targetModelRef = models[key];
              }
            } catch (e) {
              console.warn(`[Genkit Router] Classifier failed:`, e);
            }
          }

          // 3. If we have a target model, use it directly
          if (targetModelRef) {
            try {
              const modelAction = await ai.registry.lookupAction(
                `/model/${targetModelRef.name}`
              );
              if (modelAction) {
                // Apply model-specific config from the routing rule if provided,
                // otherwise fall through to the original request config.
                const routedReq = targetModelRef.config
                  ? { ...req, config: targetModelRef.config }
                  : req;
                return await (modelAction as Function)(routedReq, ctx);
              }
            } catch (e) {
              throw new GenkitError({
                status: 'INTERNAL',
                message: `Router failed to resolve model '${targetModelRef.name}': ${e instanceof Error ? e.message : String(e)}`,
                detail: e,
              });
            }
          }

          // 4. Fallback to original model
          return next(req, ctx);
        },
      };
    }
  );
