# Router Middleware

The Router Middleware for Genkit allows you to dynamically route generation requests to different models based on the request content or other criteria. This is useful for optimizing costs, latency, or capability matching (e.g., sending simple requests to a faster model and complex requests to a more capable one).

## Installation

```bash
npm install genkitx-misc
```

## Setup

The router middleware uses the Genkit `generateMiddleware()` API. You register it as a plugin (optionally with custom matchers and classifiers), then use the middleware per-request with serializable config.

```typescript
import { genkit } from 'genkit';
import { router } from 'genkitx-misc/router';

const ai = genkit({
  plugins: [router.plugin()],
});
```

## Usage

### Rule-Based Routing

Define a list of rules that are evaluated in order. The first rule whose named matcher returns `true` determines the model to use. Built-in matchers: `'hasMedia'`, `'hasTools'`, `'hasHistory'`.

```typescript
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest', // Default fallback model
  prompt: input,
  use: [
    router({
      rules: [
        { when: 'hasMedia', use: { name: 'googleai/gemini-pro-latest' } },
        { when: 'hasTools', use: { name: 'googleai/gemini-pro-latest' } },
      ],
    }),
  ],
});
```

### Custom Matchers

Register custom matchers via plugin options. Matchers are functions that take a `RouterInput` (`{ request }`) and return a boolean (or `Promise<boolean>`).

```typescript
const ai = genkit({
  plugins: [
    router.plugin({
      matchers: {
        isLongContext: ({ request }) =>
          request.messages.some((m) => m.content.some((p) => p.text && p.text.length > 10000)),
      },
    }),
  ],
});

// Reference custom matcher by name:
const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: input,
  use: [
    router({
      rules: [{ when: 'isLongContext', use: { name: 'googleai/gemini-pro-latest' } }],
    }),
  ],
});
```

### Classification-Based Routing

For more complex scenarios, register a classifier function that determines the "type" of request and map classification keys to models.

```typescript
const ai = genkit({
  plugins: [
    router.plugin({
      classifiers: {
        byComplexity: async ({ request }) => {
          // Your logic to classify request
          const text = request.messages.at(-1)?.content[0]?.text || '';
          return text.length > 1000 ? 'complex' : 'simple';
        },
      },
    }),
  ],
});

const response = await ai.generate({
  model: 'googleai/gemini-flash-latest',
  prompt: input,
  use: [
    router({
      classifier: 'byComplexity',
      models: {
        simple: { name: 'googleai/gemini-flash-latest' },
        complex: { name: 'googleai/gemini-pro-latest' },
      },
    }),
  ],
});
```

## Configuration

### Per-Use Config (serializable)

The `router()` function accepts:

- `rules` _(optional)_: An array of routing rules, evaluated in order.
  - `when`: Name of a registered matcher (string).
  - `use`: `{ name: string, config?: any }` — the model to use if the condition matches.
- `classifier` _(optional)_: Name of a registered classifier function (string).
- `models` _(optional)_: `Record<string, { name: string, config?: any }>` — map of classification keys to models. Required if `classifier` is used.

### Plugin Options (non-serializable)

The `router.plugin()` function accepts:

- `matchers` _(optional)_: `Record<string, RoutingCondition>` — custom matcher functions.
- `classifiers` _(optional)_: `Record<string, Classifier>` — custom classifier functions.

## Built-in Matchers

The following matchers are always available by name:

| Name           | Description                                                   |
| -------------- | ------------------------------------------------------------- |
| `'hasMedia'`   | Returns `true` if any message contains media parts.           |
| `'hasTools'`   | Returns `true` if the request defines any tools.              |
| `'hasHistory'` | Returns `true` if the conversation has more than one message. |

## API Types

```typescript
// Matcher function signature
type RoutingCondition = (input: RouterInput) => boolean | Promise<boolean>;

// Classifier function signature
type Classifier = (input: RouterInput) => string | Promise<string>;

// Router input
interface RouterInput {
  request: GenerateRequest;
}
```
