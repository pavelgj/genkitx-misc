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

import { createHash } from 'crypto';
import type { MessageData } from 'genkit';

/** Result of a detector analysis. */
export interface DetectorResult {
  status: 'ok' | 'loop' | 'stalled' | 'stuck';
  /** Human-readable description of what was detected. */
  detail?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Extract tool request signatures from a model message.
 * Each signature is `toolName:hash(args)`.
 */
function extractToolCallSignatures(message: MessageData): string[] {
  return message.content
    .filter((p) => p.toolRequest)
    .map((p) => {
      const tr = p.toolRequest!;
      const argsHash = hashString(JSON.stringify(tr.input ?? {}));
      return `${tr.name}:${argsHash}`;
    });
}

/**
 * Extract tool response hashes from a tool message.
 * Each hash is `toolName:hash(output)`.
 */
function extractToolResponseSignatures(message: MessageData): string[] {
  return message.content
    .filter((p) => p.toolResponse)
    .map((p) => {
      const tr = p.toolResponse!;
      const outputHash = hashString(JSON.stringify(tr.output ?? ''));
      return `${tr.name}:${outputHash}`;
    });
}

// ---------------------------------------------------------------------------
// Exact Loop Detector
// ---------------------------------------------------------------------------

/**
 * Detects when the model is making identical tool calls across consecutive turns.
 *
 * Scans model messages for repeated tool call signatures (name + hash of args).
 * If the same set of signatures appears `threshold` or more times consecutively,
 * a loop is detected.
 */
export function detectExactLoops(messages: MessageData[], threshold: number): DetectorResult {
  // Collect signatures from consecutive model messages (most recent first)
  const modelSignatures: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'model') {
      const sigs = extractToolCallSignatures(msg);
      if (sigs.length > 0) {
        // Combine multiple tool calls in one message into a single sorted signature
        modelSignatures.push(sigs.sort().join('|'));
      }
    }
  }

  if (modelSignatures.length < threshold) return { status: 'ok' };

  // Check if the most recent N signatures are identical
  const latest = modelSignatures[0];
  let count = 0;
  for (const sig of modelSignatures) {
    if (sig === latest) {
      count++;
    } else {
      break;
    }
  }

  if (count >= threshold) {
    // Extract tool names from the signature for the detail message
    const toolNames = latest
      .split('|')
      .map((s) => s.split(':')[0])
      .join(', ');
    return {
      status: 'loop',
      detail: `Identical tool calls repeated ${count} times: ${toolNames}`,
    };
  }

  return { status: 'ok' };
}

// ---------------------------------------------------------------------------
// Response Repetition Detector
// ---------------------------------------------------------------------------

/**
 * Detects when tools are returning identical responses across consecutive turns.
 *
 * If the same tool returns the same output `threshold` or more times, the agent
 * is likely stalled — making different requests but getting nowhere.
 */
export function detectResponseRepetition(
  messages: MessageData[],
  threshold: number
): DetectorResult {
  // Collect response signatures from consecutive tool messages (most recent first)
  const responseSigSets: string[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'tool') {
      const sigs = extractToolResponseSignatures(msg);
      if (sigs.length > 0) {
        responseSigSets.push(sigs.sort().join('|'));
      }
    }
  }

  if (responseSigSets.length < threshold) return { status: 'ok' };

  // Check if the most recent N response sets are identical
  const latest = responseSigSets[0];
  let count = 0;
  for (const sig of responseSigSets) {
    if (sig === latest) {
      count++;
    } else {
      break;
    }
  }

  if (count >= threshold) {
    return {
      status: 'stalled',
      detail: `Identical tool responses received ${count} times in a row`,
    };
  }

  return { status: 'ok' };
}
