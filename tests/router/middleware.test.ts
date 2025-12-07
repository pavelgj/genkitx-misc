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

import { describe, it, expect, beforeEach } from "@jest/globals";
import { genkit, z } from "genkit";
import { router } from "../../src/router/middleware.js";
import { hasTools, hasMedia } from "../../src/router/predicates.js";

describe("Router Middleware", () => {
  let ai: ReturnType<typeof genkit>;

  beforeEach(() => {
    ai = genkit({});
    
    ai.defineModel({ name: "modelA" }, async () => ({
      message: { role: "model", content: [{ text: "Response from Model A" }] }
    }));

    ai.defineModel({ name: "modelB" }, async () => ({
      message: { role: "model", content: [{ text: "Response from Model B" }] }
    }));

    ai.defineModel({ name: "defaultModel" }, async () => ({
      message: { role: "model", content: [{ text: "Response from Default Model" }] }
    }));
  });

  it("should route based on rules", async () => {
    const r = router(ai, {
        rules: [
            { when: () => true, use: "modelA" }
        ]
    });

    const response = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });

    expect(response.text).toContain("Model A");
  });

  it("should fallback to next/default if no rules match", async () => {
    const r = router(ai, {
        rules: [
            { when: () => false, use: "modelA" }
        ]
    });

    const response = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });

    expect(response.text).toContain("Default Model");
  });

  it("should prioritize rules in order", async () => {
    const r = router(ai, {
        rules: [
            { when: () => true, use: "modelA" },
            { when: () => true, use: "modelB" }
        ]
    });

    const response = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });

    expect(response.text).toContain("Model A");
  });

  it("should use classifier", async () => {
    const r = router(ai, {
        classifier: async () => "typeB",
        models: {
            typeA: "modelA",
            typeB: "modelB"
        }
    });

    const response = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });

    expect(response.text).toContain("Model B");
  });

  it("should support hasTools predicate", async () => {
    const r = router(ai, {
        rules: [
            { when: hasTools, use: "modelB" }
        ]
    });

    // Without tools
    const resp1 = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });
    expect(resp1.text).toContain("Default Model");

    // With tools
    const tool = ai.defineTool({ name: "testTool", description: 'does stuff', inputSchema: z.object({}) }, async () => "done");
    const resp2 = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        tools: [tool],
        use: [r]
    });
    expect(resp2.text).toContain("Model B");
  });

  it("should support hasMedia predicate", async () => {
    const r = router(ai, {
        rules: [
            { when: hasMedia, use: "modelB" }
        ]
    });

    // Without media
    const resp1 = await ai.generate({
        model: "defaultModel",
        prompt: "hello",
        use: [r]
    });
    expect(resp1.text).toContain("Default Model");

    // With media
    const resp2 = await ai.generate({
        model: "defaultModel",
        prompt: [
            { text: "look at this" },
            { media: { url: "http://example.com/image.jpg", contentType: "image/jpeg" } }
        ],
        use: [r]
    });
    expect(resp2.text).toContain("Model B");
  });
});
