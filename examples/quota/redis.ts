import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { quota } from "../../src/quota/index.js";
import { RedisQuotaStore } from "../../src/quota/redis.js";
import Redis from "ioredis";

const ai = genkit({
  plugins: [googleAI()],
});

// Assumes local Redis on default port 6379
const redis = new Redis(); 

const store = new RedisQuotaStore({ client: redis });

const myFlow = ai.defineFlow("myFlow", async (input) => {
  const response = await ai.generate({
    model: googleAI.model("gemini-2.5-flash"),
    prompt: input,
    use: [
      quota({
        store,
        limit: 2,
        windowMs: 60000,
        key: "redis-example",
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log("Running flow...");
    console.log(await myFlow("Tell me a very short joke"));

    console.log("Running flow again...");
    console.log(await myFlow("Tell me another very short joke"));

    console.log("Running flow a third time (should fail)...");
    try {
      console.log(await myFlow("This one should fail"));
    } catch (e: any) {
      console.log("Caught expected error:", e.message);
    }
  } catch (e) {
    console.error("Unexpected Error:", e);
  } finally {
    await redis.quit();
  }
})();
