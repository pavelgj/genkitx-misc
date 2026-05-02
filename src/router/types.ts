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

import { GenerateRequest } from 'genkit/model';

/**
 * Input provided to routing conditions and classifiers.
 */
export type RouterInput = {
  request: GenerateRequest;
};

/**
 * A routing condition function. Returns true if the request matches.
 */
export type RoutingCondition = (input: RouterInput) => boolean | Promise<boolean>;

/**
 * A classifier function. Returns a string key used to look up a model.
 */
export type Classifier = (input: RouterInput) => string | Promise<string>;

/**
 * Plugin options for the router middleware (non-serializable).
 * These are provided when registering the middleware plugin.
 */
export interface RouterPluginOptions {
  /**
   * Custom named matchers (routing conditions).
   * Built-in matchers ('hasMedia', 'hasTools', 'hasHistory') are always available.
   * Register additional matchers here, then reference them by name in the config.
   */
  matchers?: Record<string, RoutingCondition>;

  /**
   * Custom named classifiers.
   * Register classifier functions here, then reference them by name in the config.
   */
  classifiers?: Record<string, Classifier>;
}
