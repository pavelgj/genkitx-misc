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

import { GenerateRequest, ModelArgument } from 'genkit/model';

export type RouterInput = {
  request: GenerateRequest;
};

export type RoutingCondition = (input: RouterInput) => boolean | Promise<boolean>;

export interface RoutingRule {
  /**
   * Condition to check against the request.
   */
  when: RoutingCondition;

  /**
   * Model to use if the condition is met.
   */
  use: ModelArgument;
}

export type Classifier = (input: RouterInput) => string | Promise<string>;

export interface RouterOptions {
  /**
   * Prioritized list of routing rules.
   * Evaluated in order. The first rule whose `when` condition evaluates to true will be used.
   * If a rule matches, its `use` model is selected.
   */
  rules?: RoutingRule[];

  /**
   * Function to classify the request into a category (e.g., 'simple', 'complex').
   * The returned string is used as a key to look up a model in the `models` map.
   * If provided, this is evaluated after `rules` (if any rules fail to match).
   */
  classifier?: Classifier;

  /**
   * Map of category keys to models.
   * Required if `classifier` is used.
   */
  models?: Record<string, ModelArgument>;
}
