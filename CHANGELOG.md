# Changelog

## 0.3.0

### Context Compression v2

Major enhancements to the `contextCompression` middleware. These changes significantly improve compression quality, reduce costs, and better preserve context for long-running agentic loops.

#### New Features

- **Tool response deduplication** (`deduplicateToolResponses`) — When the same tool is called multiple times with the same input (common in agentic loops that repeatedly read the same files or call the same APIs), older responses are replaced with a short notice. Only the most recent response is kept. Supports `name-and-input` and `name-only` matching strategies.

- **Safety cap on tool response size** (`maxToolResponseChars`, default: 400,000) — Hard-truncates any individual tool response that exceeds a character limit, preventing a single massive response from consuming the entire context window. Applied unconditionally as a safety net.

- **Skip summarization threshold** (`skipSummarizationThreshold`) — If cheap strategies (deduplication + truncation) save enough context (e.g., 30%+), the expensive LLM summarization step is automatically skipped, saving latency and cost.

- **Adaptive truncation aggressiveness** — The middleware now automatically adjusts compression aggressiveness based on how far over budget the context is:
  - 1.0–1.5× overshoot: normal compression
  - 1.5–2.0× overshoot: halve preserve windows (min 2)
  - 2.0×+ overshoot: reduce preserve windows to minimum (2)

- **Truncation notices** (`insertTruncationNotice`, default: `true`) — When messages are dropped during message truncation, a notice is inserted at the boundary so the model knows context was removed. Customizable via `truncationNotice`.

#### Improvements

- **Structured summarization prompt** — The default summarization prompt now produces structured summaries with 6 sections: primary request & intent, key decisions & facts, tool interactions, task evolution, current state, and pending work. This significantly improves summary quality for task continuation.

- **Improved summary prefix** — Summaries are now prefixed with a descriptive marker explaining that the session continues from a compressed conversation.

#### Updated Compression Pipeline

The strategy execution order is now:

1. Safety cap — Hard-truncate oversized tool responses
2. Deduplication — Replace duplicate tool responses with notices
3. Tool response truncation — Trim verbose tool outputs
4. Message truncation — Drop oldest messages (with optional notice)
5. Summarization — LLM-generated summary (skippable if cheap strategies suffice)

#### New Metadata Fields

The `response.custom.contextCompression` metadata now includes:

| Field | Description |
|-------|-------------|
| `overshootRatio` | How far over the threshold (e.g., 1.5 = 50% over) |
| `toolResponsesSafetyCapped` | Number of tool responses hard-truncated by safety cap |
| `toolResponsesDeduplicated` | Number of duplicate tool responses replaced |
| `summarizationSkipped` | Whether summarization was skipped due to sufficient savings |
| `truncationNoticeInserted` | Whether a truncation notice was inserted |

#### New Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxToolResponseChars` | `number` | `400000` | Hard cap on any single tool response size |
| `deduplicateToolResponses` | `object` | — | Deduplication config (`matchBy`, `keepRecent`, `notice`) |
| `skipSummarizationThreshold` | `number` | — | Skip summarization if cheap strategies save this fraction |
| `insertTruncationNotice` | `boolean` | `true` | Insert a notice when messages are dropped |
| `truncationNotice` | `string` | — | Custom notice text |

## 0.2.0

- Initial release with context compression, quota, cache, router, soft-fail, and smart-max-turns middleware.
