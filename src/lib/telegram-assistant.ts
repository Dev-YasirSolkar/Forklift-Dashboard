/**
 * @fileOverview Complete Enterprise AI Assistant Engine for Vithal & R.V Enterprises
 * 
 * ARCHITECTURAL PRINCIPLES:
 * 1. Conversational Context & Follow-Up Session Memory (15 min sliding window).
 * 2. Structured Intent & Entity Parsing (Deterministic + Gemini NLU JSON extraction).
 * 3. 100% Deterministic Financial & Business Calculations (Zero hallucination).
 * 4. Multi-Firm Strict Isolation (Vithal vs RV vs Both with full breakdown).
 * 5. Formatting Standards:
 *    - Bill Numbers displayed with enterprise suffix: e.g. "1571-MHE" (not just #1571).
 *    - Icons / Emojis used ONLY in Main Titles & Section Headers.
 *    - Body items formatted as clean indented bullet points ("  • ").
 *    - Horizontal Pending Bill Numbers ("  👉 `1544-MHE`  •  `1569-MHE`").
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

export type IntentType =
  | 'pending_balance'
  | 'pending_bill_count'
  | 'pending_bill_list'
  | 'bill_history'
  | 'billing_summary'
  | 'monthly_pending_bills'
  | 'top_debtors'
  | 'all_companies'
  | 'workshop_forklifts'
  | 'onsite_forklifts'
  | 'fleet_summary'
  | 'forklift_details'
  | 'attendance_today'
  | 'absent_staff'
  | 'present_staff'
  | 'firm_switch'
  | 'casual_conversation'
  | 'help'
  | 'clarification_required'
  | 'unknown';

export interface UserConversationContext {
  chatId: string;
  lastIntent?: IntentType;
  lastEntity?: string;
  lastFirm?: EnterpriseType;
  lastMonth?: { monthKey: string; monthLabel: string } | null;
  lastDetailLevel?: 'summary' | 'detailed' | 'count';
  lastLimit?: number;
  lastPage?: number;
  updatedAt: number;
}

export interface StructuredIntent {
  intent: IntentType;
  entity?: string;
  firm: EnterpriseType;
  timeRange?: { monthKey: string; monthLabel: string } | null;
  detailLevel: 'summary' | 'detailed' | 'count';
  limit?: number;
  page?: number;
  confidence: number;
  rawText: string;
}

export interface ProcessedInvoiceData {
  id: string;
  companyId: string;
  companyName: string;
  billNo: number | string;
  billNoFormatted: string; // e.g. "1571-MHE"
  date: string;
  billingMonth: string;
  enterprise: 'Vithal' | 'RV';
  netTotal: number;
  gstAmount: number;
  grandTotal: number;
  received: number;
  tds: number;
  otherDeductions: number;
  due: number;
  isPaid: boolean;
}

interface CompanySummary {
  id: string;
  name: string;
  address?: string;
  gstin?: string;
  kindAttn?: string;
  contactNumber?: string;
}

// In-memory stores
const verifiedAdminChatIds = new Set<string>();
const userActiveFirmMap = new Map<string, EnterpriseType>();
const userSessionContextMap = new Map<string, UserConversationContext>();
const chatRecentChoices = new Map<string, string[]>();
const awaitingFirmSelection = new Set<string>();
let cachedGeminiKey: string | null = null;

export const ADMIN_SECRET_CODE = '2028';
const CONTEXT_TTL_MS = 15 * 60 * 1000; // 15 minutes sliding session window

/**
 * Format currency in Indian format (₹ X,XX,XXX).
 */
export function formatInr(num: number): string {
  return Math.round(num || 0).toLocaleString('en-IN');
}

/**
 * Format readable date (e.g. 15 Jun 2026).
 */
export function formatDateReadable(dateStr: string): string {
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
 * Safe word boundary check.
 */
function hasWord(text: string, word: string): boolean {
  const cleanWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${cleanWord}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(text);
}

/**
 * Fuzzy bigram similarity (0.0 to 1.0).
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
 * Get authenticated Firestore session.
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
 * Centralized Exact Billing Math Engine.
 * Matches web dashboard (/payments) 100%.
 */
export function calculateInvoiceDue(
  invoiceDoc: any, 
  invoiceId: string, 
  paymentsByInvoice: Record<string, { received: number; tds: number; otherDeductions: number }>,
  companyName: string = 'Company'
): ProcessedInvoiceData {
  const inv = invoiceDoc;
  const enterprise: 'Vithal' | 'RV' = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
  const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');

  // Format bill number with enterprise suffix: e.g. "1571-MHE"
  const defaultSuffix = enterprise === 'RV' ? 'RV' : 'MHE';
  const billSuffix = inv.billNoSuffix || defaultSuffix;
  const billNoFormatted = inv.billNo ? `${inv.billNo}-${billSuffix}` : 'N/A';

  // Look up payments by invoice document ID or bill number string
  const billKey = String(inv.billNo || '');
  const payData = paymentsByInvoice[invoiceId] || paymentsByInvoice[billKey] || { received: 0, tds: 0, otherDeductions: 0 };
  
  const advanceReceived = Number(inv.advanceReceived || 0);
  const totalReceived = payData.received + advanceReceived;
  const totalDeductions = payData.otherDeductions;

  const taxableAmount = inv.discountType === 'before_gst' 
    ? (Number(inv.netTotal || 0) - Number(inv.discount || 0)) 
    : Number(inv.netTotal || 0);
  const tdsPercentage = Number(inv.tdsPercentage || 0);
  const calculatedTds = (taxableAmount * tdsPercentage) / 100;
  const totalTds = Math.max(calculatedTds, payData.tds);

  const grandTotal = Number(inv.grandTotal || 0);
  const netTotal = Number(inv.netTotal || (grandTotal > 0 ? (grandTotal / 1.18) : 0));
  const gstAmount = Math.max(0, grandTotal - netTotal);

  const totalCredited = totalReceived + totalDeductions + totalTds;
  const rawBalance = grandTotal - totalCredited;
  const finalBalance = Math.max(0, Math.round(rawBalance));
  
  // An invoice is considered fully paid if remaining balance is <= 1
  const isPaid = finalBalance <= 1;

  return {
    id: invoiceId,
    companyId: inv.companyId || '',
    companyName,
    billNo: inv.billNo || 'N/A',
    billNoFormatted,
    date: inv.billDate || inv.billingMonth || '',
    billingMonth: bMonth,
    enterprise,
    netTotal,
    gstAmount,
    grandTotal,
    received: totalReceived,
    tds: totalTds,
    otherDeductions: totalDeductions,
    due: finalBalance,
    isPaid,
  };
}

/**
 * Natural Month & Relative Date Parser.
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
 * Extract firm explicitly mentioned in query text.
 */
export function extractFirmFromQuery(queryStr: string, fallback: EnterpriseType): EnterpriseType {
  const lower = queryStr.toLowerCase();
  if (lower.includes('vithal') && !lower.includes('rv') && !lower.includes('both')) {
    return 'Vithal';
  }
  if ((lower.includes('rv') || lower.includes('r.v') || lower.includes('r v')) && !lower.includes('vithal')) {
    return 'RV';
  }
  if (lower.includes('both') || lower.includes('dono') || (lower.includes('vithal') && (lower.includes('rv') || lower.includes('r.v')))) {
    return 'Both';
  }
  return fallback;
}

/**
 * Admin authorization check.
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
 * Get active firm preference (default: 'Both').
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
 * Set active firm preference permanently in Firestore.
 */
export async function setUserActiveFirm(chatId: string, firm: EnterpriseType): Promise<AssistantResponse> {
  userActiveFirmMap.set(chatId, firm);
  awaitingFirmSelection.delete(chatId);

  // Update session context
  const ctx = getUserSession(chatId);
  ctx.lastFirm = firm;
  saveUserSession(chatId, ctx);

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

  let msg = `✅ *ACTIVE FIRM UPDATED*\n`;
  msg += `🏢 Scope: *${label}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `  • Ab saare bills, fleet aur revenue reports **${label}** ke hisaab se aayenge.\n\n`;
  msg += `_Firm change karne ke liye neeche button tap karein:_`;

  return {
    text: msg,
    buttons: renderFirmRadioButtons(firm),
  };
}

/**
 * Render interactive radio buttons for firm selection.
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
 * Render firm selection menu.
 */
export async function renderFirmSelectionMenu(chatId: string): Promise<AssistantResponse> {
  awaitingFirmSelection.add(chatId);
  const currentFirm = await getUserActiveFirm(chatId);

  let msg = `🏢 *SELECT ACTIVE FIRM / ENTERPRISE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `Kripya apni active firm select karein:\n\n`;
  msg += `  • *Vithal Enterprises:* Sirf Vithal ke bills aur fleet\n`;
  msg += `  • *R.V Enterprises:* Sirf RV ke bills aur fleet\n`;
  msg += `  • *Both Firms:* Vithal aur RV dono ka alag-alag breakdown\n\n`;
  msg += `👇 *Tap a button below to select:*`;

  return {
    text: msg,
    buttons: renderFirmRadioButtons(currentFirm),
  };
}

/**
 * Register chat ID as super admin with passcode 2028.
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
 * Get Gemini API Key from environment or Firestore.
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
 * Conversational Session Context Manager.
 */
export function getUserSession(chatId: string): UserConversationContext {
  const now = Date.now();
  const existing = userSessionContextMap.get(chatId);
  if (existing && (now - existing.updatedAt < CONTEXT_TTL_MS)) {
    return existing;
  }
  const fresh: UserConversationContext = {
    chatId,
    updatedAt: now,
  };
  userSessionContextMap.set(chatId, fresh);
  return fresh;
}

export function saveUserSession(chatId: string, ctx: Partial<UserConversationContext>) {
  const current = getUserSession(chatId);
  const updated: UserConversationContext = {
    ...current,
    ...ctx,
    updatedAt: Date.now(),
  };
  userSessionContextMap.set(chatId, updated);
}

/**
 * Test Gemini AI connection.
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
        return `✅ *Gemini AI is Fully Connected & Active!* 🤖\n━━━━━━━━━━━━━━━━━━━━━\n  • API Key: \`${maskedKey}\`\n  • Model: \`${model}\`\n  • Response: "${text.trim()}"\n\nAb aap natural Hindi/Hinglish/English me koi bhi sawal pooch sakte hain!`;
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
 * Top Debtors ranking with configurable limit.
 */
export async function getTopPendingBalances(activeFirm: EnterpriseType = 'Both', limitCount: number = 10): Promise<AssistantResponse> {
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

  const paymentsByInvoice: Record<string, { received: number; tds: number; otherDeductions: number }> = {};
  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId) {
      const invKey = String(pay.invoiceId);
      if (!paymentsByInvoice[invKey]) {
        paymentsByInvoice[invKey] = { received: 0, tds: 0, otherDeductions: 0 };
      }
      paymentsByInvoice[invKey].received += Number(pay.receivedAmount || 0);
      paymentsByInvoice[invKey].tds += Number(pay.tdsDeducted || 0);
      paymentsByInvoice[invKey].otherDeductions += Number(pay.otherDeductions || 0);
    }
  });

  const companyDueMap = new Map<string, { name: string; billed: number; received: number; due: number; pendingBillsCount: number }>();

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    const compName = companyMap.get(inv.companyId) || 'Unknown Company';
    const processed = calculateInvoiceDue(inv, d.id, paymentsByInvoice, compName);

    const existing = companyDueMap.get(inv.companyId) || { name: compName, billed: 0, received: 0, due: 0, pendingBillsCount: 0 };
    existing.billed += processed.grandTotal;
    existing.received += processed.received;
    existing.due += processed.due;
    if (!processed.isPaid) {
      existing.pendingBillsCount += 1;
    }
    companyDueMap.set(inv.companyId, existing);
  });

  const sortedDebtors = Array.from(companyDueMap.values())
    .filter(c => c.due > 1)
    .sort((a, b) => b.due - a.due);

  const totalOutstanding = sortedDebtors.reduce((s, c) => s + c.due, 0);
  const firmLabel = activeFirm === 'Both' ? 'Vithal & R.V Enterprises' : activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';

  let msg = `⚠️ *TOP OUTSTANDING DUE RANKING*\n`;
  msg += `🏢 Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
  msg += `💰 *MARKET SUMMARY:*\n`;
  msg += `  • Total Market Outstanding: *₹ ${formatInr(totalOutstanding)}*\n`;
  msg += `  • Total Debtors: *${sortedDebtors.length} Clients*\n\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 *TOP ${Math.min(limitCount, sortedDebtors.length)} PENDING CLIENTS:*\n\n`;

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];

  sortedDebtors.slice(0, limitCount).forEach((c, idx) => {
    msg += `${idx + 1}️⃣ *${c.name}*\n`;
    msg += `  • Pending Due: *₹ ${formatInr(c.due)}* (${c.pendingBillsCount} Bills)\n`;
    msg += `  • Total Billed: ₹ ${formatInr(c.billed)} | Received: ₹ ${formatInr(c.received)}\n\n`;

    if (idx < 5) {
      buttons.push([
        {
          text: `🏢 ${c.name.slice(0, 24)}... (Due ₹${formatInr(c.due)})`,
          callback_data: `comp_select:${c.name}`,
        },
      ]);
    }
  });

  if (sortedDebtors.length > limitCount) {
    msg += `_...and ${sortedDebtors.length - limitCount} more clients with smaller pending amounts._\n\n`;
  }

  msg += `👉 *Tap any client button below for complete bill details:*`;

  return {
    text: msg.trim(),
    buttons,
  };
}

/**
 * Company details executor with pagination and precise intent views.
 */
export async function getCompanyDetailByIntent(
  companyName: string, 
  intent: 'count_pending' | 'pending' | 'pending_list' | 'bills' | 'forklifts' | 'all' = 'all',
  activeFirm: EnterpriseType = 'Both',
  targetMonth?: { monthKey: string; monthLabel: string } | null,
  page: number = 1
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
    msg += `🏢 Scope: *${firmTag}* (${companyForklifts.length} Units)\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (companyForklifts.length === 0) {
      msg += `_No forklifts currently deployed for ${activeFirm} at this client site._\n`;
    } else {
      companyForklifts.forEach((f, idx) => {
        const firm = (f.firm || 'Vithal') === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        msg += `${idx + 1}️⃣ *Serial #${f.serialNumber}* (${firm})\n`;
        msg += `  • Model: *${f.make || ''} ${f.model || ''}*\n`;
        msg += `  • Capacity: *${f.capacity || 'N/A'}*\n`;
        if (f.siteArea) msg += `  • Site Area: *${f.siteArea}*\n`;
        if (f.siteContactPerson) msg += `  • Contact: *${f.siteContactPerson}* (${f.siteContactNumber || ''})\n`;
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
    getDocs(collection(firestore, 'payments'))
  ]);

  if (invoicesSnap.empty) {
    let msg = `🏢 *${company.name.toUpperCase()}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `  • Status: No invoices recorded yet in dashboard.\n`;
    if (company.gstin) msg += `  • GSTIN: \`${company.gstin}\`\n`;
    if (company.kindAttn) msg += `  • Attn: *${company.kindAttn}*\n`;
    if (company.contactNumber) msg += `  • Phone: *${company.contactNumber}*\n`;
    return { text: msg };
  }

  const paymentsByInvoice: Record<string, { received: number; tds: number; otherDeductions: number }> = {};
  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId) {
      const invKey = String(pay.invoiceId);
      if (!paymentsByInvoice[invKey]) {
        paymentsByInvoice[invKey] = { received: 0, tds: 0, otherDeductions: 0 };
      }
      paymentsByInvoice[invKey].received += Number(pay.receivedAmount || 0);
      paymentsByInvoice[invKey].tds += Number(pay.tdsDeducted || 0);
      paymentsByInvoice[invKey].otherDeductions += Number(pay.otherDeductions || 0);
    }
  });

  const filteredInvoices: ProcessedInvoiceData[] = [];

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

    const processed = calculateInvoiceDue(inv, d.id, paymentsByInvoice, company.name);
    filteredInvoices.push(processed);
  });

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

  const paidInvoices = filteredInvoices.filter(inv => inv.isPaid);
  const unpaidInvoices = filteredInvoices.filter(inv => !inv.isPaid);

  const totalBilled = filteredInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const totalBasic = filteredInvoices.reduce((s, i) => s + i.netTotal, 0);
  const totalGst = filteredInvoices.reduce((s, i) => s + i.gstAmount, 0);
  const totalReceived = filteredInvoices.reduce((s, i) => s + i.received, 0);
  const totalTds = filteredInvoices.reduce((s, i) => s + i.tds, 0);
  const totalOtherDed = filteredInvoices.reduce((s, i) => s + i.otherDeductions, 0);
  const totalDue = filteredInvoices.reduce((s, i) => s + i.due, 0);

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

  // ─── 3. COUNT ONLY VIEW ("kitne bills pending hai") ──────────────────────
  if (intent === 'count_pending') {
    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `🏢 Scope: *${firmHeader}*\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (unpaidInvoices.length === 0) {
      text += `✨ *Pending Bills: 0 (Zero)* 🎉\n`;
      text += `  • Is company ke saare ${filteredInvoices.length} bills fully clear & settled hain!\n\n`;
    } else {
      text += `📊 *PENDING UNPAID BILLS: ${unpaidInvoices.length} INVOICES*\n`;
      text += `⚠️ *Total Outstanding Balance:* *₹ ${formatInr(totalDue)}*\n\n`;

      text += `💰 *ACCOUNT BREAKDOWN:*\n`;
      text += `  • Total Invoices Generated: *${filteredInvoices.length} Bills* (₹ ${formatInr(totalBilled)})\n`;
      text += `  • Fully Paid / Settled: *${paidInvoices.length} Bills* (₹ ${formatInr(totalReceived)})\n`;
      text += `  • Unpaid / Pending: *${unpaidInvoices.length} Bills* (₹ ${formatInr(totalDue)})\n\n`;

      if (unpaidInvoices.length > 0) {
        const billNoTags = unpaidInvoices.map(inv => `\`${inv.billNoFormatted}\``).join('  •  ');
        text += `📋 *PENDING BILL NUMBERS:*\n  👉 ${billNoTags}\n\n`;
      }

      if (activeFirm === 'Both') {
        const firmLines: string[] = [];
        if (vithalUnpaid.length > 0 || vithalDue > 0) {
          firmLines.push(`  • Vithal Enterprises: *${vithalUnpaid.length} Bills Pending* (Due ₹ ${formatInr(vithalDue)})`);
        }
        if (rvUnpaid.length > 0 || rvDue > 0) {
          firmLines.push(`  • R.V Enterprises: *${rvUnpaid.length} Bills Pending* (Due ₹ ${formatInr(rvDue)})`);
        }
        if (firmLines.length > 0) {
          text += `🏭 *ENTERPRISE BREAKDOWN:*\n${firmLines.join('\n')}\n\n`;
        }
      }
    }

    text += `👉 _Agar bills ki list dekhna chahte hain toh neeche button tap karein:_`;

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

  // ─── 4. PENDING BILLS LIST VIEW ("konse pending hai") ────────────────────
  if (intent === 'pending_list') {
    const PAGE_SIZE = 8;
    const totalPages = Math.ceil(unpaidInvoices.length / PAGE_SIZE) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const pagedInvoices = unpaidInvoices.slice(startIndex, startIndex + PAGE_SIZE);

    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `📋 *PENDING UNPAID BILLS (${unpaidInvoices.length} of ${filteredInvoices.length} Total)*\n`;
    text += `🏢 Scope: *${firmHeader}* (Page ${currentPage}/${totalPages})\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (unpaidInvoices.length === 0) {
      text += `✨ *No pending bills! All ${filteredInvoices.length} invoices are fully paid.* 🎉\n\n`;
    } else {
      pagedInvoices.forEach((inv, idx) => {
        const firm = inv.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
        const isPartial = inv.received > 0;
        const statusTag = isPartial ? `🟡 PARTIALLY PAID (Due ₹ ${formatInr(inv.due)})` : `⏳ UNPAID (Due ₹ ${formatInr(inv.due)})`;

        text += `${startIndex + idx + 1}️⃣ *Bill ${inv.billNoFormatted}* (${firm})\n`;
        text += `  • Date: *${formatDateReadable(inv.date)}*\n`;
        text += `  • Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
        text += `  • Received: *₹ ${formatInr(inv.received)}*`;
        if (inv.tds > 0) text += ` (TDS: ₹ ${formatInr(inv.tds)})`;
        text += `\n`;
        text += `  • Pending Due: *₹ ${formatInr(inv.due)}*\n`;
        text += `  • Status: ${statusTag}\n\n`;
      });

      text += `━━━━━━━━━━━━━━━━━━━━━\n`;
      text += `⚠️ *Total Outstanding Balance:* *₹ ${formatInr(totalDue)}*\n\n`;

      const billNoTags = unpaidInvoices.map(inv => `\`${inv.billNoFormatted}\``).join('  •  ');
      text += `📋 *ALL PENDING BILL NUMBERS:*\n  👉 ${billNoTags}\n\n`;
    }

    if (company.contactNumber || company.kindAttn) {
      text += `📞 *Contact:* ${company.kindAttn || 'N/A'}`;
      if (company.contactNumber) text += ` (\`${company.contactNumber}\`)`;
      text += `\n`;
    }

    const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
    const navRow: Array<{ text: string; callback_data: string }> = [];

    if (currentPage > 1) {
      navRow.push({ text: '⬅️ Prev', callback_data: `page:pendlist:${company.name}:${currentPage - 1}` });
    }
    if (currentPage < totalPages) {
      navRow.push({ text: 'Next ➡️', callback_data: `page:pendlist:${company.name}:${currentPage + 1}` });
    }
    if (navRow.length > 0) {
      buttons.push(navRow);
    }

    buttons.push([
      { text: '📄 View All Invoices', callback_data: `comp_bills:${company.name}` },
      { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
    ]);
    buttons.push([
      { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
    ]);

    return {
      text: text.trim(),
      buttons,
    };
  }

  // ─── 5. PENDING BALANCE SUMMARY VIEW ("kitna paisa baki hai") ────────────
  if (intent === 'pending') {
    let text = `🏢 *${company.name.toUpperCase()}*\n`;
    text += `🏢 Scope: *${firmHeader}*\n`;
    if (monthHeader) text += monthHeader;
    text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    text += `⚠️ *TOTAL OUTSTANDING DUE: ₹ ${formatInr(totalDue)}*\n\n`;

    text += `💰 *FINANCIAL OVERVIEW:*\n`;
    text += `  • Total Invoices Generated: *${filteredInvoices.length} Bills* (₹ ${formatInr(totalBilled)})\n`;
    text += `  • Fully Paid Invoices: *${paidInvoices.length} Bills* (₹ ${formatInr(totalReceived)})\n`;
    text += `  • Unpaid / Pending Bills: *${unpaidInvoices.length} Bills* (₹ ${formatInr(totalDue)})\n`;
    if (totalTds > 0) {
      text += `  • Total TDS Deducted: *₹ ${formatInr(totalTds)}*\n`;
    }
    if (totalOtherDed > 0) {
      text += `  • Other Deductions: *₹ ${formatInr(totalOtherDed)}*\n`;
    }
    text += `\n`;

    if (unpaidInvoices.length > 0) {
      const billNoTags = unpaidInvoices.map(inv => `\`${inv.billNoFormatted}\``).join('  •  ');
      text += `📋 *PENDING BILL NUMBERS:*\n  👉 ${billNoTags}\n\n`;
    }

    if (activeFirm === 'Both') {
      const firmLines: string[] = [];
      if (vithalDue > 0 || vithalTotal > 0) {
        firmLines.push(`  • Vithal Enterprises: Billed ₹ ${formatInr(vithalTotal)} | *Due: ₹ ${formatInr(vithalDue)}* (${vithalUnpaid.length} Pending)`);
      }
      if (rvDue > 0 || rvTotal > 0) {
        firmLines.push(`  • R.V Enterprises: Billed ₹ ${formatInr(rvTotal)} | *Due: ₹ ${formatInr(rvDue)}* (${rvUnpaid.length} Pending)`);
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

  // ─── 6. ALL BILLS HISTORY BREAKDOWN VIEW ("saare bills") ─────────────────
  const PAGE_SIZE = 8;
  const totalPages = Math.ceil(filteredInvoices.length / PAGE_SIZE) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const pagedInvoices = filteredInvoices.slice(startIndex, startIndex + PAGE_SIZE);

  let text = `🏢 *${company.name.toUpperCase()}*\n`;
  text += `🏢 Scope: *${firmHeader}* (Page ${currentPage}/${totalPages})\n`;
  if (monthHeader) text += monthHeader;
  text += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  text += `💰 *FINANCIAL SUMMARY:*\n`;
  if (activeFirm === 'Both') {
    const firmLines: string[] = [];
    if (vithalTotal > 0 || vithalDue > 0) {
      firmLines.push(`  • Vithal Enterprises: Billed ₹ ${formatInr(vithalTotal)} | *Due: ₹ ${formatInr(vithalDue)}*`);
    }
    if (rvTotal > 0 || rvDue > 0) {
      firmLines.push(`  • R.V Enterprises: Billed ₹ ${formatInr(rvTotal)} | *Due: ₹ ${formatInr(rvDue)}*`);
    }
    if (firmLines.length > 0) {
      text += `${firmLines.join('\n')}\n`;
    }
  }
  text += `  • Total Basic / Taxable: *₹ ${formatInr(totalBasic)}*\n`;
  text += `  • Total GST (CGST+SGST): *₹ ${formatInr(totalGst)}*\n`;
  text += `  • Total Grand Invoiced: *₹ ${formatInr(totalBilled)}* (${filteredInvoices.length} Bills)\n`;
  text += `  • Total Received: *₹ ${formatInr(totalReceived)}* (${paidInvoices.length} Settled)\n`;
  if (totalTds > 0) {
    text += `  • Total TDS Deducted: *₹ ${formatInr(totalTds)}*\n`;
  }
  if (totalOtherDed > 0) {
    text += `  • Other Deductions: *₹ ${formatInr(totalOtherDed)}*\n`;
  }
  text += `  • Outstanding Due: *₹ ${formatInr(totalDue)}* (${unpaidInvoices.length} Pending)\n\n`;

  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `📄 *DETAILED BILLS BREAKDOWN (${filteredInvoices.length}):*\n\n`;

  pagedInvoices.forEach((inv, idx) => {
    const firm = inv.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises';
    const isPaid = inv.isPaid;
    const isPartial = !isPaid && inv.received > 0;
    const statusTag = isPaid ? '✅ PAID' : isPartial ? `🟡 PARTIALLY PAID (Due ₹ ${formatInr(inv.due)})` : `⏳ UNPAID (Due ₹ ${formatInr(inv.due)})`;

    text += `${startIndex + idx + 1}️⃣ *Bill ${inv.billNoFormatted}* (${firm})\n`;
    text += `  • Date: *${formatDateReadable(inv.date)}*\n`;
    text += `  • Basic Amount: *₹ ${formatInr(inv.netTotal)}*\n`;
    if (inv.gstAmount > 0) {
      text += `  • GST: *₹ ${formatInr(inv.gstAmount)}*\n`;
    }
    text += `  • Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
    text += `  • Received: *₹ ${formatInr(inv.received)}*\n`;
    if (inv.tds > 0) {
      text += `  • TDS Deducted: *₹ ${formatInr(inv.tds)}*\n`;
    }
    text += `  • Outstanding Due: *₹ ${formatInr(inv.due)}*\n`;
    text += `  • Status: ${statusTag}\n\n`;
  });

  if (company.contactNumber || company.kindAttn) {
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `📞 *Contact Person:* ${company.kindAttn || 'N/A'}\n`;
    if (company.contactNumber) text += `📱 *Phone:* \`${company.contactNumber}\`\n`;
  }

  const buttons: Array<Array<{ text: string; callback_data: string }>> = [];
  const navRow: Array<{ text: string; callback_data: string }> = [];

  if (currentPage > 1) {
    navRow.push({ text: '⬅️ Prev', callback_data: `page:bills:${company.name}:${currentPage - 1}` });
  }
  if (currentPage < totalPages) {
    navRow.push({ text: 'Next ➡️', callback_data: `page:bills:${company.name}:${currentPage + 1}` });
  }
  if (navRow.length > 0) {
    buttons.push(navRow);
  }

  buttons.push([
    { text: '⚠️ View Due Summary', callback_data: `comp_pend:${company.name}` },
    { text: `📋 Only Pending Bills (${unpaidInvoices.length})`, callback_data: `comp_pendlist:${company.name}` },
  ]);
  buttons.push([
    { text: '🚜 Site Forklifts', callback_data: `comp_fork:${company.name}` },
    { text: '🔄 Change Firm Scope', callback_data: 'menu:firm' },
  ]);

  return {
    text: text.trim(),
    buttons,
  };
}

/**
 * Fleet status query executor.
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
        msg += `  • Model: *${f.make || ''} ${f.model || ''}*\n`;
        msg += `  • Capacity: *${f.capacity || 'N/A'}*\n`;
        msg += `  • Location: *Workshop*\n\n`;
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
        msg += `  • Client Site: *${site}*\n`;
        msg += `  • Capacity: *${f.capacity || 'N/A'}*\n`;
        if (f.siteArea) msg += `  • Area: *${f.siteArea}*\n`;
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
  msg += `  • Total Fleet: *${all.length} Units*\n`;
  msg += `  • On-Site (Deployed): *${onSite.length} Units*\n`;
  msg += `  • Workshop (Idle): *${workshop.length} Units*\n`;
  if (notConfirmed.length > 0) {
    msg += `  • Unconfirmed: *${notConfirmed.length} Units*\n`;
  }
  msg += `  • Fleet Utilization: *${utilRate}%*\n\n`;

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
 * Single forklift lookup.
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
  msg += `  • Firm: *${firm}*\n`;
  msg += `  • Make / Model: *${f.make || ''} ${f.model || ''}*\n`;
  msg += `  • Capacity: *${f.capacity || 'N/A'}*\n`;
  msg += `  • Location: *${f.locationType || 'N/A'}*\n`;
  if (f.locationType === 'On-Site') {
    msg += `  • Client Site: *${f.siteCompany || 'N/A'}*\n`;
    if (f.siteArea) msg += `  • Area: *${f.siteArea}*\n`;
    if (f.siteContactPerson) msg += `  • Contact: *${f.siteContactPerson}* (${f.siteContactNumber || ''})\n`;
  }
  if (f.remarks) msg += `  • Remarks: _${f.remarks}_\n`;

  return { text: msg.trim() };
}

/**
 * Attendance summary executor.
 */
export async function getTodayAttendanceSummary(mode: 'all' | 'absent' | 'present' = 'all'): Promise<AssistantResponse> {
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

  if (mode === 'absent') {
    let msg = `🔴 *ABSENT STAFF TODAY (${formatDateReadable(today)})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    if (absent.length === 0) {
      msg += `✨ *All staff members are present today!* 🎉\n`;
    } else {
      msg += `Total Absent: *${absent.length} Staff*\n\n`;
      absent.forEach((name, i) => {
        msg += `  ${i + 1}. *${name}*\n`;
      });
    }
    return { text: msg.trim() };
  }

  if (mode === 'present') {
    let msg = `🟢 *PRESENT STAFF TODAY (${formatDateReadable(today)})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `Total Present: *${present.length} Staff*\n\n`;
    present.forEach((name, i) => {
      msg += `  ${i + 1}. *${name}*\n`;
    });
    return { text: msg.trim() };
  }

  let msg = `📅 *ATTENDANCE TODAY (${formatDateReadable(today)})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `👥 *ATTENDANCE SUMMARY:*\n`;
  msg += `  • Total Staff: *${empSnap.size}*\n`;
  msg += `  • Present: *${present.length}*\n`;
  msg += `  • Absent: *${absent.length}*\n`;
  if (halfDay.length > 0) {
    msg += `  • Half-Day: *${halfDay.length}*\n`;
  }
  msg += `\n`;

  if (absent.length > 0) {
    msg += `🔴 *ABSENT STAFF (${absent.length}):*\n`;
    absent.forEach((name, i) => {
      msg += `  ${i + 1}. *${name}*\n`;
    });
    msg += `\n`;
  }

  if (present.length > 0) {
    msg += `🟢 *PRESENT STAFF (${present.length}):*\n`;
    msg += `  • ${present.join(', ')}\n`;
  }

  return { text: msg.trim() };
}

/**
 * Monthly billing summary with full invoice breakdown.
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

  const paymentsByInvoice: Record<string, { received: number; tds: number; otherDeductions: number }> = {};
  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId) {
      const invKey = String(pay.invoiceId);
      if (!paymentsByInvoice[invKey]) {
        paymentsByInvoice[invKey] = { received: 0, tds: 0, otherDeductions: 0 };
      }
      paymentsByInvoice[invKey].received += Number(pay.receivedAmount || 0);
      paymentsByInvoice[invKey].tds += Number(pay.tdsDeducted || 0);
      paymentsByInvoice[invKey].otherDeductions += Number(pay.otherDeductions || 0);
    }
  });

  const monthInvoices: ProcessedInvoiceData[] = [];

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');
    if (bMonth === monthKey || (inv.billDate && inv.billDate.startsWith(monthKey))) {
      const compName = companyMap.get(inv.companyId) || 'Client Company';
      const processed = calculateInvoiceDue(inv, d.id, paymentsByInvoice, compName);
      monthInvoices.push(processed);
    }
  });

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
  const totalDue = monthInvoices.reduce((s, i) => s + i.due, 0);

  const vithalTotal = vithalInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const vithalDue = vithalInvoices.reduce((s, i) => s + i.due, 0);

  const rvTotal = rvInvoices.reduce((s, i) => s + i.grandTotal, 0);
  const rvDue = rvInvoices.reduce((s, i) => s + i.due, 0);

  let msg = `📊 *BILLING STATEMENT - ${monthLabel.toUpperCase()}*\n`;
  msg += `🏢 Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `💰 *${monthLabel.toUpperCase()} FINANCIAL SUMMARY:*\n`;
  if (activeFirm === 'Both') {
    if (vithalInvoices.length > 0) {
      msg += `  • Vithal Enterprises: Billed ₹ ${formatInr(vithalTotal)} (${vithalInvoices.length} Bills) | *Due: ₹ ${formatInr(vithalDue)}*\n`;
    }
    if (rvInvoices.length > 0) {
      msg += `  • R.V Enterprises: Billed ₹ ${formatInr(rvTotal)} (${rvInvoices.length} Bills) | *Due: ₹ ${formatInr(rvDue)}*\n`;
    }
  }
  msg += `  • Total Basic / Taxable: *₹ ${formatInr(totalBasic)}*\n`;
  msg += `  • Total GST (CGST+SGST): *₹ ${formatInr(totalGst)}*\n`;
  msg += `  • Total Grand Invoiced: *₹ ${formatInr(totalBilled)}* (${monthInvoices.length} Bills)\n`;
  msg += `  • Total Received: *₹ ${formatInr(totalReceived)}*\n`;
  if (totalTds > 0) {
    msg += `  • Total TDS Deducted: *₹ ${formatInr(totalTds)}*\n`;
  }
  if (totalOtherDed > 0) {
    msg += `  • Other Deductions: *₹ ${formatInr(totalOtherDed)}*\n`;
  }
  msg += `  • Total Month Due Balance: *₹ ${formatInr(totalDue)}*\n\n`;

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *ALL INVOICES GENERATED IN ${monthLabel.toUpperCase()} (${monthInvoices.length}):*\n\n`;

  monthInvoices.forEach((inv, idx) => {
    const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    const isPaid = inv.isPaid;
    const isPartial = !isPaid && inv.received > 0;
    const statusTag = isPaid ? '✅ PAID' : isPartial ? `🟡 PARTIAL (Due ₹ ${formatInr(inv.due)})` : `⏳ DUE ₹ ${formatInr(inv.due)}`;

    msg += `${idx + 1}️⃣ *Bill ${inv.billNoFormatted}* • *${inv.companyName}* (${firm})\n`;
    msg += `  • Date: *${formatDateReadable(inv.date)}*\n`;
    msg += `  • Basic: ₹ ${formatInr(inv.netTotal)} | GST: ₹ ${formatInr(inv.gstAmount)}\n`;
    msg += `  • Grand Total: *₹ ${formatInr(inv.grandTotal)}*\n`;
    msg += `  • Received: ₹ ${formatInr(inv.received)}`;
    if (inv.tds > 0) msg += ` (TDS: ₹ ${formatInr(inv.tds)})`;
    msg += `\n`;
    msg += `  • Outstanding: *₹ ${formatInr(inv.due)}*\n`;
    msg += `  • Status: ${statusTag}\n\n`;
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
 * Get monthly pending bills strictly filtered by Month and Firm.
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

  const paymentsByInvoice: Record<string, { received: number; tds: number; otherDeductions: number }> = {};
  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId) {
      const invKey = String(pay.invoiceId);
      if (!paymentsByInvoice[invKey]) {
        paymentsByInvoice[invKey] = { received: 0, tds: 0, otherDeductions: 0 };
      }
      paymentsByInvoice[invKey].received += Number(pay.receivedAmount || 0);
      paymentsByInvoice[invKey].tds += Number(pay.tdsDeducted || 0);
      paymentsByInvoice[invKey].otherDeductions += Number(pay.otherDeductions || 0);
    }
  });

  const pendingInvoices: ProcessedInvoiceData[] = [];

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const ent = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    if (activeFirm !== 'Both' && ent !== activeFirm) return;

    const bMonth = inv.billingMonth || (inv.billDate ? inv.billDate.slice(0, 7) : '');
    if (bMonth === monthKey || (inv.billDate && inv.billDate.startsWith(monthKey))) {
      const compName = companyMap.get(inv.companyId) || 'Client Company';
      const processed = calculateInvoiceDue(inv, d.id, paymentsByInvoice, compName);
      if (!processed.isPaid) {
        pendingInvoices.push(processed);
      }
    }
  });

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
  msg += `🏢 Scope: *${firmLabel}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📊 *SUMMARY:*\n`;
  msg += `  • Total Unpaid Invoices: *${pendingInvoices.length} Bills*\n`;
  msg += `  • Total Pending Due: *₹ ${formatInr(totalPendingDue)}*\n\n`;

  if (pendingInvoices.length > 0) {
    const billNoTags = pendingInvoices.map(inv => `\`${inv.billNoFormatted}\``).join('  •  ');
    msg += `📋 *PENDING BILL NUMBERS:*\n  👉 ${billNoTags}\n\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *UNPAID BILLS LIST (${pendingInvoices.length}):*\n\n`;

  pendingInvoices.forEach((inv, idx) => {
    const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    const isPartial = inv.received > 0;
    const statusTag = isPartial ? `🟡 PARTIAL (Paid ₹ ${formatInr(inv.received)})` : `⏳ UNPAID`;

    msg += `${idx + 1}️⃣ *Bill ${inv.billNoFormatted}* • *${inv.companyName}* (${firm})\n`;
    msg += `  • Date: *${formatDateReadable(inv.date)}*\n`;
    msg += `  • Grand Total: ₹ ${formatInr(inv.grandTotal)}\n`;
    msg += `  • Pending Due: *₹ ${formatInr(inv.due)}*\n`;
    msg += `  • Status: ${statusTag}\n\n`;
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
 * List all registered companies.
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
 * Disambiguation Helper.
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
 * Gemini NLU JSON Intent Extractor.
 * Strictly outputs a JSON StructuredIntent object without inventing numbers.
 */
async function extractIntentWithGeminiNLU(userPrompt: string, session: UserConversationContext): Promise<StructuredIntent | null> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) return null;

  try {
    const systemPrompt = `
You are an expert NLU Intent Extractor for an Industrial Forklift business assistant ("Vithal Enterprises" & "R.V Enterprises").
Your task is to analyze the user's natural message (Hindi/Hinglish/English) and return ONLY a strict JSON object.

CURRENT CONTEXT:
- Last Intent: "${session.lastIntent || 'none'}"
- Last Company Entity: "${session.lastEntity || 'none'}"
- Last Firm: "${session.lastFirm || 'Both'}"
- Last Month: "${session.lastMonth ? session.lastMonth.monthLabel : 'none'}"

POSSIBLE INTENTS:
- "pending_balance": User asking how much money is due/pending from a company ("Bisleri ka kitna paisa baki hai", "Bisleri balance").
- "pending_bill_count": User asking HOW MANY bills are pending ("Bisleri ke kitne bills pending hai", "how many unpaid bills").
- "pending_bill_list": User asking WHICH specific bills are pending ("Bisleri ke konse pending hai", "unpaid bills list").
- "bill_history": User asking for all invoices/full account history ("Bisleri bills", "saare bill dikhao", "pura account").
- "billing_summary": Overall sales/billing summary for a month ("August billing", "last month revenue").
- "monthly_pending_bills": All unpaid bills in a specific month ("is month ke saare pending bills Vithal ke", "August pending bills").
- "top_debtors": Highest pending debtors ranking ("Top pending", "sabse zyada baki kiska hai").
- "workshop_forklifts": Forklifts idle in workshop ("Workshop me kitni gadi hai", "khali gadi").
- "onsite_forklifts": Forklifts deployed on site ("Onsite kitni gadi hai").
- "fleet_summary": Total fleet status.
- "forklift_details": Details of a specific serial number.
- "attendance_today": Overall staff attendance.
- "absent_staff": Absent staff list ("aaj kaun nahi aaya").
- "present_staff": Present staff list ("aaj kaun kaun aaya").
- "firm_switch": Change active firm scope.
- "casual_conversation": Greetings ("bhai kya haal hai", "hello").
- "help": Help request.

OUTPUT JSON FORMAT ONLY:
{
  "intent": "<intent_name>",
  "entity": "<company_name_or_serial_if_applicable>",
  "firm": "Vithal" | "RV" | "Both",
  "detailLevel": "summary" | "detailed" | "count",
  "limit": number | null,
  "confidence": 0.95
}
`;

    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: `${systemPrompt}\n\nUSER MESSAGE: "${userPrompt}"` }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 300,
        responseMimeType: 'application/json',
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
          const rawOutput = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawOutput) {
            const parsed = JSON.parse(rawOutput);
            return {
              intent: parsed.intent || 'unknown',
              entity: parsed.entity && parsed.entity !== 'none' ? parsed.entity : undefined,
              firm: parsed.firm || session.lastFirm || 'Both',
              detailLevel: parsed.detailLevel || 'summary',
              limit: parsed.limit || undefined,
              confidence: Number(parsed.confidence || 0.9),
              rawText: userPrompt,
            };
          }
        }
      } catch {
        // Fallback to next model
      }
    }
  } catch (e) {
    console.warn('Gemini NLU extraction failed:', e);
  }
  return null;
}

/**
 * Deterministic Intent & Follow-up Resolver.
 */
export async function resolveUserIntent(userPrompt: string, chatId: string): Promise<StructuredIntent> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();
  const session = getUserSession(chatId);
  const userActiveFirm = await getUserActiveFirm(chatId);
  const targetMonth = extractTargetMonth(raw);

  // 1. Direct Firm Commands
  if (lower === '/firm' || lower === 'firm' || lower === '/switch' || lower === 'switch' || lower === 'change firm') {
    return { intent: 'firm_switch', firm: userActiveFirm, detailLevel: 'summary', confidence: 1.0, rawText: raw };
  }

  // 2. Casual Conversation
  if (
    lower === 'hi' || lower === 'hello' || lower === 'hey' || lower === 'namaste' ||
    lower === 'salam' || lower.includes('kya haal hai') || lower.includes('kaise ho') ||
    lower.includes('kya hal hai') || lower === 'bhai'
  ) {
    return { intent: 'casual_conversation', firm: userActiveFirm, detailLevel: 'summary', confidence: 1.0, rawText: raw };
  }

  // 3. Help Command
  if (lower === '/help' || lower === 'help' || lower.includes('kya kar sakte ho') || lower.includes('commands')) {
    return { intent: 'help', firm: userActiveFirm, detailLevel: 'summary', confidence: 1.0, rawText: raw };
  }

  // 4. Follow-up Query Modifications
  // Case A: Firm change follow-up ("RV ka?", "Vithal pe karo", "sirf RV", "dono ka")
  const isFirmFollowUp = (
    (lower === 'rv' || lower === 'vithal' || lower === 'both' || lower.startsWith('rv ka') || lower.startsWith('vithal ka') || lower.startsWith('dono ka') || lower.includes('sirf rv') || lower.includes('sirf vithal')) &&
    session.lastEntity
  );
  if (isFirmFollowUp) {
    const newFirm = extractFirmFromQuery(raw, session.lastFirm || userActiveFirm);
    return {
      intent: session.lastIntent || 'pending_balance',
      entity: session.lastEntity,
      firm: newFirm,
      timeRange: session.lastMonth,
      detailLevel: session.lastDetailLevel || 'summary',
      confidence: 0.98,
      rawText: raw,
    };
  }

  // Case B: Month follow-up ("August ka?", "Pichle mahine ka?", "July ka dikhao")
  if (targetMonth && (lower.endsWith('ka?') || lower.endsWith('ka') || lower.startsWith('aur ') || lower.startsWith('ab ')) && session.lastEntity) {
    return {
      intent: session.lastIntent || 'pending_balance',
      entity: session.lastEntity,
      firm: session.lastFirm || userActiveFirm,
      timeRange: targetMonth,
      detailLevel: session.lastDetailLevel || 'summary',
      confidence: 0.95,
      rawText: raw,
    };
  }

  // Case C: Detail level follow-up ("Pura detail dikhao", "Bas total batao", "Bills dikhao", "Kaun kaun se")
  if (session.lastEntity && (lower.includes('pura detail') || lower.includes('detail dikhao') || lower.includes('saare bills') || lower === 'bills')) {
    return {
      intent: 'bill_history',
      entity: session.lastEntity,
      firm: session.lastFirm || userActiveFirm,
      timeRange: session.lastMonth,
      detailLevel: 'detailed',
      confidence: 0.98,
      rawText: raw,
    };
  }
  if (session.lastEntity && (lower.includes('bas total') || lower.includes('sirf total') || lower.includes('total batao'))) {
    return {
      intent: 'pending_balance',
      entity: session.lastEntity,
      firm: session.lastFirm || userActiveFirm,
      timeRange: session.lastMonth,
      detailLevel: 'summary',
      confidence: 0.98,
      rawText: raw,
    };
  }
  if (session.lastEntity && (lower.includes('kaun kaun') || lower.includes('konse pending') || lower.includes('pending bills'))) {
    return {
      intent: 'pending_bill_list',
      entity: session.lastEntity,
      firm: session.lastFirm || userActiveFirm,
      timeRange: session.lastMonth,
      detailLevel: 'detailed',
      confidence: 0.98,
      rawText: raw,
    };
  }

  // Case D: Top Debtors limit follow-up ("Top 5 karo", "Top 20", "Sirf top 5")
  const limitMatch = lower.match(/top\s*(\d+)/i) || lower.match(/sirf\s*(\d+)/i);
  if (limitMatch && (session.lastIntent === 'top_debtors' || lower.includes('pending') || lower.includes('due') || lower.includes('baki'))) {
    const num = parseInt(limitMatch[1], 10);
    const firm = extractFirmFromQuery(raw, session.lastFirm || userActiveFirm);
    return {
      intent: 'top_debtors',
      firm,
      limit: num,
      detailLevel: 'summary',
      confidence: 0.98,
      rawText: raw,
    };
  }

  // 5. Top Debtors Fresh Query
  if (
    lower.includes('top pending') || lower.includes('pending list') || lower.includes('baki list') ||
    lower.includes('kiske kitne baki') || lower.includes('kiska balance') || lower.includes('sabse zyada balance') ||
    lower.includes('sabse jyada baki') || lower.includes('debtors') || lower.includes('top due') ||
    lower === 'pending' || lower === 'dues' || lower === 'balance'
  ) {
    const firm = extractFirmFromQuery(raw, userActiveFirm);
    return { intent: 'top_debtors', firm, limit: 10, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  // 6. Fleet Fresh Query
  if (
    hasWord(lower, 'workshop') || hasWord(lower, 'idle') || hasWord(lower, 'khade') ||
    hasWord(lower, 'khada') || hasWord(lower, 'godown') || hasWord(lower, 'garage') ||
    hasWord(lower, 'khali') || lower.includes('workshop forklift') || lower.includes('workshop me')
  ) {
    const firm = extractFirmFromQuery(raw, userActiveFirm);
    return { intent: 'workshop_forklifts', firm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  if (
    hasWord(lower, 'onsite') || hasWord(lower, 'on-site') || hasWord(lower, 'deployed') ||
    hasWord(lower, 'bahar') || lower.includes('on site') || lower.includes('client site') || lower.includes('site par')
  ) {
    const firm = extractFirmFromQuery(raw, userActiveFirm);
    return { intent: 'onsite_forklifts', firm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  if (
    hasWord(lower, 'fleet') || hasWord(lower, 'forklift') || hasWord(lower, 'forklifts') ||
    hasWord(lower, 'gadi') || hasWord(lower, 'gaadi') || hasWord(lower, 'machines') ||
    lower.includes('total unit') || lower.includes('total fleet') || lower.includes('total gadi')
  ) {
    const firm = extractFirmFromQuery(raw, userActiveFirm);
    return { intent: 'fleet_summary', firm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  // 7. Attendance Fresh Query
  if (
    hasWord(lower, 'absent') || lower.includes('kaun nahi aaya') || lower.includes('kon nahi aaya') ||
    lower.includes('absent staff') || lower.includes('chhutti')
  ) {
    return { intent: 'absent_staff', firm: userActiveFirm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  if (lower.includes('kaun aya') || lower.includes('kon aya') || lower.includes('present staff')) {
    return { intent: 'present_staff', firm: userActiveFirm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  if (hasWord(lower, 'attendance') || hasWord(lower, 'haziri') || lower.includes('today attendance') || lower.includes('staff report')) {
    return { intent: 'attendance_today', firm: userActiveFirm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  // 8. All Companies Fresh Query
  if (lower.includes('all companies') || lower.includes('company list') || lower.includes('companies list') || lower === 'companies' || lower === 'company') {
    return { intent: 'all_companies', firm: userActiveFirm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
  }

  // 9. Monthly Pending Bills / Billing Fresh Query (Without company name)
  const isMonthlyPendingRequest = (
    targetMonth !== null &&
    (
      hasWord(lower, 'pending') || hasWord(lower, 'baki') || hasWord(lower, 'due') ||
      hasWord(lower, 'unpaid') || lower.includes('pending bills') || lower.includes('baki bills')
    )
  );

  const isMonthlyBillingRequest = (
    hasWord(lower, 'billing') || hasWord(lower, 'revenue') || hasWord(lower, 'turnover') ||
    hasWord(lower, 'collection') || hasWord(lower, 'kamai') || lower.includes('total bill') ||
    lower.includes('sales') || (targetMonth !== null && (hasWord(lower, 'bills') || hasWord(lower, 'bill') || hasWord(lower, 'hisab')))
  );

  const queryFirm = extractFirmFromQuery(raw, userActiveFirm);

  // Check if query matches a company
  const firestore = await getAuthenticatedFirestore();
  const companiesSnap = await getDocs(collection(firestore, 'companies'));
  const allCompanyNames = companiesSnap.docs.map(d => String(d.data().name || '').trim()).filter(Boolean);

  const stopWords = new Set([
    'pvt', 'ltd', 'limited', 'private', 'enterprises', 'enterprise',
    'llp', 'and', 'the', 'services', 'solutions', 'international',
    'internationals', 'group', 'india', 'supply', 'chain', 'corp',
    'corporation', 'industries', 'freight', 'logistics', 'logictics',
    'traders', 'trading', 'works', 'company', 'ka', 'ki', 'ke', 'details',
    'batao', 'chahiye', 'kya', 'hai', 'dikhao', 'pending', 'bills', 'bill',
    'last', 'previous', 'month', 'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'kaun', 'kitna', 'baki', 'due',
    'konse', 'kitne', 'saare', 'sab', 'invoices', 'account', 'pura', 'hisaab'
  ]);

  const matchedCompanies: string[] = [];

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

  // If no company matched and query is a month query
  if (matchedCompanies.length === 0) {
    if (isMonthlyPendingRequest) {
      return { intent: 'monthly_pending_bills', firm: queryFirm, timeRange: targetMonth, detailLevel: 'detailed', confidence: 0.95, rawText: raw };
    }
    if (isMonthlyBillingRequest) {
      return { intent: 'billing_summary', firm: queryFirm, timeRange: targetMonth, detailLevel: 'summary', confidence: 0.95, rawText: raw };
    }
  }

  // If single company matched:
  if (matchedCompanies.length === 1) {
    const companyName = matchedCompanies[0];

    // Check intent precision
    const isAskingCount = (
      lower.includes('kitne bill') || lower.includes('kitne bills') || lower.includes('kitna bill baki') ||
      lower.includes('kitne invoice') || lower.includes('kitne pending') || lower.includes('how many') ||
      lower.includes('count of pending')
    );

    const isAskingPendingList = (
      lower.includes('konse pending') || lower.includes('konse bill') || lower.includes('kaun se pending') ||
      lower.includes('kaun se bill') || lower.includes('pending bills dikhao') || lower.includes('pending bills list') ||
      lower.includes('unpaid bills') || lower.includes('pending invoices')
    );

    const isAskingPendingBalance = (
      hasWord(lower, 'pending') || hasWord(lower, 'due') || hasWord(lower, 'balance') ||
      hasWord(lower, 'baki') || hasWord(lower, 'unpaid') || lower.includes('kitna paisa') ||
      lower.includes('paisa baki') || lower.includes('kitna lena') || lower.includes('balance kitna')
    );

    const isAskingBillsHistory = (
      hasWord(lower, 'bills') || hasWord(lower, 'invoices') || (hasWord(lower, 'bill') && !isAskingCount && !isAskingPendingList && !isAskingPendingBalance) ||
      lower.includes('pura account') || lower.includes('billing history') || lower.includes('all bills') || lower.includes('saare bill')
    );

    let specificIntent: IntentType = 'pending_balance';
    let detailLevel: 'summary' | 'detailed' | 'count' = 'summary';

    if (isAskingCount) {
      specificIntent = 'pending_bill_count';
      detailLevel = 'count';
    } else if (isAskingPendingList) {
      specificIntent = 'pending_bill_list';
      detailLevel = 'detailed';
    } else if (isAskingBillsHistory) {
      specificIntent = 'bill_history';
      detailLevel = 'detailed';
    } else if (isAskingPendingBalance) {
      specificIntent = 'pending_balance';
      detailLevel = 'summary';
    } else if (hasWord(lower, 'forklift') || hasWord(lower, 'gadi')) {
      specificIntent = 'onsite_forklifts';
      detailLevel = 'summary';
    }

    return {
      intent: specificIntent,
      entity: companyName,
      firm: queryFirm,
      timeRange: targetMonth,
      detailLevel,
      confidence: 0.98,
      rawText: raw,
    };
  }

  // If multiple companies matched:
  if (matchedCompanies.length > 1) {
    return {
      intent: 'clarification_required',
      firm: queryFirm,
      detailLevel: 'summary',
      confidence: 0.95,
      rawText: raw,
    };
  }

  // 10. Forklift specific serial search
  const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
  for (const d of forkliftsSnap.docs) {
    const sn = String(d.data().serialNumber || '').trim();
    if (sn.length >= 2 && hasWord(raw, sn)) {
      return { intent: 'forklift_details', entity: sn, firm: queryFirm, detailLevel: 'summary', confidence: 0.98, rawText: raw };
    }
  }

  // 11. Try Gemini NLU for Unstructured Conversational Reasoning
  const geminiParsed = await extractIntentWithGeminiNLU(raw, session);
  if (geminiParsed && geminiParsed.intent !== 'unknown') {
    return geminiParsed;
  }

  return {
    intent: 'unknown',
    firm: queryFirm,
    detailLevel: 'summary',
    confidence: 0.5,
    rawText: raw,
  };
}

/**
 * Main Natural Language Processing Entrypoint.
 * Executes exact deterministic business query based on resolved Structured Intent.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string, chatId: string = ''): Promise<AssistantResponse> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  try {
    const firestore = await getAuthenticatedFirestore();
    const activeFirm = await getUserActiveFirm(chatId);

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

    // ─── 1. RESOLVE STRUCTURED INTENT WITH CONVERSATION CONTEXT ────────────
    const structured = await resolveUserIntent(raw, chatId);
    const session = getUserSession(chatId);

    // Save turn state in session
    saveUserSession(chatId, {
      lastIntent: structured.intent,
      lastEntity: structured.entity || session.lastEntity,
      lastFirm: structured.firm || session.lastFirm || activeFirm,
      lastMonth: structured.timeRange !== undefined ? structured.timeRange : session.lastMonth,
      lastDetailLevel: structured.detailLevel || session.lastDetailLevel,
      lastLimit: structured.limit || session.lastLimit,
      lastPage: structured.page || 1,
    });

    // ─── 2. DISPATCH TO EXACT DETERMINISTIC BUSINESS EXECUTORS ─────────────

    // Firm Switch
    if (structured.intent === 'firm_switch') {
      return await renderFirmSelectionMenu(chatId);
    }

    // Casual Greeting
    if (structured.intent === 'casual_conversation') {
      return {
        text: `Namaste! 🙏 Main aapka business assistant ready hoon.\n\nKripya batayein kis company ya billing ka data dekhna chahte hain?`,
        buttons: [
          [
            { text: '⚠️ Top Debtors', callback_data: 'quick:pending' },
            { text: '🚜 Fleet Status', callback_data: 'quick:fleet' },
          ],
          [
            { text: '📅 Today Attendance', callback_data: 'quick:attendance' },
            { text: '🏢 Change Firm', callback_data: 'menu:firm' },
          ],
        ],
      };
    }

    // Help
    if (structured.intent === 'help') {
      return {
        text: `🤖 *VE Business Assistant Guide*\n🏢 Scope: *${activeFirm === 'Both' ? 'Both Firms (Vithal + RV)' : activeFirm}*\n━━━━━━━━━━━━━━━━━━━━━\n\nAap WhatsApp ki tarah natural Hindi/Hinglish me pooch sakte hain:\n\n  • *Kitne Bills Pending:* _"Bisleri ke kitne bills pending hai"_\n  • *Konse Bills Pending:* _"Bisleri ke konse pending hai"_\n  • *Total Pending Due:* _"Bisleri ka kitna paisa baki hai"_\n  • *Saare Bills:* _"Bisleri bills"_\n  • *Month & Firm Filter:* _"is month ke saare pending bills Vithal ke"_\n  • *Top Debtors Ranking:* _"Top pending"_\n  • *Forklift Fleet:* _"Workshop"_, _"On-site"_\n  • *Staff Haziri:* _"Today attendance"_, _"Aaj kaun nahi aaya"_\n\n👇 *Select Active Firm below:*`,
        buttons: renderFirmRadioButtons(activeFirm),
      };
    }

    // Clarification Required (Multiple matching companies)
    if (structured.intent === 'clarification_required') {
      const companiesSnap = await getDocs(collection(firestore, 'companies'));
      const allCompanyNames = companiesSnap.docs.map(d => String(d.data().name || '').trim()).filter(Boolean);
      const matched = allCompanyNames.filter(c => stringSimilarity(raw, c) > 0.4 || raw.toLowerCase().includes(c.toLowerCase().slice(0, 4)));
      return renderCompanyDisambiguation(raw, matched, chatId);
    }

    // Company Specific Queries
    if (structured.entity) {
      if (structured.intent === 'pending_bill_count') {
        return await getCompanyDetailByIntent(structured.entity, 'count_pending', structured.firm, structured.timeRange);
      }
      if (structured.intent === 'pending_bill_list') {
        return await getCompanyDetailByIntent(structured.entity, 'pending_list', structured.firm, structured.timeRange, structured.page || 1);
      }
      if (structured.intent === 'bill_history') {
        return await getCompanyDetailByIntent(structured.entity, 'bills', structured.firm, structured.timeRange, structured.page || 1);
      }
      if (structured.intent === 'pending_balance') {
        return await getCompanyDetailByIntent(structured.entity, 'pending', structured.firm, structured.timeRange);
      }
      if (structured.intent === 'onsite_forklifts' || structured.intent === 'workshop_forklifts') {
        return await getCompanyDetailByIntent(structured.entity, 'forklifts', structured.firm, structured.timeRange);
      }
      // Default company view
      return await getCompanyDetailByIntent(structured.entity, 'all', structured.firm, structured.timeRange);
    }

    // Top Debtors Ranking
    if (structured.intent === 'top_debtors') {
      return await getTopPendingBalances(structured.firm, structured.limit || 10);
    }

    // Monthly Pending Bills
    if (structured.intent === 'monthly_pending_bills') {
      return await getMonthlyPendingBills(structured.firm, structured.timeRange);
    }

    // Monthly Billing Summary
    if (structured.intent === 'billing_summary') {
      return await getMonthlyBillingSummary(structured.firm, structured.timeRange);
    }

    // Fleet Status
    if (structured.intent === 'workshop_forklifts') {
      return await getFleetStatus('Workshop', structured.firm);
    }
    if (structured.intent === 'onsite_forklifts') {
      return await getFleetStatus('On-Site', structured.firm);
    }
    if (structured.intent === 'fleet_summary') {
      return await getFleetStatus(undefined, structured.firm);
    }
    if (structured.intent === 'forklift_details' && structured.entity) {
      return await getForkliftDetail(structured.entity);
    }

    // Attendance
    if (structured.intent === 'absent_staff') {
      return await getTodayAttendanceSummary('absent');
    }
    if (structured.intent === 'present_staff') {
      return await getTodayAttendanceSummary('present');
    }
    if (structured.intent === 'attendance_today') {
      return await getTodayAttendanceSummary('all');
    }

    // All Companies List
    if (structured.intent === 'all_companies') {
      return await listAllCompanies();
    }

  } catch (err: any) {
    console.error('Smart NLP processing error:', err);
    return { text: `⚠️ *Data load nahi ho paaya.*\n\nPlease thodi der baad try karein.` };
  }

  // Fallback Guide
  const activeFirm = await getUserActiveFirm(chatId);
  return {
    text: `🤖 *VE Dashboard AI Assistant*\n🏢 Scope: *${activeFirm === 'Both' ? 'Both Firms (Vithal + RV)' : activeFirm}*\n━━━━━━━━━━━━━━━━━━━━━\n\nAap bilkul specific sawaal pooch sakte hain:\n\n  • *Kitne Bills Pending:* _"Bisleri ke kitne bills pending hai"_\n  • *Konse Bills Pending:* _"Bisleri ke konse pending hai"_\n  • *Month & Firm Pending:* _"is month ke saare pending bills Vithal ke"_\n  • *Top Debtors Ranking:* _"Top pending"_\n  • *Forklift Fleet:* _"Workshop"_, _"On-site"_\n  • *Attendance:* _"Today attendance"_\n\n👇 *Select Active Firm below:*`,
    buttons: renderFirmRadioButtons(activeFirm),
  };
}
