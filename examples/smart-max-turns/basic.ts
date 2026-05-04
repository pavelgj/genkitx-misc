import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { smartMaxTurns } from '../../src/smart-max-turns/index.js';

const ai = genkit({
  plugins: [googleAI(), smartMaxTurns.plugin()],
});

// A search tool that might return the same results repeatedly
const searchTool = ai.defineTool(
  {
    name: 'search',
    description: 'Search for information on a topic',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async ({ query }) => {
    // Simulate a search that might return duplicate results
    return `Search results for: ${query} — Found 3 relevant articles about the topic.`;
  }
);

const analyzeTool = ai.defineTool(
  {
    name: 'analyze',
    description: 'Analyze a piece of text',
    inputSchema: z.object({ text: z.string() }),
    outputSchema: z.string(),
  },
  async ({ text }) => {
    return `Analysis: The text discusses ${text.split(' ').length} topics.`;
  }
);

(async () => {
  try {
    // Basic usage — default settings (heuristic detectors, abort on detection)
    console.log('--- Basic smartMaxTurns ---');
    const response = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Research and summarize the latest developments in quantum computing',
      tools: [searchTool, analyzeTool],
      use: [smartMaxTurns()],
    });

    const meta = (response.custom as any)?.smartMaxTurns;
    if (meta) {
      console.log(`Terminated early: ${meta.reason} (${meta.detail})`);
      console.log(`Turns used: ${meta.turnsUsed}`);
    } else {
      console.log('Completed normally:', response.text.slice(0, 200));
    }

    // WrapUp strategy — ask the model to summarize instead of aborting
    console.log('\n--- wrapUp strategy ---');
    const response2 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Find and compare at least 10 different sources on climate change',
      tools: [searchTool],
      use: [
        smartMaxTurns({
          maxTurns: 10,
          onDetection: 'wrapUp',
          wrapUpPrompt: 'Please provide your best summary based on what you have gathered.',
        }),
      ],
    });

    const meta2 = (response2.custom as any)?.smartMaxTurns;
    if (meta2) {
      console.log(`Wrapped up: ${meta2.reason} after ${meta2.turnsUsed} turns`);
      console.log('Final answer:', response2.text.slice(0, 200));
    } else {
      console.log('Completed normally:', response2.text.slice(0, 200));
    }

    // PruneTools strategy — remove problematic tools, let the model continue
    console.log('\n--- pruneTools strategy ---');
    const response3 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Search for information and then analyze it',
      tools: [searchTool, analyzeTool],
      use: [
        smartMaxTurns({
          onDetection: 'pruneTools',
          detect: {
            exactLoops: { threshold: 2 },
            responseRepetition: { threshold: 2 },
          },
        }),
      ],
    });

    const meta3 = (response3.custom as any)?.smartMaxTurns;
    if (meta3) {
      console.log(`Pruned tools: ${meta3.prunedTools?.join(', ')}`);
      console.log('Result:', response3.text.slice(0, 200));
    } else {
      console.log('Completed normally:', response3.text.slice(0, 200));
    }

    // Custom thresholds — more tolerant detection
    console.log('\n--- Custom thresholds ---');
    const response4 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Do extensive research on renewable energy',
      tools: [searchTool],
      use: [
        smartMaxTurns({
          maxTurns: 30,
          minTurns: 5,
          detect: {
            exactLoops: { threshold: 4 },
            responseRepetition: { threshold: 3 },
          },
        }),
      ],
    });

    console.log('Result:', response4.text.slice(0, 200));
  } catch (e) {
    console.error('Error:', e);
  }
})();
