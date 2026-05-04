import { genkit, z } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { retry } from '@genkit-ai/middleware';
import { contextCompression } from '../../src/context-compression/index.js';

const ai = genkit({
  plugins: [googleAI(), contextCompression.plugin(), retry.plugin()],
});

// A tool that returns verbose data (simulating large API responses)
const searchTool = ai.defineTool(
  {
    name: 'search',
    description: 'Search for information on a topic',
    inputSchema: z.object({ query: z.string() }),
    outputSchema: z.string(),
  },
  async ({ query }) => {
    // Simulate a large response
    return `Search results for "${query}":\n` + 'Lorem ipsum '.repeat(500);
  }
);

// A tool that reads documents
const readTool = ai.defineTool(
  {
    name: 'readDocument',
    description: 'Read the contents of a document',
    inputSchema: z.object({ url: z.string() }),
    outputSchema: z.string(),
  },
  async ({ url }) => {
    return `Contents of ${url}:\n` + 'Detailed content '.repeat(300);
  }
);

(async () => {
  try {
    // --- Basic: Tool response truncation only ---
    console.log('--- Tool Response Truncation ---');
    const response1 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt: 'Search for the latest AI research papers and summarize them',
      tools: [searchTool, readTool],
      maxTurns: 20,
      use: [
        contextCompression({
          maxInputTokens: 2000,
          toolResponses: { maxChars: 100 },
        }),
        retry(),
      ],
    });

    console.log('Result:', response1.text.slice(0, 200) + '...');
    const meta1 = (response1.custom as any)?.contextCompression;
    if (meta1) {
      console.log('Compression applied:', meta1);
    }

    // --- With message cap ---
    console.log('\n--- With Message Cap ---');
    const response2 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt:
        'Research and compare different machine learning frameworks. Use search and read tools extensively.',
      tools: [searchTool, readTool],
      maxTurns: 20,
      use: [
        contextCompression({
          maxInputTokens: 2000,
          toolResponses: { maxChars: 100, preserveRecent: 3 },
          maxMessages: 20,
        }),
        retry(),
      ],
    });

    console.log('Result:', response2.text.slice(0, 200) + '...');
    const meta2 = (response2.custom as any)?.contextCompression;
    if (meta2) {
      console.log('Compression applied:', meta2);
    }

    // --- Full: All strategies with summarization ---
    console.log('\n--- Full Compression with Summarization ---');
    const response3 = await ai.generate({
      model: 'googleai/gemini-flash-latest',
      prompt:
        'Conduct thorough research on quantum computing advances in 2025. Search for papers, read key documents, and provide a comprehensive summary.',
      tools: [searchTool, readTool],
      maxTurns: 20,
      use: [
        contextCompression({
          maxInputTokens: 2000,
          toolResponses: { maxChars: 100 },
          maxMessages: 30,
          summarize: {
            model: { name: 'googleai/gemini-flash-lite-latest' },
            preserveRecent: 2,
          },
        }),
        retry(),
      ],
    });

    console.log('Result:', response3.text.slice(0, 200) + '...');
    const meta3 = (response3.custom as any)?.contextCompression;
    if (meta3) {
      console.log('Compression applied:', meta3);
    }
  } catch (e) {
    console.error('Error:', e);
  }
})();
