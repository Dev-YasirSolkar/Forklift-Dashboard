
'use server';
/**
 * @fileOverview AI Voice Command Parser.
 *
 * - processVoiceCommand - Parses natural language into structured workshop data.
 */

import { ai, model } from '@/ai/genkit';
import { z } from 'genkit';

const VoiceCommandInputSchema = z.object({
  text: z.string().describe('The transcribed text from the voice command.'),
});
export type VoiceCommandInput = z.infer<typeof VoiceCommandInputSchema>;

const VoiceCommandOutputSchema = z.object({
  intent: z.enum(['invoice', 'challan', 'payment', 'unknown']).describe('The identified action type.'),
  data: z.object({
    companyName: z.string().optional().describe('Extracted client or company name.'),
    amount: z.number().optional().describe('Extracted monetary amount.'),
    billingMonth: z.string().optional().describe('Extracted month in YYYY-MM format.'),
    date: z.string().optional().describe('Extracted date in YYYY-MM-DD format.'),
    billNo: z.string().optional().describe('Extracted invoice or bill number.'),
    items: z.array(z.string()).optional().describe('List of items or particulars described.'),
    mode: z.string().optional().describe('Payment mode if mentioned (e.g. RTGS, NEFT).'),
  }),
  explanation: z.string().describe('Short summary of what was understood.'),
});
export type VoiceCommandOutput = z.infer<typeof VoiceCommandOutputSchema>;

export async function processVoiceCommand(input: VoiceCommandInput): Promise<VoiceCommandOutput> {
  return voiceCommandFlow(input);
}

const prompt = ai.definePrompt({
  name: 'voiceCommandPrompt',
  input: { schema: VoiceCommandInputSchema },
  output: { schema: VoiceCommandOutputSchema },
  prompt: `You are an AI assistant for a Forklift Workshop Management System (VE Dashboard).
Your job is to parse the user's spoken command into structured data.

Current Context:
- Today is: {{today}}
- Intent could be creating an invoice, a delivery challan, or recording a payment.

Guidelines:
1. If the user mentions a month (e.g., "January"), convert it to YYYY-MM based on the current year.
2. For invoices, extract the client name and amount.
3. For challans, extract the items and client.
4. For payments, extract the bill number and amount.

User Input: "{{{text}}}"`,
});

const voiceCommandFlow = ai.defineFlow(
  {
    name: 'voiceCommandFlow',
    inputSchema: VoiceCommandInputSchema,
    outputSchema: VoiceCommandOutputSchema,
  },
  async (input) => {
    const today = new Date().toISOString().split('T')[0];
    const { output } = await prompt({ ...input, today });
    return output!;
  }
);
