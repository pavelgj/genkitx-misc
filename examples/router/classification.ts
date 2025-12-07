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

import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { router } from '../../src/router/index.js';

const ai = genkit({
  plugins: [googleAI()],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: input,
    use: [
      router(ai, {
        classifier: async (input) => {
          // Simple heuristic: long prompts -> complex
          const text = input.request.messages
            .map((m) => m.content.map((c) => c.text).join(''))
            .join('');
          return text.length > 100 ? 'complex' : 'simple';
        },
        models: {
          simple: 'googleai/gemini-2.5-flash',
          complex: 'googleai/gemini-2.5-pro',
        },
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log('Running flow...');
    console.log(await myFlow('Short prompt'));
    console.log(
      await myFlow(
        'This is a much longer prompt that should trigger the complex classifier rule because it exceeds the length threshold we set in the classifier function.'
      )
    );
  } catch (e) {
    console.error('Error:', e);
  }
})();
