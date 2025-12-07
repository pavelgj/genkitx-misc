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

import { Pool } from 'pg';
import { CacheStore } from './types.js';

export interface PostgresCacheOptions {
  /**
   * Postgres Pool instance or configuration.
   * If passing a config object, a new Pool will be created.
   */
  pool: Pool;
  /**
   * Name of the table to store cache entries.
   * Defaults to 'cache'.
   */
  tableName?: string;
  /**
   * If true, the store will not attempt to create the table.
   * Useful if you want to manage schema migrations separately.
   * Defaults to false.
   */
  noCreate?: boolean;
}

export class PostgresCacheStore implements CacheStore {
  private pool: Pool;
  private tableName: string;
  private noCreate: boolean;
  private initialized = false;

  constructor(options: PostgresCacheOptions) {
    this.pool = options.pool;
    this.tableName = options.tableName || 'cache';
    this.noCreate = options.noCreate || false;
  }

  private async ensureTable() {
    if (this.initialized || this.noCreate) return;

    if (!/^[a-zA-Z0-9_]+$/.test(this.tableName)) {
      throw new Error(`Invalid table name: ${this.tableName}`);
    }

    const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        expires_at BIGINT NOT NULL
      );
    `;

    await this.pool.query(query);
    this.initialized = true;
  }

  async get(key: string): Promise<any | null> {
    await this.ensureTable();

    const query = `SELECT value, expires_at FROM ${this.tableName} WHERE key = $1`;
    const result = await this.pool.query(query, [key]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    // pg returns BIGINT as string
    if (BigInt(row.expires_at) < BigInt(Date.now())) {
      // Lazy cleanup
      this.pool
        .query(`DELETE FROM ${this.tableName} WHERE key = $1`, [key])
        .catch((e) =>
          console.error(`[PostgresCacheStore] Failed to delete expired key '${key}':`, e)
        );
      return null;
    }

    return row.value;
  }

  async set(key: string, value: any, ttlMs: number): Promise<void> {
    await this.ensureTable();

    const expiresAt = Date.now() + ttlMs;

    const query = `
      INSERT INTO ${this.tableName} (key, value, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key)
      DO UPDATE SET
        value = $2,
        expires_at = $3
    `;

    // pg driver handles object serialization for JSONB columns, but for primitives (strings)
    // we need to stringify them so they are treated as JSON strings, not invalid JSON tokens.
    // Explicit stringify works for objects too (pg sees string and passes it).
    await this.pool.query(query, [key, JSON.stringify(value), expiresAt]);
  }
}
