/**
 * @fileOverview Smart Telegram Assistant Module
 * Handles natural language querying over Firestore data for Admin & Employees with beautiful tabular output,
 * precise intent routing, full non-truncated invoice lists, and multi-company disambiguation.
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, getDoc, doc, setDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

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

// Cache recent ambiguous company choices per chat ID for number-based selection (e.g., replying "1" or "2")
const chatRecentChoices = new Map<string, string[]>();

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
 * Check if the given chatId is an authorized Admin.
 */
export async function isTelegramAdmin(chatId: string): Promise<boolean> {
  if (verifiedAdminChatIds.has(chatId)) return true;

  try {
    const firestore = await getAuthenticatedFirestore();
    const adminDoc = await getDoc(doc(firestore, 'telegramAdmins', chatId));
    if (adminDoc.exists()) {
      verifiedAdminChatIds.add(chatId);
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
      registeredAt: new Date().toISOString(),
      role: 'super_admin',
    }, { merge: true });
  } catch (err) {
    console.error('Firestore admin save error:', err);
  }

  return true;
}

/**
 * Query company details based on specific intent:
 * - 'pending': only pending balance and complete unpaid bills list
 * - 'bills': all invoices history (paid & unpaid)
 * - 'forklifts': forklifts deployed at this company
 * - 'all': complete summary
 */
export async function getCompanyDetailByIntent(
  companyName: string, 
  intent: 'pending' | 'bills' | 'forklifts' | 'all' = 'all'
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

  // 1. If user specifically asked for Forklifts of this company
  if (intent === 'forklifts') {
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    const companyForklifts = forkliftsSnap.docs
      .map(d => d.data())
      .filter(f => {
        const site = String(f.siteCompany || '').toLowerCase();
        return site.includes(company.name.toLowerCase()) || company.name.toLowerCase().includes(site);
      });

    let msg = `🚜 *FORKLIFTS AT ${company.name.toUpperCase()} (${companyForklifts.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (companyForklifts.length === 0) {
      msg += `_No forklifts currently recorded at this client's site._\n`;
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬──────────────────┬──────────┬─────────────┐\n`;
      msg += `│ Serial # │ Make / Model     │ Capacity │ Site Area   │\n`;
      msg += `├──────────┼──────────────────┼──────────┼─────────────┤\n`;
      companyForklifts.forEach(f => {
        const mm = `${f.make || ''} ${f.model || ''}`.trim() || 'Forklift';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(mm, 16)} │ ${pad(f.capacity || 'N/A', 8)} │ ${pad(f.siteArea || 'Site', 11)} │\n`;
      });
      msg += `└──────────┴──────────────────┴──────────┴─────────────┘\n`;
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
    msg += `📌 *Status:* No invoices recorded yet in dashboard.\n`;
    if (company.gstin) msg += `🔖 *GSTIN:* \`${company.gstin}\`\n`;
    if (company.kindAttn) msg += `👤 *Attn:* ${company.kindAttn}\n`;
    if (company.contactNumber) msg += `📞 *Phone:* ${company.contactNumber}\n`;
    if (company.address) msg += `📍 *Address:* ${company.address}\n`;
    return msg;
  }

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
      billNo: inv.billNo || 'N/A',
      date: inv.billDate || inv.billingMonth || '',
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
  const unpaidInvoices = Object.values(invoiceMap).filter(inv => (inv.amount - inv.received) > 1);
  const allInvoicesList = Object.values(invoiceMap);

  // 3. User specifically asked for ALL BILLS / INVOICE LIST
  if (intent === 'bills') {
    let text = `📄 *ALL INVOICES: ${company.name.toUpperCase()} (${allInvoicesList.length})*\n`;
    text += `━━━━━━━━━━━━━━━━━━━━━\n`;
    text += `\`\`\`text\n`;
    text += `┌─────────┬────────┬──────────────┬─────────────┐\n`;
    text += `│ Bill #  │ Firm   │ Total (₹)    │ Status      │\n`;
    text += `├─────────┼────────┼──────────────┼─────────────┤\n`;
    allInvoicesList.forEach(inv => {
      const due = inv.amount - inv.received;
      const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
      const status = due <= 1 ? 'PAID' : `DUE ₹${formatInr(due)}`;
      text += `│ ${pad(inv.billNo, 7)} │ ${pad(firm, 6)} │ ${pad(formatInr(inv.amount), 12, 'right')} │ ${pad(status, 11)} │\n`;
    });
    text += `└─────────┴────────┴──────────────┴─────────────┘\n`;
    text += `\`\`\`\n`;
    text += `💰 *Total Billed:* ₹${formatInr(totalBilled)} | ⚠️ *Total Due:* ₹${formatInr(pendingBalance)}\n`;
    return text;
  }

  // 4. Default or 'pending': Pending & Complete Unpaid Bills Table
  let text = `🏢 *${company.name.toUpperCase()}*\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `\`\`\`text\n`;
  text += `┌──────────────────────┬──────────────┐\n`;
  text += `│ METRIC               │ AMOUNT (₹)   │\n`;
  text += `├──────────────────────┼──────────────┤\n`;
  text += `│ Total Invoiced       │ ${pad(formatInr(totalBilled), 12, 'right')} │\n`;
  text += `│ Total Received       │ ${pad(formatInr(totalReceived), 12, 'right')} │\n`;
  if (totalTds > 0) {
    text += `│ TDS Deducted         │ ${pad(formatInr(totalTds), 12, 'right')} │\n`;
  }
  text += `├──────────────────────┼──────────────┤\n`;
  text += `│ OUTSTANDING DUE      │ ${pad(formatInr(pendingBalance), 12, 'right')} │\n`;
  text += `└──────────────────────┴──────────────┘\n`;
  text += `\`\`\`\n`;

  // COMPLETE list of unpaid bills - NEVER truncated!
  if (unpaidInvoices.length > 0) {
    text += `📋 *Complete Unpaid Bills (${unpaidInvoices.length}):*\n`;
    text += `\`\`\`text\n`;
    text += `┌─────────┬────────┬──────────────┬────────────┐\n`;
    text += `│ Bill #  │ Firm   │ Due (₹)      │ Date       │\n`;
    text += `├─────────┼────────┼──────────────┼────────────┤\n`;
    unpaidInvoices.forEach(inv => {
      const due = inv.amount - inv.received;
      const firm = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
      text += `│ ${pad(inv.billNo, 7)} │ ${pad(firm, 6)} │ ${pad(formatInr(due), 12, 'right')} │ ${pad(inv.date || 'N/A', 10)} │\n`;
    });
    text += `└─────────┴────────┴──────────────┴────────────┘\n`;
    text += `\`\`\`\n`;
  } else {
    text += `✨ *All invoices are fully settled!* 🎉\n`;
  }

  if (company.contactNumber || company.kindAttn) {
    text += `📞 *Contact:* ${company.kindAttn || ''} ${company.contactNumber ? `(\`${company.contactNumber}\`)` : ''}\n`;
  }

  return text;
}

/**
 * Get fleet status in a clean table format.
 */
export async function getFleetStatus(locationFilter?: 'Workshop' | 'On-Site'): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'forklifts'));

  if (snap.empty) {
    return '🚜 *No forklifts found in the database.*';
  }

  const all = snap.docs.map(d => d.data());
  const workshop = all.filter(f => f.locationType === 'Workshop');
  const onSite = all.filter(f => f.locationType === 'On-Site');
  const notConfirmed = all.filter(f => f.locationType === 'Not Confirm');

  if (locationFilter === 'Workshop') {
    let msg = `🏭 *WORKSHOP IDLE FORKLIFTS (${workshop.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (workshop.length === 0) {
      msg += '_No forklifts currently idle in workshop._';
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬──────────────────┬──────────┐\n`;
      msg += `│ Serial # │ Make / Model     │ Capacity │\n`;
      msg += `├──────────┼──────────────────┼──────────┤\n`;
      workshop.forEach(f => {
        const makeModel = `${f.make || ''} ${f.model || ''}`.trim() || 'Forklift';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(makeModel, 16)} │ ${pad(f.capacity || 'N/A', 8)} │\n`;
      });
      msg += `└──────────┴──────────────────┴──────────┘\n`;
      msg += `\`\`\`\n`;
    }
    return msg;
  }

  if (locationFilter === 'On-Site') {
    let msg = `📍 *ON-SITE DEPLOYED FORKLIFTS (${onSite.length})*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    if (onSite.length === 0) {
      msg += '_No forklifts currently deployed on-site._';
    } else {
      msg += `\`\`\`text\n`;
      msg += `┌──────────┬──────────────────────┬──────────┐\n`;
      msg += `│ Serial # │ Client / Site        │ Capacity │\n`;
      msg += `├──────────┼──────────────────────┼──────────┤\n`;
      onSite.forEach(f => {
        const site = f.siteCompany || f.siteArea || 'Client Site';
        msg += `│ ${pad(f.serialNumber, 8)} │ ${pad(site, 20)} │ ${pad(f.capacity || 'N/A', 8)} │\n`;
      });
      msg += `└──────────┴──────────────────────┴──────────┘\n`;
      msg += `\`\`\`\n`;
    }
    return msg;
  }

  const utilRate = all.length > 0 ? ((onSite.length / all.length) * 100).toFixed(0) : '0';

  let msg = `🚜 *TOTAL FLEET SUMMARY*\n`;
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
 * Get current month billing summary as a table.
 */
export async function getMonthlyBillingSummary(): Promise<string> {
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
  msg += `┌──────────────────────┬───────┬──────────────┐\n`;
  msg += `│ Enterprise           │ Bills │ Amount (₹)   │\n`;
  msg += `├──────────────────────┼───────┼──────────────┤\n`;
  msg += `│ Vithal Enterprises   │ ${pad(vithalCount, 5)} │ ${pad(formatInr(vithalTotal), 12, 'right')} │\n`;
  msg += `│ R.V Enterprises      │ ${pad(rvCount, 5)} │ ${pad(formatInr(rvTotal), 12, 'right')} │\n`;
  msg += `├──────────────────────┼───────┼──────────────┤\n`;
  msg += `│ TOTAL REVENUE        │ ${pad(vithalCount + rvCount, 5)} │ ${pad(formatInr(vithalTotal + rvTotal), 12, 'right')} │\n`;
  msg += `└──────────────────────┴───────┴──────────────┘\n`;
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
 * Dynamically queries Firestore with strict intent prioritization, disambiguation, and whole-word matching.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string, chatId: string = ''): Promise<string> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  try {
    const firestore = await getAuthenticatedFirestore();

    // ─── 0. CHECK IF USER REPLIED TO A RECENT MULTI-CHOICE SELECTION ────────
    if (/^\d{1,2}$/.test(raw) && chatId && chatRecentChoices.has(chatId)) {
      const choices = chatRecentChoices.get(chatId) || [];
      const index = parseInt(raw, 10) - 1;
      if (index >= 0 && index < choices.length) {
        const selectedCompany = choices[index];
        chatRecentChoices.delete(chatId);
        return await getCompanyDetailByIntent(selectedCompany, 'all');
      }
    }

    // ─── 1. ALL COMPANIES LIST ─────────────────────────────────────────────
    if (lower.includes('all companies') || lower.includes('company list') || lower.includes('companies list') || lower === 'companies' || lower === 'company') {
      return await listAllCompanies();
    }

    // ─── 2. WORKSHOP / IDLE FORKLIFTS ──────────────────────────────────────
    if (
      hasWord(lower, 'workshop') ||
      hasWord(lower, 'idle') ||
      hasWord(lower, 'khade') ||
      hasWord(lower, 'khada') ||
      hasWord(lower, 'godown') ||
      lower.includes('workshop forklift') ||
      lower.includes('workshop me')
    ) {
      return await getFleetStatus('Workshop');
    }

    // ─── 3. ON-SITE / DEPLOYED FORKLIFTS ────────────────────────────────────
    if (
      hasWord(lower, 'onsite') ||
      hasWord(lower, 'on-site') ||
      hasWord(lower, 'deployed') ||
      hasWord(lower, 'bahar') ||
      lower.includes('on site') ||
      lower.includes('client site')
    ) {
      return await getFleetStatus('On-Site');
    }

    // ─── 4. OVERALL FLEET SUMMARY ──────────────────────────────────────────
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
      return await getFleetStatus();
    }

    // ─── 5. ATTENDANCE & STAFF ─────────────────────────────────────────────
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

    // ─── 6. BILLING / REVENUE / TOTAL SALES (Overall Enterprise Level) ──────
    if (
      (hasWord(lower, 'billing') || hasWord(lower, 'revenue') || hasWord(lower, 'turnover') || lower.includes('this month') || lower.includes('is mahine')) &&
      !lower.includes('company')
    ) {
      return await getMonthlyBillingSummary();
    }

    // ─── 7. FORKLIFT SPECIFIC SERIAL NUMBER SEARCH ─────────────────────────
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    for (const d of forkliftsSnap.docs) {
      const sn = String(d.data().serialNumber || '').trim();
      if (sn.length >= 2 && hasWord(raw, sn)) {
        return await getForkliftDetail(sn);
      }
    }

    // ─── 8. DYNAMIC COMPANY NAME SEARCH WITH INTENT DETECTION & DISAMBIGUATION ───
    const companiesSnap = await getDocs(collection(firestore, 'companies'));
    const allCompanyNames = companiesSnap.docs.map(d => String(d.data().name || '').trim()).filter(Boolean);

    // Determine sub-intent for the company:
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

      // Exact full name match
      if (lower.includes(companyLower)) {
        matchedCompanies.push(companyFullName);
        continue;
      }

      // Check distinct brand keywords
      const brandWords = companyLower
        .split(/[\s,./()]+/)
        .filter(w => w.length >= 3 && !stopWords.has(w));

      if (brandWords.some(w => hasWord(lower, w))) {
        if (!matchedCompanies.includes(companyFullName)) {
          matchedCompanies.push(companyFullName);
        }
      }
    }

    // Single company matched:
    if (matchedCompanies.length === 1) {
      return await getCompanyDetailByIntent(matchedCompanies[0], companyIntent);
    }

    // Multiple companies matched (Disambiguation required!):
    if (matchedCompanies.length > 1) {
      // Find the matched search keyword
      const matchedKeyword = raw.replace(/\b(ka|ki|ke|pending|bills|bill|invoices|forklifts|details|batao|chahiye|dikhao|kya|hai)\b/gi, '').trim() || raw;
      return renderCompanyDisambiguation(matchedKeyword, matchedCompanies, chatId);
    }

  } catch (err: any) {
    console.error('Smart NLP processing error:', err);
    return `⚠️ *Error accessing data:* ${err.message || 'Database error'}`;
  }

  // Helpful response if no specific entity was recognized
  return `🤖 *VE Dashboard Assistant*\n━━━━━━━━━━━━━━━━━━━━━\nAap mujhse ye sawal puch sakte hain:\n\n🏢 *Company Bills / Pending:* Type company name (e.g. _"JSW pending"_, _"Bisleri bills"_, ya _"all companies"_)\n🚜 *Forklift Fleet:* Type _"Workshop"_, _"On-site"_, ya _"Total fleet"_\n📅 *Attendance:* Type _"Today attendance"_ ya _"Absent staff"_\n💰 *Revenue:* Type _"This month billing"_ ya \`/revenue\`\n━━━━━━━━━━━━━━━━━━━━━`;
}
