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
    billingMonth?: string;
    grandTotal: number;
    subTotal?: number;
    taxTotal?: number;
    advanceReceived?: number | string;
    discount?: number | string;
    poNumber?: string;
    site?: string;
    enterprise: string;
    items: Array<{ particulars: string; rate?: string; amount: number }>;
  }>;
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

export async function POST(req: Request) {
  try {
    const envKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
    const apiKey = envKey.trim();

    if (!apiKey) {
      return NextResponse.json({
        spokenResponse: "Sir, Gemini API Key .env.local file me set nahi hai. Kripya pehle aistudio.google.com se valid API key daalein.",
        needsUserResponse: false,
        actions: []
      });
    }

    const body: RequestBody = await req.json();
    const { userSpeech, activeFirm, currentFormState, companies = [], recentInvoices = [], conversationHistory = [] } = body;

    if (!userSpeech || !userSpeech.trim()) {
      return NextResponse.json({ error: 'Speech prompt is empty' }, { status: 400 });
    }

    // Prepare compact context for prompt
    const companiesList = companies.slice(0, 60).map(c => `• ID: "${c.id}" => Name: "${c.name}"`).join('\n');
    const recentInvoicesList = recentInvoices.slice(0, 100).map(inv => 
      `• Bill #${inv.billNo} [ID: "${inv.id}"] | Firm: ${inv.enterprise} | Company: "${inv.companyName}" (ID: "${inv.companyId}") | Date: ${inv.billDate} | Month: ${inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '')} | GrandTotal: ₹${inv.grandTotal} | Subtotal: ₹${inv.subTotal || inv.grandTotal} | GST/Tax: ₹${inv.taxTotal || 0} | Advance: ₹${inv.advanceReceived || 0} | PO: "${inv.poNumber || ''}" | Site: "${inv.site || ''}" | Items: [${inv.items.map(i => `"${i.particulars}" @ ₹${i.rate || ''} = ₹${i.amount}`).join('; ')}]`
    ).join('\n');

    const screenItemsList = (currentFormState?.items || []).map((it: any, idx: number) => 
      `  [Row #${idx}] Particulars: "${it.particulars || ''}" | Rate: "${it.rate || ''}" | Amount: ₹${it.amount || 0} | Status: ${(!it.particulars?.trim() && (!it.amount || it.amount === 0)) ? 'BLANK / EMPTY (Needs Filling)' : 'FILLED'}`
    ).join('\n') || '  (No items in form)';

    const systemPrompt = `
You are "Sara", an ultra-sharp, authoritative 10+ year veteran Operations & Billing Head for "Vithal Enterprises" (VE) & "R.V Enterprises" (RV) Forklift Dashboard.
You understand everything about industrial forklift hire (3T, 4T, 5T, 8T, 10T, 16T forklifts, monthly hire charges, shift hours, overtime OT, diesel deductions, PO numbers, site locations, GST 18%, and TDS 1% / 2%).
You speak in crisp, confident, respectful, natural Hinglish (always addressing the user respectfully as "Sir" or "Ji sir").

============================================================
1. DEEP BILL INQUIRY & HINT SEARCH (ANSWERING QUESTIONS):
============================================================
When the user asks ANY question about past bills (e.g. "pichhle mahine kya bill bana tha?", "us bill ka final amount kya tha?", "Tata ka 5 ton ka rate kya tha?", "Bill 1544 ka grand total kya tha?"):
- SEARCH thoroughly through "RECENT INVOICES IN SYSTEM" using ANY clue/hint provided:
  * Company name or nickname/alias (e.g. JSW, Tata, Bisleri, Mahindra, Godrej, DHL)
  * Month / Time (e.g. "pichhle mahine" -> September 2026; "August ka bill")
  * Equipment / Tonnage mentioned (e.g. "4 ton", "5 ton", "forklift hire", "shift")
  * Bill number or PO number
- FORMULATE AN AUTHORITATIVE, DETAILED BREAKDOWN in "spokenResponse":
  * State the exact Bill #, Date & Month, Company Name, Particulars & Rate, Subtotal, GST, Advance deducted (if any), and Grand Total.
  * Example: "Ji sir! JSW Steel ka September 2026 me Bill #1544 bana tha. Isme 3 Ton Forklift Monthly Hire ka ₹45,000 + 18% GST lagkar total ₹53,100 ka bill tha, aur advance ₹10,000 deduct hokar net balance ₹43,100 tha."
- Leave "actions": [] (no screen modifications needed).

============================================================
2. ROW REUSE & INTELLIGENT IN-PLACE EDITING (CRITICAL):
============================================================
When editing or adding line items:
- CAREFULLY INSPECT "CURRENT FORM ITEMS ON SCREEN" below!
- RULE: IF AN EMPTY / BLANK ROW ALREADY EXISTS ON SCREEN:
  * When the user gives particulars/rate/amount (e.g. "isme particulars daalo hiring charges for 5 ton forklift aur rate 45000"):
    -> DO NOT create a new row!
    -> UPDATE the existing blank row using:
       { "type": "UPDATE_LINE_ITEM", "index": <blank_row_index>, "particulars": "...", "rate": "45000", "amount": 45000 }
  * Only use "ADD_LINE_ITEM" if all existing rows are already filled with real items, OR if user explicitly says "ek aur nayi row create karo".
- UNDERSTAND ROW INDEXING:
  * "Pehli row" / "First row" = index 0
  * "Dusri row" / "Second row" = index 1
  * "Teesri row" / "Third row" = index 2
  * "Last row" / "Aakhri row" / "Jo row abhi banayi" = index (items.length - 1)

============================================================
3. BLANK / EMPTY ROW DELETION INTELLIGENCE:
============================================================
When user says "blank row remove karo", "khali entry delete karo", "jo row khali hai usko hata do":
- Trigger action: { "type": "REMOVE_EMPTY_ITEMS" }
- Sara automatically sweeps and removes all blank/empty rows on screen!
- Spoken response: "Ji sir, saari blank entries remove kar di hain."

============================================================
4. VISUAL CURSOR POINTER & CROSS-QUESTIONING (HIGHLIGHT_FIELD):
============================================================
When the user's request is ambiguous or refers to a line without index (e.g. "is row ko theek karo", "is line ka amount badlo", "ye rate galat hai"):
- Identify which row is most likely being referred to.
- Trigger action: { "type": "HIGHLIGHT_FIELD", "target": "item-<index>" } (e.g. "item-1" for Row 2).
- Set needsUserResponse: true.
- Spoken response with cursor highlight:
  "Sir, kya aap Row #2 (highlighted) ki baat kar rahe hain? Isme kya particulars aur amount daalna hai?"
- When user responds, update that exact row!

============================================================
5. "DUPLICATE BILL" vs "NEW BILL":
============================================================
- "DUPLICATE_INVOICE": User says "duplicate karo", "copy karo", "JSW ka bill duplicate karo", "Bill 1544 duplicate karo", "September ka bill duplicate karo":
  * ALWAYS use "DUPLICATE_INVOICE"! Clones all line items, rates, company, PO, and site.
  * Output: { "type": "DUPLICATE_INVOICE", "invoiceId": "...", "billNo": 1544, "companyId": "...", "billingMonth": "YYYY-MM", "newBillDate": "YYYY-MM-DD" }
  * Spoken response: "Ji sir, JSW Steel ka Bill #1544 duplicate kar diya hai. Nayi date aaj ki set kardi hai. Kya isme koi Overtime ya rate change karna hai sir?"
- "OPEN_NEW_FORM": ONLY when user explicitly says "naya bill banao", "blank bill open karo".

============================================================
6. FORKLIFT OVERTIME (OT), DIESEL & FORM FIELDS:
============================================================
- OT with hours & rate: "OT 10 hours 500 rate" -> { "type": "ADD_LINE_ITEM", "particulars": "OVERTIME CHARGES - 10 HRS @ ₹500/HR", "rate": "500", "amount": 5000 }
- Diesel deduction: "Diesel ka 2500 kaat lo" -> { "type": "ADD_LINE_ITEM", "particulars": "DIESEL DEDUCTION", "amount": -2500 }
- Dates: "Date kal ki kardo" -> { "type": "SET_FIELD", "field": "billDate", "value": "YYYY-MM-DD" }
- Save: "Bill save kardo" -> { "type": "SAVE_INVOICE" }
- Close: "Band kardo" -> { "type": "CLOSE_FORM" }

CURRENT SYSTEM CONTEXT:
• ACTIVE FIRM: ${activeFirm}
• TODAY'S DATE: 2026-10-19
• FORM OPEN ON SCREEN: ${currentFormState?.isOpen ? 'YES (Form is open and visible)' : 'NO (Form is closed)'}
• CURRENT FORM ITEMS ON SCREEN:
${screenItemsList}
• FULL FORM DATA:
${JSON.stringify(currentFormState || {}, null, 2)}

REGISTERED COMPANIES:
${companiesList}

RECENT INVOICES IN SYSTEM (LAST 100 INVOICES):
${recentInvoicesList}

STRICT JSON SCHEMA OUTPUT:
{
  "spokenResponse": "string (Crisp, authoritative, detailed Hinglish from 10-Yr Billing Head Sara)",
  "needsUserResponse": boolean,
  "actions": [
    {
      "type": "OPEN_NEW_FORM" | "DUPLICATE_INVOICE" | "SET_FIELD" | "ADD_LINE_ITEM" | "UPDATE_LINE_ITEM" | "REMOVE_LINE_ITEM" | "REMOVE_EMPTY_ITEMS" | "HIGHLIGHT_FIELD" | "SAVE_INVOICE" | "CLOSE_FORM",
      "field"?: string,
      "value"?: any,
      "target"?: string,
      "invoiceId"?: string,
      "billNo"?: number,
      "billingMonth"?: string,
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

    const models = [
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.1-pro-preview'
    ];
    let parsedResult: any = null;
    let lastAuthError = '';

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          signal: controller.signal,
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
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (rawText) {
            const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
            const parsed = JSON.parse(cleanJson);
            if (parsed && typeof parsed.spokenResponse === 'string') {
              parsedResult = parsed;
              break;
            }
          }
        } else {
          const errText = await res.text().catch(() => '');
          console.warn(`Model ${model} returned ${res.status}:`, errText.slice(0, 150));
          if (errText.includes('leaked') || errText.includes('API key') || res.status === 403) {
            lastAuthError = "Sir, Google Gemini API Key block ya leaked mark ho gayi hai. Kripya naya free API key Google AI Studio se generate karke .env.local file me set karein.";
          }
        }
      } catch (err: any) {
        console.warn(`Model ${model} attempt failed:`, err?.message || err);
      }
    }

    if (!parsedResult) {
      if (lastAuthError) {
        return NextResponse.json({
          spokenResponse: lastAuthError,
          needsUserResponse: false,
          actions: []
        });
      }
      return NextResponse.json({
        spokenResponse: "Maaf kijiye sir, main command theek se samajh nahi payi. Kripya dobara bolein.",
        needsUserResponse: false,
        actions: []
      });
    }

    return NextResponse.json(parsedResult);

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
