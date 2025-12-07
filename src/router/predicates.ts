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

import { RouterInput } from "./types.js";

/**
 * Checks if the request contains any media (images, video, audio).
 */
export function hasMedia(input: RouterInput): boolean {
  return input.request.messages.some((message) =>
    message.content.some((part) => !!part.media)
  );
}

/**
 * Checks if the request has any tools defined.
 */
export function hasTools(input: RouterInput): boolean {
  const { request } = input;
  return !!(request.tools && request.tools.length > 0);
}

/**
 * Checks if the request has conversation history (more than one message).
 * Typically implies a multi-turn conversation.
 */
export function hasHistory(input: RouterInput): boolean {
  return input.request.messages.length > 1;
}
