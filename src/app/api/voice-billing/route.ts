import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface RequestBody {
  userSpeech: string;
  activeFirm: 'Vithal' | 'RV';
  currentFormState?: {
    isOpen: boolean;
    companyId?: string;
    companyName?: string;
    billDate?: string;
    billingMonth?: string;
    poNumber?: string;
    site?: string;
    items?: Array<{ particulars: string; rate?: string; amount: number }>;
    discount?: string;
    advanceReceived?: string;
    tdsPercentage?: string;
    editingInvoiceId?: string | null;
  };
  companies?: Array<{ id: string; name: string }>;
  recentInvoices?: Array<{
    id: string;
    billNo: number;
    companyId: string;
    companyName: string;
    billDate: string;
    grandTotal: number;
    enterprise: string;
    items: Array<{ particulars: string; rate?: string; amount: number }>;
  }>;
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured in server environment.' },
        { status: 500 }
      );
    }

    const body: RequestBody = await req.json();
    const { userSpeech, activeFirm, currentFormState, companies = [], recentInvoices = [], conversationHistory = [] } = body;

    if (!userSpeech || !userSpeech.trim()) {
      return NextResponse.json({ error: 'Speech prompt is empty' }, { status: 400 });
    }

    // Prepare compact context for prompt
    const companiesList = companies.slice(0, 50).map(c => `• ID: "${c.id}" => Name: "${c.name}"`).join('\n');
    const recentInvoicesList = recentInvoices.slice(0, 25).map(inv => 
      `• Bill #${inv.billNo} [ID: "${inv.id}"] | Firm: ${inv.enterprise} | Company: "${inv.companyName}" (ID: "${inv.companyId}") | Date: ${inv.billDate} | Total: ₹${inv.grandTotal} | Items: ${inv.items.map(i => `${i.particulars} (₹${i.amount})`).join(', ')}`
    ).join('\n');

    const systemPrompt = `
You are the Voice Billing Copilot for "Vithal Enterprises" & "R.V Enterprises" Forklift Dashboard.
You control the Billing page in real time based on the user's spoken Hindi, Hinglish, or English commands.
Your responses must feel like a sharp, professional human billing accountant working alongside the user.

CURRENT ACTIVE FIRM: ${activeFirm}
CURRENT FORM OPEN ON SCREEN: ${currentFormState?.isOpen ? 'YES (Form is active)' : 'NO (Form is closed)'}
CURRENT FORM DATA ON SCREEN:
${JSON.stringify(currentFormState || {}, null, 2)}

REGISTERED COMPANIES IN SYSTEM:
${companiesList}

RECENT INVOICES IN SYSTEM:
${recentInvoicesList}

AVAILABLE ACTIONS YOU CAN TRIGGER ON THE USER'S SCREEN:
1. "OPEN_NEW_FORM": Open fresh new bill form. Optional field: { "companyId": "..." }
2. "DUPLICATE_INVOICE": Duplicate an existing bill. Field: { "invoiceId": "...", "companyId": "...", "newBillDate": "YYYY-MM-DD" }
3. "SET_FIELD": Set a form field. Fields allowed: "companyId", "billDate" (YYYY-MM-DD), "billingMonth" (YYYY-MM), "poNumber", "site", "discount", "advanceReceived", "tdsPercentage", "enterprise".
4. "ADD_LINE_ITEM": Add a line item to the bill. Fields: { "particulars": "...", "rate": "...", "amount": number }
5. "UPDATE_LINE_ITEM": Modify an existing line item. Fields: { "index": number (0-based), "particulars"?: string, "rate"?: string, "amount"?: number }
6. "REMOVE_LINE_ITEM": Delete a line item. Field: { "index": number (0-based) }
7. "SAVE_INVOICE": Save the current invoice.
8. "CLOSE_FORM": Close the form.

RULES FOR ACTIONS & SPOKEN RESPONSE:
1. "spokenResponse": Keep it concise (1-2 sentences), natural Hindi/Hinglish (e.g. "JSW ka bill duplicate kar diya hai. Date 15 October set hai."). Always confirm what you did clearly.
2. "needsUserResponse": Set to true if you are asking a question to clarify missing information (e.g. which company, what amount, confirmation to save).
3. Company Matching: Match fuzzy company names from speech to the registered company IDs (e.g., "JSW" matches "JSW STEEL...", "Bisleri" matches "BISLERI INTERNATIONAL...").
4. Item Addition / Editing (OT, Diesel, Repairs, Forklift hire):
   - If user says: "isme ek aur item add karo OT ka" without amount, add the item with 0 amount or empty rate, and ask: "OT item add kar diya hai, iska kitna amount ya hours rakhna hai?"
   - If user provides hours & rate: calculate amount (e.g. 10 hours @ 500 = 5000), set particulars as "OVERTIME CHARGES - 10 HRS @ ₹500/HR" and amount 5000.
5. Duplication: Look up the matching company's latest invoice from RECENT INVOICES. If multiple exist, pick the most recent one for that company, or ask if ambiguous.
6. Strictly return VALID JSON only. Do not wrap in markdown quotes if possible, or use standard markdown json fences.

JSON SCHEMA EXPECTED:
{
  "spokenResponse": "string (in natural Hinglish)",
  "needsUserResponse": boolean,
  "actions": [
    {
      "type": "OPEN_NEW_FORM" | "DUPLICATE_INVOICE" | "SET_FIELD" | "ADD_LINE_ITEM" | "UPDATE_LINE_ITEM" | "REMOVE_LINE_ITEM" | "SAVE_INVOICE" | "CLOSE_FORM",
      "field"?: string,
      "value"?: any,
      "invoiceId"?: string,
      "companyId"?: string,
      "newBillDate"?: string,
      "index"?: number,
      "particulars"?: string,
      "rate"?: string,
      "amount"?: number
    }
  ]
}
`.trim();

    // Construct conversation messages
    const contents: any[] = [];

    // Prior history
    conversationHistory.slice(-4).forEach(h => {
      contents.push({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.text }]
      });
    });

    // Current user speech
    contents.push({
      role: 'user',
      parts: [{ text: `User Spoken Command: "${userSpeech}"` }]
    });

    const models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    let rawText = '';
    let success = false;

    for (const model of models) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2
            }
          })
        });

        if (res.ok) {
          const data = await res.json();
          rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawText) {
            success = true;
            break;
          }
        }
      } catch (err) {
        console.warn(`Model ${model} failed, trying fallback...`, err);
      }
    }

    if (!success || !rawText) {
      return NextResponse.json({
        spokenResponse: "Maaf kijiye, main command samajh nahi paya. Kripya dobara bolein.",
        needsUserResponse: false,
        actions: []
      });
    }

    // Parse JSON safely
    const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanJson);

    return NextResponse.json(parsed);

  } catch (error: any) {
    console.error('Voice billing endpoint error:', error);
    return NextResponse.json({
      error: error.message || 'Internal Server Error',
      spokenResponse: "Kuch technical problem aayi hai. Kripya dobara try karein.",
      needsUserResponse: false,
      actions: []
    }, { status: 500 });
  }
}
