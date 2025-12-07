import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { cache } from '../../src/cache/index.js';
import { InMemoryCacheStore } from '../../src/cache/memory.js';

const ai = genkit({
  plugins: [googleAI()],
});

const cacheStore = new InMemoryCacheStore();

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: input,
    use: [
      cache({
        store: cacheStore,
        ttlMs: 60000,
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log('Running flow...');
    console.log('First call (computed):', await myFlow('Hello world'));
    console.log('Second call (cached):', await myFlow('Hello world'));
  } catch (e) {
    console.error('Error:', e);
  }
})();
