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
import { QuotaStore } from './types.js';

export interface PostgresQuotaOptions {
  /**
   * Postgres Pool instance or configuration.
   * If passing a config object, a new Pool will be created.
   */
  pool: Pool;
  /**
   * Name of the table to store quotas.
   * Defaults to 'quotas'.
   */
  tableName?: string;
  /**
   * If true, the store will not attempt to create the table.
   * Useful if you want to manage schema migrations separately.
   * Defaults to false.
   */
  noCreate?: boolean;
}

export class PostgresQuotaStore implements QuotaStore {
  private pool: Pool;
  private tableName: string;
  private noCreate: boolean;
  private initialized = false;

  constructor(options: PostgresQuotaOptions) {
    this.pool = options.pool;
    this.tableName = options.tableName || 'quotas';
    this.noCreate = options.noCreate || false;
  }

  private async ensureTable() {
    if (this.initialized || this.noCreate) return;
    
    // Simple sanitization to avoid SQL injection on table name
    // In a real scenario, user should provide a safe table name
    if (!/^[a-zA-Z0-9_]+$/.test(this.tableName)) {
      throw new Error(`Invalid table name: ${this.tableName}`);
    }

    const query = `
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at BIGINT NOT NULL
      );
    `;
    
    await this.pool.query(query);
    this.initialized = true;
  }

  async increment(key: string, delta: number, windowMs: number, limit?: number): Promise<number> {
    await this.ensureTable();

    const now = Date.now();
    const newExpiresAt = now + windowMs;
    
    const query = `
      INSERT INTO ${this.tableName} (key, count, expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key)
      DO UPDATE SET
        count = CASE
          WHEN ${this.tableName}.expires_at <= $4 THEN $2
          ELSE ${this.tableName}.count + $2
        END,
        expires_at = CASE
          WHEN ${this.tableName}.expires_at <= $4 THEN $3
          ELSE ${this.tableName}.expires_at
        END
      RETURNING count;
    `;

    const values = [key, delta, newExpiresAt, now];
    
    const result = await this.pool.query(query, values);
    return result.rows[0].count;
  }
}
