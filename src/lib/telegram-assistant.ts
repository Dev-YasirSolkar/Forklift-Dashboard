/**
 * @fileOverview Super Smart AI-Powered Telegram Assistant Engine
 * Integrates Google Gemini AI with live Firestore business data for deep natural language understanding (Hinglish/Hindi/English).
 * Specialized intent handlers for:
 * 1. "Kitne bills pending hai" -> Count of pending bills & total due balance only.
 * 2. "Konse pending hai" -> Specific unpaid bills of that company only.
 * 3. "Is month ke saare pending bills [firm] ke" -> Filtered strictly by that Month, that Firm, and only unpaid bills.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, getDoc, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

export type EnterpriseType = 'Vithal' | 'RV' | 'Both';

export interface AssistantResponse {
  text: string;
  buttons?: Array<Array<{ text: string; callback_data: string }>>;
}

interface CompanySummary {
  id: string;
  name: string;
  address?: string;
  gstin?: string;
  kindAttn?: string;
  contactNumber?: string;
}

// In-memory cache for fast lookups
const verifiedAdminChatIds = new Set<string>();
const userActiveFirmMap = new Map<string, EnterpriseType>();
const chatRecentChoices = new Map<string, string[]>();
const awaitingFirmSelection = new Set<string>();
let cachedGeminiKey: string | null = null;

export const ADMIN_SECRET_CODE = '2028';

/**
 * Format currency in Indian format.
 */
function formatInr(num: number): string {
  return Math.round(num || 0).toLocaleString('en-IN');
}

/**
 * Format date readable (e.g. 15 Jun 2026).
 */
function formatDateReadable(dateStr: string): string {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/**
 * Clean word check with boundary.
 */
function hasWord(text: string, word: string): boolean {
  const cleanWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${cleanWord}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(text);
}

/**
 * Fuzzy similarity between two strings (0.0 to 1.0).
 */
function stringSimilarity(s1: string, s2: string): number {
  const str1 = s1.toLowerCase().trim();
  const str2 = s2.toLowerCase().trim();
  if (str1 === str2) return 1.0;
  if (str1.includes(str2) || str2.includes(str1)) return 0.85;

  const pairs1 = getBigrams(str1);
  const pairs2 = getBigrams(str2);
  const union = pairs1.length + pairs2.length;
  if (union === 0) return 0;

  let hits = 0;
  for (const p1 of pairs1) {
    if (pairs2.includes(p1)) hits++;
  }
  return (2.0 * hits) / union;
}

function getBigrams(str: string): string[] {
  const s = str.replace(/\s+/g, '');
  const bigrams: string[] = [];
  for (let i = 0; i < s.length - 1; i++) {
    bigrams.push(s.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Extract firm mentioned in natural query string (e.g. "Vithal ke bills", "RV ka balance").
 */
export function extractFirmFromQuery(queryStr: string, fallback: EnterpriseType): EnterpriseType {
  const lower = queryStr.toLowerCase();
  if (lower.includes('vithal') && !lower.includes('rv') && !lower.includes('both')) {
    return 'Vithal';
  }
  if ((lower.includes('rv') || lower.includes('r.v') || lower.includes('r v')) && !lower.includes('vithal')) {
    return 'RV';
  }
  if (lower.includes('both') || (lower.includes('vithal') && (lower.includes('rv') || lower.includes('r.v')))) {
    return 'Both';
  }
  return fallback;
}

/**
 * Month Parser: Understands relative and named months.
 */
export function extractTargetMonth(text: string): { monthKey: string; monthLabel: string } | null {
  const lower = text.toLowerCase();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth();

  if (
    lower.includes('last month') ||
    lower.includes('previous month') ||
    lower.includes('prev month') ||
    lower.includes('pichle mahine') ||
    lower.includes('pichla mahina') ||
    lower.includes('last mo')
  ) {
    const prevDate = new Date(currentYear, currentMonthIdx - 1, 1);
    const y = prevDate.getFullYear();
    const m = String(prevDate.getMonth() + 1).padStart(2, '0');
    const label = prevDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return { monthKey: `${y}-${m}`, monthLabel: label };
  }

  if (
    lower.includes('this month') ||
    lower.includes('current month') ||
    lower.includes('is mahine') ||
    lower.includes('is month') ||
    lower.includes('ye mahina') ||
    lower.includes('present month')
  ) {
    const y = currentYear;
    const m = String(currentMonthIdx + 1).padStart(2, '0');
    const label = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    return { monthKey: `${y}-${m}`, monthLabel: label };
  }

  const monthNames: Record<string, number> = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'september': 9, 'sept': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12,
  };

  for (const [mName, mNum] of Object.entries(monthNames)) {
    if (hasWord(lower, mName) || lower.includes(`${mName} month`) || lower.includes(`${mName} bill`) || lower.includes(`${mName} pending`)) {
      const mStr = String(mNum).padStart(2, '0');
      const y = (mNum > currentMonthIdx + 1) ? (currentYear - 1) : currentYear;
      const d = new Date(y, mNum - 1, 1);
      const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
      return { monthKey: `${y}-${mStr}`, monthLabel: label };
    }
  }

  return null;
}

/**
 * Get Firestore instance with authenticated server session.
 */
export async function getAuthenticatedFirestore() {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  if (!auth.currentUser) {
    try {
      await signInAnonymously(auth);
    } catch (e) {
      console.warn('Anonymous sign-in warning:', e);
    }
  }
  return getFirestore(app);
}

/**
 * Check if the given chatId is an authorized Admin.
 */
export async function isTelegramAdmin(chatId: string): Promise<boolean> {
  if (verifiedAdminChatIds.has(chatId)) return true;

  try {
    const firestore = await getAuthenticatedFirestore();
    const adminDoc = await getDoc(doc(firestore, 'telegramAdmins', chatId));
    if (adminDoc.exists()) {
      verifiedAdminChatIds.add(chatId);
      const data = adminDoc.data();
      if (data?.activeFirm) {
        userActiveFirmMap.set(chatId, data.activeFirm);
      }
      return true;
    }

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
 * Get active firm preference (Defaults to 'Both').
 */
export async function getUserActiveFirm(chatId: string): Promise<EnterpriseType> {
  if (userActiveFirmMap.has(chatId)) {
    return userActiveFirmMap.get(chatId)!;
  }

  try {
    const firestore = await getAuthenticatedFirestore();
    const adminDoc = await getDoc(doc(firestore, 'telegramAdmins', chatId));
    if (adminDoc.exists() && adminDoc.data()?.activeFirm) {
      const firm = adminDoc.data().activeFirm as EnterpriseType;
      userActiveFirmMap.set(chatId, firm);
      return firm;
    }
  } catch (err) {
    console.error('Fetch user firm error:', err);
  }

  return 'Both';
}

/**
 * Set active firm preference permanently.
 */
export async function setUserActiveFirm(chatId: string, firm: EnterpriseType): Promise<AssistantResponse> {
  userActiveFirmMap.set(chatId, firm);
  awaitingFirmSelection.delete(chatId);

  try {
    const firestore = await getAuthenticatedFirestore();
    await setDoc(doc(firestore, 'telegramAdmins', chatId), {
      chatId,
      activeFirm: firm,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch (err) {
    console.error('Save active firm error:', err);
  }

  const label = firm === 'Vithal' 
    ? '🏭 VITHAL ENTERPRISES' 
    : firm === 'RV' 
      ? '🏢 R.V ENTERPRISES' 
      : '🌐 BOTH FIRMS (Vithal + RV)';

  let msg = `✅ *Active Firm Updated:*\n*${label}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Ab saare bills, fleet aur revenue reports **${label}** ke hisaab se aayenge.\n\n`;
  msg += `_Firm change karne ke liye neeche button tap karein:_`;

  return {
    text: msg,
    buttons: renderFirmRadioButtons(firm),
  };
}

/**
 * Renders the interactive radio button keyboard for firm selection.
 */
export function renderFirmRadioButtons(currentFirm: EnterpriseType): Array<Array<{ text: string; callback_data: string }>> {
  return [
    [
      {
        text: currentFirm === 'Vithal' ? '🔘 Vithal Enterprises' : '⚪ Vithal Enterprises',
        callback_data: 'firm:Vithal',
      },
      {
        text: currentFirm === 'RV' ? '🔘 R.V Enterprises' : '⚪ R.V Enterprises',
        callback_data: 'firm:RV',
      },
    ],
    [
      {
        text: currentFirm === 'Both' ? '🔘 Both (Vithal + RV Combined)' : '⚪ Both (Vithal + RV Combined)',
        callback_data: 'firm:Both',
      },
    ],
  ];
}

/**
 * Renders the Firm Selection Menu with interactive Radio Buttons.
 */
export async function renderFirmSelectionMenu(chatId: string): Promise<AssistantResponse> {
  awaitingFirmSelection.add(chatId);
  const currentFirm = await getUserActiveFirm(chatId);

  let msg = `🏢 *SELECT ACTIVE FIRM / ENTERPRISE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Kripya apni active firm select karein:\n\n`;
  msg += `• *Vithal Enterprises:* Sirf Vithal ke bills aur fleet\n`;
  msg += `• *R.V Enterprises:* Sirf RV ke bills aur fleet\n`;
  msg += `• *Both Firms:* Vithal aur RV dono ka alag-alag breakdown\n\n`;
  msg += `👇 *Tap a button below to select:*`;

  return {
    text: msg,
    buttons: renderFirmRadioButtons(currentFirm),
  };
}

/**
 * Register a chatId as Admin.
 */
export async function registerTelegramAdmin(chatId: string, secretOrEmail: string): Promise<boolean> {
  const input = (secretOrEmail || '').toLowerCase().trim();
  const superAdminEmail = (process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAIL || '').toLowerCase().trim();
  
  const isMatch = input === ADMIN_SECRET_CODE || input.includes(ADMIN_SECRET_CODE) || (superAdminEmail && input === superAdminEmail);

  if (!isMatch) return false;

  verifiedAdminChatIds.add(chatId);

  try {
    const firestore = await getAuthenticatedFirestore();
    await setDoc(doc(firestore, 'telegramAdmins', chatId), {
      chatId,
      passcode: ADMIN_SECRET_CODE,
      activeFirm: 'Both',
      registeredAt: new Date().toISOString(),
      role: 'super_admin',
    }, { merge: true });
  } catch (err) {
    console.error('Firestore admin save error:', err);
  }

  return true;
}

/**
 * Save Gemini API Key directly to Firestore.
 */
export async function saveGeminiApiKey(apiKey: string): Promise<boolean> {
  try {
    const firestore = await getAuthenticatedFirestore();
    cachedGeminiKey = apiKey.trim();
    await setDoc(doc(firestore, 'companySettings', 'telegram'), {
      geminiApiKey: cachedGeminiKey,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return true;
  } catch (err) {
    console.error('Error saving Gemini API key:', err);
    return false;
  }
}

/**
 * Fetch Gemini API Key from environment or Firestore.
 */
export async function getGeminiApiKey(): Promise<string | null> {
  if (cachedGeminiKey) return cachedGeminiKey;
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
  if (process.env.NEXT_PUBLIC_GEMINI_API_KEY) return process.env.NEXT_PUBLIC_GEMINI_API_KEY;

  try {
    const firestore = await getAuthenticatedFirestore();
    const [telegramSnap, aiSnap] = await Promise.all([
      getDoc(doc(firestore, 'companySettings', 'telegram')),
      getDoc(doc(firestore, 'companySettings', 'ai'))
    ]);

    if (telegramSnap.exists() && telegramSnap.data()?.geminiApiKey) {
      cachedGeminiKey = telegramSnap.data().geminiApiKey;
      return cachedGeminiKey;
    }
    if (aiSnap.exists() && aiSnap.data()?.geminiApiKey) {
      cachedGeminiKey = aiSnap.data().geminiApiKey;
      return cachedGeminiKey;
    }
  } catch (err) {
    console.error('Error reading Gemini API key from Firestore:', err);
  }

  return null;
}

/**
 * Top Pending Outstanding Balances across all companies.
 */
export async function getTopPendingBalances(activeFirm: EnterpriseType = 'Both'): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const [companiesSnap, invoicesSnap, paymentsSnap] = await Promise.all([
    getDocs(collection(firestore, 'companies')),
    getDocs(collection(firestore, 'invoices')),
    getDocs(collection(firestore, 'payments')),
  ]);

  const companyMap = new Map<string, string>();
  companiesSnap.docs.forEach(d => {
    companyMap.set(d.id, String(d.data().name || 'Unknown Company'));
  });

  const invoiceBalanceMap: Record<string, { companyId: string; enterprise: string; billed: number; received: number }> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    invoiceBalanceMap[d.id] = {
      companyId: inv.companyId,
      enterprise: ent,
      billed: Number(inv.grandTotal || 0),
      received: 0,
    };
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId && invoiceBalanceMap[pay.invoiceId]) {
      const rec = Number(pay.receivedAmount || 0);
      const tds = Number(pay.tdsDeducted || 0);
      const oth = Number(pay.otherDeductions || 0);
      invoiceBalanceMap[pay.invoiceId].received += (rec + tds + oth);
    }
  });

  const companyDueMap = new Map<string, { name: string; billed: number; received: number; due: number }>();

  Object.values(invoiceBalanceMap).forEach(inv => {
    const compName = companyMap.get(inv.companyId) || 'Unknown Company';
    const due = Math.max(0, inv.billed - inv.received);
    const existing = companyDueMap.get(inv.companyId) || { name: compName, billed: 0, received: 0, due: 0 };
    existing.billed += inv.billed;
    existing.received += inv.received;
    existing.due += due;
    companyDueMap.set(inv.companyId, existing);
  });

  const sortedDebtors = Array.from(companyDueMap.values())
    .filter(c => c.due > 1)
    .sort((a, b) => b.due - a.due);

  const totalOutstanding = sortedDebtors.reduce((s, c) => s + c.due, 0);
  const firmLabel = activeFirm === 'Both' ? 'Vithal & R.V Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  let msg = `⚠️ *TOP OUTSTANDING DUE RANKING*\n`;
  msg += `🏢 Firm Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💎 *Total Market Outstanding:* *₹ ${formatInr(totalOutstanding)}*\n`;
  msg += `👥 *Companies with Pending Balance:* *${sortedDebtors.length} Clients*\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 *TOP PENDING CLIENTS:*\n\n`;

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  sortedDebtors.slice(0, 10).forEach((c, idx) => {
    msg += `${idx + 1}️⃣ *${c.name}*\n`;
    msg += `• ⚠️ Pending Due: *₹ ${formatInr(c.due)}*\n`;
    msg += `• 💰 Total Billed: ₹ ${formatInr(c.billed)} | Received: ₹ ${formatInr(c.received)}\n\n`;

    if (idx < 5) {
      buttons.push([
        {
          text: `🏢 ${c.name.slice(0, 24)}... (Due ₹${formatInr(c.due)})`,
          callback_data: `comp_select:${c.name}`,
        },
      ]);
    }
  });

  if (sortedDebtors.length > 10) {
    msg += `_...and ${sortedDebtors.length - 10} more clients with smaller pending amounts._\n\n`;
  }

  msg += `👉 *Tap any client button below for complete bill details:*`;

  return {
    text: msg.trim(),
    buttons,
  };
}

/**
 * Query company details formatted with clean bullet points and line breaks.
 * Handles:
 * - 'count_pending': Only prints the count of pending bills & total due numbers!
 * - 'pending_list': Only prints the list of unpaid invoices for that company!
 * - 'pending': Outstanding financial summary card.
 * - 'bills': Full detailed breakdown of all invoices.
 */
export async function getCompanyDetailByIntent(
  companyName: string, 
  intent: 'count_pending' | 'pending' | 'pending_list' | 'bills' | 'forklifts' | 'all' = 'all',
  activeFirm: EnterpriseType = 'Both',
  targetMonth?: { monthKey: string; monthLabel: string } | null
): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const companiesSnap = await getDocs(collection(firestore, 'companies'));

  const matchedCompanyDoc = companiesSnap.docs.find(d => {
    const name = String(d.data().name || '').toLowerCase().trim();
    return name === companyName.toLowerCase().trim();
  });

  if (!matchedCompanyDoc) {
    return { text: `❌ *Company "${companyName}" Not Found*\n\nType *"all companies"* to see all registered clients.` };
  }

  const company = matchedCompanyDoc.data() as CompanySummary;
  const companyId = matchedCompanyDoc.id;

  // ─── 1. FORKLIFTS INTENT ─────────────────────────────────────────────────
  if (intent === 'forklifts') {
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    let companyForklifts = forkliftsSnap.docs
      .map(d => d.data())
      .filter(f => {
        const site = String(f.siteCompany || '').toLowerCase();
        return site.includes(company.name.toLowerCase()) || company.name.toLowerCase().includes(site);
      });

    if (activeFirm !== 'Both') {
      companyForklifts = companyForklifts.filter(f => (f.firm || 'Vithal') === activeFirm);
    }

    const firmTag = activeFirm === 'Both' ? 'Vithal & RV' : activeFirm;
    let msg = `🚜 *FORKLIFTS AT ${company.name.toUpperCase()}*\n`;
    msg += `🏢 Firm Scope: *${firmTag}* (${companyForklifts.length} Units)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (companyForklifts.length === 0) {
      msg += `_No forklifts currently deployed for ${activeFirm} at this client site._\n`;
    } else {
      companyForklifts.forEach((f, idx) => {
        const firm = (f.firm || 'Vithal') === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        msg += `${idx + 1}️⃣ *Serial #${f.serialNumber}* (${firm})\n`;
        msg += `• 🚜 Model: *${f.make || ''} ${f.model || ''}*\n`;
        msg += `• ⚡ Capacity: *${f.capacity || 'N/A'}*\n`;
        if (f.siteArea) msg += `• 📍 Site Area: *${f.siteArea}*\n`;
        if (f.siteContactPerson) msg += `• 👤 Contact: *${f.siteContactPerson}* (${f.siteContactNumber || ''})\n`;
        msg += `\n`;
      });
    }

    return {
      text: msg.trim(),
      buttons: [
        [
          { text: '💰 View Pending Bills', callback_data: `comp_pend:${company.name}` },
          { text: '📄 All Invoices', callback_data: `comp_bills:${company.name}` },
        ],
        [
          { text: '🔄 Change Firm', callback_data: 'menu:firm' },
        ],
      ],
    };
  }

  // ─── 2. INVOICES & PAYMENTS ──────────────────────────────────────────────
  const invoicesQuery = query(collection(firestore, 'invoices'), where('companyId', '==', companyId));
  const [invoicesSnap, paymentsSnap] = await Promise.all([
    getDocs(invoicesQuery),
    getDocs(query(collection(firestore, 'payments'), where('companyId', '==', companyId)))
  ]);

  if (invoicesSnap.empty) {
    let msg = `🏢 *${company.name.toUpperCase()}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `📌 *Status:* No invoices recorded yet in dashboard.\n`;
    if (company.gstin) msg += `• 🔖 GSTIN: \`${company.gstin}\`\n`;
    if (company.kindAttn) msg += `• 👤 Attn: *${company.kindAttn}*\n`;
    if (company.contactNumber) msg += `• 📞 Phone: *${company.contactNumber}*\n`;
    return { text: msg };
  }

  interface DetailedInvoice {
    id: string;
    billNo: number | string;
    date: string;
    billingMonth: string;
    enterprise: string;
    netTotal: number;
    gstAmount: number;
    grandTotal: number;
    received: number;
    tds: number;
    otherDeductions: number;
    due: number;
  }

  const invoiceMap: Record<string, DetailedInvoice> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const enterprise = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    
    if (activeFirm !== 'Both' && enterprise !== activeFirm) {
      return;
    }

    const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');

    if (targetMonth && bMonth && bMonth !== targetMonth.monthKey) {
      return;
    }

    const grandTotal = Number(inv.grandTotal || 0);
    const netTotal = Number(inv.netTotal || (grandTotal > 0 ? (grandTotal / 1.18) : 0));
    const gstAmount = Math.max(0, grandTotal - netTotal);

    invoiceMap[d.id] = {
      id: d.id,
      billNo: inv.billNo || 'N/A',
      date: inv.billDate || inv.billingMonth || '',
      billingMonth: bMonth,
      enterprise,
      netTotal,
      gstAmount,
      grandTotal,
      received: 0,
      tds: 0,
      otherDeductions: 0,
      due: grandTotal,
    };
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId && invoiceMap[pay.invoiceId]) {
      const rec = Number(pay.receivedAmount || 0);
      const tds = Number(pay.tdsDeducted || 0);
      const oth = Number(pay.otherDeductions || 0);
      invoiceMap[pay.invoiceId].received += rec;
      invoiceMap[pay.invoiceId].tds += tds;
      invoiceMap[pay.invoiceId].otherDeductions += oth;
      invoiceMap[pay.invoiceId].due = Math.max(0, invoiceMap[pay.invoiceId].grandTotal - (invoiceMap[pay.invoiceId].received + invoiceMap[pay.invoiceId].tds + invoiceMap[pay.invoiceId].otherDeductions));
    }
  });

  const filteredInvoices = Object.values(invoiceMap);

  if (filteredInvoices.length === 0) {
    const monthText = targetMonth ? `for *${targetMonth.monthLabel}*` : '';
    return {
      text: `🏢 *${company.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n\n📌 No invoices found ${monthText} under *${activeFirm === 'Both' ? 'Vithal / RV' : activeFirm}*.`,
      buttons: [[{ text: '🌐 View All Months / Both Firms', callback_data: 'firm:Both' }]],
    };
  }

  filteredInvoices.sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    if (timeA && timeB && timeA !== timeB) {
      return timeA - timeB;
    }
    const billA = parseInt(String(a.billNo), 10) || 0;
    const billB = parseInt(String(b.billNo), 10) || 0;
    return billA - billB;
  });

  const unpaidInvoices = filteredInvoices.filter(inv => inv.due > 1);

  const totalBilled = filteredInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalBasic = filteredInvoices.reduce((s, i) => s + i.netTotal, 0);
  const totalGst = filteredInvoices.reduce((s, i) => s + i.gstAmount, 0);
  const totalReceived = filteredInvoices.reduce((s, i) => s + i.received, 0);
  const totalTds = filteredInvoices.reduce((s, i) => s + i.tds, 0);
  const totalOtherDed = filteredInvoices.reduce((s, i) => s + i.otherDeductions, 0);
  const totalDue = Math.max(0, totalBilled - (totalReceived + totalTds + totalOtherDed));

  const vithalInvoices = filteredInvoices.filter(i => i.enterprise === 'Vithal');
  const rvInvoices = filteredInvoices.filter(i => i.enterprise === 'RV');

  const vithalUnpaid = unpaidInvoices.filter(i => i.enterprise === 'Vithal');
  const rvUnpaid = unpaidInvoices.filter(i => i.enterprise === 'RV');

  const vithalTotal = vithalInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const vithalDue = vithalInvoices.reduce((s, i) => s + i.due, 0);

  const rvTotal = rvInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const rvDue = rvInvoices.reduce((s, i) => s + i.due, 0);

  const firmHeader = activeFirm === 'Both' ? 'Vithal & R.V Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
  const monthHeader = targetMonth ? `📅 Period: *${targetMonth.monthLabel}*\n` : '';

  // ─── 3. USER ASKED FOR COUNT OF PENDING BILLS ("kitne bills pending hai") ──
  if (intent === 'count_pending') {
    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `🏢 Firm Scope: *${firmHeader}*\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (unpaidInvoices.length === 0) {
      text += `✨ *Total Pending Bills: 0 (Zero)* 🎉\n`;
      text += `• Is company ke saare bills fully clear & settled hain!\n\n`;
    } else {
      text += `📊 *PENDING BILLS COUNT: ${unpaidInvoices.length} INVOICES*\n`;
      text += `⚠️ *Total Outstanding Balance: ₹ ${formatInr(totalDue)}*\n\n`;

      if (activeFirm === 'Both') {
        const firmLines: string[] = [];
        if (vithalUnpaid.length > 0 || vithalDue > 0) {
          firmLines.push(`• 🏭 Vithal Enterprises: *${vithalUnpaid.length} Bills Pending* (Due ₹ ${formatInr(vithalDue)})`);
        }
        if (rvUnpaid.length > 0 || rvDue > 0) {
          firmLines.push(`• 🏢 R.V Enterprises: *${rvUnpaid.length} Bills Pending* (Due ₹ ${formatInr(rvDue)})`);
        }
        if (firmLines.length > 0) {
          text += `💰 *Firm Breakdown:*\n${firmLines.join('\n')}\n\n`;
        }
      }
    }

    text += `💎 *Overall:* Total Invoiced ₹ ${formatInr(totalBilled)} | Received ₹ ${formatInr(totalReceived)}\n\n`;
    text += `👉 _Agar bills dekhna chahte hain toh neeche button tap karein:_`;

    return {
      text: text.trim(),
      buttons: [
        [
          { text: `📋 Kaun Se Bills Pending Hai (${unpaidInvoices.length})`, callback_data: `comp_pendlist:${company.name}` },
          { text: '📄 All Invoices', callback_data: `comp_bills:${company.name}` },
        ],
        [
          { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
          { text: '🔄 Change Firm', callback_data: 'menu:firm' },
        ],
      ],
    };
  }

  // ─── 4. USER ASKED WHICH SPECIFIC BILLS ARE PENDING ("konse pending hai") ─
  if (intent === 'pending_list') {
    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `📋 *PENDING UNPAID BILLS (${unpaidInvoices.length})*\n`;
    text += `🏢 Scope: *${firmHeader}*\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (unpaidInvoices.length === 0) {
      text += `✨ *No pending bills! All invoices are fully paid.* 🎉\n\n`;
    } else {
      unpaidInvoices.forEach((inv, idx) => {
        const firm = inv.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        const isPartial = inv.received > 0;
        const statusTag = isPartial ? `🟡 PARTIALLY PAID (Due ₹ ${formatInr(inv.due)})` : `⏳ UNPAID (Due ₹ ${formatInr(inv.due)})`;

        text += `${idx + 1}️⃣ *Bill #${inv.billNo}* (${firm})\n`;
        text += `• 📅 Date: *${formatDateReadable(inv.date)}*\n`;
        text += `• 📊 Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
        text += `• 💰 Received: *₹ ${formatInr(inv.received)}*`;
        if (inv.tds > 0) text += ` (TDS: ₹ ${formatInr(inv.tds)})`;
        text += `\n`;
        text += `• ⚠️ Pending Due: *₹ ${formatInr(inv.due)}*\n`;
        text += `• 🏁 Status: *${statusTag}*\n\n`;
      });

      text += `━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `⚠️ *Total Outstanding Balance:* *₹ ${formatInr(totalDue)}*\n\n`;
    }

    if (company.contactNumber || company.kindAttn) {
      text += `📞 *Contact:* ${company.kindAttn || 'N/A'}`;
      if (company.contactNumber) text += ` (\`${company.contactNumber}\`)`;
      text += `\n`;
    }

    return {
      text: text.trim(),
      buttons: [
        [
          { text: '📄 View All Invoices', callback_data: `comp_bills:${company.name}` },
          { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
        ],
        [
          { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
        ],
      ],
    };
  }

  // ─── 5. USER ASKED FOR PENDING DUE / BALANCE SUMMARY ─────────────────────
  if (intent === 'pending') {
    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `🏢 Firm Scope: *${firmHeader}*\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `⚠️ *TOTAL OUTSTANDING DUE: ₹ ${formatInr(totalDue)}*\n\n`;

    text += `💰 *FINANCIAL OVERVIEW:*\n`;
    text += `• 💎 Total Invoiced: *₹ ${formatInr(totalBilled)}* (${filteredInvoices.length} Bills)\n`;
    text += `• ✅ Total Received: *₹ ${formatInr(totalReceived)}*\n`;
    if (totalTds > 0) {
      text += `• 📑 Total TDS Deducted: *₹ ${formatInr(totalTds)}*\n`;
    }
    if (totalOtherDed > 0) {
      text += `• 🔻 Other Deductions: *₹ ${formatInr(totalOtherDed)}*\n`;
    }
    text += `• 📋 Pending Unpaid Bills: *${unpaidInvoices.length} Invoices*\n\n`;

    if (activeFirm === 'Both') {
      const firmLines: string[] = [];
      if (vithalDue > 0 || vithalTotal > 0) {
        firmLines.push(`• 🏭 *Vithal Enterprises:* Billed ₹ ${formatInr(vithalTotal)} | *Due: ₹ ${formatInr(vithalDue)}*`);
      }
      if (rvDue > 0 || rvTotal > 0) {
        firmLines.push(`• 🏢 *R.V Enterprises:* Billed ₹ ${formatInr(rvTotal)} | *Due: ₹ ${formatInr(rvDue)}*`);
      }
      if (firmLines.length > 0) {
        text += `🏭 *ENTERPRISE BREAKDOWN:*\n${firmLines.join('\n')}\n\n`;
      }
    }

    if (company.contactNumber || company.kindAttn) {
      text += `━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `📞 *Contact Person:* ${company.kindAttn || 'N/A'}\n`;
      if (company.contactNumber) text += `📱 *Phone:* \`${company.contactNumber}\`\n`;
    }

    return {
      text: text.trim(),
      buttons: [
        [
          { text: `📋 Kaun Se Bills Pending Hai (${unpaidInvoices.length})`, callback_data: `comp_pendlist:${company.name}` },
          { text: '📄 All Invoices', callback_data: `comp_bills:${company.name}` },
        ],
        [
          { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
          { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
        ],
      ],
    };
  }

  // ─── 6. BILLS / FULL INVOICE BREAKDOWN VIEW ──────────────────────────────
  let text = `🏢 *${company.name.toUpperCase()}*\n`;
  text += `🏢 Firm Scope: *${firmHeader}*\n`;
  if (monthHeader) text += monthHeader;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  text += `💰 *FINANCIAL SUMMARY:*\n`;
  if (activeFirm === 'Both') {
    const firmLines: string[] = [];
    if (vithalTotal > 0 || vithalDue > 0) {
      firmLines.push(`• 🏭 *Vithal Enterprises:* Billed ₹ ${formatInr(vithalTotal)} | *Due: ₹ ${formatInr(vithalDue)}*`);
    }
    if (rvTotal > 0 || rvDue > 0) {
      firmLines.push(`• 🏢 *R.V Enterprises:* Billed ₹ ${formatInr(rvTotal)} | *Due: ₹ ${formatInr(rvDue)}*`);
    }
    if (firmLines.length > 0) {
      text += `${firmLines.join('\n')}\n`;
    }
  }
  text += `• 💵 *Total Basic / Taxable:* *₹ ${formatInr(totalBasic)}*\n`;
  text += `• 🔖 *Total GST (CGST+SGST):* *₹ ${formatInr(totalGst)}*\n`;
  text += `• 💎 *Total Grand Invoiced:* *₹ ${formatInr(totalBilled)}* (${filteredInvoices.length} Bills)\n`;
  text += `• ✅ *Total Received:* *₹ ${formatInr(totalReceived)}*\n`;
  if (totalTds > 0) {
    text += `• 📑 *Total TDS Deducted:* *₹ ${formatInr(totalTds)}*\n`;
  }
  if (totalOtherDed > 0) {
    text += `• 🔻 *Other Deductions:* *₹ ${formatInr(totalOtherDed)}*\n`;
  }
  text += `• ⚠️ *TOTAL OUTSTANDING DUE:* *₹ ${formatInr(totalDue)}*\n\n`;

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;

  const displayInvoices = filteredInvoices;
  const sectionTitle = `📄 *DETAILED BILLS BREAKDOWN (${filteredInvoices.length}):*`;

  text += `${sectionTitle}\n\n`;

  if (displayInvoices.length === 0) {
    text += `✨ *All invoices for ${firmHeader} are fully settled!* 🎉\n\n`;
  } else {
    displayInvoices.forEach((inv, idx) => {
      const firm = inv.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
      const isPaid = inv.due <= 1;
      const isPartial = !isPaid && inv.received > 0;
      const statusTag = isPaid ? '✅ PAID' : isPartial ? `🟡 PARTIALLY PAID (Due ₹ ${formatInr(inv.due)})` : `⏳ UNPAID (Due ₹ ${formatInr(inv.due)})`;

      text += `${idx + 1}️⃣ *Bill #${inv.billNo}* (${firm})\n`;
      text += `• 📅 Date: *${formatDateReadable(inv.date)}*\n`;
      text += `• 💵 Basic Amount: *₹ ${formatInr(inv.netTotal)}*\n`;
      if (inv.gstAmount > 0) {
        text += `• 🔖 GST: *₹ ${formatInr(inv.gstAmount)}*\n`;
      }
      text += `• 📊 Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
      text += `• 💰 Received: *₹ ${formatInr(inv.received)}*\n`;
      if (inv.tds > 0) {
        text += `• 📑 TDS Deducted: *₹ ${formatInr(inv.tds)}*\n`;
      }
      text += `• ⚠️ Outstanding Due: *₹ ${formatInr(inv.due)}*\n`;
      text += `• 🏁 Status: *${statusTag}*\n\n`;
    });
  }

  if (company.contactNumber || company.kindAttn) {
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📞 *Contact Person:* ${company.kindAttn || 'N/A'}\n`;
    if (company.contactNumber) text += `📱 *Phone:* \`${company.contactNumber}\`\n`;
  }

  return {
    text: text.trim(),
    buttons: [
      [
        { text: '⚠️ View Due Summary', callback_data: `comp_pend:${company.name}` },
        { text: `📋 Only Pending Bills (${unpaidInvoices.length})`, callback_data: `comp_pendlist:${company.name}` },
      ],
      [
        { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
        { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
      ],
    ],
  };
}

/**
 * Get fleet status in clean bullet points with line breaks.
 */
export async function getFleetStatus(locationFilter?: 'Workshop' | 'On-Site', activeFirm: EnterpriseType = 'Both'): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'forklifts'));

  if (snap.empty) {
    return { text: '🚜 *No forklifts found in the database.*' };
  }

  let all = snap.docs.map(d => d.data());
  if (activeFirm !== 'Both') {
    all = all.filter(f => (f.firm || 'Vithal') === activeFirm);
  }

  const workshop = all.filter(f => f.locationType === 'Workshop');
  const onSite = all.filter(f => f.locationType === 'On-Site');
  const notConfirmed = all.filter(f => f.locationType === 'Not Confirm');
  const firmLabel = activeFirm === 'Both' ? 'Vithal & RV Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  if (locationFilter === 'Workshop') {
    let msg = `🏭 *WORKSHOP IDLE FORKLIFTS (${workshop.length})*\n`;
    msg += `🏢 Scope: *${firmLabel}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (workshop.length === 0) {
      msg += `_No forklifts currently idle in workshop for ${activeFirm}._\n`;
    } else {
      workshop.forEach((f, idx) => {
        const firm = (f.firm || 'Vithal') === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        msg += `${idx + 1}️⃣ *Serial #${f.serialNumber}* (${firm})\n`;
        msg += `• 🚜 Model: *${f.make || ''} ${f.model || ''}*\n`;
        msg += `• ⚡ Capacity: *${f.capacity || 'N/A'}*\n`;
        msg += `• 📍 Location: *Workshop*\n\n`;
      });
    }

    return {
      text: msg.trim(),
      buttons: [
        [
          { text: '📍 On-Site Units', callback_data: 'quick:onsite' },
          { text: '🚜 Full Fleet', callback_data: 'quick:fleet' },
        ],
      ],
    };
  }

  if (locationFilter === 'On-Site') {
    let msg = `📍 *ON-SITE DEPLOYED FORKLIFTS (${onSite.length})*\n`;
    msg += `🏢 Scope: *${firmLabel}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (onSite.length === 0) {
      msg += `_No forklifts currently deployed on-site for ${activeFirm}._\n`;
    } else {
      onSite.forEach((f, idx) => {
        const site = f.siteCompany || f.siteArea || 'Client Site';
        const firm = (f.firm || 'Vithal') === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        msg += `${idx + 1}️⃣ *Serial #${f.serialNumber}* (${firm})\n`;
        msg += `• 🏢 Client Site: *${site}*\n`;
        msg += `• ⚡ Capacity: *${f.capacity || 'N/A'}*\n`;
        if (f.siteArea) msg += `• 📍 Area: *${f.siteArea}*\n`;
        msg += `\n`;
      });
    }

    return {
      text: msg.trim(),
      buttons: [
        [
          { text: '🏭 Workshop Units', callback_data: 'quick:workshop' },
          { text: '🚜 Full Fleet', callback_data: 'quick:fleet' },
        ],
      ],
    };
  }

  const utilRate = all.length > 0 ? ((onSite.length / all.length) * 100).toFixed(0) : '0';

  let msg = `🚜 *TOTAL FLEET OVERVIEW*\n`;
  msg += `🏢 Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 *FLEET BREAKDOWN:*\n`;
  msg += `• 🚜 Total Fleet: *${all.length} Units*\n`;
  msg += `• 🟢 On-Site (Deployed): *${onSite.length} Units*\n`;
  msg += `• 🟠 Workshop (Idle): *${workshop.length} Units*\n`;
  if (notConfirmed.length > 0) {
    msg += `• 🔴 Unconfirmed: *${notConfirmed.length} Units*\n`;
  }
  msg += `• 📈 Fleet Utilization: *${utilRate}%*\n\n`;

  msg += `_Tap a button below to view detailed lists:_`;

  return {
    text: msg.trim(),
    buttons: [
      [
        { text: '🏭 Workshop Units', callback_data: 'quick:workshop' },
        { text: '📍 On-Site Units', callback_data: 'quick:onsite' },
      ],
      [
        { text: '🔄 Change Firm', callback_data: 'menu:firm' },
      ],
    ],
  };
}

/**
 * Search a specific forklift by serial number or name.
 */
export async function getForkliftDetail(serialQuery: string): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'forklifts'));
  const searchLower = serialQuery.toLowerCase().trim();

  const matched = snap.docs.find(d => {
    const sn = String(d.data().serialNumber || '').toLowerCase().trim();
    return sn === searchLower || sn.includes(searchLower);
  });

  if (!matched) {
    return { text: `🚜 *Forklift not found*\nCould not find forklift matching "${serialQuery}".` };
  }

  const f = matched.data();
  const firm = (f.firm || 'Vithal') === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  let msg = `🚜 *FORKLIFT DETAILS: #${f.serialNumber}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `• 🏭 Firm: *${firm}*\n`;
  msg += `• 🚜 Make / Model: *${f.make || ''} ${f.model || ''}*\n`;
  msg += `• ⚡ Capacity: *${f.capacity || 'N/A'}*\n`;
  msg += `• 📍 Location: *${f.locationType || 'N/A'}*\n`;
  if (f.locationType === 'On-Site') {
    msg += `• 🏢 Client Site: *${f.siteCompany || 'N/A'}*\n`;
    if (f.siteArea) msg += `• 📍 Area: *${f.siteArea}*\n`;
    if (f.siteContactPerson) msg += `• 👤 Contact: *${f.siteContactPerson}* (${f.siteContactNumber || ''})\n`;
  }
  if (f.remarks) msg += `• 📝 Remarks: _${f.remarks}_\n`;

  return { text: msg.trim() };
}

/**
 * Get today's attendance summary in clean bullet points.
 */
export async function getTodayAttendanceSummary(): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const today = new Date().toISOString().split('T')[0];

  const empSnap = await getDocs(collection(firestore, 'employees'));
  const attSnap = await getDocs(query(collection(firestore, 'attendance'), where('date', '==', today)));

  const empMap: Record<string, string> = {};
  empSnap.docs.forEach(d => {
    empMap[d.id] = d.data().fullName || 'Employee';
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

  let msg = `📅 *ATTENDANCE TODAY (${formatDateReadable(today)})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `👥 *ATTENDANCE SUMMARY:*\n`;
  msg += `• Total Staff: *${empSnap.size}*\n`;
  msg += `• ✅ Present: *${present.length}*\n`;
  msg += `• ❌ Absent: *${absent.length}*\n`;
  if (halfDay.length > 0) {
    msg += `• ⏳ Half-Day: *${halfDay.length}*\n`;
  }
  msg += `\n`;

  if (absent.length > 0) {
    msg += `❌ *ABSENT STAFF (${absent.length}):*\n`;
    absent.forEach((name, i) => {
      msg += `${i + 1}. *${name}*\n`;
    });
    msg += `\n`;
  }

  if (present.length > 0) {
    msg += `✅ *PRESENT STAFF (${present.length}):*\n`;
    msg += `• ${present.join(', ')}\n`;
  }

  return { text: msg.trim() };
}

/**
 * Get monthly billing summary with month intelligence and FULL list of all invoices for that month.
 */
export async function getMonthlyBillingSummary(
  activeFirm: EnterpriseType = 'Both', 
  targetMonth?: { monthKey: string; monthLabel: string } | null
): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();

  const monthKey = targetMonth ? targetMonth.monthKey : new Date().toISOString().slice(0, 7);
  const monthLabel = targetMonth 
    ? targetMonth.monthLabel 
    : new Date(monthKey + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const [companiesSnap, invoicesSnap, paymentsSnap] = await Promise.all([
    getDocs(collection(firestore, 'companies')),
    getDocs(collection(firestore, 'invoices')),
    getDocs(collection(firestore, 'payments')),
  ]);

  const companyMap = new Map<string, string>();
  companiesSnap.docs.forEach(d => {
    companyMap.set(d.id, String(d.data().name || 'Client Company'));
  });

  interface MonthlyInvoiceItem {
    id: string;
    companyId: string;
    companyName: string;
    billNo: number | string;
    date: string;
    enterprise: string;
    netTotal: number;
    gstAmount: number;
    grandTotal: number;
    received: number;
    tds: number;
    otherDeductions: number;
    due: number;
  }

  const monthInvoicesMap: Record<string, MonthlyInvoiceItem> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');
    if (bMonth === monthKey || (inv.billDate && inv.billDate.startsWith(monthKey))) {
      const grandTotal = Number(inv.grandTotal || 0);
      const netTotal = Number(inv.netTotal || (grandTotal > 0 ? (grandTotal / 1.18) : 0));
      const gstAmount = Math.max(0, grandTotal - netTotal);

      monthInvoicesMap[d.id] = {
        id: d.id,
        companyId: inv.companyId,
        companyName: companyMap.get(inv.companyId) || 'Client Company',
        billNo: inv.billNo || 'N/A',
        date: inv.billDate || inv.billingMonth || '',
        enterprise: ent,
        netTotal,
        gstAmount,
        grandTotal,
        received: 0,
        tds: 0,
        otherDeductions: 0,
        due: grandTotal,
      };
    }
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId && monthInvoicesMap[pay.invoiceId]) {
      const rec = Number(pay.receivedAmount || 0);
      const tds = Number(pay.tdsDeducted || 0);
      const oth = Number(pay.otherDeductions || 0);
      monthInvoicesMap[pay.invoiceId].received += rec;
      monthInvoicesMap[pay.invoiceId].tds += tds;
      monthInvoicesMap[pay.invoiceId].otherDeductions += oth;
      monthInvoicesMap[pay.invoiceId].due = Math.max(0, monthInvoicesMap[pay.invoiceId].grandTotal - (monthInvoicesMap[pay.invoiceId].received + monthInvoicesMap[pay.invoiceId].tds + monthInvoicesMap[pay.invoiceId].otherDeductions));
    }
  });

  const monthInvoices = Object.values(monthInvoicesMap);

  const firmLabel = activeFirm === 'Both' ? 'Vithal & R.V Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  if (monthInvoices.length === 0) {
    return {
      text: `📊 *BILLING STATEMENT - ${monthLabel.toUpperCase()}*\n🏢 Scope: *${firmLabel}*\n━━━━━━━━━━━━━━━━━━━━━\n\n📌 *No invoices were generated in ${monthLabel} for ${firmLabel}.*`,
      buttons: [
        [
          { text: '🌐 Check Both Firms', callback_data: 'firm:Both' },
          { text: '⚠️ Top Pending Overall', callback_data: 'quick:pending' },
        ],
      ],
    };
  }

  // Sort invoices chronologically
  monthInvoices.sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    if (timeA && timeB && timeA !== timeB) return timeA - timeB;
    const billA = parseInt(String(a.billNo), 10) || 0;
    const billB = parseInt(String(b.billNo), 10) || 0;
    return billA - billB;
  });

  const vithalInvoices = monthInvoices.filter(i => i.enterprise === 'Vithal');
  const rvInvoices = monthInvoices.filter(i => i.enterprise === 'RV');

  const totalBilled = monthInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalBasic = monthInvoices.reduce((s, i) => s + i.netTotal, 0);
  const totalGst = monthInvoices.reduce((s, i) => s + i.gstAmount, 0);
  const totalReceived = monthInvoices.reduce((s, i) => s + i.received, 0);
  const totalTds = monthInvoices.reduce((s, i) => s + i.tds, 0);
  const totalOtherDed = monthInvoices.reduce((s, i) => s + i.otherDeductions, 0);
  const totalDue = Math.max(0, totalBilled - (totalReceived + totalTds + totalOtherDed));

  const vithalTotal = vithalInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const vithalDue = vithalInvoices.reduce((s, i) => s + i.due, 0);

  const rvTotal = rvInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const rvDue = rvInvoices.reduce((s, i) => s + i.due, 0);

  let msg = `📊 *BILLING STATEMENT - ${monthLabel.toUpperCase()}*\n`;
  msg += `🏢 Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `💰 *${monthLabel.toUpperCase()} FINANCIAL SUMMARY:*\n`;
  if (activeFirm === 'Both') {
    msg += `• 🏭 *Vithal Enterprises:* Billed ₹ ${formatInr(vithalTotal)} (${vithalInvoices.length} Bills) | *Due: ₹ ${formatInr(vithalDue)}*\n`;
    msg += `• 🏢 *R.V Enterprises:* Billed ₹ ${formatInr(rvTotal)} (${rvInvoices.length} Bills) | *Due: ₹ ${formatInr(rvDue)}*\n`;
  }
  msg += `• 💵 *Total Basic / Taxable:* *₹ ${formatInr(totalBasic)}*\n`;
  msg += `• 🔖 *Total GST (CGST+SGST):* *₹ ${formatInr(totalGst)}*\n`;
  msg += `• 💎 *Total Grand Invoiced:* *₹ ${formatInr(totalBilled)}* (${monthInvoices.length} Bills)\n`;
  msg += `• ✅ *Total Received:* *₹ ${formatInr(totalReceived)}*\n`;
  if (totalTds > 0) {
    msg += `• 📑 *Total TDS Deducted:* *₹ ${formatInr(totalTds)}*\n`;
  }
  if (totalOtherDed > 0) {
    msg += `• 🔻 *Other Deductions:* *₹ ${formatInr(totalOtherDed)}*\n`;
  }
  msg += `• ⚠️ *TOTAL MONTH DUE BALANCE:* *₹ ${formatInr(totalDue)}*\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *ALL INVOICES GENERATED IN ${monthLabel.toUpperCase()} (${monthInvoices.length}):*\n\n`;

  monthInvoices.forEach((inv, idx) => {
    const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    const isPaid = inv.due <= 1;
    const isPartial = !isPaid && inv.received > 0;
    const statusTag = isPaid ? '✅ PAID' : isPartial ? `🟡 PARTIAL (Due ₹ ${formatInr(inv.due)})` : `⏳ DUE ₹ ${formatInr(inv.due)}`;

    msg += `${idx + 1}️⃣ *Bill #${inv.billNo}* • *${inv.companyName}* (${firm})\n`;
    msg += `• 📅 Date: *${formatDateReadable(inv.date)}*\n`;
    msg += `• 💵 Basic: ₹ ${formatInr(inv.netTotal)} | 🔖 GST: ₹ ${formatInr(inv.gstAmount)}\n`;
    msg += `• 📊 Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
    msg += `• 💰 Received: ₹ ${formatInr(inv.received)}`;
    if (inv.tds > 0) msg += ` (TDS: ₹ ${formatInr(inv.tds)})`;
    msg += `\n`;
    msg += `• ⚠️ Outstanding: *₹ ${formatInr(inv.due)}*\n`;
    msg += `• 🏁 Status: *${statusTag}*\n\n`;
  });

  return {
    text: msg.trim(),
    buttons: [
      [
        { text: '⚠️ Only Pending Bills', callback_data: 'quick:month_pending' },
        { text: '⚠️ Top Debtors Overall', callback_data: 'quick:pending' },
      ],
      [
        { text: '🔄 Switch to Vithal', callback_data: 'firm:Vithal' },
        { text: '🔄 Switch to RV', callback_data: 'firm:RV' },
      ],
    ],
  };
}

/**
 * Get pending/unpaid bills strictly filtered by Month and Firm.
 * Answers: "Is month ke saare pending bills Vithal ke", "August ke pending bills RV ke".
 */
export async function getMonthlyPendingBills(
  activeFirm: EnterpriseType = 'Both',
  targetMonth?: { monthKey: string; monthLabel: string } | null
): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();

  const monthKey = targetMonth ? targetMonth.monthKey : new Date().toISOString().slice(0, 7);
  const monthLabel = targetMonth 
    ? targetMonth.monthLabel 
    : new Date(monthKey + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const [companiesSnap, invoicesSnap, paymentsSnap] = await Promise.all([
    getDocs(collection(firestore, 'companies')),
    getDocs(collection(firestore, 'invoices')),
    getDocs(collection(firestore, 'payments')),
  ]);

  const companyMap = new Map<string, string>();
  companiesSnap.docs.forEach(d => {
    companyMap.set(d.id, String(d.data().name || 'Client Company'));
  });

  interface MonthlyInvoiceItem {
    id: string;
    companyId: string;
    companyName: string;
    billNo: number | string;
    date: string;
    enterprise: string;
    netTotal: number;
    gstAmount: number;
    grandTotal: number;
    received: number;
    tds: number;
    otherDeductions: number;
    due: number;
  }

  const monthInvoicesMap: Record<string, MonthlyInvoiceItem> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');
    if (bMonth === monthKey || (inv.billDate && inv.billDate.startsWith(monthKey))) {
      const grandTotal = Number(inv.grandTotal || 0);
      const netTotal = Number(inv.netTotal || (grandTotal > 0 ? (grandTotal / 1.18) : 0));
      const gstAmount = Math.max(0, grandTotal - netTotal);

      monthInvoicesMap[d.id] = {
        id: d.id,
        companyId: inv.companyId,
        companyName: companyMap.get(inv.companyId) || 'Client Company',
        billNo: inv.billNo || 'N/A',
        date: inv.billDate || inv.billingMonth || '',
        enterprise: ent,
        netTotal,
        gstAmount,
        grandTotal,
        received: 0,
        tds: 0,
        otherDeductions: 0,
        due: grandTotal,
      };
    }
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId && monthInvoicesMap[pay.invoiceId]) {
      const rec = Number(pay.receivedAmount || 0);
      const tds = Number(pay.tdsDeducted || 0);
      const oth = Number(pay.otherDeductions || 0);
      monthInvoicesMap[pay.invoiceId].received += rec;
      monthInvoicesMap[pay.invoiceId].tds += tds;
      monthInvoicesMap[pay.invoiceId].otherDeductions += oth;
      monthInvoicesMap[pay.invoiceId].due = Math.max(0, monthInvoicesMap[pay.invoiceId].grandTotal - (monthInvoicesMap[pay.invoiceId].received + monthInvoicesMap[pay.invoiceId].tds + monthInvoicesMap[pay.invoiceId].otherDeductions));
    }
  });

  const pendingInvoices = Object.values(monthInvoicesMap).filter(inv => inv.due > 1);
  const firmLabel = activeFirm === 'Both' ? 'Vithal & R.V Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  if (pendingInvoices.length === 0) {
    return {
      text: `✨ *ALL BILLS SETTLED IN ${monthLabel.toUpperCase()}!* 🎉\n🏢 Scope: *${firmLabel}*\n━━━━━━━━━━━━━━━━━━━━━\n\n📌 *${monthLabel} me ${firmLabel} ka koi bhi bill pending nahi hai!* Saare payments clear ho chuke hain.`,
      buttons: [
        [
          { text: '📄 All Bills for ' + monthLabel, callback_data: 'quick:bills' },
          { text: '⚠️ Top Pending Overall', callback_data: 'quick:pending' },
        ],
      ],
    };
  }

  // Sort chronologically
  pendingInvoices.sort((a, b) => {
    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    if (timeA && timeB && timeA !== timeB) return timeA - timeB;
    const billA = parseInt(String(a.billNo), 10) || 0;
    const billB = parseInt(String(b.billNo), 10) || 0;
    return billA - billB;
  });

  const totalPendingDue = pendingInvoices.reduce((s, i) => s + i.due, 0);

  let msg = `⚠️ *PENDING BILLS - ${monthLabel.toUpperCase()}*\n`;
  msg += `🏢 Firm Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 *SUMMARY:*\n`;
  msg += `• Total Unpaid Invoices: *${pendingInvoices.length} Bills*\n`;
  msg += `• ⚠️ Total Pending Due: *₹ ${formatInr(totalPendingDue)}*\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *UNPAID BILLS LIST (${pendingInvoices.length}):*\n\n`;

  pendingInvoices.forEach((inv, idx) => {
    const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    const isPartial = inv.received > 0;
    const statusTag = isPartial ? `🟡 PARTIAL (Paid ₹ ${formatInr(inv.received)})` : `⏳ UNPAID`;

    msg += `${idx + 1}️⃣ *Bill #${inv.billNo}* • *${inv.companyName}* (${firm})\n`;
    msg += `• 📅 Date: *${formatDateReadable(inv.date)}*\n`;
    msg += `• 📊 Grand Total: ₹ ${formatInr(inv.grandTotal)}\n`;
    msg += `• ⚠️ Pending Due: *₹ ${formatInr(inv.due)}*\n`;
    msg += `• 🏁 Status: *${statusTag}*\n\n`;
  });

  return {
    text: msg.trim(),
    buttons: [
      [
        { text: '📄 All Bills (Paid + Pending)', callback_data: 'quick:bills' },
        { text: '⚠️ Top Debtors Overall', callback_data: 'quick:pending' },
      ],
      [
        { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
      ],
    ],
  };
}

/**
 * List all registered companies formatted in clean numbered bullet points.
 */
export async function listAllCompanies(): Promise<AssistantResponse> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'companies'));

  if (snap.empty) {
    return { text: '🏢 *No companies registered in database.*' };
  }

  let msg = `🏢 *REGISTERED CLIENTS (${snap.size})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  snap.docs.forEach((d, i) => {
    const c = d.data();
    msg += `${i + 1}. *${c.name}*`;
    if (c.contactNumber) msg += ` (📞 ${c.contactNumber})`;
    msg += `\n`;
  });

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Type any company name (e.g. "Bisleri" or "Bisleri Aug bills") to view details._`;

  return { text: msg.trim() };
}

/**
 * Disambiguation Helper: Renders interactive choice buttons when multiple companies match.
 */
function renderCompanyDisambiguation(keyword: string, matchedCompanies: string[], chatId: string): AssistantResponse {
  chatRecentChoices.set(chatId, matchedCompanies);

  let msg = `🔍 *Multiple companies found for "${keyword}":*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Kripya neeche di gayi company me se select karein:\n\n`;

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  matchedCompanies.slice(0, 6).forEach((name, i) => {
    msg += `${i + 1}️⃣ *${name}*\n`;
    buttons.push([
      {
        text: `🏢 ${name.length > 30 ? name.slice(0, 27) + '...' : name}`,
        callback_data: `comp_select:${name}`,
      },
    ]);
  });

  msg += `\n👉 *Tap a button above or reply with the number (\`1\`, \`2\`).*`;

  return {
    text: msg.trim(),
    buttons,
  };
}

/**
 * Build rich live business context from Firestore for Gemini reasoning.
 */
async function buildLiveBusinessContext(activeFirm: EnterpriseType): Promise<string> {
  try {
    const firestore = await getAuthenticatedFirestore();
    const today = new Date().toISOString().split('T')[0];
    const currentMonth = new Date().toISOString().slice(0, 7);

    const [companiesSnap, forkliftsSnap, invoicesSnap, paymentsSnap, attendanceSnap, employeesSnap] = await Promise.all([
      getDocs(collection(firestore, 'companies')),
      getDocs(collection(firestore, 'forklifts')),
      getDocs(collection(firestore, 'invoices')),
      getDocs(collection(firestore, 'payments')),
      getDocs(query(collection(firestore, 'attendance'), where('date', '==', today))),
      getDocs(collection(firestore, 'employees')),
    ]);

    const companyMap = new Map<string, string>();
    companiesSnap.docs.forEach(d => companyMap.set(d.id, String(d.data().name || 'Company')));

    const empMap = new Map<string, string>();
    employeesSnap.docs.forEach(d => empMap.set(d.id, String(d.data().fullName || 'Employee')));

    // Financial aggregation per company
    const compDueMap = new Map<string, { billed: number; received: number; due: number; billsCount: number; unpaidCount: number }>();
    const invoicePaymentMap = new Map<string, number>();

    paymentsSnap.docs.forEach(d => {
      const p = d.data();
      if (p.invoiceId) {
        const totalPaid = Number(p.receivedAmount || 0) + Number(p.tdsDeducted || 0) + Number(p.otherDeductions || 0);
        invoicePaymentMap.set(p.invoiceId, (invoicePaymentMap.get(p.invoiceId) || 0) + totalPaid);
      }
    });

    invoicesSnap.docs.forEach(d => {
      const inv = d.data();
      const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
      if (activeFirm !== 'Both' && ent !== activeFirm) return;

      const compName = companyMap.get(inv.companyId) || 'Unknown Client';
      const grand = Number(inv.grandTotal || 0);
      const paid = invoicePaymentMap.get(d.id) || 0;
      const due = Math.max(0, grand - paid);

      const existing = compDueMap.get(compName) || { billed: 0, received: 0, due: 0, billsCount: 0, unpaidCount: 0 };
      existing.billed += grand;
      existing.received += paid;
      existing.due += due;
      existing.billsCount += 1;
      if (due > 1) existing.unpaidCount += 1;
      compDueMap.set(compName, existing);
    });

    const topDebtors = Array.from(compDueMap.entries())
      .map(([name, data]) => `${name}: Total Billed ₹${formatInr(data.billed)}, Received ₹${formatInr(data.received)}, Net Due Pending ₹${formatInr(data.due)} (${data.billsCount} total bills, ${data.unpaidCount} unpaid/pending bills)`)
      .slice(0, 35)
      .join('\n');

    // Forklifts
    let forklifts = forkliftsSnap.docs.map(d => d.data());
    if (activeFirm !== 'Both') {
      forklifts = forklifts.filter(f => (f.firm || 'Vithal') === activeFirm);
    }
    const workshopForklifts = forklifts.filter(f => f.locationType === 'Workshop').map(f => `#${f.serialNumber} (${f.firm || 'Vithal'} ${f.make || ''} ${f.model || ''} - ${f.capacity || 'N/A'})`).join(', ') || 'None';
    const onsiteForklifts = forklifts.filter(f => f.locationType === 'On-Site').map(f => `#${f.serialNumber} at ${f.siteCompany || 'Site'} (${f.firm || 'Vithal'})`).join(', ') || 'None';

    // Attendance
    const presentStaff: string[] = [];
    const absentStaff: string[] = [];
    attendanceSnap.docs.forEach(d => {
      const r = d.data();
      const name = empMap.get(r.employeeId) || 'Staff';
      if (r.status === 'Present') presentStaff.push(name);
      if (r.status === 'Absent') absentStaff.push(name);
    });

    return `
=== REAL-TIME LIVE ENTERPRISE FACTS ===
Active Firm Scope: ${activeFirm === 'Both' ? 'Both Vithal Enterprises & R.V Enterprises' : activeFirm}
Today's Date: ${today} (${formatDateReadable(today)})
Current Billing Month: ${currentMonth}

--- FLEET DETAILS ---
Total Units: ${forklifts.length}
Workshop Idle Units: ${workshopForklifts}
On-Site Deployed Units: ${onsiteForklifts}

--- TODAY'S ATTENDANCE ---
Total Staff: ${employeesSnap.size}
Present (${presentStaff.length}): ${presentStaff.join(', ') || 'None marked'}
Absent (${absentStaff.length}): ${absentStaff.join(', ') || 'None marked'}

--- CLIENTS DUE & REVENUE (Live Database Snapshot) ---
${topDebtors}
===================================
`;
  } catch (err) {
    console.error('Error generating live business context:', err);
    return '';
  }
}

/**
 * Tests Gemini AI Connection and returns detailed diagnostic report.
 */
export async function testGeminiConnection(): Promise<string> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    return `❌ *Gemini API Key Missing!*\n\n• Vercel Environment Variables me \`GEMINI_API_KEY\` add karein, YA\n• Telegram par \`/key AIzaSy...\` bhej kar key save karein.`;
  }

  const maskedKey = apiKey.slice(0, 6) + '...' + apiKey.slice(-4);
  const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];
  const errors: string[] = [];

  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Hello, reply with only the word "OK".' }] }]
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return `✅ *Gemini AI is Fully Connected & Active!* 🤖\n━━━━━━━━━━━━━━━━━━━━━\n• 🔑 API Key: \`${maskedKey}\`\n• 🚀 Model: \`${model}\`\n• ⚡ Response: "${text.trim()}"\n\nAb aap natural Hindi/Hinglish/English me koi bhi sawal pooch sakte hain!`;
      } else {
        const errText = await res.text();
        errors.push(`${model} (HTTP ${res.status}): ${errText.slice(0, 100)}`);
      }
    } catch (e: any) {
      errors.push(`${model}: ${e.message}`);
    }
  }

  return `⚠️ *Gemini API Error with Key \`${maskedKey}\`:*\n\n${errors.join('\n\n')}\n\nKripya [Google AI Studio](https://aistudio.google.com/app/apikey) se new API key lekar \`/key <new_key>\` bhejein.`;
}

/**
 * Query Google Gemini AI model with live business grounding and multi-model fallback.
 */
async function queryGeminiAI(userPrompt: string, activeFirm: EnterpriseType): Promise<string | null> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const liveContext = await buildLiveBusinessContext(activeFirm);

    const systemInstruction = `
You are the ultra-smart AI Executive Assistant for "Vithal Enterprises" and "R.V Enterprises" (Forklift Rentals, Fleet & Maintenance, Maharashtra).
The user speaking to you is the Business Owner / Admin.

CRITICAL INTENT RULES:
1. COUNT OF PENDING BILLS ("kitne bills pending hai", "how many bills pending", "kitne bill baki hai", "kitna bill hai"):
   - Respond ONLY with the NUMBER / COUNT of pending unpaid bills and the Total Due Balance in rupees.
   - DO NOT list individual bills unless the user specifically asks "konse pending hai".
2. WHICH SPECIFIC BILLS ARE PENDING ("konse pending hai", "kaun se bill baki hai", "pending bills dikhao", "unpaid bills list"):
   - List ONLY the specific unpaid/pending bills of that company with Bill #, Date, and Due Amount.
3. MONTHLY PENDING BILLS OF A SPECIFIC FIRM ("is month ke saare pending bills Vithal ke", "August ke pending bills RV ke"):
   - Filter strictly by the requested Month and the requested Firm (Vithal vs RV).
   - Return ONLY the unpaid bills generated in that month for that specific firm.
4. TOTAL DUE AMOUNT ("kitna paisa baki hai total", "balance kitna hai"):
   - State the Net Due Outstanding amount, Total Invoiced, and Received amount clearly.
5. GENERAL RULES:
   - Understand natural Hindi, Hinglish, or English.
   - Ground all answers strictly in the REAL-TIME LIVE ENTERPRISE FACTS provided below.
   - Use clean bullet points, bold numbers, and emojis (🏢, 💰, 🚜, 📅, ⚠️, ✅, ⏳).
   - Format currency as "₹ X,XX,XXX".
`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [
            { text: `${systemInstruction}\n\n${liveContext}\n\nUSER'S QUESTION: "${userPrompt}"` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1500,
      }
    };

    const models = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-pro'];

    for (const model of models) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (res.ok) {
          const json = await res.json();
          const answer = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (answer && answer.trim()) {
            return answer.trim();
          }
        } else {
          const errText = await res.text();
          console.warn(`Gemini model ${model} failed (HTTP ${res.status}):`, errText);
        }
      } catch (err) {
        console.warn(`Gemini fetch error on model ${model}:`, err);
      }
    }

    return null;
  } catch (err) {
    console.error('Gemini query failed:', err);
    return null;
  }
}

/**
 * Comprehensive Smart Natural Language Processor.
 * Combines Google Gemini AI with Precision Rule Engine for 100% Accuracy.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string, chatId: string = ''): Promise<AssistantResponse> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  try {
    const firestore = await getAuthenticatedFirestore();
    const activeFirm = await getUserActiveFirm(chatId);
    const queryFirm = extractFirmFromQuery(raw, activeFirm);

    // ─── 0. CHECK IF USER WANTS TO TEST OR SET GEMINI API KEY ───────────────
    if (lower === '/testai' || lower === '/aistatus' || lower === 'test ai' || lower === 'ai status') {
      const diagReport = await testGeminiConnection();
      return {
        text: diagReport,
        buttons: renderFirmRadioButtons(activeFirm),
      };
    }

    if (lower.startsWith('/key ') || lower.startsWith('/gemini ') || lower.startsWith('set key ')) {
      const key = raw.replace(/^(\/key|\/gemini|set key)\s+/i, '').trim();
      if (key.length > 10) {
        const saved = await saveGeminiApiKey(key);
        if (saved) {
          const testRes = await testGeminiConnection();
          return {
            text: `✨ *Gemini API Key Saved!* 🤖\n━━━━━━━━━━━━━━━━━━━━━\n${testRes}`,
            buttons: renderFirmRadioButtons(activeFirm),
          };
        }
      }
    }

    // ─── 1. FIRM SELECTION / SWITCHING COMMANDS ────────────────────────────
    if (
      lower === '/firm' || lower === 'firm' || lower === '/switch' || 
      lower === 'switch' || lower === 'change firm' || lower === 'select firm'
    ) {
      return await renderFirmSelectionMenu(chatId);
    }

    if (lower === '/vithal' || lower === 'vithal' || (awaitingFirmSelection.has(chatId) && (raw === '1' || lower.includes('vithal')))) {
      return await setUserActiveFirm(chatId, 'Vithal');
    }

    if (lower === '/rv' || lower === 'rv' || (awaitingFirmSelection.has(chatId) && (raw === '2' || lower.includes('rv')))) {
      return await setUserActiveFirm(chatId, 'RV');
    }

    if (lower === '/both' || lower === 'both' || (awaitingFirmSelection.has(chatId) && (raw === '3' || lower.includes('both')))) {
      return await setUserActiveFirm(chatId, 'Both');
    }

    // ─── 2. CHECK IF USER REPLIED TO A RECENT MULTI-CHOICE SELECTION ────────
    if (/^\d{1,2}$/.test(raw) && chatId && chatRecentChoices.has(chatId)) {
      const choices = chatRecentChoices.get(chatId) || [];
      const index = parseInt(raw, 10) - 1;
      if (index >= 0 && index < choices.length) {
        const selectedCompany = choices[index];
        chatRecentChoices.delete(chatId);
        return await getCompanyDetailByIntent(selectedCompany, 'all', activeFirm, null);
      }
    }

    // ─── 3. TOP OUTSTANDING DUE / DEBTORS LIST ─────────────────────────────
    if (
      lower.includes('top pending') ||
      lower.includes('pending list') ||
      lower.includes('baki list') ||
      lower.includes('kiske kitne baki') ||
      lower.includes('kiska balance') ||
      lower.includes('sabse zyada balance') ||
      lower.includes('sabse jyada baki') ||
      lower.includes('debtors') ||
      lower.includes('top due') ||
      lower === 'pending' ||
      lower === 'dues' ||
      lower === 'balance'
    ) {
      return await getTopPendingBalances(queryFirm);
    }

    // ─── 4. ALL COMPANIES LIST ─────────────────────────────────────────────
    if (lower.includes('all companies') || lower.includes('company list') || lower.includes('companies list') || lower === 'companies' || lower === 'company') {
      return await listAllCompanies();
    }

    // ─── 5. MONTH + PENDING QUERY (e.g. "is month ke saare pending bills Vithal ke") ──
    const targetMonth = extractTargetMonth(raw);
    const isAskingMonthPending = (
      targetMonth !== null &&
      (
        hasWord(lower, 'pending') ||
        hasWord(lower, 'baki') ||
        hasWord(lower, 'due') ||
        hasWord(lower, 'unpaid') ||
        lower.includes('pending bills') ||
        lower.includes('baki bills') ||
        lower.includes('baki bill')
      )
    );

    if (isAskingMonthPending) {
      const companiesSnap = await getDocs(collection(firestore, 'companies'));
      const hasCompanyInQuery = companiesSnap.docs.some(d => {
        const cName = String(d.data().name || '').toLowerCase();
        return cName.length > 2 && lower.includes(cName);
      });

      if (!hasCompanyInQuery) {
        return await getMonthlyPendingBills(queryFirm, targetMonth);
      }
    }

    // ─── 6. MONTHLY BILLING SUMMARY (All Bills) ────────────────────────────
    const isBillingRequest = (
      hasWord(lower, 'billing') ||
      hasWord(lower, 'revenue') ||
      hasWord(lower, 'turnover') ||
      hasWord(lower, 'collection') ||
      hasWord(lower, 'kamai') ||
      lower.includes('total bill') ||
      lower.includes('sales') ||
      (targetMonth !== null && (hasWord(lower, 'bills') || hasWord(lower, 'bill') || hasWord(lower, 'hisab')))
    );

    if (isBillingRequest) {
      const companiesSnap = await getDocs(collection(firestore, 'companies'));
      const hasCompanyInQuery = companiesSnap.docs.some(d => {
        const cName = String(d.data().name || '').toLowerCase();
        return cName.length > 2 && lower.includes(cName);
      });

      if (!hasCompanyInQuery) {
        return await getMonthlyBillingSummary(queryFirm, targetMonth);
      }
    }

    // ─── 7. WORKSHOP / IDLE FORKLIFTS ──────────────────────────────────────
    if (
      hasWord(lower, 'workshop') ||
      hasWord(lower, 'idle') ||
      hasWord(lower, 'khade') ||
      hasWord(lower, 'khada') ||
      hasWord(lower, 'godown') ||
      hasWord(lower, 'garage') ||
      hasWord(lower, 'khali') ||
      lower.includes('workshop forklift') ||
      lower.includes('workshop me')
    ) {
      return await getFleetStatus('Workshop', queryFirm);
    }

    // ─── 8. ON-SITE / DEPLOYED FORKLIFTS ────────────────────────────────────
    if (
      hasWord(lower, 'onsite') ||
      hasWord(lower, 'on-site') ||
      hasWord(lower, 'deployed') ||
      hasWord(lower, 'bahar') ||
      lower.includes('on site') ||
      lower.includes('client site') ||
      lower.includes('site par')
    ) {
      return await getFleetStatus('On-Site', queryFirm);
    }

    // ─── 9. OVERALL FLEET SUMMARY ──────────────────────────────────────────
    if (
      hasWord(lower, 'fleet') ||
      hasWord(lower, 'forklift') ||
      hasWord(lower, 'forklifts') ||
      hasWord(lower, 'gadi') ||
      hasWord(lower, 'gaadi') ||
      hasWord(lower, 'machines') ||
      lower.includes('total unit') ||
      lower.includes('total fleet') ||
      lower.includes('total gadi')
    ) {
      return await getFleetStatus(undefined, queryFirm);
    }

    // ─── 10. ATTENDANCE & STAFF ────────────────────────────────────────────
    if (
      hasWord(lower, 'attendance') ||
      hasWord(lower, 'absent') ||
      hasWord(lower, 'present') ||
      hasWord(lower, 'haziri') ||
      hasWord(lower, 'chhutti') ||
      lower.includes('kaun aya') ||
      lower.includes('kon aya') ||
      lower.includes('absent staff') ||
      lower.includes('today attendance') ||
      lower.includes('staff report') ||
      lower.includes('kitne log')
    ) {
      return await getTodayAttendanceSummary();
    }

    // ─── 11. SPECIFIC FORKLIFT SERIAL SEARCH ───────────────────────────────
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    for (const d of forkliftsSnap.docs) {
      const sn = String(d.data().serialNumber || '').trim();
      if (sn.length >= 2 && hasWord(raw, sn)) {
        return await getForkliftDetail(sn);
      }
    }

    // ─── 12. DYNAMIC COMPANY NAME MATCHING & INTENT DISPATCH ───────────────
    const companiesSnap = await getDocs(collection(firestore, 'companies'));
    const allCompanyNames = companiesSnap.docs.map(d => String(d.data().name || '').trim()).filter(Boolean);

    // 1. User asks for COUNT / NUMBER of pending bills ("kitne bills pending", "kitne bill baki")
    const isAskingCountPending = (
      lower.includes('kitne bill') ||
      lower.includes('kitne bills') ||
      lower.includes('kitna bill baki') ||
      lower.includes('kitna bill pending') ||
      lower.includes('kitne invoice') ||
      lower.includes('kitne pending') ||
      lower.includes('how many bill') ||
      lower.includes('how many pending') ||
      lower.includes('count of pending') ||
      lower.includes('number of pending')
    );

    // 2. User asks WHICH specific bills are pending ("konse pending", "kaun se bill baki", "pending bills dikhao")
    const isAskingPendingList = (
      lower.includes('konse pending') ||
      lower.includes('konse bill') ||
      lower.includes('konse bills') ||
      lower.includes('kaun se pending') ||
      lower.includes('kaun se bill') ||
      lower.includes('kaun se bills') ||
      lower.includes('pending bill dikhao') ||
      lower.includes('pending bills dikhao') ||
      lower.includes('pending bills list') ||
      lower.includes('pending bills chahiye') ||
      lower.includes('unpaid bills list') ||
      lower.includes('unpaid bills dikhao') ||
      lower.includes('pending invoice dikhao')
    );

    // 3. User asks for TOTAL money pending ("kitna paisa baki", "pending due")
    const isAskingPendingDue = (
      hasWord(lower, 'pending') ||
      hasWord(lower, 'due') ||
      hasWord(lower, 'balance') ||
      hasWord(lower, 'baki') ||
      hasWord(lower, 'unpaid') ||
      lower.includes('kitna paisa') ||
      lower.includes('paisa baki') ||
      lower.includes('kitna baki') ||
      lower.includes('kitna lena') ||
      lower.includes('balance kitna')
    );

    // 4. User asks for ALL bills
    const isAskingBills = (
      hasWord(lower, 'bills') ||
      hasWord(lower, 'invoices') ||
      (hasWord(lower, 'bill') && !isAskingCountPending && !isAskingPendingList && !isAskingPendingDue) ||
      lower.includes('all bills') ||
      lower.includes('saare bill') ||
      lower.includes('all invoices') ||
      targetMonth !== null
    );

    let companyIntent: 'count_pending' | 'pending_list' | 'pending' | 'bills' | 'forklifts' | 'all' = 'all';

    if (isAskingCountPending) {
      companyIntent = 'count_pending';
    } else if (isAskingPendingList) {
      companyIntent = 'pending_list';
    } else if (isAskingPendingDue) {
      companyIntent = 'pending';
    } else if (isAskingBills) {
      companyIntent = 'bills';
    } else if (hasWord(lower, 'forklift') || hasWord(lower, 'forklifts') || hasWord(lower, 'gadi') || hasWord(lower, 'gaadi') || hasWord(lower, 'machine')) {
      companyIntent = 'forklifts';
    }

    const matchedCompanies: string[] = [];

    const stopWords = new Set([
      'pvt', 'ltd', 'limited', 'private', 'enterprises', 'enterprise',
      'llp', 'and', 'the', 'services', 'solutions', 'international',
      'internationals', 'group', 'india', 'supply', 'chain', 'corp',
      'corporation', 'industries', 'freight', 'logistics', 'logictics',
      'traders', 'trading', 'works', 'company', 'ka', 'ki', 'ke', 'details',
      'batao', 'chahiye', 'kya', 'hai', 'dikhao', 'pending', 'bills', 'bill',
      'last', 'previous', 'month', 'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'kaun', 'kitna', 'baki', 'due',
      'konse', 'kitne', 'saare', 'sab'
    ]);

    for (const companyFullName of allCompanyNames) {
      const companyLower = companyFullName.toLowerCase();

      if (lower.includes(companyLower)) {
        matchedCompanies.push(companyFullName);
        continue;
      }

      const brandWords = companyLower
        .split(/[\s,./()]+/)
        .filter(w => w.length >= 3 && !stopWords.has(w));

      if (brandWords.some(w => hasWord(lower, w))) {
        if (!matchedCompanies.includes(companyFullName)) {
          matchedCompanies.push(companyFullName);
        }
        continue;
      }

      const queryWords = lower.split(/[\s,./()]+/).filter(w => w.length >= 4 && !stopWords.has(w));
      for (const qWord of queryWords) {
        for (const bWord of brandWords) {
          if (bWord.length >= 4 && stringSimilarity(qWord, bWord) >= 0.75) {
            if (!matchedCompanies.includes(companyFullName)) {
              matchedCompanies.push(companyFullName);
            }
          }
        }
      }
    }

    if (matchedCompanies.length === 1) {
      return await getCompanyDetailByIntent(matchedCompanies[0], companyIntent, queryFirm, targetMonth);
    }

    if (matchedCompanies.length > 1) {
      const matchedKeyword = raw.replace(/\b(ka|ki|ke|pending|bills|bill|invoices|forklifts|details|batao|chahiye|dikhao|kya|hai|last|previous|month|aug|july|june|kiska|kitna|konse|kitne|saare)\b/gi, '').trim() || raw;
      return renderCompanyDisambiguation(matchedKeyword, matchedCompanies, chatId);
    }

    // ─── 13. TRY GEMINI AI FOR FREE-FORM CONVERSATIONAL REASONING ───────────
    const aiAnswer = await queryGeminiAI(raw, queryFirm);
    if (aiAnswer) {
      return {
        text: aiAnswer,
        buttons: renderFirmRadioButtons(activeFirm),
      };
    }

  } catch (err: any) {
    console.error('Smart NLP processing error:', err);
    return { text: `⚠️ *Error accessing data:* ${err.message || 'Database error'}` };
  }

  // Helpful standard guide
  const activeFirm = await getUserActiveFirm(chatId);
  return {
    text: `🤖 *VE Dashboard AI Assistant*\n🏢 Active Scope: *${activeFirm === 'Both' ? 'Both Firms (Vithal + RV)' : activeFirm}*\n━━━━━━━━━━━━━━━━━━━━━\n\nAap bilkul specific sawaal pooch sakte hain:\n\n• 🔢 *Kitne Bills Pending:* e.g. _"Bisleri ke kitne bills pending hai"_\n• 📋 *Konse Bills Pending:* e.g. _"Bisleri ke konse pending hai"_\n• 📅 *Month & Firm Pending:* e.g. _"is month ke saare pending bills Vithal ke"_\n• ⚠️ *Top Debtors Ranking:* e.g. _"Top pending"_\n• 🚜 *Forklift Fleet:* e.g. _"Workshop"_, _"On-site"_\n• 📅 *Attendance:* e.g. _"Today attendance"_\n\n👇 *Select Active Firm below:*`,
    buttons: renderFirmRadioButtons(activeFirm),
  };
}
