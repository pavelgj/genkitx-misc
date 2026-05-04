import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { cache } from '../../src/cache/index.js';
import { PostgresCacheStore } from '../../src/cache/postgres.js';
import { Pool } from 'pg';

const pool = new Pool({
  database: 'postgres',
});
const cacheStore = new PostgresCacheStore({ pool });

const ai = genkit({
  plugins: [googleAI(), cache.plugin({ store: cacheStore })],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-flash-latest',
    prompt: input,
    use: [cache({ ttlMs: 60000 })],
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
