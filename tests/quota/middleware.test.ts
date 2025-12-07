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

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { quota } from "../../src/quota/middleware.js";
import { InMemoryQuotaStore } from "../../src/quota/memory.js";
import { genkit, GenkitError } from "genkit";
import { defineEchoModel } from "../helpers.js";
import { QuotaStore } from "../../src/quota/index.js";

describe("Quota Middleware Integration", () => {
  let ai: ReturnType<typeof genkit>;
  let store: InMemoryQuotaStore;

  beforeEach(() => {
    ai = genkit({});
    defineEchoModel(ai);
    store = new InMemoryQuotaStore();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("should allow requests within quota", async () => {
    const response = await ai.generate({
      model: "echoModel",
      prompt: "hi",
      use: [quota({ store, limit: 2, windowMs: 1000 })],
    });
    expect(response.text).toContain("Echo: hi");

    const response2 = await ai.generate({
      model: "echoModel",
      prompt: "hi",
      use: [quota({ store, limit: 2, windowMs: 1000 })],
    });
    expect(response2.text).toContain("Echo: hi");
  });

  it("should block requests exceeding quota", async () => {
    const q = quota({ store, limit: 1, windowMs: 1000 });

    await ai.generate({
      model: "echoModel",
      prompt: "1",
      use: [q],
    });

    await expect(
      ai.generate({
        model: "echoModel",
        prompt: "2",
        use: [q],
      })
    ).rejects.toThrow(GenkitError);
  });

  it("should reset quota after window expiration", async () => {
    const q = quota({ store, limit: 1, windowMs: 1000 });

    await ai.generate({ model: "echoModel", prompt: "1", use: [q] });
    await expect(
      ai.generate({ model: "echoModel", prompt: "2", use: [q] })
    ).rejects.toThrow();

    jest.advanceTimersByTime(1001);

    const response = await ai.generate({
      model: "echoModel",
      prompt: "3",
      use: [q],
    });
    expect(response.text).toContain("Echo: 3");
  });

  it("should use custom key function", async () => {
    const q = quota({
      store,
      limit: 1,
      windowMs: 1000,
      key: ({ request }: any) => request.messages[0]?.content[0]?.text || "default",
    });

    await ai.generate({ model: "echoModel", prompt: "user1", use: [q] });
    await ai.generate({ model: "echoModel", prompt: "user2", use: [q] });

    await expect(
      ai.generate({ model: "echoModel", prompt: "user1", use: [q] })
    ).rejects.toThrow();
    await expect(
      ai.generate({ model: "echoModel", prompt: "user2", use: [q] })
    ).rejects.toThrow();
  });

  it("should not block if logOnly is true", async () => {
    const q = quota({ store, limit: 1, windowMs: 1000, logOnly: true });
    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    await ai.generate({ model: "echoModel", prompt: "1", use: [q] });
    await ai.generate({ model: "echoModel", prompt: "2", use: [q] });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[Genkit Quota Warning]")
    );
    consoleSpy.mockRestore();
  });

  it("should block all requests if limit is 0", async () => {
    const q = quota({ store, limit: 0, windowMs: 1000 });
    await expect(
      ai.generate({ model: "echoModel", prompt: "1", use: [q] })
    ).rejects.toThrow(GenkitError);
  });

  it("should fail open (allow request) if store throws error", async () => {
    const failingStore = {
      increment: (_, __, ___): Promise<number> => {
        throw new Error("Store down");
      },
    } as QuotaStore;
    const q = quota({ store: failingStore as any, limit: 1, windowMs: 1000, failOpen: true });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const response = await ai.generate({
      model: "echoModel",
      prompt: "1",
      use: [q],
    });
    expect(response.text).toContain("Echo: 1");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to check quota"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should fail closed (block request) if store throws error and failOpen is false", async () => {
    const failingStore = {
      increment: (_, __, ___): Promise<number> => {
        throw new Error("Store down");
      },
    } as QuotaStore;
    
    const q = quota({ store: failingStore as any, limit: 1, windowMs: 1000, failOpen: false });
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(ai.generate({
      model: "echoModel",
      prompt: "1",
      use: [q],
    })).rejects.toThrow(GenkitError);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to check quota"),
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it("should use message metadata for key", async () => {
    const q = quota({
      store,
      limit: 1,
      windowMs: 1000,
      key: ({ request }: any) =>
        request.messages[0]?.content[0]?.metadata?.userId || "anon",
    });

    await ai.generate({
      model: "echoModel",
      prompt: [{ text: "hi", metadata: { userId: "alice" } }],
      use: [q],
    });

    await expect(
      ai.generate({
        model: "echoModel",
        prompt: [{ text: "hi", metadata: { userId: "alice" } }],
        use: [q],
      })
    ).rejects.toThrow();

    // Bob should be allowed
    await ai.generate({
      model: "echoModel",
      prompt: [{ text: "hi", metadata: { userId: "bob" } }],
      use: [q],
    });
  });

  it("should use custom string key", async () => {
    const q = quota({
      store,
      limit: 1,
      windowMs: 1000,
      key: "my-custom-key",
    });

    await ai.generate({ model: "echoModel", prompt: "1", use: [q] });
    await expect(
      ai.generate({ model: "echoModel", prompt: "2", use: [q] })
    ).rejects.toThrow();

    // Verify it was stored under 'my-custom-key'
    const current = await store.increment("my-custom-key", 0, 1000);
    expect(current).toBe(1);
  });

  it("should not increment store count if limit exceeded (optimization)", async () => {
    const q = quota({ store, limit: 1, windowMs: 1000 });

    await ai.generate({ model: "echoModel", prompt: "1", use: [q] }); // Count 1

    // Blocked
    await expect(
      ai.generate({ model: "echoModel", prompt: "2", use: [q] })
    ).rejects.toThrow();
    await expect(
      ai.generate({ model: "echoModel", prompt: "3", use: [q] })
    ).rejects.toThrow();

    // Verify store count is still 1 (optimization prevents writing)
    // key 'default' is used when no key provided?
    // Wait, key defaults to 'global' in middleware if not provided.
    const current = await store.increment("global", 0, 1000);
    expect(current).toBe(1);
  });
});
