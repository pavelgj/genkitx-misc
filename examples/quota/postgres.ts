import { genkit } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { quota } from "../../src/quota/index.js";
import { PostgresQuotaStore } from "../../src/quota/postgres.js";
import { Pool } from "pg";

const ai = genkit({
  plugins: [googleAI()],
});

// Assumes a local Postgres instance is running on default port (5432)
// and accessible by the current user without password (trust auth)
// or configured via environment variables (PGUSER, PGPASSWORD, PGHOST, PGPORT, PGDATABASE)
const pool = new Pool({
  database: "postgres", // Default database
});

const store = new PostgresQuotaStore({ pool });

const myFlow = ai.defineFlow("myFlow", async (input) => {
  const response = await ai.generate({
    model: googleAI.model("gemini-2.5-flash"),
    prompt: input,
    use: [
      quota({
        store,
        limit: 2,
        windowMs: 60000,
        key: "postgres-example",
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
    await pool.end();
  }
})();
