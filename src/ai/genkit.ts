
import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';

/**
 * @fileOverview Genkit initialization file.
 * Configures the Google AI plugin for use with Gemini models.
 */

export const ai = genkit({
  plugins: [googleAI()],
});

export const model = 'googleai/gemini-1.5-flash';
