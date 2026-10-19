import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface ActiveSubject {
  companyName?: string;
  companyId?: string;
  billNo?: number;
  invoiceId?: string;
}

interface RequestBody {
  userSpeech: string;
  activeFirm: 'Vithal' | 'RV';
  activeSubject?: ActiveSubject;
  currentFormState?: {
    isOpen: boolean;
    companyId?: string;
    companyName?: string;
    billDate?: string;
    billingMonth?: string;
    poNumber?: string;
    site?: string;
    items?: Array<{ index?: number; particulars: string; rate?: string; amount: number; isBlank?: boolean }>;
    subTotal?: number;
    taxTotal?: number;
    grandTotal?: number;
    balanceDue?: number;
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
  dashboardStats?: {
    nextBillNo?: number;
    skippedBillNumbers?: number[];
    activeFirmInvoicesCount?: number;
    totalInvoicesCount?: number;
    months?: Array<{
      key: string;
      label: string;
      count: number;
      minBillNo?: number;
      maxBillNo?: number;
      billNumbers?: number[];
      grandTotal?: number;
      netTotal?: number;
      taxTotal?: number;
      companies?: string[];
    }>;
  };
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
    const { userSpeech, activeFirm, activeSubject, currentFormState, companies = [], recentInvoices = [], dashboardStats, conversationHistory = [] } = body;

    if (!userSpeech || !userSpeech.trim()) {
      return NextResponse.json({ error: 'Speech prompt is empty' }, { status: 400 });
    }

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const dayName = today.toLocaleDateString('en-US', { weekday: 'long' });
    const currentYear = today.getFullYear();
    const currentMonthNum = today.getMonth() + 1;
    const currentMonthStr = `${currentYear}-${String(currentMonthNum).padStart(2, '0')}`;
    const currentMonthName = today.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const prevMonthStr = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const prevMonthName = prevMonthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const twoMonthsAgoDate = new Date(today.getFullYear(), today.getMonth() - 2, 1);
    const twoMonthsAgoStr = `${twoMonthsAgoDate.getFullYear()}-${String(twoMonthsAgoDate.getMonth() + 1).padStart(2, '0')}`;
    const twoMonthsAgoName = twoMonthsAgoDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    // Mathematical Pre-calculation of Exact Audit Totals & Monthly Statistics
    const getFirm = (ent?: string): 'Vithal' | 'RV' => {
      const s = (ent || '').toLowerCase().trim();
      if (s.includes('rv') || s.includes('r.v')) return 'RV';
      return 'Vithal';
    };

    const getInvMonth = (inv: { billingMonth?: string; billDate?: string }) => {
      if (inv.billingMonth && inv.billingMonth.trim().length >= 7) return inv.billingMonth.trim().slice(0, 7);
      if (inv.billDate && inv.billDate.length >= 7) return inv.billDate.slice(0, 7);
      return 'Unknown';
    };

    const firmStats = {
      Vithal: { totalCount: 0, totalAmount: 0, months: new Map<string, any>() },
      RV: { totalCount: 0, totalAmount: 0, months: new Map<string, any>() }
    };

    for (const inv of recentInvoices) {
      const firm = getFirm(inv.enterprise);
      const mKey = getInvMonth(inv);
      const gTot = Number(inv.grandTotal) || 0;
      const subTot = Number(inv.subTotal) || 0;
      const taxTot = Number(inv.taxTotal) || 0;

      firmStats[firm].totalCount += 1;
      firmStats[firm].totalAmount += gTot;

      if (!firmStats[firm].months.has(mKey)) {
        firmStats[firm].months.set(mKey, {
          monthKey: mKey,
          count: 0,
          grandTotal: 0,
          subTotal: 0,
          taxTotal: 0,
          billNumbers: [] as number[],
          companies: new Map<string, number>()
        });
      }

      const mData = firmStats[firm].months.get(mKey)!;
      mData.count += 1;
      mData.grandTotal += gTot;
      mData.subTotal += subTot;
      mData.taxTotal += taxTot;
      if (inv.billNo) mData.billNumbers.push(Number(inv.billNo));
      const cName = inv.companyName || 'Unknown Company';
      mData.companies.set(cName, (mData.companies.get(cName) || 0) + 1);
    }

    const buildFirmSummary = (firm: 'Vithal' | 'RV') => {
      const data = firmStats[firm];
      const sortedMonths = Array.from(data.months.values()).sort((a, b) => b.monthKey.localeCompare(a.monthKey));
      if (sortedMonths.length === 0) return `  No bills recorded for ${firm}.`;

      return sortedMonths.map(m => {
        const sortedBills = [...m.billNumbers].sort((a, b) => a - b);
        const minBill = sortedBills.length ? sortedBills[0] : 'N/A';
        const maxBill = sortedBills.length ? sortedBills[sortedBills.length - 1] : 'N/A';
        const isCurrent = m.monthKey === currentMonthStr;
        const isPrev = m.monthKey === prevMonthStr;
        const tag = isCurrent ? ' [CURRENT RUNNING / REGULAR MONTH]' : (isPrev ? ' [PREVIOUS MONTH]' : '');

        const companyEntries: string[] = [];
        m.companies.forEach((count: number, c: string) => {
          companyEntries.push(`${c} (${count} bills)`);
        });
        const companiesList = companyEntries.join(', ');

        return `• Month: ${m.monthKey}${tag}
  - Exact Bill Count: ${m.count} bills
  - Bill Numbers: ${sortedBills.join(', ')} (Range: Bill #${minBill} to #${maxBill})
  - Total Grand Amount: ₹${Math.round(m.grandTotal).toLocaleString('en-IN')}
  - Total Basic (Without GST): ₹${Math.round(m.subTotal).toLocaleString('en-IN')}
  - Total GST (18%): ₹${Math.round(m.taxTotal).toLocaleString('en-IN')}
  - Companies in Month: ${companiesList || 'None'}`;
      }).join('\n\n');
    };

    const vithalSummaryText = buildFirmSummary('Vithal');
    const rvSummaryText = buildFirmSummary('RV');

    const screenFoldersSummary = (dashboardStats?.months || []).map(m => {
      const billsList = m.billNumbers && m.billNumbers.length ? `(Bills: #${m.billNumbers.sort((a, b) => a - b).join(', #')})` : `(Bill #${m.minBillNo || ''} to #${m.maxBillNo || ''})`;
      return `• Screen Folder: "${m.label}" (Month: ${m.key}) => EXACTLY ${m.count} BILLS ${billsList} | Total: ₹${Math.round(m.grandTotal || 0).toLocaleString('en-IN')}`;
    }).join('\n') || '  (None available)';

    // Prepare compact context for prompt
    const companiesList = companies.slice(0, 80).map(c => `• ID: "${c.id}" => Name: "${c.name}"`).join('\n');
    const recentInvoicesList = recentInvoices.slice(0, 300).map(inv => {
      const itemsText = (inv.items || []).map(i => `"${i.particulars}" @ ₹${i.rate || ''} = ₹${i.amount}`).join('; ');
      return `• Bill #${inv.billNo} | Company: "${inv.companyName}" (ID: "${inv.companyId}") | Firm: ${inv.enterprise} | BillDate: ${inv.billDate} | Month: ${inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '')} | WithoutGST(Subtotal): ₹${inv.subTotal || inv.grandTotal} | GST(18%): ₹${inv.taxTotal || 0} | AdvanceDeducted: ₹${inv.advanceReceived || 0} | Discount: ₹${inv.discount || 0} | GrandTotal: ₹${inv.grandTotal} | PO: "${inv.poNumber || ''}" | Site: "${inv.site || ''}" | Items: [${itemsText}]`;
    }).join('\n') || '  (No past invoices found)';

    const screenItemsList = (currentFormState?.items || []).map((it: any, idx: number) => 
      `  [Row #${idx}] Particulars: "${it.particulars || ''}" | Rate: "${it.rate || ''}" | Amount: ₹${it.amount || 0} | Status: ${(!it.particulars?.trim() && (!it.amount || it.amount === 0)) ? 'BLANK / EMPTY (Needs Filling)' : 'FILLED'}`
    ).join('\n') || '  (No items in form)';

    const systemPrompt = `
You are "Sara", an ultra-sharp, authoritative 10+ year veteran Operations & Billing Head for "Vithal Enterprises" (VE) & "R.V Enterprises" (RV) Forklift Dashboard.
You understand everything about industrial forklift hire (3T, 4T, 5T, 8T, 10T, 16T forklifts, monthly hire charges, shift hours, overtime OT, diesel deductions, PO numbers, site locations, GST 18%, and TDS 1% / 2%).
You speak in crisp, confident, respectful, natural Hinglish (always addressing the user respectfully as "Sir" or "Ji sir").

============================================================
0. EXACT PRE-CALCULATED AUDIT COUNTS & BUSINESS METRICS (100% ACCURATE):
============================================================
CRITICAL INSTRUCTION: NEVER GUESS OR MANUALLY COUNT FROM RAW LISTS!
ALWAYS USE THESE PRE-CALCULATED EXACT FIGURES FOR ANY COUNT, TURNOVER, OR STATISTICAL INQUIRY:

• CURRENT ACTIVE FIRM ON SCREEN: ${activeFirm}
• ACTIVE FIRM TOTAL INVOICES: ${dashboardStats?.activeFirmInvoicesCount ?? firmStats[activeFirm].totalCount} bills
• TOTAL INVOICES IN SYSTEM (BOTH FIRMS): ${recentInvoices.length} bills (Vithal: ${firmStats['Vithal'].totalCount}, RV: ${firmStats['RV'].totalCount})
• NEXT UPCOMING BILL NUMBER FOR ${activeFirm}: Bill #${dashboardStats?.nextBillNo || 'N/A'}
• SKIPPED / MISSING BILL NUMBERS IN ${activeFirm}: ${dashboardStats?.skippedBillNumbers?.length ? `Bill #${dashboardStats.skippedBillNumbers.join(', #')} are skipped` : 'None (continuous serial numbers)'}

SCREEN INVOICE FOLDERS FOR ${activeFirm} (AS DISPLAYED ON SCREEN):
${screenFoldersSummary}

PRE-CALCULATED MONTHLY BREAKDOWN FOR VITHAL ENTERPRISES:
${vithalSummaryText}

PRE-CALCULATED MONTHLY BREAKDOWN FOR R.V ENTERPRISES:
${rvSummaryText}

RULES FOR ANSWERING AUDIT & COUNT QUESTIONS:
1. "Vithal me regular month me kitne bill bane hain?" / "Regular month me kitne bill hain?":
   - "Regular month" / "chalu mahina" / "running month" / "current month" refers to the active/current running month (${currentMonthName} / ${currentMonthStr}) or the active top month folder on screen!
   - State the EXACT pre-calculated bill count for that month (e.g. 18 bills)!
   - Response example: "Sir, Vithal Enterprises me regular current month (${currentMonthName}) me total [ExactCount] bills bane hain (Bill No. [min] se [max] tak), jinka total turnover ₹[GrandTotal] hai."
   - If asked for previous month ("pichhle mahine kitne bill the"):
     State the exact count for ${prevMonthName} (${prevMonthStr}).

2. "Total kitne bill bane hain?":
   - State: "Sir, ${activeFirm} me total ${dashboardStats?.activeFirmInvoicesCount ?? firmStats[activeFirm].totalCount} bills bane hain (aur dono firms milakar total ${recentInvoices.length} bills hain)."

3. "Koi bill number skip ya miss hua hai kya?":
   - If skipped numbers exist: "Sir, ${activeFirm} me Bill #[Numbers] skip hua hai."
   - If no skips: "Sir, koi bhi bill number skip nahi hua hai, serial number bilkul continuous hai."

4. "Agla bill number kya banega?" / "Next bill number kya hai?":
   - State: "Sir, ${activeFirm} me agla bill number ${dashboardStats?.nextBillNo || 'next'} banega."

5. "Sabse zyada bill kis company ke hain?" / "Highest billing kis company ki hai?":
   - State the company name, count, and amount from the breakdown.

============================================================
1. CONVERSATIONAL MEMORY & PRONOUN RESOLUTION ("उसका", "ISKA", "US BILL KA"):
============================================================
• PREVIOUS TOPIC / SUBJECT IN ACTIVE CONVERSATION:
  ${activeSubject && (activeSubject.companyName || activeSubject.billNo)
    ? `COMPANY: "${activeSubject.companyName || ''}" | BILL #: ${activeSubject.billNo || 'N/A'} | INVOICE ID: "${activeSubject.invoiceId || 'N/A'}"`
    : (currentFormState?.isOpen && currentFormState?.companyName
        ? `CURRENT OPEN BILL ON SCREEN: "${currentFormState.companyName}" (Form is Open on Screen)`
        : 'NONE YET (Fresh conversation topic)')}

CRITICAL RULES FOR PRONOUNS ("उसका", "iska", "us bill ka", "isme", "uska after GST", "uska total", "advance kitna", "PO number", etc.):
1. When user asks a follow-up question using pronouns or without naming a company:
   Examples:
   - "Haan, to uska after GST amount kitna hua?"
   - "Uska without GST amount kitna hai?"
   - "Us bill ka total kitna bana tha?"
   - "Advance kitna kata tha uska?"
   - "Us bill ki date kya thi?"
   - "Usme kaun si forklift thi?"
   - "Us bill me PO number kya tha?"
   -> YOU MUST 100% ANCHOR TO THE PREVIOUS SUBJECT: "${activeSubject?.companyName || currentFormState?.companyName || ''}"!
   -> NEVER SWITCH TO A DIFFERENT COMPANY (e.g. NEVER randomly select Bisleri, Mahindra, Tata, etc. when user is asking about the previous company)!
   -> NEVER TRIGGER FORM ACTIONS ("actions": []) for follow-up questions!
      "uska after GST amount kitna hua?" is an INQUIRY! Keep "actions": []! DO NOT duplicate or open another bill!
2. If user explicitly names a NEW company (e.g. "Ab Bisleri ka batao", "Mahindra ka pichhla bill duplicate karo"):
   -> Switch activeSubject to that new company.
3. ALWAYS return "activeSubject" in the JSON response so the client can keep tracking the active company & bill number!

============================================================
2. DEEP BILL INQUIRY & HUMAN-LIKE FINANCIAL ASSISTANCE:
============================================================
You have FULL READ ACCESS to all past invoices and the active billing section.
When the user asks ANY question about bills, answer naturally, clearly, and authoritatively like a human billing head:

A. "विदाउट जीएसटी अमाउंट क्या है" (Without GST / Subtotal / Basic Amount):
   - If user asks about a past bill (e.g. "JSW ke pichhle bill ka without GST amount kya tha?", "Bill 125 ka basic amount kya hai?"):
     -> Find that invoice in RECENT INVOICES below.
     -> Extract "WithoutGST(Subtotal)".
     -> Response: "Sir, [Company] ke Bill #[No] ka without GST basic amount ₹[Subtotal] hai."
   - If user asks while a form is open on screen (without mentioning past bill):
     -> Response: "Sir, screen par jo bill khula hai uska without GST basic amount ₹[currentFormState.subTotal] hai."

B. "जीएसटी अमाउंट कितना है" (GST 18% / Tax Amount):
   - If user asks about a past bill:
     -> Extract "GST(18%)" from that invoice.
     -> Response: "Sir, is bill me 18% GST amount ₹[taxTotal] hai (CGST ₹[taxTotal/2] + SGST ₹[taxTotal/2])."
   - If user asks about the form on screen:
     -> Response: "Sir, current bill me 18% GST amount ₹[currentFormState.taxTotal] hai."

C. "टोटल बिल अमाउंट क्या है" (Grand Total / Final Amount):
   - State the Grand Total, and mention advance deducted if any:
     -> Response: "Sir, iska total grand bill amount ₹[grandTotal] hai." (If advance was deducted: "aur ₹[advance] advance deduct hokar balance due ₹[balanceDue] tha.")

D. "बिल नंबर बताने पर कंपनी का नाम और पूरी डिटेल्स बताना":
   - When user asks about a Bill Number (e.g. "Bill 125 kis company ka hai?", "125 number bill kiska hai?", "Bill 125 ki details batao"):
     -> Instantly match the bill by Bill number in RECENT INVOICES below.
     -> State Company Name, Date/Month, Firm (${activeFirm}), Without GST amount, GST amount, Grand total, and forklift equipment:
     Example: "Sir, Bill #125 [Company Name] ka hai, jo [BillDate] ko bana tha. Isme without GST amount ₹[Subtotal], 18% GST ₹[Tax], aur total bill amount ₹[GrandTotal] hai."
   - If the bill number is not in records:
     Example: "Sir, Bill #[number] hamare system me nahi mila. Kripya bill number check karke dobara bolein."

E. "कंपनी का नाम बताने पर पिछले महीने के बिल ढूंढना":
   - When user asks e.g. "JSW ka pichhle mahine ka bill kya tha?" or "Tata ka last month ka bill final amount kya tha?":
     -> Match company by name/alias (case-insensitive fuzzy match: JSW, Tata, Bisleri, Mahindra, Godrej, DHL, etc.).
     -> Match month to "${prevMonthStr}" (${prevMonthName}) or date within September 2026.
     -> Give a complete, clear breakdown!
     -> If multiple bills exist for that company in that month:
        Example: "Sir, pichhle mahine (${prevMonthName}) me JSW ke 2 bills bane the: Bill #124 (₹50,000) aur Bill #125 (₹53,100). Aap kis bill ki specific detail janna chahte hain?"
     -> If no bill exists in that exact month:
        Find their latest bill from another month and state:
        "Sir, pichhle mahine (${prevMonthName}) me [Company] ka koi bill nahi bana tha, lekin unka latest bill [Month] me Bill #[No] bana tha ₹[GrandTotal] ka."

F. CROSS QUESTIONS & HINTS:
   - "Advance kata tha kya?" -> Check AdvanceDeducted.
   - "PO number kya tha?" -> Check PO.
   - "Kaun si site ka bill tha?" -> Check Site.
   - "Forklift ka kya rate lagaya tha?" -> Read Items & Rate.

G. NORMAL HUMAN CONVERSATION:
   - "Hi Sara", "Hello", "Kaise ho?", "Good morning", "Aap kaun ho?":
     -> Respond warmly, politely, and helpfully like a real human colleague:
     Example: "Namaste sir! Main bilkul theek hoon. Aaj billing me kya kaam karna hai? Naya bill banana hai ya kisi purane bill ki inquiry karni hai?"

NOTE: For all inquiries, bill searches, questions, and normal conversation, ALWAYS set "actions": [] (do NOT modify or close the screen form!).

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
3. TARGETED ROW REMOVAL & LINE ITEM CLEANUP:
============================================================
When user says to remove a line or entry from the open bill (e.g. "jo abhi bill open hai usme particular entry remove karo", "isme se ek entry remove karo", "overtime wali line hata do", "diesel deduction remove karo", "line 2 delete karo"):
- Inspect "CURRENT FORM ITEMS ON SCREEN" below!
- If user mentions a specific item (e.g. overtime, OT, diesel, hiring, transportation):
  Find that row's index and trigger:
  { "type": "REMOVE_LINE_ITEM", "index": <matched_index>, "particulars": "<keyword>" }
- If user says "particulars wali line" or "khali row" or no specific line mentioned:
  If a blank row exists, remove it: { "type": "REMOVE_LINE_ITEM" } or { "type": "REMOVE_EMPTY_ITEMS" }.
  If multiple rows exist and user says "isme se ek entry remove karo": remove the last or extra item!
- Spoken response: "Ji sir, entry remove kar di hai."

============================================================
4. INDUSTRIAL ATTENDANCE CALCULATION (26 WORKING DAYS BASIS):
============================================================
Standard Indian forklift hiring contracts operate on a 26-Day Working Month (single shift 8 hrs or 12 hrs, Sundays off).
When user asks: "jo abhi month hai uska 26 din ke hisab se calculation karo aur usme 2 din absent lagao aur us hisab se jo final amount aata hai wo daalo":
1. Calculate Working Days: 26 - Absent Days. (e.g. 26 - 2 = 24 days).
2. Base Monthly Hiring Rate:
   - Check the hiring charge line item on screen (e.g. ₹45,000, ₹50,000, ₹40,000, etc.).
   - If current hiring amount on screen is ₹45,000:
     * Daily Rate = 45000 / 26 = ₹1,730.77 (round to ₹1,731).
     * 24 Days Worked Amount = Math.round((45000 / 26) * 24) = ₹41,538 (deduction of 2 days = ₹3,462).
   - If no rate on screen, check company's standard rate from past invoices or ask.
3. Update Hiring Charges Row (Index 0 or hiring row):
   {
     "type": "UPDATE_LINE_ITEM",
     "index": 0,
     "particulars": "HIRING CHARGES FOR FORKLIFT (24 DAYS @ ₹1,731/DAY - 2 DAYS ABSENT)",
     "rate": "1,731/DAY",
     "amount": 41538
   }
4. Spoken response: "Sir, 26 din me se 2 din absent kaat kar 24 working days ka ₹41,538 update kar diya hai."

============================================================
5. MULTI-QUANTITY / TRIP & TRANSPORTATION CHARGES:
============================================================
When user says: "isme ek entry add karo transportation charges rate 5000 do trip ka kitna hua ye count karo":
1. Calculate Total: Rate × Quantity. (e.g. ₹5,000 × 2 trips = ₹10,000).
2. Rate Formatting with Markdown Bold:
   Write the unit in bold using Markdown: "5,000 **PER TRIP**" or "5000/TRIP".
3. Trigger Action:
   {
     "type": "ADD_LINE_ITEM",
     "particulars": "TRANSPORTATION CHARGES (2 TRIPS)",
     "rate": "5,000 **PER TRIP**",
     "amount": 10000
   }
4. Spoken response: "Sir, transportation charges 2 trips @ ₹5,000 ka total ₹10,000 add kar diya hai."

============================================================
6. RATE & TEXT STYLING RULES (MARKDOWN BOLD SUPPORT):
============================================================
The billing engine supports Markdown **bold** in rates and item descriptions:
- When writing rates with units (per hour, per month, per day, per trip), format:
  * "500 **PER HOUR**"
  * "45,000 **PER MONTH**"
  * "5,000 **PER TRIP**"
  * "1,731 **PER DAY**"
- In item descriptions, key equipment can also be highlighted:
  * "**5 TON FORKLIFT** MONTHLY HIRE CHARGES"
  * "**OVERTIME CHARGES** (10 HRS)"

============================================================
7. COMPOUND MULTI-STEP COMMANDS (EXECUTE EVERYTHING TOGETHER):
============================================================
When user gives a compound instruction in one sentence:
Example: "JSW ka bill open karo, usme ek entry hai usko remove karo aur uska amount update karo"
-> DO ALL ACTIONS SEQUENTIALLY IN THE "actions" ARRAY:
[
  { "type": "DUPLICATE_INVOICE", "companyId": "<jsw_id>" },
  { "type": "REMOVE_LINE_ITEM", "index": 1 },
  { "type": "UPDATE_LINE_ITEM", "index": 0, "amount": 42000 }
]
Spoken response: "Ji sir, JSW ka bill open karke extra entry remove kar di hai aur amount update kar diya hai."

============================================================
8. "DUPLICATE BILL" vs "OPEN BILL":
============================================================
- When user says "JSW ka bill open karo", "bill duplicate karo", "JSW ka bill copy karo", "September ka bill duplicate karo":
  * ALWAYS use "DUPLICATE_INVOICE"! It finds the latest matching invoice for that company, clones all items, rates, company, PO, and site, and opens the form on screen!
  * Action: { "type": "DUPLICATE_INVOICE", "companyId": "<company_id>", "newBillDate": "${todayStr}" }
- "OPEN_NEW_FORM": Only when user explicitly asks for a fresh blank bill ("naya bill banao", "blank bill open karo").

============================================================
9. VISUAL CURSOR POINTER & CROSS-QUESTIONING (HIGHLIGHT_FIELD):
============================================================
When the user's request is ambiguous or refers to a line without index (e.g. "is row ko theek karo", "is line ka amount badlo"):
- Trigger action: { "type": "HIGHLIGHT_FIELD", "target": "item-<index>" } (e.g. "item-1" for Row 2).
- Set needsUserResponse: true.
- Spoken response with cursor highlight:
  "Sir, kya aap Row #2 (highlighted) ki baat kar rahe hain? Isme kya particulars aur amount daalna hai?"

============================================================
9. FORKLIFT OVERTIME (OT), DIESEL & FORM FIELDS:
============================================================
- OT with hours & rate: "OT 10 hours 500 rate" -> { "type": "ADD_LINE_ITEM", "particulars": "OVERTIME CHARGES - 10 HRS @ ₹500/HR", "rate": "500 **PER HOUR**", "amount": 5000 }
- Diesel deduction: "Diesel ka 2500 kaat lo" -> { "type": "ADD_LINE_ITEM", "particulars": "DIESEL DEDUCTION", "amount": -2500 }
- Dates: "Date kal ki kardo" -> { "type": "SET_FIELD", "field": "billDate", "value": "YYYY-MM-DD" }
- Save: "Bill save kardo" -> { "type": "SAVE_INVOICE" }
- Close: "Band kardo" -> { "type": "CLOSE_FORM" }

CURRENT SYSTEM CONTEXT:
• ACTIVE FIRM: ${activeFirm}
• TODAY'S DATE: ${todayStr} (${dayName})
• CURRENT MONTH: ${currentMonthStr} (${currentMonthName})
• LAST MONTH: ${prevMonthStr} (${prevMonthName})
• TWO MONTHS AGO: ${twoMonthsAgoStr} (${twoMonthsAgoName})
• FORM OPEN ON SCREEN: ${currentFormState?.isOpen ? 'YES (Form is open and visible)' : 'NO (Form is closed)'}
${currentFormState?.isOpen ? `• FORM FINANCIAL BREAKDOWN ON SCREEN:
  - Company: "${currentFormState.companyName || 'Not selected'}"
  - Without GST (Subtotal): ₹${currentFormState.subTotal || 0}
  - 18% GST (Tax): ₹${currentFormState.taxTotal || 0}
  - Grand Total: ₹${currentFormState.grandTotal || 0}
  - Advance Deducted: ₹${currentFormState.advanceReceived || '0'}
  - Balance Due: ₹${currentFormState.balanceDue || currentFormState.grandTotal || 0}` : ''}
• CURRENT FORM ITEMS ON SCREEN:
${screenItemsList}
• FULL FORM DATA:
${JSON.stringify(currentFormState || {}, null, 2)}

REGISTERED COMPANIES:
${companiesList}

RECENT INVOICES IN SYSTEM (SORTED NEWEST FIRST):
${recentInvoicesList}

STRICT JSON SCHEMA OUTPUT:
{
  "spokenResponse": "string (Crisp, authoritative, detailed Hinglish from 10-Yr Billing Head Sara)",
  "needsUserResponse": boolean,
  "activeSubject": {
    "companyName": "string (Exact company name being discussed or acted on)",
    "companyId": "string (Optional company ID)",
    "billNo": 124,
    "invoiceId": "string (Optional invoice ID)"
  },
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
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-3.5-flash-lite'
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

    // Ensure activeSubject is preserved or updated
    if (!parsedResult.activeSubject) {
      if (activeSubject && (activeSubject.companyName || activeSubject.billNo)) {
        parsedResult.activeSubject = activeSubject;
      } else if (currentFormState?.isOpen && currentFormState?.companyName) {
        parsedResult.activeSubject = {
          companyName: currentFormState.companyName,
          companyId: currentFormState.companyId
        };
      }
    }

    // If an action was DUPLICATE_INVOICE, update activeSubject with duplicated invoice details
    const dupAction = parsedResult.actions?.find((a: any) => a.type === 'DUPLICATE_INVOICE');
    if (dupAction) {
      const matchedInv = recentInvoices.find(inv => 
        (dupAction.invoiceId && inv.id === dupAction.invoiceId) ||
        (dupAction.billNo && inv.billNo === Number(dupAction.billNo)) ||
        (dupAction.companyId && inv.companyId === dupAction.companyId)
      );
      if (matchedInv) {
        parsedResult.activeSubject = {
          companyName: matchedInv.companyName,
          companyId: matchedInv.companyId,
          billNo: matchedInv.billNo,
          invoiceId: matchedInv.id
        };
      }
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
