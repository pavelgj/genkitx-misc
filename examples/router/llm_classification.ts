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
import { router } from '../../src/router/index.js';

// We create the Genkit instance first so we can use it in the classifier
let ai: ReturnType<typeof genkit>;

ai = genkit({
  plugins: [
    googleAI(),
    // Register the router plugin with an LLM-based classifier
    router.plugin({
      classifiers: {
        llmClassifier: async ({ request }) => {
          // Extract text from request
          const text = request.messages
            .map((m) => m.content.map((c) => c.text).join(''))
            .join('\n');

          // Use a lightweight model for classification
          const result = await ai.generate({
            model: 'googleai/gemini-2.5-flash-lite',
            prompt: `Classify the following prompt as either "simple" (math, greeting, short question) or "complex" (coding, creative writing, reasoning).\n\nPrompt: ${text}\n\nClassification:`,
            output: {
              format: 'enum',
              schema: z.enum(['simple', 'complex']),
            },
          });
          return result.output || 'simple';
        },
      },
    }),
  ],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: input,
    use: [
      router({
        classifier: 'llmClassifier',
        models: {
          simple: { name: 'googleai/gemini-2.5-flash' },
          complex: { name: 'googleai/gemini-2.5-pro' },
        },
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log('Running flow...');
    console.log(await myFlow('What is 2+2?'));
    console.log(await myFlow('Write a poem about the singularity.'));
  } catch (e) {
    console.error('Error:', e);
  }
})();
