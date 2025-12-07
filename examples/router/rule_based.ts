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

import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { router, hasMedia, hasTools } from '../../src/router/index.js';

const ai = genkit({
  plugins: [googleAI()],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash', // Default fallback
    prompt: input,
    use: [
      router(ai, {
        rules: [
          // Use Pro model for requests with media
          { when: hasMedia, use: 'googleai/gemini-2.5-pro' },
          // Use Pro model for requests with tools
          { when: hasTools, use: 'googleai/gemini-2.5-pro' },
        ],
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log('Running flow...');
    console.log(await myFlow('Hello world'));
    console.log(
      await myFlow([
        {
          media: {
            url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/1280px-Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg',
          },
        },
      ])
    );
  } catch (e) {
    console.error('Error:', e);
  }
})();
