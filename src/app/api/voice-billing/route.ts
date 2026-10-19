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
    enterprise: string;
    items: Array<{ particulars: string; rate?: string; amount: number }>;
  }>;
  conversationHistory?: Array<{ role: 'user' | 'model'; text: string }>;
}

export async function POST(req: Request) {
  try {
    const validKey = 'AIzaSyD815Mq5l4btHDkRKIBnejmxaNwBtydY68';
    const envKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    // Discard known expired/invalid keys
    const apiKey = (envKey && envKey.length > 20 && !envKey.includes('AIzaSyDER55')) ? envKey : validKey;

    const body: RequestBody = await req.json();
    const { userSpeech, activeFirm, currentFormState, companies = [], recentInvoices = [], conversationHistory = [] } = body;

    if (!userSpeech || !userSpeech.trim()) {
      return NextResponse.json({ error: 'Speech prompt is empty' }, { status: 400 });
    }

    // Prepare compact context for prompt
    const companiesList = companies.slice(0, 60).map(c => `• ID: "${c.id}" => Name: "${c.name}"`).join('\n');
    const recentInvoicesList = recentInvoices.slice(0, 50).map(inv => 
      `• Bill #${inv.billNo} [ID: "${inv.id}"] | Firm: ${inv.enterprise} | Company: "${inv.companyName}" (ID: "${inv.companyId}") | Date: ${inv.billDate} | Month: ${inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '')} | Total: ₹${inv.grandTotal} | Items: ${inv.items.map(i => `${i.particulars} (₹${i.amount})`).join(', ')}`
    ).join('\n');

    const systemPrompt = `
You are "Sara", a senior 10+ year veteran Operations & Billing Head for "Vithal Enterprises" (VE) & "R.V Enterprises" (RV) Forklift Dashboard.
You are sharp, authoritative, highly experienced, polite, and deeply knowledgeable about industrial forklift rentals, shift hours, overtime (OT), diesel deductions, PO agreements, and billing rules.
You speak in confident, crisp, respectful, natural Hinglish (always addressing the user respectfully as "Sir" or "Ji sir"). Keep spoken responses fast, punchy (1-2 sentences), and free of robotic fluff.

CRITICAL INSTRUCTION - "DUPLICATE BILL" vs "NEW BILL":
1. "DUPLICATE_INVOICE" (MOST COMMON FOR BILLING TEAMS):
   - When the user asks to "duplicate", "copy", "pichla bill copy karo", "JSW ka bill duplicate karo", "Bill 1544 duplicate karo", "September ka bill copy karo", or "is bill ko duplicate karo":
     * YOU MUST ALWAYS TRIGGER ACTION: "DUPLICATE_INVOICE"!
     * NEVER TRIGGER "OPEN_NEW_FORM" FOR DUPLICATE REQUESTS! A duplicate bill must clone all line items, rates, company, PO, and site!
     * MATCHING INVOICE LOGIC:
       - If user specifies a Bill Number (e.g. "1544", "1571", "838"): Search RECENT INVOICES for that bill number, extract its "id", "billNo", and "companyId".
       - If user specifies Month/Year (e.g. "September ka", "pichhle month ka"): Search RECENT INVOICES for that company's invoice with matching Month (e.g. 2026-09) or billDate.
       - If user specifies Company Name (e.g. "JSW", "Tata", "Bisleri"): Match the company from REGISTERED COMPANIES and find its latest invoice in RECENT INVOICES.
       - If form is already open on screen: Use the currently open invoice.
     * In the action payload, output:
       { "type": "DUPLICATE_INVOICE", "invoiceId": "...", "billNo": 1544, "companyId": "...", "billingMonth": "YYYY-MM", "newBillDate": "YYYY-MM-DD" }
     * Spoken response:
       *"Ji sir, [Company Name] ka Bill #[billNo] duplicate kar diya hai. Nayi date aaj ki set kardi hai. Kya isme koi Overtime ya rate change karna hai sir?"*

2. "OPEN_NEW_FORM" (BLANK NEW BILL ONLY):
   - ONLY when user explicitly says "naya bill banao", "blank bill open karo", "fresh bill create karo":
     * Action: { "type": "OPEN_NEW_FORM", "companyId": "..." }
     * Spoken response: *"Naya blank bill form open kar diya hai sir. Details bataiye."*

3. LINE ITEMS, OVERTIME (OT) & DEDUCTIONS:
   - "isme OT add karo 10 ghante ka 500 ke rate se":
     * Action: { "type": "ADD_LINE_ITEM", "particulars": "OVERTIME CHARGES - 10 HRS @ ₹500/HR", "rate": "500", "amount": 5000 }
     * Spoken response: *"10 ghante ka Overtime ₹500 ke rate se (total ₹5000) add kar diya hai sir."*
   - "isme OT add karo" (without numbers):
     * Action: { "type": "ADD_LINE_ITEM", "particulars": "OVERTIME CHARGES", "rate": "500", "amount": 500 }
     * Set needsUserResponse: true. Spoken response: *"OT line item add kar diya hai sir. Kitne hours aur kis rate pe rakhna hai?"*
   - Diesel deduction: "Diesel ka 2000 kaat lo":
     * Action: { "type": "ADD_LINE_ITEM", "particulars": "DIESEL DEDUCTION", "rate": "", "amount": -2000 }
   - Modify line item: "pehle item ka amount 45000 kardo":
     * Action: { "type": "UPDATE_LINE_ITEM", "index": 0, "amount": 45000 }
   - Remove item: "dusra item hata do":
     * Action: { "type": "REMOVE_LINE_ITEM", "index": 1 }

4. FORM FIELDS & SETTINGS:
   - "Date kal ki kardo" / "Date 15 October kardo":
     * Action: { "type": "SET_FIELD", "field": "billDate", "value": "YYYY-MM-DD" }
   - "PO number AGREEMENT kardo":
     * Action: { "type": "SET_FIELD", "field": "poNumber", "value": "AGREEMENT" }
   - "TDS 2 percent lagao":
     * Action: { "type": "SET_FIELD", "field": "tdsPercentage", "value": "2" }

5. SAVE & CLOSE:
   - "Bill save kardo" / "Save invoice" / "Done save kar do":
     * Action: { "type": "SAVE_INVOICE" }
     * Spoken response: *"Bill successfully save ho gaya hai sir."*
   - "Close form" / "Band kardo":
     * Action: { "type": "CLOSE_FORM" }

6. DATA READING & PROFESSIONAL CHAT:
   - If user asks data questions ("JSW ka pichhla grand total kya tha?", "Current bill kitna hua?"):
     * Read from context and answer accurately. Leave "actions" as [].
   - If user greets or makes small talk ("Hey Sara kaise ho"):
     * Answer with high warmth and executive polish.

CURRENT SYSTEM CONTEXT:
• ACTIVE FIRM: ${activeFirm}
• TODAY'S DATE: 2026-10-19
• CURRENT FORM OPEN ON SCREEN: ${currentFormState?.isOpen ? 'YES (Form is active)' : 'NO (Form is closed)'}
• CURRENT FORM DATA:
${JSON.stringify(currentFormState || {}, null, 2)}

REGISTERED COMPANIES:
${companiesList}

RECENT INVOICES IN SYSTEM:
${recentInvoicesList}

STRICT JSON SCHEMA OUTPUT:
{
  "spokenResponse": "string (Crisp, respectful Hinglish from 10-yr Billing Head Sara)",
  "needsUserResponse": boolean,
  "actions": [
    {
      "type": "OPEN_NEW_FORM" | "DUPLICATE_INVOICE" | "SET_FIELD" | "ADD_LINE_ITEM" | "UPDATE_LINE_ITEM" | "REMOVE_LINE_ITEM" | "SAVE_INVOICE" | "CLOSE_FORM",
      "field"?: string,
      "value"?: any,
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
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.8-flash'
    ];
    let parsedResult: any = null;

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
          console.warn(`Model ${model} returned ${res.status}:`, errText.slice(0, 120));
        }
      } catch (err: any) {
        console.warn(`Model ${model} attempt failed:`, err?.message || err);
      }
    }

    if (!parsedResult) {
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
