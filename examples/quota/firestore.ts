import { genkit } from 'genkit';
import { retry } from 'genkit/model/middleware';
import { googleAI } from '@genkit-ai/google-genai';
import { quota } from '../../src/quota/index.js';
import { FirestoreQuotaStore } from '../../src/quota/firestore.js';
import { Firestore } from '@google-cloud/firestore';

const ai = genkit({
  plugins: [googleAI()],
});

// Ensure you have GOOGLE_APPLICATION_CREDENTIALS set or are in a GCP environment
const firestore = new Firestore();
const quotaStore = new FirestoreQuotaStore(firestore, 'quotas');

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash', // Ensure model is configured/available
    prompt: input,
    use: [
      retry({ initialDelayMs: 20000, maxRetries: 5, onError: console.log }),
      quota({
        store: quotaStore,
        limit: 5,
        windowMs: 60000, // 1 minute
        key: 'example-key',
      }),
    ],
  });
  return response.text;
});

// Run the flow
(async () => {
  try {
    console.log('Running flow...');
    console.log(await myFlow('Hello world'));
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await firestore.terminate();
  }
})();
