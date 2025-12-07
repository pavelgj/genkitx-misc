# Router Middleware

The Router Middleware for Genkit allows you to dynamically route generation requests to different models based on the request content or other criteria. This is useful for optimizing costs, latency, or capability matching (e.g., sending simple requests to a faster model and complex requests to a more capable one).

## Installation

The router middleware is included in the `genkitx-misc` package.

```bash
npm install genkitx-misc
```

## Usage

### Basic Rule-Based Routing

You can define a list of rules that are evaluated in order. The first rule that matches the request determines the model to use.

```typescript
import { genkit } from 'genkit';
import { router, hasMedia, hasTools } from 'genkitx-misc/router';

const ai = genkit({ ... });

const myFlow = ai.defineFlow('myFlow', async (input) => {
  await ai.generate({
    model: 'googleai/gemini-2.5-flash', // Default fallback model
    use: [
      router(ai, {
        rules: [
          // If the request contains images/video, use the Pro model
          { when: hasMedia, use: 'googleai/gemini-2.5-pro' },
          // If the request uses tools, use the Pro model
          { when: hasTools, use: 'googleai/gemini-2.5-pro' },
          // Otherwise, it falls through to the default model (Flash)
        ]
      })
    ]
  });
});
```

### Custom Conditions

You can write your own condition functions. A condition is a function that takes a `GenerateRequest` and returns a boolean (or Promise<boolean>).

```typescript
const isLongContext = (req) => {
  // Example: check token count or character length
  return req.messages.some(m => m.content.some(p => p.text && p.text.length > 10000));
};

router(ai, {
  rules: [
    { when: isLongContext, use: 'googleai/gemini-2.5-pro' }
  ]
})
```

### Classification-Based Routing

For more complex scenarios, you can use a classifier function to determine the "type" of request and map it to a model. This is ideal for using an LLM to decide the best model.

```typescript
router(ai, {
  classifier: async (req) => {
    // Your logic to classify request
    // e.g., call a small model to classify as 'simple' or 'complex'
    return 'simple'; 
  },
  models: {
    simple: 'googleai/gemini-2.5-flash',
    complex: 'googleai/gemini-2.5-pro',
  }
})
```

## API Reference

### `router(ai, options)`

Creates the middleware.

-   `ai`: The Genkit instance.
-   `options`: Configuration object.

### `RouterOptions`

-   `rules`: An array of `RoutingRule` objects.
    -   `when`: `(input: RouterInput) => boolean | Promise<boolean>`
    -   `use`: The model to use if `when` returns true.
-   `classifier`: `(input: RouterInput) => string | Promise<string>`
-   `models`: `Record<string, ModelArgument>` - Map of keys returned by classifier to models.

### `RouterInput`

-   `request`: The `GenerateRequest` object.

### Helper Predicates

-   `hasMedia(input)`: Returns `true` if any message contains media parts.
-   `hasTools(input)`: Returns `true` if the request defines any tools.
-   `hasHistory(input)`: Returns `true` if the conversation has more than one message.
