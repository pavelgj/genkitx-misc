import { genkit } from 'genkit';
import { retry } from 'genkit/model/middleware';
import { googleAI } from '@genkit-ai/google-genai';
import { quota } from '../../src/quota/index.js';
import { InMemoryQuotaStore } from '../../src/quota/memory.js';

const ai = genkit({
  plugins: [googleAI()],
});

const quotaStore = new InMemoryQuotaStore();

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    prompt: input,
    use: [
      retry({ initialDelayMs: 20000, maxRetries: 5, onError: console.log }),
      quota({
        store: quotaStore,
        limit: 5,
        windowMs: 60000,
        key: 'example-key',
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log('Running flow...');
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
    console.log(await myFlow('Hello world'));
  } catch (e) {
    console.error('Error:', e);
  }
})();
