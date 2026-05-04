import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { quota } from '../../src/quota/index.js';
import { InMemoryQuotaStore } from '../../src/quota/memory.js';

const ai = genkit({
  plugins: [googleAI(), quota.plugin({ store: new InMemoryQuotaStore() })],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-flash-latest',
    prompt: input,
    use: [
      quota({
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
