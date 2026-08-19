/**
 * @fileOverview Smart Telegram Assistant Module
 * Handles natural language querying over Firestore data for Admin & Employees with beautiful tabular output,
 * permanent admin session persistence, strict firm separation (Vithal vs RV vs Both), intent routing, and multi-company disambiguation.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, getDoc, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

export type EnterpriseType = 'Vithal' | 'RV' | 'Both';

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

export const ADMIN_SECRET_CODE = '2028';

/**
 * Helper to pad strings for monospace ASCII tables.
 */
function pad(str: string | number, length: number, align: 'left' | 'right' = 'left'): string {
  const s = String(str ?? '');
  if (s.length >= length) return s.slice(0, length);
  const diff = length - s.length;
  return align === 'right' ? ' '.repeat(diff) + s : s + ' '.repeat(diff);
}

/**
 * Format currency in Indian number system.
 */
function formatInr(num: number): string {
  return num.toLocaleString('en-IN');
}

/**
 * Safe whole word check.
 */
function hasWord(text: string, word: string): boolean {
  const cleanWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(^|[^a-zA-Z0-9])${cleanWord}([^a-zA-Z0-9]|$)`, 'i');
  return regex.test(text);
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
 * Check if the given chatId is an authorized Admin (Permanent Persistence).
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
 * Get the active firm preference for the user (Defaults to 'Both').
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
 * Set the active firm preference for the user permanently.
 */
export async function setUserActiveFirm(chatId: string, firm: EnterpriseType): Promise<string> {
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

  let msg = `✅ *Active Firm Set To:* ${label}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Ab saare bills, fleet aur revenue queries **${label}** ke hisaab se dikhayenge.\n\n`;
  msg += `_Firm change karne ke liye kabhi bhi \`/firm\` type karein._`;
  return msg;
}

/**
 * Renders the Firm Selection Menu.
 */
export function renderFirmSelectionMenu(chatId?: string): string {
  if (chatId) awaitingFirmSelection.add(chatId);

  let msg = `🏢 *SELECT ACTIVE FIRM / ENTERPRISE*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Aap kis firm ka data dekhna chahte hain?\n\n`;
  msg += `1️⃣ *Vithal Enterprises* (Sirf Vithal ke bills & gadi)\n`;
  msg += `2️⃣ *R.V Enterprises* (Sirf RV ke bills & gadi)\n`;
  msg += `3️⃣ *Both Firms* (Vithal + RV Alag-Alag Table)\n\n`;
  msg += `👉 Reply karein: \`1\`, \`2\`, ya \`3\` (ya type karein \`/vithal\`, \`/rv\`, \`/both\`)`;
  return msg;
}

/**
 * Register a chatId as Admin (Permanent Lifetime Persistence).
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
 * Query company details strictly respecting the active firm scope (Vithal vs RV vs Both).
 */
export async function getCompanyDetailByIntent(
  companyName: string, 
  intent: 'pending' | 'bills' | 'forklifts' | 'all' = 'all',
  activeFirm: EnterpriseType = 'Both'
): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const companiesSnap = await getDocs(collection(firestore, 'companies'));

  const matchedCompanyDoc = companiesSnap.docs.find(d => {
    const name = String(d.data().name || '').toLowerCase().trim();
    return name === companyName.toLowerCase().trim();
  });

  if (!matchedCompanyDoc) {
    return `❌ *Company "${companyName}" Not Found*\n\nType *"all companies"* to see all registered clients.`;
  }

  const company = matchedCompanyDoc.data() as CompanySummary;
  const companyId = matchedCompanyDoc.id;

  // 1. Forklifts Intent
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

    const firmTag = activeFirm === 'Both' ? 'ALL FIRMS' : activeFirm.toUpperCase();
    let msg = `🚜 *FORKLIFTS AT ${company.name.toUpperCase()} [${firmTag}] (${companyForklifts.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (companyForklifts.length === 0) {
      msg += `_No forklifts currently recorded for ${activeFirm} at this client's site._\n`;
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬────────┬──────────────────┬──────────┐\n`;
      msg += `│ Serial # │ Firm   │ Make / Model     │ Capacity │\n`;
      msg += `├──────────┼────────┼──────────────────┼──────────┤\n`;
      companyForklifts.forEach(f => {
        const mm = `${f.make || ''} ${f.model || ''}`.trim() || 'Forklift';
        const firm = (f.firm || 'Vithal') === 'RV' ? 'RV' : 'Vithal';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(firm, 6)} │ ${pad(mm, 16)} │ ${pad(f.capacity || 'N/A', 8)} │\n`;
      });
      msg += `└──────────┴────────┴──────────────────┴──────────┘\n`;
      msg += `\`\`\`\n`;
    }
    return msg;
  }

  // 2. Fetch Invoices & Payments
  const invoicesQuery = query(collection(firestore, 'invoices'), where('companyId', '==', companyId));
  const [invoicesSnap, paymentsSnap] = await Promise.all([
    getDocs(invoicesQuery),
    getDocs(query(collection(firestore, 'payments'), where('companyId', '==', companyId)))
  ]);

  if (invoicesSnap.empty) {
    let msg = `🏢 *${company.name.toUpperCase()}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 *Status:* No invoices recorded yet.\n`;
    if (company.gstin) msg += `🔖 *GSTIN:* \`${company.gstin}\`\n`;
    if (company.kindAttn) msg += `👤 *Attn:* ${company.kindAttn}\n`;
    if (company.contactNumber) msg += `📞 *Phone:* ${company.contactNumber}\n`;
    return msg;
  }

  const invoiceMap: Record<string, { billNo: number | string; date: string; amount: number; received: number; enterprise: string }> = {};

  invoicesSnap.docs.forEach(d => {
    const inv = d.data();
    const enterprise = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
    
    // Strict firm filtering if not 'Both'
    if (activeFirm !== 'Both' && enterprise !== activeFirm) {
      return;
    }

    const grandTotal = Number(inv.grandTotal || 0);
    invoiceMap[d.id] = {
      billNo: inv.billNo || 'N/A',
      date: inv.billDate || inv.billingMonth || '',
      amount: grandTotal,
      received: 0,
      enterprise,
    };
  });

  paymentsSnap.docs.forEach(d => {
    const pay = d.data();
    if (pay.invoiceId && invoiceMap[pay.invoiceId]) {
      const rec = Number(pay.receivedAmount || 0);
      const tds = Number(pay.tdsDeducted || 0);
      const oth = Number(pay.otherDeductions || 0);
      invoiceMap[pay.invoiceId].received += (rec + tds + oth);
    }
  });

  const filteredInvoices = Object.values(invoiceMap);

  if (filteredInvoices.length === 0) {
    return `🏢 *${company.name.toUpperCase()}*\n━━━━━━━━━━━━━━━━━━━━━\n📌 No invoices found under *${activeFirm === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises'}* for this client.\n_Switch firm using \`/both\` to see all records._`;
  }

  const unpaidInvoices = filteredInvoices.filter(inv => (inv.amount - inv.received) > 1);

  // Breakdown by firm (Vithal vs RV)
  const vithalInvoices = filteredInvoices.filter(i => i.enterprise === 'Vithal');
  const rvInvoices = filteredInvoices.filter(i => i.enterprise === 'RV');

  const vithalTotal = vithalInvoices.reduce((s, i) => s + i.amount, 0);
  const vithalRec = vithalInvoices.reduce((s, i) => s + i.received, 0);
  const vithalDue = Math.max(0, vithalTotal - vithalRec);

  const rvTotal = rvInvoices.reduce((s, i) => s + i.amount, 0);
  const rvRec = rvInvoices.reduce((s, i) => s + i.received, 0);
  const rvDue = Math.max(0, rvTotal - rvRec);

  const firmHeader = activeFirm === 'Both' ? 'VITHAL & R.V ENTERPRISES' : activeFirm === 'RV' ? 'R.V ENTERPRISES' : 'VITHAL ENTERPRISES';

  // 3. User specifically asked for ALL BILLS / INVOICES
  if (intent === 'bills') {
    let text = `📄 *ALL INVOICES: ${company.name.toUpperCase()}*\n`;
    text += `🏢 Firm Scope: *${firmHeader}* (${filteredInvoices.length} Bills)\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `\`\`\`text\n`;
    text += `┌─────────┬────────┬──────────────┬─────────────┐\n`;
    text += `│ Bill #  │ Firm   │ Total (₹)    │ Status      │\n`;
    text += `├─────────┼────────┼──────────────┼─────────────┤\n`;
    filteredInvoices.forEach(inv => {
      const due = inv.amount - inv.received;
      const status = due <= 1 ? 'PAID' : `DUE ₹${formatInr(due)}`;
      text += `│ ${pad(inv.billNo, 7)} │ ${pad(inv.enterprise, 6)} │ ${pad(formatInr(inv.amount), 12, 'right')} │ ${pad(status, 11)} │\n`;
    });
    text += `└─────────┴────────┴──────────────┴─────────────┘\n`;
    text += `\`\`\`\n`;
    return text;
  }

  // 4. Default / Pending View: Clean Non-Mixed Tables
  let text = `🏢 *${company.name.toUpperCase()}*\n`;
  text += `🔖 Scope: *${firmHeader}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;

  // Overview Table (Separate by firm if Both, or Single firm)
  if (activeFirm === 'Both') {
    text += `\`\`\`text\n`;
    text += `┌──────────────────────┬──────────────┬──────────────┐\n`;
    text += `│ ENTERPRISE           │ BILLED (₹)   │ DUE (₹)      │\n`;
    text += `├──────────────────────┼──────────────┼──────────────┤\n`;
    text += `│ Vithal Enterprises   │ ${pad(formatInr(vithalTotal), 12, 'right')} │ ${pad(formatInr(vithalDue), 12, 'right')} │\n`;
    text += `│ R.V Enterprises      │ ${pad(formatInr(rvTotal), 12, 'right')} │ ${pad(formatInr(rvDue), 12, 'right')} │\n`;
    text += `├──────────────────────┼──────────────┼──────────────┤\n`;
    text += `│ TOTAL COMBINED       │ ${pad(formatInr(vithalTotal + rvTotal), 12, 'right')} │ ${pad(formatInr(vithalDue + rvDue), 12, 'right')} │\n`;
    text += `└──────────────────────┴──────────────┴──────────────┘\n`;
    text += `\`\`\`\n`;
  } else {
    const total = activeFirm === 'RV' ? rvTotal : vithalTotal;
    const rec = activeFirm === 'RV' ? rvRec : vithalRec;
    const due = activeFirm === 'RV' ? rvDue : vithalDue;

    text += `\`\`\`text\n`;
    text += `┌──────────────────────┬──────────────┐\n`;
    text += `│ METRIC (${pad(activeFirm, 6)})      │ AMOUNT (₹)   │\n`;
    text += `├──────────────────────┼──────────────┤\n`;
    text += `│ Total Billed         │ ${pad(formatInr(total), 12, 'right')} │\n`;
    text += `│ Total Received       │ ${pad(formatInr(rec), 12, 'right')} │\n`;
    text += `├──────────────────────┼──────────────┤\n`;
    text += `│ OUTSTANDING DUE      │ ${pad(formatInr(due), 12, 'right')} │\n`;
    text += `└──────────────────────┴──────────────┘\n`;
    text += `\`\`\`\n`;
  }

  // Complete List of Unpaid Bills (Strictly Distinct)
  if (unpaidInvoices.length > 0) {
    text += `📋 *Unpaid Bills (${unpaidInvoices.length}):*\n`;
    text += `\`\`\`text\n`;
    text += `┌─────────┬────────┬──────────────┬────────────┐\n`;
    text += `│ Bill #  │ Firm   │ Due (₹)      │ Date       │\n`;
    text += `├─────────┼────────┼──────────────┼────────────┤\n`;
    unpaidInvoices.forEach(inv => {
      const due = inv.amount - inv.received;
      text += `│ ${pad(inv.billNo, 7)} │ ${pad(inv.enterprise, 6)} │ ${pad(formatInr(due), 12, 'right')} │ ${pad(inv.date || 'N/A', 10)} │\n`;
    });
    text += `└─────────┴────────┴──────────────┴────────────┘\n`;
    text += `\`\`\`\n`;
  } else {
    text += `✨ *All bills for ${firmHeader} are fully settled!* 🎉\n`;
  }

  if (company.contactNumber || company.kindAttn) {
    text += `📞 *Contact:* ${company.kindAttn || ''} ${company.contactNumber ? `(\`${company.contactNumber}\`)` : ''}\n`;
  }

  return text;
}

/**
 * Get fleet status in a clean table format filtered by active firm.
 */
export async function getFleetStatus(locationFilter?: 'Workshop' | 'On-Site', activeFirm: EnterpriseType = 'Both'): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'forklifts'));

  if (snap.empty) {
    return '🚜 *No forklifts found in the database.*';
  }

  let all = snap.docs.map(d => d.data());
  if (activeFirm !== 'Both') {
    all = all.filter(f => (f.firm || 'Vithal') === activeFirm);
  }

  const workshop = all.filter(f => f.locationType === 'Workshop');
  const onSite = all.filter(f => f.locationType === 'On-Site');
  const notConfirmed = all.filter(f => f.locationType === 'Not Confirm');
  const firmLabel = activeFirm === 'Both' ? 'BOTH FIRMS' : activeFirm.toUpperCase();

  if (locationFilter === 'Workshop') {
    let msg = `🏭 *WORKSHOP IDLE FORKLIFTS [${firmLabel}] (${workshop.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (workshop.length === 0) {
      msg += `_No forklifts currently idle in workshop for ${activeFirm}._`;
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬────────┬──────────────────┬──────────┐\n`;
      msg += `│ Serial # │ Firm   │ Make / Model     │ Capacity │\n`;
      msg += `├──────────┼────────┼──────────────────┼──────────┤\n`;
      workshop.forEach(f => {
        const makeModel = `${f.make || ''} ${f.model || ''}`.trim() || 'Forklift';
        const firm = (f.firm || 'Vithal') === 'RV' ? 'RV' : 'Vithal';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(firm, 6)} │ ${pad(makeModel, 16)} │ ${pad(f.capacity || 'N/A', 8)} │\n`;
      });
      msg += `└──────────┴────────┴──────────────────┴──────────┘\n`;
      msg += `\`\`\`\n`;
    }
    return msg;
  }

  if (locationFilter === 'On-Site') {
    let msg = `📍 *ON-SITE DEPLOYED FORKLIFTS [${firmLabel}] (${onSite.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (onSite.length === 0) {
      msg += `_No forklifts currently deployed on-site for ${activeFirm}._`;
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬────────┬──────────────────────┬──────────┐\n`;
      msg += `│ Serial # │ Firm   │ Client / Site        │ Capacity │\n`;
      msg += `├──────────┼────────┼──────────────────────┼──────────┤\n`;
      onSite.forEach(f => {
        const site = f.siteCompany || f.siteArea || 'Client Site';
        const firm = (f.firm || 'Vithal') === 'RV' ? 'RV' : 'Vithal';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(firm, 6)} │ ${pad(site, 20)} │ ${pad(f.capacity || 'N/A', 8)} │\n`;
      });
      msg += `└──────────┴────────┴──────────────────────┴──────────┘\n`;
      msg += `\`\`\`\n`;
    }
    return msg;
  }

  const utilRate = all.length > 0 ? ((onSite.length / all.length) * 100).toFixed(0) : '0';

  let msg = `🚜 *TOTAL FLEET SUMMARY [${firmLabel}]*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;
  msg += `┌──────────────────────┬──────────────┐\n`;
  msg += `│ CATEGORY             │ UNITS        │\n`;
  msg += `├──────────────────────┼──────────────┤\n`;
  msg += `│ Total Fleet          │ ${pad(all.length, 12, 'right')} │\n`;
  msg += `│ On-Site (Deployed)   │ ${pad(onSite.length, 12, 'right')} │\n`;
  msg += `│ Workshop (Idle)      │ ${pad(workshop.length, 12, 'right')} │\n`;
  msg += `│ Unconfirmed          │ ${pad(notConfirmed.length, 12, 'right')} │\n`;
  msg += `├──────────────────────┼──────────────┤\n`;
  msg += `│ FLEET UTILIZATION    │ ${pad(utilRate + '%', 12, 'right')} │\n`;
  msg += `└──────────────────────┴──────────────┘\n`;
  msg += `\`\`\`\n`;
  msg += `_Type "workshop" or "onsite" for detailed list._`;
  return msg;
}

/**
 * Search a specific forklift by serial number or name.
 */
export async function getForkliftDetail(serialQuery: string): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'forklifts'));
  const searchLower = serialQuery.toLowerCase().trim();

  const matched = snap.docs.find(d => {
    const sn = String(d.data().serialNumber || '').toLowerCase().trim();
    return sn === searchLower || sn.includes(searchLower);
  });

  if (!matched) {
    return `🚜 *Forklift not found*\nCould not find forklift matching "${serialQuery}".`;
  }

  const f = matched.data();
  let msg = `🚜 *FORKLIFT: ${f.serialNumber}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;
  msg += `┌─────────────┬──────────────────────────┐\n`;
  msg += `│ Field       │ Value                    │\n`;
  msg += `├─────────────┼──────────────────────────┤\n`;
  msg += `│ Serial No   │ ${pad(f.serialNumber, 24)} │\n`;
  msg += `│ Make/Model  │ ${pad((f.make || '') + ' ' + (f.model || ''), 24)} │\n`;
  msg += `│ Capacity    │ ${pad(f.capacity || 'N/A', 24)} │\n`;
  msg += `│ Firm        │ ${pad(f.firm || 'Vithal', 24)} │\n`;
  msg += `│ Location    │ ${pad(f.locationType || 'N/A', 24)} │\n`;
  if (f.locationType === 'On-Site') {
    msg += `│ Client Site │ ${pad(f.siteCompany || 'N/A', 24)} │\n`;
    msg += `│ Site Area   │ ${pad(f.siteArea || 'N/A', 24)} │\n`;
  }
  msg += `└─────────────┴──────────────────────────┘\n`;
  msg += `\`\`\`\n`;
  if (f.siteContactPerson) msg += `👤 *Site Contact:* ${f.siteContactPerson} (${f.siteContactNumber || 'N/A'})\n`;
  if (f.remarks) msg += `📝 *Remarks:* ${f.remarks}\n`;
  return msg;
}

/**
 * Get today's attendance summary as a clean table.
 */
export async function getTodayAttendanceSummary(): Promise<string> {
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

  let msg = `📅 *ATTENDANCE TODAY (${today})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;
  msg += `┌──────────────────────┬──────────────┐\n`;
  msg += `│ ATTENDANCE METRIC    │ COUNT        │\n`;
  msg += `├──────────────────────┼──────────────┤\n`;
  msg += `│ Total Staff          │ ${pad(empSnap.size, 12, 'right')} │\n`;
  msg += `│ Present Staff        │ ${pad(present.length, 12, 'right')} │\n`;
  msg += `│ Absent Staff         │ ${pad(absent.length, 12, 'right')} │\n`;
  if (halfDay.length > 0) {
    msg += `│ Half-Day             │ ${pad(halfDay.length, 12, 'right')} │\n`;
  }
  msg += `└──────────────────────┴──────────────┘\n`;
  msg += `\`\`\`\n`;

  if (absent.length > 0) {
    msg += `❌ *Absent Staff:*\n• ${absent.join('\n• ')}\n\n`;
  }
  if (present.length > 0) {
    msg += `✅ *Present Staff:*\n• ${present.join('\n• ')}\n`;
  }

  return msg;
}

/**
 * Get current month billing summary separated cleanly by firm.
 */
export async function getMonthlyBillingSummary(activeFirm: EnterpriseType = 'Both'): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
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

  let msg = `📊 *BILLING SUMMARY (${monthName.toUpperCase()})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;

  if (activeFirm === 'Both') {
    msg += `┌──────────────────────┬───────┬──────────────┐\n`;
    msg += `│ Enterprise           │ Bills │ Amount (₹)   │\n`;
    msg += `├──────────────────────┼───────┼──────────────┤\n`;
    msg += `│ Vithal Enterprises   │ ${pad(vithalCount, 5)} │ ${pad(formatInr(vithalTotal), 12, 'right')} │\n`;
    msg += `│ R.V Enterprises      │ ${pad(rvCount, 5)} │ ${pad(formatInr(rvTotal), 12, 'right')} │\n`;
    msg += `├──────────────────────┼───────┼──────────────┤\n`;
    msg += `│ TOTAL REVENUE        │ ${pad(vithalCount + rvCount, 5)} │ ${pad(formatInr(vithalTotal + rvTotal), 12, 'right')} │\n`;
    msg += `└──────────────────────┴───────┴──────────────┘\n`;
  } else if (activeFirm === 'Vithal') {
    msg += `┌──────────────────────┬───────┬──────────────┐\n`;
    msg += `│ VITHAL ENTERPRISES   │ Bills │ Amount (₹)   │\n`;
    msg += `├──────────────────────┼───────┼──────────────┤\n`;
    msg += `│ Current Month Bills  │ ${pad(vithalCount, 5)} │ ${pad(formatInr(vithalTotal), 12, 'right')} │\n`;
    msg += `└──────────────────────┴───────┴──────────────┘\n`;
  } else {
    msg += `┌──────────────────────┬───────┬──────────────┐\n`;
    msg += `│ R.V ENTERPRISES      │ Bills │ Amount (₹)   │\n`;
    msg += `├──────────────────────┼───────┼──────────────┤\n`;
    msg += `│ Current Month Bills  │ ${pad(rvCount, 5)} │ ${pad(formatInr(rvTotal), 12, 'right')} │\n`;
    msg += `└──────────────────────┴───────┴──────────────┘\n`;
  }

  msg += `\`\`\`\n`;
  return msg;
}

/**
 * List all registered companies formatted as a table.
 */
export async function listAllCompanies(): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'companies'));

  if (snap.empty) {
    return '🏢 *No companies registered in database.*';
  }

  let msg = `🏢 *REGISTERED CLIENTS (${snap.size})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;
  msg += `┌────┬──────────────────────────────────┐\n`;
  msg += `│ #  │ Company Name                     │\n`;
  msg += `├────┼──────────────────────────────────┤\n`;
  snap.docs.forEach((d, i) => {
    const c = d.data();
    msg += `│ ${pad(i + 1, 2)} │ ${pad(c.name || 'Company', 32)} │\n`;
  });
  msg += `└────┴──────────────────────────────────┘\n`;
  msg += `\`\`\`\n`;
  msg += `_Type any company name (e.g. Bisleri) to view pending balance._`;
  return msg;
}

/**
 * Disambiguation Helper: Renders interactive choice table when multiple companies match.
 */
function renderCompanyDisambiguation(keyword: string, matchedCompanies: string[], chatId: string): string {
  chatRecentChoices.set(chatId, matchedCompanies);

  let msg = `🔍 *Multiple companies found for "${keyword}":*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `\`\`\`text\n`;
  msg += `┌────┬──────────────────────────────────────────┐\n`;
  msg += `│ #  │ Company Name                             │\n`;
  msg += `├────┼──────────────────────────────────────────┤\n`;
  matchedCompanies.forEach((name, i) => {
    msg += `│ ${pad(i + 1, 2)} │ ${pad(name, 40)} │\n`;
  });
  msg += `└────┴──────────────────────────────────────────┘\n`;
  msg += `\`\`\`\n`;
  msg += `👉 *Please reply with the number (e.g. \`1\` or \`2\`) or the exact company name.*`;
  return msg;
}

/**
 * Comprehensive Smart Natural Language Processor.
 * Dynamically queries Firestore with strict intent prioritization, firm isolation, and whole-word matching.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string, chatId: string = ''): Promise<string> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  try {
    const firestore = await getAuthenticatedFirestore();
    const activeFirm = await getUserActiveFirm(chatId);

    // ─── 0. FIRM SELECTION / SWITCHING COMMANDS ────────────────────────────
    if (
      lower === '/firm' || lower === 'firm' || lower === '/switch' || 
      lower === 'switch' || lower === 'change firm' || lower === 'select firm'
    ) {
      return renderFirmSelectionMenu(chatId);
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

    // ─── 1. CHECK IF USER REPLIED TO A RECENT MULTI-CHOICE SELECTION ────────
    if (/^\d{1,2}$/.test(raw) && chatId && chatRecentChoices.has(chatId)) {
      const choices = chatRecentChoices.get(chatId) || [];
      const index = parseInt(raw, 10) - 1;
      if (index >= 0 && index < choices.length) {
        const selectedCompany = choices[index];
        chatRecentChoices.delete(chatId);
        return await getCompanyDetailByIntent(selectedCompany, 'all', activeFirm);
      }
    }

    // ─── 2. ALL COMPANIES LIST ─────────────────────────────────────────────
    if (lower.includes('all companies') || lower.includes('company list') || lower.includes('companies list') || lower === 'companies' || lower === 'company') {
      return await listAllCompanies();
    }

    // ─── 3. WORKSHOP / IDLE FORKLIFTS ──────────────────────────────────────
    if (
      hasWord(lower, 'workshop') ||
      hasWord(lower, 'idle') ||
      hasWord(lower, 'khade') ||
      hasWord(lower, 'khada') ||
      hasWord(lower, 'godown') ||
      lower.includes('workshop forklift') ||
      lower.includes('workshop me')
    ) {
      return await getFleetStatus('Workshop', activeFirm);
    }

    // ─── 4. ON-SITE / DEPLOYED FORKLIFTS ────────────────────────────────────
    if (
      hasWord(lower, 'onsite') ||
      hasWord(lower, 'on-site') ||
      hasWord(lower, 'deployed') ||
      hasWord(lower, 'bahar') ||
      lower.includes('on site') ||
      lower.includes('client site')
    ) {
      return await getFleetStatus('On-Site', activeFirm);
    }

    // ─── 5. OVERALL FLEET SUMMARY ──────────────────────────────────────────
    if (
      hasWord(lower, 'fleet') ||
      hasWord(lower, 'forklift') ||
      hasWord(lower, 'forklifts') ||
      hasWord(lower, 'gadi') ||
      hasWord(lower, 'gaadi') ||
      hasWord(lower, 'machines') ||
      lower.includes('total unit') ||
      lower.includes('total fleet')
    ) {
      return await getFleetStatus(undefined, activeFirm);
    }

    // ─── 6. ATTENDANCE & STAFF ─────────────────────────────────────────────
    if (
      hasWord(lower, 'attendance') ||
      hasWord(lower, 'absent') ||
      hasWord(lower, 'present') ||
      hasWord(lower, 'haziri') ||
      hasWord(lower, 'chhutti') ||
      lower.includes('kaun aya') ||
      lower.includes('kon aya') ||
      lower.includes('absent staff') ||
      lower.includes('today attendance')
    ) {
      return await getTodayAttendanceSummary();
    }

    // ─── 7. BILLING / REVENUE / TOTAL SALES ────────────────────────────────
    if (
      (hasWord(lower, 'billing') || hasWord(lower, 'revenue') || hasWord(lower, 'turnover') || lower.includes('this month') || lower.includes('is mahine')) &&
      !lower.includes('company')
    ) {
      return await getMonthlyBillingSummary(activeFirm);
    }

    // ─── 8. FORKLIFT SPECIFIC SERIAL NUMBER SEARCH ─────────────────────────
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    for (const d of forkliftsSnap.docs) {
      const sn = String(d.data().serialNumber || '').trim();
      if (sn.length >= 2 && hasWord(raw, sn)) {
        return await getForkliftDetail(sn);
      }
    }

    // ─── 9. DYNAMIC COMPANY NAME SEARCH WITH INTENT DETECTION & DISAMBIGUATION ───
    const companiesSnap = await getDocs(collection(firestore, 'companies'));
    const allCompanyNames = companiesSnap.docs.map(d => String(d.data().name || '').trim()).filter(Boolean);

    let companyIntent: 'pending' | 'bills' | 'forklifts' | 'all' = 'all';
    if (hasWord(lower, 'pending') || hasWord(lower, 'due') || hasWord(lower, 'balance') || hasWord(lower, 'baki') || hasWord(lower, 'unpaid')) {
      companyIntent = 'pending';
    } else if (hasWord(lower, 'bill') || hasWord(lower, 'bills') || hasWord(lower, 'invoice') || hasWord(lower, 'invoices') || hasWord(lower, 'billing')) {
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
      'batao', 'chahiye', 'kya', 'hai', 'dikhao', 'pending', 'bills', 'bill'
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
      }
    }

    if (matchedCompanies.length === 1) {
      return await getCompanyDetailByIntent(matchedCompanies[0], companyIntent, activeFirm);
    }

    if (matchedCompanies.length > 1) {
      const matchedKeyword = raw.replace(/\b(ka|ki|ke|pending|bills|bill|invoices|forklifts|details|batao|chahiye|dikhao|kya|hai)\b/gi, '').trim() || raw;
      return renderCompanyDisambiguation(matchedKeyword, matchedCompanies, chatId);
    }

  } catch (err: any) {
    console.error('Smart NLP processing error:', err);
    return `⚠️ *Error accessing data:* ${err.message || 'Database error'}`;
  }

  // Helpful response
  const activeFirm = await getUserActiveFirm(chatId);
  return `🤖 *VE Dashboard Assistant*\n🏢 Active Scope: *${activeFirm === 'Both' ? 'Both Firms' : activeFirm}*\n━━━━━━━━━━━━━━━━━━━━━\nAap ye puch sakte hain:\n\n🏢 *Company Bills / Pending:* e.g. _"JSW pending"_, _"Bisleri bills"_\n🚜 *Forklift Fleet:* e.g. _"Workshop"_, _"On-site"_\n📅 *Attendance:* e.g. _"Today attendance"_\n💰 *Revenue:* e.g. _"This month billing"_\n🔄 *Change Firm:* Type \`/firm\` (Vithal / RV / Both)\n━━━━━━━━━━━━━━━━━━━━━`;
}
