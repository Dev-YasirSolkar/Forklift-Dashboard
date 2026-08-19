/**
 * @fileOverview Smart Telegram Assistant Module
 * Handles natural language querying over Firestore data for Admin & Employees.
 */

import { initializeFirebase } from '@/firebase';
import { collection, query, where, getDocs, getDoc, doc, setDoc, orderBy, limit } from 'firebase/firestore';

interface CompanySummary {
  id: string;
  name: string;
  address?: string;
  gstin?: string;
  kindAttn?: string;
  contactNumber?: string;
}

// In-memory cache of authorized admin chat IDs
const verifiedAdminChatIds = new Set<string>();

export const ADMIN_SECRET_CODE = '2028';

/**
 * Check if the given chatId is an authorized Admin.
 */
export async function isTelegramAdmin(chatId: string): Promise<boolean> {
  if (verifiedAdminChatIds.has(chatId)) return true;

  const { firestore } = initializeFirebase();
  try {
    const adminDoc = await getDoc(doc(firestore, 'telegramAdmins', chatId));
    if (adminDoc.exists()) {
      verifiedAdminChatIds.add(chatId);
      return true;
    }

    // Check company settings
    const settingsDoc = await getDoc(doc(firestore, 'companySettings', 'telegram'));
    if (settingsDoc.exists() && settingsDoc.data()?.adminChatIds?.includes(chatId)) {
      verifiedAdminChatIds.add(chatId);
      return true;
    }
  } catch (err) {
    console.error('Admin check error:', err);
  }
  return false;
}

/**
 * Register a chatId as Admin if the user provides the secret code 2028 or super admin email.
 */
export async function registerTelegramAdmin(chatId: string, secretOrEmail: string): Promise<boolean> {
  const input = (secretOrEmail || '').toLowerCase().trim();
  const superAdminEmail = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  
  const isMatch = input === ADMIN_SECRET_CODE || input.includes(ADMIN_SECRET_CODE) || (superAdminEmail && input === superAdminEmail);

  if (!isMatch) {
    return false;
  }

  verifiedAdminChatIds.add(chatId);

  try {
    const { firestore } = initializeFirebase();
    await setDoc(doc(firestore, 'telegramAdmins', chatId), {
      chatId,
      passcode: ADMIN_SECRET_CODE,
      registeredAt: new Date().toISOString(),
      role: 'super_admin',
    }, { merge: true });
  } catch (err) {
    console.error('Firestore admin save error:', err);
  }

  return true;
}

/**
 * Query pending payments and invoice balance for a company.
 */
export async function getCompanyPaymentSummary(companyQuery: string): Promise<string> {
  const { firestore } = initializeFirebase();
  
  // 1. Find Company
  const companiesSnap = await getDocs(collection(firestore, 'companies'));
  const searchLower = companyQuery.toLowerCase().trim();
  const matchedCompanyDoc = companiesSnap.docs.find(d => {
    const name = (d.data().name || '').toLowerCase();
    return name.includes(searchLower) || searchLower.includes(name);
  });

  if (!matchedCompanyDoc) {
    return `❌ *Company not found*\nCould not find any company matching "${companyQuery}".\n_Try typing the full or partial company name._`;
  }

  const company = matchedCompanyDoc.data() as CompanySummary;
  const companyId = matchedCompanyDoc.id;

  // 2. Fetch Invoices for this company
  const invoicesQuery = query(collection(firestore, 'invoices'), where('companyId', '==', companyId));
  const invoicesSnap = await getDocs(invoicesQuery);

  if (invoicesSnap.empty) {
    return `🏢 *${company.name}*\n━━━━━━━━━━━━━━━━━━\n📌 *Status:* No invoices recorded yet for this client.\n📞 *Contact:* ${company.contactNumber || 'N/A'}\n📍 *Address:* ${company.address || 'N/A'}`;
  }

  // 3. Fetch Payments for this company
  const paymentsQuery = query(collection(firestore, 'payments'), where('companyId', '==', companyId));
  const paymentsSnap = await getDocs(paymentsQuery);

  let totalBilled = 0;
  let totalReceived = 0;
  let totalTds = 0;
  let totalOtherDeductions = 0;

  const invoiceMap: Record<string, { billNo: number | string; date: string; amount: number; received: number; enterprise: string }> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const grandTotal = Number(inv.grandTotal || 0);
    totalBilled += grandTotal;
    invoiceMap[d.id] = {
      billNo: inv.billNo,
      date: inv.billDate || inv.billingMonth || 'N/A',
      amount: grandTotal,
      received: 0,
      enterprise: inv.enterprise || 'Vithal',
    };
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    const rec = Number(pay.receivedAmount || 0);
    const tds = Number(pay.tdsDeducted || 0);
    const oth = Number(pay.otherDeductions || 0);
    totalReceived += rec;
    totalTds += tds;
    totalOtherDeductions += oth;

    if (pay.invoiceId && invoiceMap[pay.invoiceId]) {
      invoiceMap[pay.invoiceId].received += (rec + tds + oth);
    }
  });

  const pendingBalance = Math.max(0, totalBilled - (totalReceived + totalTds + totalOtherDeductions));

  // Find unpaid or partially paid invoices
  const unpaidInvoices = Object.values(invoiceMap).filter(inv => (inv.amount - inv.received) > 1);

  let text = `🏢 *${company.name.toUpperCase()}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `💰 *Total Billed:* ₹${totalBilled.toLocaleString('en-IN')}\n`;
  text += `✅ *Total Received:* ₹${totalReceived.toLocaleString('en-IN')}\n`;
  if (totalTds > 0) text += `🔖 *TDS Deducted:* ₹${totalTds.toLocaleString('en-IN')}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `⚠️ *OUTSTANDING BALANCE:* ₹${pendingBalance.toLocaleString('en-IN')}\n\n`;

  if (unpaidInvoices.length > 0) {
    text += `📋 *Unpaid / Pending Bills (${unpaidInvoices.length}):*\n`;
    unpaidInvoices.slice(0, 8).forEach(inv => {
      const due = inv.amount - inv.received;
      text += `• Bill #${inv.billNo} (${inv.enterprise}) - Due: ₹${due.toLocaleString('en-IN')} [Date: ${inv.date}]\n`;
    });
    if (unpaidInvoices.length > 8) {
      text += `_...and ${unpaidInvoices.length - 8} more bills._\n`;
    }
  } else {
    text += `✨ *All bills are fully paid!* 🎉\n`;
  }

  if (company.contactNumber || company.kindAttn) {
    text += `\n📞 *Contact:* ${company.kindAttn || ''} ${company.contactNumber ? `(${company.contactNumber})` : ''}\n`;
  }

  return text;
}

/**
 * Get fleet status (Workshop, On-Site, Total).
 */
export async function getFleetStatus(locationFilter?: 'Workshop' | 'On-Site'): Promise<string> {
  const { firestore } = initializeFirebase();
  const snap = await getDocs(collection(firestore, 'forklifts'));

  if (snap.empty) {
    return '🚜 *No forklifts found in the database.*';
  }

  const all = snap.docs.map(d => d.data());
  const workshop = all.filter(f => f.locationType === 'Workshop');
  const onSite = all.filter(f => f.locationType === 'On-Site');
  const notConfirmed = all.filter(f => f.locationType === 'Not Confirm');

  if (locationFilter === 'Workshop') {
    let msg = `🏭 *Forklifts Currently in Workshop (${workshop.length}):*\n━━━━━━━━━━━━━━━━━━━━━\n`;
    if (workshop.length === 0) {
      msg += '_No forklifts currently idle in workshop._';
    } else {
      workshop.forEach((f, i) => {
        msg += `${i + 1}. *${f.serialNumber}* - ${f.make || ''} ${f.model || ''} (${f.capacity || 'N/A'})\n`;
      });
    }
    return msg;
  }

  if (locationFilter === 'On-Site') {
    let msg = `📍 *Forklifts Deployed On-Site (${onSite.length}):*\n━━━━━━━━━━━━━━━━━━━━━\n`;
    if (onSite.length === 0) {
      msg += '_No forklifts currently deployed on-site._';
    } else {
      onSite.forEach((f, i) => {
        msg += `${i + 1}. *${f.serialNumber}* @ ${f.siteCompany || 'Client Site'} (${f.siteArea || 'On-Site'})\n`;
      });
    }
    return msg;
  }

  const utilRate = all.length > 0 ? ((onSite.length / all.length) * 100).toFixed(0) : '0';

  let msg = `🚜 *FLEET SUMMARY*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 *Total Fleet:* ${all.length} Units\n`;
  msg += `🟢 *On-Site (Deployed):* ${onSite.length} Units\n`;
  msg += `🟠 *Workshop (Idle):* ${workshop.length} Units\n`;
  msg += `🔴 *Unconfirmed:* ${notConfirmed.length} Units\n`;
  msg += `📈 *Fleet Utilization:* ${utilRate}%\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Type "workshop forklifts" or "on site forklifts" for detailed list._`;
  return msg;
}

/**
 * Get today's attendance summary.
 */
export async function getTodayAttendanceSummary(): Promise<string> {
  const { firestore } = initializeFirebase();
  const today = new Date().toISOString().split('T')[0];

  const empSnap = await getDocs(collection(firestore, 'employees'));
  const attSnap = await getDocs(query(collection(firestore, 'attendance'), where('date', '==', today)));

  const empMap: Record<string, string> = {};
  empSnap.docs.forEach(d => {
    empMap[d.id] = d.data().fullName || 'Unknown';
  });

  const records = attSnap.docs.map(d => d.data());
  const present: string[] = [];
  const absent: string[] = [];
  const halfDay: string[] = [];

  records.forEach(r => {
    const name = empMap[r.employeeId] || 'Employee';
    if (r.status === 'Present') present.push(name);
    else if (r.status === 'Absent') absent.push(name);
    else if (r.status === 'Half-Day') halfDay.push(name);
  });

  let msg = `📅 *ATTENDANCE TODAY (${today})*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👥 *Total Staff:* ${empSnap.size}\n`;
  msg += `✅ *Present:* ${present.length}\n`;
  msg += `❌ *Absent:* ${absent.length}\n`;
  if (halfDay.length > 0) msg += `⏳ *Half-Day:* ${halfDay.length}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;

  if (absent.length > 0) {
    msg += `❌ *Absent Staff:*\n• ${absent.join('\n• ')}\n\n`;
  }
  if (present.length > 0) {
    msg += `✅ *Present Staff:*\n• ${present.join('\n• ')}\n`;
  }

  return msg;
}

/**
 * Get current month billing summary for Vithal & RV Enterprises.
 */
export async function getMonthlyBillingSummary(): Promise<string> {
  const { firestore } = initializeFirebase();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const snap = await getDocs(collection(firestore, 'invoices'));
  
  let vithalTotal = 0;
  let rvTotal = 0;
  let vithalCount = 0;
  let rvCount = 0;

  snap.docs.forEach(d => {
    const inv = d.data();
    const m = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');
    if (m === currentMonth) {
      const amount = Number(inv.grandTotal || 0);
      if (inv.enterprise === 'RV') {
        rvTotal += amount;
        rvCount++;
      } else {
        vithalTotal += amount;
        vithalCount++;
      }
    }
  });

  const monthDate = new Date(currentMonth + '-01');
  const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  let msg = `📊 *BILLING SUMMARY (${monthName.toUpperCase()})*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏭 *Vithal Enterprises:* ₹${vithalTotal.toLocaleString('en-IN')} (${vithalCount} Invoices)\n`;
  msg += `🏢 *R.V Enterprises:* ₹${rvTotal.toLocaleString('en-IN')} (${rvCount} Invoices)\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💎 *TOTAL BILLING:* ₹${(vithalTotal + rvTotal).toLocaleString('en-IN')}\n`;
  return msg;
}

/**
 * Process any free-form natural language query using Gemini 2.0 Flash.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return '⚠️ Gemini API Key is missing in server environment.';
  }

  // 1. Identify Intent via Gemini
  const systemInstruction = `You are the Brain of VE Dashboard Telegram Bot for a Forklift Workshop & Rental company (Vithal Enterprises & R.V Enterprises).
Analyze the user's message and determine the best action.
Return a STRICT JSON response in this format:
{
  "action": "company_pending" | "fleet_summary" | "workshop_fleet" | "onsite_fleet" | "attendance_today" | "billing_summary" | "general_qa",
  "companyName": string | null,
  "explanation": string
}

Actions:
- "company_pending": when user asks for pending, balance, payments, or details of a specific company (extract companyName).
- "fleet_summary": when user asks about overall fleet, total forklifts, utilization.
- "workshop_fleet": when user asks about forklifts in workshop, idle, available units.
- "onsite_fleet": when user asks about forklifts on-site or deployed at client sites.
- "attendance_today": when user asks about today's attendance, absentees, present staff.
- "billing_summary": when user asks about monthly billing, revenue, total invoice amounts.
- "general_qa": for greetings, help, or other workshop management questions.`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const res = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `${systemInstruction}\n\nUser Message: "${userPrompt}"` }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      }),
    });

    const geminiResult = await res.json();
    const rawJson = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (rawJson) {
      const parsed = JSON.parse(rawJson);

      switch (parsed.action) {
        case 'company_pending':
          if (parsed.companyName) {
            return await getCompanyPaymentSummary(parsed.companyName);
          }
          break;
        case 'fleet_summary':
          return await getFleetStatus();
        case 'workshop_fleet':
          return await getFleetStatus('Workshop');
        case 'onsite_fleet':
          return await getFleetStatus('On-Site');
        case 'attendance_today':
          return await getTodayAttendanceSummary();
        case 'billing_summary':
          return await getMonthlyBillingSummary();
      }
    }
  } catch (err) {
    console.error('Gemini NLP Error:', err);
  }

  // Fallback direct heuristic matching if Gemini is slow or unavailable
  const lower = userPrompt.toLowerCase();
  if (lower.includes('workshop') || lower.includes('idle')) {
    return await getFleetStatus('Workshop');
  }
  if (lower.includes('site') || lower.includes('client')) {
    return await getFleetStatus('On-Site');
  }
  if (lower.includes('fleet') || lower.includes('forklift')) {
    return await getFleetStatus();
  }
  if (lower.includes('attendance') || lower.includes('absent') || lower.includes('present')) {
    return await getTodayAttendanceSummary();
  }
  if (lower.includes('billing') || lower.includes('revenue') || lower.includes('collection')) {
    return await getMonthlyBillingSummary();
  }

  return `🤖 *VE Dashboard Bot Help*\n━━━━━━━━━━━━━━━━━━━━━\nI can answer questions about your business in normal Hindi / English:\n\n• *"Bisleri ka pending payment kitna hai?"*\n• *"Workshop me kitne forklifts khade hain?"*\n• *"Aaj kon kon absent hai?"*\n• *"Is month ka total billing kitna hua?"*\n• *"On-site forklifts ki list do"*\n━━━━━━━━━━━━━━━━━━━━━`;
}
