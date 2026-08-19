/**
 * @fileOverview Smart Telegram Assistant Module
 * Handles natural language querying over Firestore data for Admin & Employees.
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

export const ADMIN_SECRET_CODE = '2028';

/**
 * Get Firestore instance with authenticated server session.
 * This guarantees full read permissions without "insufficient permissions" errors.
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
 * Query pending payments and invoice balance for a company.
 */
export async function getCompanyPaymentSummary(companyQuery: string): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  
  // 1. Find Company
  const companiesSnap = await getDocs(collection(firestore, 'companies'));
  const searchLower = companyQuery.toLowerCase().trim();

  // Find exact or partial match
  let matchedCompanyDoc = companiesSnap.docs.find(d => {
    const name = (d.data().name || '').toLowerCase().trim();
    return name === searchLower;
  });

  if (!matchedCompanyDoc) {
    matchedCompanyDoc = companiesSnap.docs.find(d => {
      const name = (d.data().name || '').toLowerCase().trim();
      return name.includes(searchLower) || searchLower.includes(name);
    });
  }

  if (!matchedCompanyDoc) {
    return `❌ *Company "${companyQuery}" Not Found*\n\nType *"all companies"* to see all registered clients in your dashboard.`;
  }

  const company = matchedCompanyDoc.data() as CompanySummary;
  const companyId = matchedCompanyDoc.id;

  // 2. Fetch Invoices for this company
  const invoicesQuery = query(collection(firestore, 'invoices'), where('companyId', '==', companyId));
  const invoicesSnap = await getDocs(invoicesQuery);

  if (invoicesSnap.empty) {
    let msg = `🏢 *${company.name.toUpperCase()}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📌 *Status:* No invoices recorded yet.\n`;
    if (company.gstin) msg += `🔖 *GSTIN:* \`${company.gstin}\`\n`;
    if (company.kindAttn) msg += `👤 *Attn:* ${company.kindAttn}\n`;
    if (company.contactNumber) msg += `📞 *Phone:* ${company.contactNumber}\n`;
    if (company.address) msg += `📍 *Address:* ${company.address}\n`;
    return msg;
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
  text += `💰 *Total Invoiced:* ₹${totalBilled.toLocaleString('en-IN')}\n`;
  text += `✅ *Total Received:* ₹${totalReceived.toLocaleString('en-IN')}\n`;
  if (totalTds > 0) text += `🔖 *TDS Deducted:* ₹${totalTds.toLocaleString('en-IN')}\n`;
  text += `━━━━━━━━━━━━━━━━━━━━━\n`;
  text += `⚠️ *OUTSTANDING DUE:* ₹${pendingBalance.toLocaleString('en-IN')}\n\n`;

  if (unpaidInvoices.length > 0) {
    text += `📋 *Pending Bills (${unpaidInvoices.length}):*\n`;
    unpaidInvoices.slice(0, 8).forEach(inv => {
      const due = inv.amount - inv.received;
      text += `• Bill #${inv.billNo} (${inv.enterprise}) - Due: ₹${due.toLocaleString('en-IN')} [${inv.date}]\n`;
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
    const sn = (d.data().serialNumber || '').toLowerCase().trim();
    return sn.includes(searchLower) || searchLower.includes(sn);
  });

  if (!matched) {
    return `🚜 *Forklift not found*\nCould not find forklift matching "${serialQuery}".`;
  }

  const f = matched.data();
  let msg = `🚜 *FORKLIFT: ${f.serialNumber}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏭 *Make / Model:* ${f.make || ''} ${f.model || ''}\n`;
  msg += `⚡ *Capacity:* ${f.capacity || 'N/A'}\n`;
  msg += `🏢 *Firm:* ${f.firm || 'Vithal'}\n`;
  msg += `📍 *Current Location:* *${f.locationType}*\n`;
  if (f.locationType === 'On-Site') {
    msg += `🏢 *Client Site:* ${f.siteCompany || 'N/A'}\n`;
    msg += `📍 *Site Area:* ${f.siteArea || 'N/A'}\n`;
    if (f.siteContactPerson) msg += `👤 *Site Contact:* ${f.siteContactPerson} (${f.siteContactNumber || ''})\n`;
  }
  if (f.remarks) msg += `📝 *Remarks:* ${f.remarks}\n`;
  return msg;
}

/**
 * Get today's attendance summary.
 */
export async function getTodayAttendanceSummary(): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
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

  let msg = `📊 *BILLING SUMMARY (${monthName.toUpperCase()})*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏭 *Vithal Enterprises:* ₹${vithalTotal.toLocaleString('en-IN')} (${vithalCount} Invoices)\n`;
  msg += `🏢 *R.V Enterprises:* ₹${rvTotal.toLocaleString('en-IN')} (${rvCount} Invoices)\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💎 *TOTAL BILLING:* ₹${(vithalTotal + rvTotal).toLocaleString('en-IN')}\n`;
  return msg;
}

/**
 * List all registered companies.
 */
export async function listAllCompanies(): Promise<string> {
  const firestore = await getAuthenticatedFirestore();
  const snap = await getDocs(collection(firestore, 'companies'));

  if (snap.empty) {
    return '🏢 *No companies registered in database.*';
  }

  let msg = `🏢 *REGISTERED COMPANIES (${snap.size}):*\n━━━━━━━━━━━━━━━━━━━━━\n`;
  snap.docs.forEach((d, i) => {
    const c = d.data();
    msg += `${i + 1}. *${c.name}* ${c.contactNumber ? `(📞 ${c.contactNumber})` : ''}\n`;
  });
  msg += `━━━━━━━━━━━━━━━━━━━━━\n_Type any company name (e.g. Bisleri) to get pending balance._`;
  return msg;
}

/**
 * Comprehensive Smart Natural Language Processor.
 * Dynamically queries Firestore with multi-layer matching.
 */
export async function processAdminNaturalLanguageQuery(userPrompt: string): Promise<string> {
  const raw = userPrompt.trim();
  const lower = raw.toLowerCase();

  try {
    const firestore = await getAuthenticatedFirestore();

    // 1. Check if user is asking for all companies list
    if (lower.includes('all companies') || lower.includes('company list') || lower.includes('companies list') || lower === 'companies' || lower === 'company') {
      return await listAllCompanies();
    }

    // 2. Dynamic Company Name Search
    const companiesSnap = await getDocs(collection(firestore, 'companies'));
    for (const d of companiesSnap.docs) {
      const companyName = (d.data().name || '').toLowerCase().trim();
      if (companyName.length > 2) {
        const words = companyName.split(/[\s,./()]+/).filter(w => w.length > 2 && !['pvt', 'ltd', 'limited', 'private', 'enterprises', 'enterprise', 'llp', 'and', 'the', 'services', 'solutions', 'international', 'internationals', 'group', 'india'].includes(w));
        const matched = lower.includes(companyName) || words.some(w => lower.includes(w));
        if (matched) {
          return await getCompanyPaymentSummary(d.data().name);
        }
      }
    }

    // 3. Forklift Specific Serial Search
    const forkliftsSnap = await getDocs(collection(firestore, 'forklifts'));
    for (const d of forkliftsSnap.docs) {
      const sn = (d.data().serialNumber || '').toLowerCase().trim();
      if (sn.length > 2 && lower.includes(sn)) {
        return await getForkliftDetail(d.data().serialNumber);
      }
    }

    // 4. Workshop / Idle Forklifts
    if (lower.includes('workshop') || lower.includes('idle') || lower.includes('khade') || lower.includes('khada') || lower.includes('available') || lower.includes('godown')) {
      return await getFleetStatus('Workshop');
    }

    // 5. On-Site / Deployed Forklifts
    if (lower.includes('site') || lower.includes('client') || lower.includes('onsite') || lower.includes('on-site') || lower.includes('deployed') || lower.includes('bahar')) {
      return await getFleetStatus('On-Site');
    }

    // 6. Overall Fleet / Machine
    if (lower.includes('fleet') || lower.includes('forklift') || lower.includes('gaadi') || lower.includes('gadi') || lower.includes('machine') || lower.includes('units')) {
      return await getFleetStatus();
    }

    // 7. Attendance & Staff
    if (lower.includes('attendance') || lower.includes('absent') || lower.includes('present') || lower.includes('haziri') || lower.includes('chhutti') || lower.includes('kaun aya') || lower.includes('kon aya') || lower.includes('staff')) {
      return await getTodayAttendanceSummary();
    }

    // 8. Billing / Revenue / Total Sales
    if (lower.includes('billing') || lower.includes('revenue') || lower.includes('collection') || lower.includes('kamai') || lower.includes('turnover') || lower.includes('total bill') || lower.includes('invoiced')) {
      return await getMonthlyBillingSummary();
    }

  } catch (err: any) {
    console.error('Smart NLP processing error:', err);
    return `⚠️ *Error accessing data:* ${err.message || 'Database error'}`;
  }

  // Helpful response if no specific entity was recognized
  return `🤖 *VE Dashboard Assistant*\n━━━━━━━━━━━━━━━━━━━━━\nAap mujhse ye sawal puch sakte hain:\n\n🏢 *Company Pending Bills:* Type company name (e.g. _"Bisleri"_, _"Varun Beverages"_, ya _"all companies"_)\n🚜 *Forklift Fleet:* Type _"Workshop"_, _"On-site"_, ya _"Total fleet"_\n📅 *Attendance:* Type _"Today attendance"_ ya _"Absent staff"_\n💰 *Revenue:* Type _"This month billing"_ ya \`/revenue\`\n━━━━━━━━━━━━━━━━━━━━━`;
}
