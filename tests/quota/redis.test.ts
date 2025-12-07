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
  beforeEach,
} from "@jest/globals";
import RedisMock from "ioredis-mock";
import { RedisQuotaStore } from "../../src/quota/redis.js";

describe("Redis Quota Store", () => {
  let store: RedisQuotaStore;
  let client: any;

  beforeEach(() => {
    client = new RedisMock();
    store = new RedisQuotaStore({ client });
  });

  it("should increment and return new value", async () => {
    const val = await store.increment("key1", 1, 1000);
    expect(val).toBe(1);

    const val2 = await store.increment("key1", 1, 1000);
    expect(val2).toBe(2);

    const storedVal = await client.get("quota:key1");
    expect(storedVal).toBe("2");
  });

  it("should set expiration on first increment", async () => {
    await store.increment("key2", 1, 1000);

    // ioredis-mock supports pttl
    const ttl = await client.pttl("quota:key2");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(1000);
  });

  it("should respect limit optimization", async () => {
    // Increment to limit (3)
    await store.increment("key3", 3, 1000);

    // Try to increment again with limit=3
    // The implementation checks limit before incrementing
    // It returns current value (3) + delta (1) = 4
    // But DOES NOT increment the stored value
    const val = await store.increment("key3", 1, 1000, 3);

    // It returns 4 so middleware blocks it
    expect(val).toBe(4);

    // Verify stored value is still 3
    const storedVal = await client.get("quota:key3");
    expect(storedVal).toBe("3");
  });

  it("should handle multiple increments correctly", async () => {
    await store.increment("key4", 1, 1000);
    await store.increment("key4", 2, 1000);
    const val = await client.get("quota:key4");
    expect(val).toBe("3");
  });
});
