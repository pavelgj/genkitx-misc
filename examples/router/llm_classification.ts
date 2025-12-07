/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { genkit, z } from "genkit";
import { googleAI } from "@genkit-ai/google-genai";
import { router } from "../../src/router/index.js";

const ai = genkit({
  plugins: [googleAI()],
});

// Define a helper flow for classification to keep things clean
const classifierFlow = ai.defineFlow("classifier", async (text: string) => {
  const result = await ai.generate({
    model: "googleai/gemini-2.5-flash-lite", // Use lightweight model for routing
    prompt: `Classify the following prompt as either "simple" (math, greeting, short question) or "complex" (coding, creative writing, reasoning).\n\nPrompt: ${text}\n\nClassification:`,
    output: {
      format: "enum",
      schema: z.enum(["simple", "complex"]),
    },
  });
  return result.output;
});

const myFlow = ai.defineFlow("myFlow", async (input) => {
  const response = await ai.generate({
    model: "googleai/gemini-2.5-flash",
    prompt: input,
    use: [
      router(ai, {
        classifier: async (input) => {
          // Extract text from request
          const text = input.request.messages
            .map((m) => m.content.map((c) => c.text).join(""))
            .join("\n");

          // Call the classifier flow (or direct generate)
          // Note: In a real scenario, you might want to handle errors gracefully or use a fallback
          const classification = await classifierFlow(text);
          return classification || "simple";
        },
        models: {
          simple: "googleai/gemini-2.5-flash",
          complex: "googleai/gemini-2.5-pro",
        },
      }),
    ],
  });
  return response.text;
});

(async () => {
  try {
    console.log("Running flow...");
    console.log(await myFlow("What is 2+2?"));
    console.log(await myFlow("Write a poem about the singularity."));
  } catch (e) {
    console.error("Error:", e);
  }
})();
