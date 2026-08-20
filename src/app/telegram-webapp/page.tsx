'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { getFirestore, collection, query, getDocs, orderBy } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

// ─── TYPES ──────────────────────────────────────────────────────────────────
export type Enterprise = 'Both' | 'Vithal' | 'RV';
export type StatusFilter = 'All' | 'Pending' | 'Paid' | 'Partial';

interface PaymentRecord {
  id: string;
  invoiceId: string;
  paymentDate?: string;
  receivedAmount?: number;
  tdsDeducted?: number;
  otherDeductions?: number;
  paymentMode?: string;
  chequeDetails?: string;
  notes?: string;
}

interface BillingRow {
  id: string;
  billNo: string;
  billNoFormatted: string;
  billDate: string;
  billDateFormatted: string;
  month: string;
  partyName: string;
  enterprise: 'Vithal' | 'RV';
  basicAmount: number;
  cgst: number;
  sgst: number;
  finalAmount: number;
  tdsDeduction: number;
  amountReceivable: number;
  paymentReceivedDate: string;
  actualAmountReceived: number;
  rtgsCheque: string;
  isPaid: boolean;
  isPartial: boolean;
}

function formatInr(num: number): string {
  if (!num && num !== 0) return '0.00';
  return Number(num).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateStr;
  }
}

function formatMonthYear(monthStr: string, dateStr: string): string {
  const target = monthStr || (dateStr ? dateStr.slice(0, 7) : '');
  if (!target) return '-';
  try {
    const [y, m] = target.split('-');
    if (!y || !m) return target;
    const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    return dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return target;
  }
}

export default function TelegramBillingWebApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<BillingRow[]>([]);

  // Filter States
  const [firmFilter, setFirmFilter] = useState<Enterprise>('Both');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [monthFilter, setMonthFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Telegram WebApp Initialization
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const tg = (window as any).Telegram?.WebApp;
      if (tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor?.('#0f172a');
        tg.setBackgroundColor?.('#f8fafc');
      }

      // Check URL search params for default filters (e.g. ?firm=Vithal&status=Pending)
      const urlParams = new URLSearchParams(window.location.search);
      const urlFirm = urlParams.get('firm');
      const urlStatus = urlParams.get('status');
      const urlMonth = urlParams.get('month');
      const urlSearch = urlParams.get('search') || urlParams.get('company');

      if (urlFirm && (urlFirm === 'Vithal' || urlFirm === 'RV' || urlFirm === 'Both')) {
        setFirmFilter(urlFirm as Enterprise);
      }
      if (urlStatus && (urlStatus === 'All' || urlStatus === 'Pending' || urlStatus === 'Paid' || urlStatus === 'Partial')) {
        setStatusFilter(urlStatus as StatusFilter);
      }
      if (urlMonth) setMonthFilter(urlMonth);
      if (urlSearch) setSearchQuery(urlSearch);
    }
  }, []);

  // Fetch Data from Firestore
  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
      const auth = getAuth(app);
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }
      const firestore = getFirestore(app);

      const [invoicesSnap, paymentsSnap, companiesSnap] = await Promise.all([
        getDocs(query(collection(firestore, 'invoices'), orderBy('billNo', 'desc'))),
        getDocs(collection(firestore, 'payments')),
        getDocs(collection(firestore, 'companies')),
      ]);

      const companyMap = new Map<string, string>();
      companiesSnap.docs.forEach(d => {
        companyMap.set(d.id, String(d.data().name || 'Client Company'));
      });

      // Group payments by invoiceId / billNo
      const paymentsMap = new Map<string, PaymentRecord[]>();
      paymentsSnap.docs.forEach(d => {
        const pay = d.data() as PaymentRecord;
        pay.id = d.id;
        const key = String(pay.invoiceId || '');
        if (key) {
          const list = paymentsMap.get(key) || [];
          list.push(pay);
          paymentsMap.set(key, list);
        }
      });

      const processedRows: BillingRow[] = invoicesSnap.docs.map(docSnap => {
        const inv = docSnap.data();
        const id = docSnap.id;
        const enterprise: 'Vithal' | 'RV' = inv.enterprise === 'RV' ? 'RV' : 'Vithal';
        const defaultSuffix = enterprise === 'RV' ? 'RV' : 'MHE';
        const suffix = inv.billNoSuffix || defaultSuffix;
        const rawBillNo = String(inv.billNo || '');
        const billNoFormatted = rawBillNo ? `${rawBillNo}-${suffix}` : '-';

        const billDate = inv.billDate || inv.date || '';
        const rawMonth = inv.billingMonth || (billDate ? billDate.slice(0, 7) : '');
        const month = formatMonthYear(rawMonth, billDate);

        const companyName = companyMap.get(inv.companyId) || inv.clientCompanyDetails?.name || 'Unknown Party';

        const grandTotal = Number(inv.grandTotal || 0);
        const netTotal = Number(inv.netTotal || (grandTotal > 0 ? grandTotal / 1.18 : 0));
        const totalGst = Math.max(0, grandTotal - netTotal);
        const cgst = totalGst / 2;
        const sgst = totalGst / 2;

        // Payment lookup
        const invPayments = paymentsMap.get(id) || paymentsMap.get(rawBillNo) || [];
        const advance = Number(inv.advanceReceived || 0);
        const totalReceived = invPayments.reduce((s, p) => s + Number(p.receivedAmount || 0), 0) + advance;
        const payTds = invPayments.reduce((s, p) => s + Number(p.tdsDeducted || 0), 0);
        const payOtherDed = invPayments.reduce((s, p) => s + Number(p.otherDeductions || 0), 0);

        const taxableAmount = inv.discountType === 'before_gst' 
          ? (Number(inv.netTotal || 0) - Number(inv.discount || 0)) 
          : Number(inv.netTotal || 0);
        const tdsPercentage = Number(inv.tdsPercentage || 0);
        const calculatedTds = (taxableAmount * tdsPercentage) / 100;
        const tdsDeduction = Math.max(calculatedTds, payTds);

        const totalCredited = totalReceived + payOtherDed + tdsDeduction;
        const amountReceivable = Math.max(0, Math.round(grandTotal - totalCredited));

        const isPaid = amountReceivable <= 1;
        const isPartial = !isPaid && totalReceived > 0;

        // Dates & Payment details
        const paymentDates = invPayments
          .map(p => p.paymentDate)
          .filter(Boolean)
          .map(d => formatDate(d!));
        const paymentReceivedDate = paymentDates.length > 0 
          ? paymentDates.join(', ') 
          : (isPaid ? 'Settled' : 'Pending');

        // RTGS/CHEQUE
        const refTokens: string[] = [];
        invPayments.forEach(p => {
          const mode = p.paymentMode || 'RTGS';
          const ref = p.chequeDetails || p.notes || '';
          if (ref) {
            refTokens.push(`${mode}: ${ref}`);
          } else {
            refTokens.push(mode);
          }
        });
        const rtgsCheque = refTokens.length > 0 ? refTokens.join(' | ') : (advance > 0 ? 'Advance' : '-');

        return {
          id,
          billNo: rawBillNo,
          billNoFormatted,
          billDate,
          billDateFormatted: formatDate(billDate),
          month,
          partyName: companyName,
          enterprise,
          basicAmount: netTotal,
          cgst,
          sgst,
          finalAmount: grandTotal,
          tdsDeduction,
          amountReceivable,
          paymentReceivedDate,
          actualAmountReceived: totalReceived,
          rtgsCheque,
          isPaid,
          isPartial,
        };
      });

      setRows(processedRows);
    } catch (err: any) {
      console.error('Failed to load billing table data:', err);
      setError(err.message || 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Get distinct month values for filter dropdown
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => {
      if (r.month && r.month !== '-') set.add(r.month);
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      // 1. Firm
      if (firmFilter !== 'Both' && r.enterprise !== firmFilter) return false;

      // 2. Status
      if (statusFilter === 'Pending' && r.isPaid) return false;
      if (statusFilter === 'Paid' && !r.isPaid) return false;
      if (statusFilter === 'Partial' && !r.isPartial) return false;

      // 3. Month
      if (monthFilter !== 'All' && r.month !== monthFilter) return false;

      // 4. Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchParty = r.partyName.toLowerCase().includes(q);
        const matchBill = r.billNoFormatted.toLowerCase().includes(q) || r.billNo.toLowerCase().includes(q);
        const matchRef = r.rtgsCheque.toLowerCase().includes(q);
        const matchMonth = r.month.toLowerCase().includes(q);
        if (!matchParty && !matchBill && !matchRef && !matchMonth) return false;
      }

      return true;
    });
  }, [rows, firmFilter, statusFilter, monthFilter, searchQuery]);

  // Calculated totals
  const totals = useMemo(() => {
    return filteredRows.reduce(
      (acc, r) => {
        acc.basic += r.basicAmount;
        acc.cgst += r.cgst;
        acc.sgst += r.sgst;
        acc.final += r.finalAmount;
        acc.tds += r.tdsDeduction;
        acc.receivable += r.amountReceivable;
        acc.received += r.actualAmountReceived;
        return acc;
      },
      { basic: 0, cgst: 0, sgst: 0, final: 0, tds: 0, receivable: 0, received: 0 }
    );
  }, [filteredRows]);

  // Export to CSV
  const handleExportCsv = () => {
    const headers = [
      'Bill NO.',
      'Bill Date',
      'Month',
      "Party's Name",
      'Enterprise',
      'Basic Amount',
      'CGST',
      'SGST',
      'Final Amount',
      'TDS Deduction',
      'Amount Receivable',
      'Payment Received Date',
      'Actual Amount Received',
      'RTGS/CHEQUE',
    ];

    const csvData = filteredRows.map(r => [
      `"${r.billNoFormatted}"`,
      `"${r.billDateFormatted}"`,
      `"${r.month}"`,
      `"${r.partyName.replace(/"/g, '""')}"`,
      `"${r.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises'}"`,
      r.basicAmount.toFixed(2),
      r.cgst.toFixed(2),
      r.sgst.toFixed(2),
      r.finalAmount.toFixed(2),
      r.tdsDeduction.toFixed(2),
      r.amountReceivable.toFixed(2),
      `"${r.paymentReceivedDate}"`,
      r.actualAmountReceived.toFixed(2),
      `"${r.rtgsCheque.replace(/"/g, '""')}"`,
    ]);

    // Summary Row
    csvData.push([
      '"TOTAL"',
      '""',
      '""',
      '""',
      '""',
      totals.basic.toFixed(2),
      totals.cgst.toFixed(2),
      totals.sgst.toFixed(2),
      totals.final.toFixed(2),
      totals.tds.toFixed(2),
      totals.receivable.toFixed(2),
      '""',
      totals.received.toFixed(2),
      '""',
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvData.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Billing_Statement_${firmFilter}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900 font-sans antialiased pb-12">
      {/* ─── APP HEADER ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white shadow-md border-b border-slate-800">
        <div className="max-w-[1920px] mx-auto px-4 py-3 sm:px-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="h-9 w-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-inner">
                VE
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold leading-tight tracking-tight text-white flex items-center gap-2">
                  <span>BILLING STATEMENT & LEDGER</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-normal border border-blue-400/30">
                    Live Sheet
                  </span>
                </h1>
                <p className="text-xs text-slate-400">Vithal Enterprises • R.V Enterprises</p>
              </div>
            </div>

            {/* Mobile Refresh Button */}
            <button
              onClick={loadData}
              disabled={loading}
              className="md:hidden p-2 text-slate-300 hover:text-white rounded-md bg-slate-800 border border-slate-700 active:scale-95 transition"
              title="Refresh"
            >
              🔄
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={handleExportCsv}
              disabled={loading || filteredRows.length === 0}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm active:scale-95 transition whitespace-nowrap"
            >
              📥 <span>Export Excel (CSV)</span>
            </button>
            <button
              onClick={() => window.print()}
              disabled={loading}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 shadow-sm active:scale-95 transition whitespace-nowrap"
            >
              🖨️ <span>Print / PDF</span>
            </button>
            <button
              onClick={loadData}
              disabled={loading}
              className="hidden md:flex px-3 py-1.5 text-xs font-semibold rounded-md bg-blue-600 hover:bg-blue-500 text-white items-center gap-1.5 shadow-sm active:scale-95 transition whitespace-nowrap"
            >
              🔄 <span>Refresh</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── FILTERS & KPI SUMMARY ───────────────────────────────────────────── */}
      <section className="max-w-[1920px] mx-auto px-4 py-4 sm:px-6">
        {/* KPI Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-300 shadow-sm">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-0.5">
              Total Invoiced ({filteredRows.length} Bills)
            </span>
            <span className="text-base sm:text-lg font-extrabold text-slate-900">
              ₹ {formatInr(totals.final)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-lg border border-slate-300 shadow-sm">
            <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider block mb-0.5">
              Total Received
            </span>
            <span className="text-base sm:text-lg font-extrabold text-emerald-700">
              ₹ {formatInr(totals.received)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-lg border border-slate-300 shadow-sm">
            <span className="text-[11px] font-bold text-amber-600 uppercase tracking-wider block mb-0.5">
              Total TDS Deducted
            </span>
            <span className="text-base sm:text-lg font-extrabold text-amber-700">
              ₹ {formatInr(totals.tds)}
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-lg border border-red-200 bg-red-50/40 shadow-sm">
            <span className="text-[11px] font-bold text-red-600 uppercase tracking-wider block mb-0.5">
              Amount Receivable (Due)
            </span>
            <span className="text-base sm:text-lg font-extrabold text-red-700">
              ₹ {formatInr(totals.receivable)}
            </span>
          </div>
        </div>

        {/* Interactive Filter Controls */}
        <div className="bg-white p-3.5 rounded-lg border border-slate-300 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Firm Scope Filter */}
            <div className="flex items-center rounded-md border border-slate-300 overflow-hidden bg-slate-50 p-0.5">
              <button
                onClick={() => setFirmFilter('Both')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  firmFilter === 'Both' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                🌐 Both Firms
              </button>
              <button
                onClick={() => setFirmFilter('Vithal')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  firmFilter === 'Vithal' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                🏭 Vithal
              </button>
              <button
                onClick={() => setFirmFilter('RV')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  firmFilter === 'RV' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                🏢 R.V
              </button>
            </div>

            {/* Payment Status Filter */}
            <div className="flex items-center rounded-md border border-slate-300 overflow-hidden bg-slate-50 p-0.5">
              <button
                onClick={() => setStatusFilter('All')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  statusFilter === 'All' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:text-slate-900'
                }`}
              >
                All Status
              </button>
              <button
                onClick={() => setStatusFilter('Pending')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  statusFilter === 'Pending' ? 'bg-red-600 text-white shadow-sm' : 'text-slate-700 hover:text-red-700'
                }`}
              >
                ⏳ Pending ({rows.filter(r => !r.isPaid).length})
              </button>
              <button
                onClick={() => setStatusFilter('Paid')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  statusFilter === 'Paid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-700 hover:text-emerald-700'
                }`}
              >
                ✅ Paid
              </button>
              <button
                onClick={() => setStatusFilter('Partial')}
                className={`px-2.5 py-1 text-xs font-semibold rounded transition ${
                  statusFilter === 'Partial' ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-700 hover:text-amber-700'
                }`}
              >
                🟡 Partial
              </button>
            </div>

            {/* Month Filter Dropdown */}
            {availableMonths.length > 0 && (
              <select
                value={monthFilter}
                onChange={e => setMonthFilter(e.target.value)}
                className="px-2.5 py-1 text-xs font-semibold rounded-md border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="All">📅 All Billing Months</option>
                {availableMonths.map(m => (
                  <option key={m} value={m}>
                    📅 {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔍 Search Party, Bill#, RTGS..."
              className="w-full pl-3 pr-8 py-1.5 text-xs font-medium rounded-md border border-slate-300 bg-slate-50 focus:bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ─── PROFESSIONAL HTML TABLE CONTAINER ──────────────────────────────── */}
      <section className="max-w-[1920px] mx-auto px-4 sm:px-6">
        <div className="bg-white rounded-lg shadow-md border border-slate-300 overflow-hidden">
          
          {/* Scrollable Container with Smooth Touch Scrolling */}
          <div 
            className="w-full overflow-x-auto scrollbar-thin scrollbar-thumb-slate-400 scrollbar-track-slate-100"
            style={{ 
              WebkitOverflowScrolling: 'touch',
              maxWidth: '100%' 
            }}
          >
            {loading ? (
              <div className="py-20 text-center text-slate-500 font-medium flex flex-col items-center justify-center gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p>Loading real-time billing records from Firestore...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-red-600 font-medium">
                <p className="text-lg">❌ Error loading data</p>
                <p className="text-xs text-slate-500 mt-1">{error}</p>
                <button
                  onClick={loadData}
                  className="mt-3 px-4 py-1.5 text-xs bg-red-600 text-white font-semibold rounded hover:bg-red-500"
                >
                  Retry Load
                </button>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <p className="text-base font-semibold">No invoices match the selected filter criteria.</p>
                <p className="text-xs text-slate-400 mt-1">Try resetting the search or firm filters.</p>
                <button
                  onClick={() => {
                    setFirmFilter('Both');
                    setStatusFilter('All');
                    setMonthFilter('All');
                    setSearchQuery('');
                  }}
                  className="mt-3 px-3 py-1 text-xs bg-slate-800 text-white rounded font-medium"
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              /* REAL HTML TABLE WITH SOLID CONTINUOUS BORDERS */
              <table
                className="w-full text-left text-slate-900 border-collapse"
                style={{
                  minWidth: '1550px',
                  border: '1px solid #94a3b8',
                  borderCollapse: 'collapse',
                  fontSize: '12px',
                }}
              >
                {/* TABLE HEADER */}
                <thead>
                  <tr 
                    style={{ 
                      backgroundColor: '#0f172a', 
                      color: '#ffffff',
                      borderBottom: '2px solid #0f172a'
                    }}
                  >
                    <th style={thStyle({ align: 'center', width: '90px' })}>1. Bill NO.</th>
                    <th style={thStyle({ align: 'center', width: '105px' })}>2. Bill Date</th>
                    <th style={thStyle({ align: 'center', width: '120px' })}>3. Month</th>
                    <th style={thStyle({ align: 'left', minWidth: '220px' })}>4. Party&apos;s Name</th>
                    <th style={thStyle({ align: 'right', width: '125px' })}>5. Basic Amount</th>
                    <th style={thStyle({ align: 'right', width: '105px' })}>6. CGST</th>
                    <th style={thStyle({ align: 'right', width: '105px' })}>7. SGST</th>
                    <th style={thStyle({ align: 'right', width: '135px', bg: '#1e293b' })}>8. Final Amount</th>
                    <th style={thStyle({ align: 'right', width: '115px' })}>9. TDS Deduction</th>
                    <th style={thStyle({ align: 'right', width: '145px', bg: '#1e293b' })}>10. Amount Receivable</th>
                    <th style={thStyle({ align: 'center', width: '140px' })}>11. Payment Received Date</th>
                    <th style={thStyle({ align: 'right', width: '145px' })}>12. Actual Amount Received</th>
                    <th style={thStyle({ align: 'left', minWidth: '160px' })}>13. RTGS/CHEQUE</th>
                  </tr>
                </thead>

                {/* TABLE BODY */}
                <tbody>
                  {filteredRows.map((row, idx) => {
                    const isEven = idx % 2 === 0;
                    const rowBg = isEven ? '#ffffff' : '#f8fafc';
                    const isUnpaid = !row.isPaid;
                    const firmBadgeColor = row.enterprise === 'RV' ? '#7e22ce' : '#2563eb';

                    return (
                      <tr
                        key={row.id}
                        style={{
                          backgroundColor: rowBg,
                          borderBottom: '1px solid #cbd5e1',
                        }}
                        className="hover:bg-blue-50/70 transition-colors"
                      >
                        {/* 1. Bill NO. */}
                        <td style={tdStyle({ align: 'center', weight: '700' })}>
                          <div className="flex items-center justify-center gap-1.5">
                            <span
                              style={{
                                display: 'inline-block',
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: firmBadgeColor,
                              }}
                              title={row.enterprise === 'RV' ? 'R.V Enterprises' : 'Vithal Enterprises'}
                            />
                            <span className="font-mono">{row.billNoFormatted}</span>
                          </div>
                        </td>

                        {/* 2. Bill Date */}
                        <td style={tdStyle({ align: 'center' })}>
                          {row.billDateFormatted}
                        </td>

                        {/* 3. Month */}
                        <td style={tdStyle({ align: 'center' })}>
                          <span className="px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-800 text-[11px] font-medium">
                            {row.month}
                          </span>
                        </td>

                        {/* 4. Party's Name */}
                        <td style={tdStyle({ align: 'left', weight: '600' })}>
                          <div className="leading-snug">
                            <span>{row.partyName}</span>
                            <span className="block text-[10px] text-slate-500 font-normal">
                              {row.enterprise === 'RV' ? '🏢 R.V Enterprises' : '🏭 Vithal Enterprises'}
                            </span>
                          </div>
                        </td>

                        {/* 5. Basic Amount */}
                        <td style={tdStyle({ align: 'right', fontMono: true })}>
                          ₹ {formatInr(row.basicAmount)}
                        </td>

                        {/* 6. CGST */}
                        <td style={tdStyle({ align: 'right', fontMono: true, color: '#64748b' })}>
                          ₹ {formatInr(row.cgst)}
                        </td>

                        {/* 7. SGST */}
                        <td style={tdStyle({ align: 'right', fontMono: true, color: '#64748b' })}>
                          ₹ {formatInr(row.sgst)}
                        </td>

                        {/* 8. Final Amount */}
                        <td style={tdStyle({ align: 'right', weight: '700', fontMono: true, bg: isEven ? '#f1f5f9' : '#e2e8f0' })}>
                          ₹ {formatInr(row.finalAmount)}
                        </td>

                        {/* 9. TDS Deduction */}
                        <td style={tdStyle({ align: 'right', fontMono: true, color: row.tdsDeduction > 0 ? '#b45309' : '#94a3b8' })}>
                          {row.tdsDeduction > 0 ? `₹ ${formatInr(row.tdsDeduction)}` : '-'}
                        </td>

                        {/* 10. Amount Receivable */}
                        <td 
                          style={tdStyle({ 
                            align: 'right', 
                            weight: '700', 
                            fontMono: true, 
                            color: isUnpaid ? '#b91c1c' : '#15803d',
                            bg: isUnpaid ? (isEven ? '#fef2f2' : '#fee2e2') : (isEven ? '#f0fdf4' : '#dcfce7')
                          })}
                        >
                          <div className="flex items-center justify-end gap-1.5">
                            <span>₹ {formatInr(row.amountReceivable)}</span>
                            {isUnpaid ? (
                              <span className="text-[10px] px-1 py-0.2 rounded bg-red-100 text-red-700 font-bold">
                                DUE
                              </span>
                            ) : (
                              <span className="text-[10px] px-1 py-0.2 rounded bg-emerald-100 text-emerald-700 font-bold">
                                PAID
                              </span>
                            )}
                          </div>
                        </td>

                        {/* 11. Payment Received Date */}
                        <td style={tdStyle({ align: 'center', color: row.paymentReceivedDate === 'Pending' ? '#94a3b8' : '#0f172a' })}>
                          {row.paymentReceivedDate}
                        </td>

                        {/* 12. Actual Amount Received */}
                        <td style={tdStyle({ align: 'right', fontMono: true, weight: '600', color: row.actualAmountReceived > 0 ? '#15803d' : '#94a3b8' })}>
                          {row.actualAmountReceived > 0 ? `₹ ${formatInr(row.actualAmountReceived)}` : '₹ 0.00'}
                        </td>

                        {/* 13. RTGS/CHEQUE */}
                        <td style={tdStyle({ align: 'left', color: row.rtgsCheque === '-' ? '#94a3b8' : '#334155' })}>
                          <span className="font-mono text-[11px]">{row.rtgsCheque}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>

                {/* TABLE FOOTER / TOTAL SUMMARY ROW */}
                <tfoot>
                  <tr
                    style={{
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      fontWeight: '700',
                      borderTop: '2px solid #0f172a',
                    }}
                  >
                    <td style={tfootStyle({ align: 'center' })}>TOTAL</td>
                    <td style={tfootStyle({ align: 'center' })}>-</td>
                    <td style={tfootStyle({ align: 'center' })}>-</td>
                    <td style={tfootStyle({ align: 'left' })}>
                      {filteredRows.length} INVOICES PROCESSED
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true })}>
                      ₹ {formatInr(totals.basic)}
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true })}>
                      ₹ {formatInr(totals.cgst)}
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true })}>
                      ₹ {formatInr(totals.sgst)}
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true, bg: '#1e293b' })}>
                      ₹ {formatInr(totals.final)}
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true, color: '#fcd34d' })}>
                      ₹ {formatInr(totals.tds)}
                    </td>
                    <td style={tfootStyle({ align: 'right', fontMono: true, color: '#fca5a5', bg: '#1e293b' })}>
                      ₹ {formatInr(totals.receivable)}
                    </td>
                    <td style={tfootStyle({ align: 'center' })}>-</td>
                    <td style={tfootStyle({ align: 'right', fontMono: true, color: '#86efac' })}>
                      ₹ {formatInr(totals.received)}
                    </td>
                    <td style={tfootStyle({ align: 'left' })}>-</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Table Bottom Info Note */}
          <div className="bg-slate-100 px-4 py-2.5 border-t border-slate-300 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
            <span>
              💡 <strong>Mobile / Tablet:</strong> Swipe horizontally (left ⇄ right) to view all 13 columns.
            </span>
            <span className="text-[11px] text-slate-400">
              Showing {filteredRows.length} of {rows.length} total recorded invoices
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

// ─── SOLID CONTINUOUS BORDER STYLING HELPERS ────────────────────────────────
function thStyle(opts: { align?: 'left' | 'center' | 'right'; width?: string; minWidth?: string; bg?: string }): React.CSSProperties {
  return {
    padding: '10px 12px',
    textAlign: opts.align || 'left',
    width: opts.width,
    minWidth: opts.minWidth || opts.width,
    backgroundColor: opts.bg || '#0f172a',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    letterSpacing: '0.025em',
    border: '1px solid #475569', // SOLID CONTINUOUS BORDER
    userSelect: 'none',
  };
}

function tdStyle(opts: {
  align?: 'left' | 'center' | 'right';
  weight?: string;
  fontMono?: boolean;
  color?: string;
  bg?: string;
}): React.CSSProperties {
  return {
    padding: '8px 12px',
    textAlign: opts.align || 'left',
    fontWeight: opts.weight || '400',
    fontFamily: opts.fontMono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : 'inherit',
    color: opts.color || '#0f172a',
    backgroundColor: opts.bg,
    whiteSpace: 'nowrap',
    border: '1px solid #cbd5e1', // SOLID CONTINUOUS BORDER
  };
}

function tfootStyle(opts: {
  align?: 'left' | 'center' | 'right';
  fontMono?: boolean;
  color?: string;
  bg?: string;
}): React.CSSProperties {
  return {
    padding: '10px 12px',
    textAlign: opts.align || 'left',
    fontFamily: opts.fontMono ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' : 'inherit',
    color: opts.color || '#ffffff',
    backgroundColor: opts.bg || '#0f172a',
    fontWeight: '700',
    fontSize: '12px',
    whiteSpace: 'nowrap',
    border: '1px solid #475569', // SOLID CONTINUOUS BORDER
  };
}
