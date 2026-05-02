import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { cache } from '../../src/cache/index.js';
import { RedisCacheStore } from '../../src/cache/redis.js';

const cacheStore = new RedisCacheStore({
  client: 'redis://localhost:6379',
});

const ai = genkit({
  plugins: [
    googleAI(),
    cache.plugin({ store: cacheStore }),
  ],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
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
