import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { quota } from '../../src/quota/index.js';
import { RTDBQuotaStore } from '../../src/quota/rtdb.js';
import * as admin from 'firebase-admin';

// Ensure FIREBASE_CONFIG or credentials are set
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.database();
const quotaStore = new RTDBQuotaStore(db, 'quotas');

const ai = genkit({
  plugins: [
    googleAI(),
    quota.plugin({ store: quotaStore }),
  ],
});

const myFlow = ai.defineFlow('myFlow', async (input) => {
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
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
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await admin.app().delete();
  }
})();
