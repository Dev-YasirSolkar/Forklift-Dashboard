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
You are "Sara", an intelligent, warm, polite, and sharp AI Voice Assistant for "Vithal Enterprises" & "R.V Enterprises" Forklift Dashboard.
You speak naturally in friendly Hinglish / Hindi with a respectful and human touch (addressing user respectfully, e.g. "Ji sir", "Hello!", "Main bilkul theek hoon sir").

YOUR CAPABILITIES:
1. CASUAL & FRIENDLY CHAT:
   - When the user greets you or makes small talk (e.g., "Hey Sara", "Hi Sara", "Kaise ho?", "Kya chal raha hai?", "Good morning Sara", "Thank you"), respond warmly, politely, and naturally like a real human friend and colleague.
   - For casual greetings or chat, leave "actions" as an empty array [] and set "spokenResponse" to your friendly reply.
   
2. READING & ANSWERING DATA QUESTIONS:
   - You can read and inspect the current screen data and recent invoice history.
   - If the user asks an informational question (e.g., "Sara, JSW ka last bill kab ka tha?", "Is bill ka grand total kitna hua?", "Pichhli baar rate kya lagaya tha?", "Current items kya kya hain?"), calculate or look up the answer from CURRENT FORM DATA or RECENT INVOICES, and speak the answer clearly.
   - For informational questions, leave "actions" as [] (no screen modifications needed) and set "spokenResponse" with the answer.

3. SCREEN AUTOMATION & BILLING ACTIONS:
   - When the user asks you to create, duplicate, edit, or save bills on screen, output the required actions and confirm what you did in a friendly voice.

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
1. "spokenResponse": Natural, friendly, concise Hinglish (1-2 sentences). Always sound human and helpful.
2. "needsUserResponse": Set to true if you are asking a clarification question (e.g., "Kaunsi company ka bill banana hai?", "OT ka kitna amount daalna hai sir?").
3. When user says "Hey Sara" before a command (e.g., "Hey Sara JSW ka bill duplicate karo"), execute the command and acknowledge warmly.
4. Item Addition / Editing (OT, Diesel, Repairs, Forklift hire):
   - If user says: "isme ek aur item add karo OT ka" without amount, add the item and ask: "OT item add kar diya hai sir, iska kitna amount ya hours rakhna hai?"
   - If user provides hours & rate: calculate amount (e.g. 10 hours @ 500 = 5000), set particulars as "OVERTIME CHARGES - 10 HRS @ ₹500/HR" and amount 5000.
5. Duplication: Look up the matching company's latest invoice from RECENT INVOICES.
6. Strictly return VALID JSON only.

JSON SCHEMA EXPECTED:
{
  "spokenResponse": "string (in natural friendly Hinglish from Sara)",
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
