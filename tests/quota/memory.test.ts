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

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { InMemoryQuotaStore } from '../../src/quota/memory.js';

describe('InMemory Quota Store', () => {
  let store: InMemoryQuotaStore;

  beforeEach(() => {
    store = new InMemoryQuotaStore();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should increment and return new value', async () => {
    const val = await store.increment('key1', 1, 1000);
    expect(val).toBe(1);
    
    const val2 = await store.increment('key1', 1, 1000);
    expect(val2).toBe(2);
  });

  it('should reset after window expires', async () => {
    await store.increment('key2', 5, 1000);
    
    jest.advanceTimersByTime(1001);
    
    const val = await store.increment('key2', 1, 1000);
    expect(val).toBe(1);
  });
});
