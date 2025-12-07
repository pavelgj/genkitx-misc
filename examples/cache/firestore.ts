import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { cache } from "../../src/cache/index.js";
import { FirestoreCacheStore } from "../../src/cache/firestore.js";
import { Firestore } from "@google-cloud/firestore";

const ai = genkit({
  plugins: [googleAI()],
});

const firestore = new Firestore();
const cacheStore = new FirestoreCacheStore(firestore);

const myFlow = ai.defineFlow("myFlow", async (input) => {
  const response = await ai.generate({
    model: "googleai/gemini-2.5-flash",
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
    console.log("Running flow...");
    console.log("First call:", await myFlow("Hello world"));
    console.log("Second call:", await myFlow("Hello world"));
  } catch (e) {
    console.error("Error:", e);
  }
})();
