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

import { Genkit, GenkitError } from 'genkit';
import { ModelMiddleware, ModelArgument, ModelAction, ModelReference } from 'genkit/model';
import { RouterOptions } from './types.js';

/**
 * Creates a router middleware that routes requests to different models based on rules or classification.
 *
 * @param ai The Genkit instance (must have a registry).
 * @param options Configuration options for the router.
 */
export function router(ai: Genkit, options: RouterOptions): ModelMiddleware {
  const { rules, classifier, models } = options;

  return async (req, next) => {
    let targetModel: ModelArgument | undefined;

    // 1. Check rules first (prioritized)
    if (rules) {
      for (const rule of rules) {
        try {
          const matches = await rule.when({ request: req });
          if (matches) {
            targetModel = rule.use;
            break;
          }
        } catch (e) {
          console.warn(`[Genkit Router] Rule check failed:`, e);
        }
      }
    }

    // 2. Check classifier if no rule matched
    if (!targetModel && classifier && models) {
      try {
        const key = await classifier({ request: req });
        if (models[key]) {
          targetModel = models[key];
        }
      } catch (e) {
        console.warn(`[Genkit Router] Classifier failed:`, e);
      }
    }

    // 3. If we have a target model, use it
    if (targetModel) {
      try {
        const resolvedModel = await resolveModel(ai, targetModel);
        if (resolvedModel) {
          return resolvedModel(req);
        }
      } catch (e) {
        throw new GenkitError({
          status: 'INTERNAL',
          message: `Router failed to resolve model '${JSON.stringify(
            targetModel
          )}': ${e instanceof Error ? e.message : String(e)}`,
          detail: e,
        });
      }
    }

    // 4. Fallback to original model
    return next(req);
  };
}

async function resolveModel(ai: Genkit, model: ModelArgument): Promise<ModelAction> {
  let out: ModelAction;
  let modelId: string;

  if (typeof model === 'string') {
    modelId = model;
    out = await lookupModel(ai, model);
  } else if (model.hasOwnProperty('__action')) {
    modelId = (model as ModelAction).__action.name;
    out = model as ModelAction;
  } else {
    const ref = model as ModelReference<any>;
    modelId = ref.name;
    out = await lookupModel(ai, ref.name);
  }

  if (!out) {
    throw new GenkitError({
      status: 'NOT_FOUND',
      message: `Model '${modelId}' not found`,
    });
  }

  return out;
}

async function lookupModel(ai: Genkit, model: string): Promise<ModelAction> {
  return await ai.registry.lookupAction(`/model/${model}`);
}
