import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { softFail } from '../../src/soft-fail/index.js';

const ai = genkit({
  plugins: [googleAI(), softFail.plugin()],
});

// A tool that might fail
const riskyTool = ai.defineTool(
  {
    name: 'riskyTool',
    description: 'A tool that sometimes fails',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async ({ query }) => {
    if (Math.random() < 0.5) {
      throw new Error('Random failure!');
    }
    return `Result for: ${query}`;
  }
);

// A tool that almost certainly will fail
const extraRiskyTool = ai.defineTool(
  {
    name: 'extraRiskyTool',
    description: 'A tool that sometimes fails',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async ({ query }) => {
    if (Math.random() < 0.95) {
      throw new Error('Random failure!');
    }
    return `Result for: ${query}`;
  }
);

(async () => {
  try {
    // Basic usage — catch all errors gracefully
    console.log('--- Basic softFail ---');
    const response = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Use the risky tool to look up "hello world"',
      tools: [riskyTool],
      use: [softFail()],
    });

    if (response.finishReason === 'aborted') {
      console.log('Generation did not complete:', response.finishMessage);
      const details = (response.custom as any)?.softFail;
      if (details) {
        console.log('Failure reason:', details.reason);
        console.log('Error:', details.error);
      }
    } else {
      console.log('Success:', response.text);
    }

    // Selective — only catch specific model error statuses
    console.log('\n--- Selective modelStatuses ---');
    const response2 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Hello',
      use: [softFail({ modelStatuses: ['UNAVAILABLE', 'RESOURCE_EXHAUSTED'] })],
    });
    console.log('Result:', response2.text);

    // With max turns protection
    console.log('\n--- Max turns protection ---');
    const response3 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Keep using the tool until you get a result',
      tools: [extraRiskyTool],
      maxTurns: 3,
      use: [softFail()],
    });

    if (response3.finishReason === 'aborted') {
      console.log('Hit max turns:', response3.finishMessage);
    } else {
      console.log('Completed:', response3.text);
    }
  } catch (e) {
    console.error('Error:', e);
  }
})();
