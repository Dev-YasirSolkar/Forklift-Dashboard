'use client';
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { PlusCircle, Search, XCircle, Info, Trash2, Download, FileSpreadsheet, MapPin, FileText, User, Building2, Phone, Fingerprint, Loader2, CheckSquare2, CalendarClock, AlignLeft, AlignCenter, AlignRight, ChevronDown, ListFilter } from "lucide-react";
import AppLayout from "@/components/app-layout";
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, orderBy, doc } from 'firebase/firestore';
import { Invoice, Company, Payment, CompanySettings } from '@/lib/data';
import { format, parseISO, differenceInDays } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { cn } from '@/lib/utils';
import { generatePaymentSummaryPdf, type ColumnConfig } from '@/lib/payment-summary-generator';
import * as XLSX from 'xlsx';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

type Enterprise = 'Vithal' | 'RV';
type PaymentStatus = 'Received' | 'Partial' | 'Pending';
type PaymentMode = 'RTGS' | 'NEFT' | 'IMPS' | 'CHEQUE' | 'CASH';

type ProcessedInvoice = Invoice & {
    companyName: string;
    totalPaid: number;
    totalDeductions: number;
    taxableAmount: number;
    tdsAmount: number;
    balance: number;
    status: PaymentStatus;
};

const defaultColumnConfigs: Record<string, ColumnConfig & { title: string }> = {
    billNo: { title: 'Invoice ID', label: 'Bill No.', align: 'center', visible: true },
    date: { title: 'Invoice Creation Date', label: 'Date', align: 'center', visible: true },
    company: { title: 'Recipient Company Name', label: 'Company Name', align: 'left', visible: true },
    billed: { title: 'Gross Billed Amount', label: 'Billed Amt', align: 'right', visible: true },
    received: { title: 'Actual Received Amount', label: 'Received', align: 'right', visible: true },
    tds: { title: 'Tax Deducted at Source', label: 'TDS', align: 'right', visible: true },
    balance: { title: 'Total Pending Amount', label: 'Pending Amt', align: 'right', visible: true },
    dueDays: { title: 'Overdue Days Count', label: 'Due Days', align: 'center', visible: false }
};

export default function PaymentsPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  // Data fetching
  const invoicesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'invoices'), orderBy('billNo', 'asc')) : null, [firestore, user]);
  const companiesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'companies'), orderBy('name')) : null, [firestore, user]);
  const paymentsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'payments'), orderBy('paymentDate', 'desc')) : null, [firestore, user]);
  
  const vithalSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'vithal') : null, [firestore, user]);
  const rvSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'rv') : null, [firestore, user]);

  const { data: invoices, isLoading: isLoadingInvoices } = useCollection<Invoice>(invoicesQuery);
  const { data: companies, isLoading: isLoadingCompanies } = useCollection<Company>(companiesQuery);
  const { data: payments, isLoading: isLoadingPayments } = useCollection<Payment>(paymentsQuery);
  const { data: vithalSettings } = useDoc<CompanySettings>(vithalSettingsRef);
  const { data: rvSettings } = useDoc<CompanySettings>(rvSettingsRef);

  const isLoading = isLoadingInvoices || isLoadingCompanies || isLoadingPayments;

  // Filters
  const [activeTab, setActiveTab] = useState<Enterprise>('Vithal');
  const [companyFilter, setCompanyFilter] = useState('All');
  const [statusFilters, setStatusFilters] = useState<PaymentStatus[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('All');
  const [monthFilter, setMonthFilter] = useState('All');
  
  // Dialog States
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<ProcessedInvoice | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [invoiceForDetails, setInvoiceForDetails] = useState<ProcessedInvoice | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);

  // Download Dialog State
  const [isDownloadPromptOpen, setIsDownloadPromptOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [tempAddress, setTempAddress] = useState('');
  const [tempSubject, setTempSubject] = useState('');
  const [tempDescription, setTempDescription] = useState('');
  const [tempSalutation, setTempSalutation] = useState('Dear Sir,');
  const [tempClientName, setTempClientName] = useState('');
  const [tempClientGstin, setTempClientGstin] = useState('');
  const [tempFirmGstin, setTempFirmGstin] = useState('');
  const [tempFirmMobiles, setTempFirmMobiles] = useState('');
  const [columnConfigs, setColumnConfigs] = useState<Record<string, ColumnConfig & { title: string }>>(defaultColumnConfigs);


  // Payment Form State
  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [receivedAmount, setReceivedAmount] = useState('');
  const [otherDeductions, setOtherDeductions] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('RTGS');
  const [chequeDetails, setChequeDetails] = useState('');
  
  const closeAllDialogs = useCallback(() => {
    setIsPaymentDialogOpen(false);
    setSelectedInvoiceForPayment(null);
    setIsDetailsDialogOpen(false);
    setInvoiceForDetails(null);
    setPaymentToDelete(null);
    setIsDownloadPromptOpen(false);
  }, []);

  useEffect(() => {
    if (yearFilter === 'All') {
      setMonthFilter('All');
    }
  }, [yearFilter]);

  const getPaymentDetails = useCallback((invoiceId: string) => {
    const relevantPayments = payments?.filter(p => p.invoiceId === invoiceId) || [];
    const totalPaid = relevantPayments.reduce((acc, p) => acc + p.receivedAmount, 0);
    const totalDeductions = relevantPayments.reduce((acc, p) => acc + (p.otherDeductions || 0), 0);
    return { totalPaid, totalDeductions };
  }, [payments]);

  const processedInvoices = useMemo((): ProcessedInvoice[] => {
    if (!invoices) return [];
    return invoices.map(invoice => {
      const { totalPaid, totalDeductions } = getPaymentDetails(invoice.id);
      
      const taxableAmount = invoice.discountType === 'before_gst' 
        ? invoice.netTotal - (invoice.discount || 0) 
        : invoice.netTotal;
      const tdsPercentage = invoice.tdsPercentage || 0;
      const tdsAmount = (taxableAmount * tdsPercentage) / 100;
      
      const totalReceivedWithAdvance = totalPaid + (invoice.advanceReceived || 0);
      const totalCredited = totalReceivedWithAdvance + totalDeductions;
      const rawBalance = invoice.grandTotal - totalCredited - tdsAmount;
      const roundedBalance = Math.round(rawBalance);

      let status: PaymentStatus;
      let finalBalance = roundedBalance;

      if (roundedBalance <= 0) {
        status = 'Received';
        finalBalance = 0;
      } else if (totalCredited > 0 && roundedBalance > 0) {
        status = 'Partial';
      } else {
        status = 'Pending';
      }

      return {
        ...invoice,
        companyName: companies?.find(c => c.id === invoice.companyId)?.name || 'Unknown',
        totalPaid: totalReceivedWithAdvance,
        totalDeductions,
        taxableAmount,
        tdsAmount,
        balance: finalBalance,
        status,
      };
    });
  }, [invoices, companies, getPaymentDetails]);

  const handleOpenPaymentDialog = useCallback((invoice: ProcessedInvoice) => {
    closeAllDialogs();
    setSelectedInvoiceForPayment(invoice);
    setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    setReceivedAmount('');
    setOtherDeductions('');
    setNotes('');
    setPaymentMode('RTGS');
    setChequeDetails('');
    setIsPaymentDialogOpen(true);
  }, [closeAllDialogs]);

  // AI Voice Command Listener (Placed after handleOpenPaymentDialog definition)
  useEffect(() => {
    const handleVoiceFill = (event: any) => {
        const { intent, data } = event.detail;
        if (intent === 'payment') {
            const billNoToMatch = data.billNo;
            const matchedInvoice = processedInvoices.find(inv => inv.billNo.toString() === billNoToMatch?.toString() && inv.enterprise === activeTab);
            if (matchedInvoice) {
                handleOpenPaymentDialog(matchedInvoice);
                if (data.amount) setReceivedAmount(data.amount.toString());
                if (data.mode) setPaymentMode(data.mode.toUpperCase() as PaymentMode);
            }
        }
    };
    window.addEventListener('ai-form-fill', handleVoiceFill);
    return () => window.removeEventListener('ai-form-fill', handleVoiceFill);
  }, [processedInvoices, activeTab, handleOpenPaymentDialog]);
  
  const availableYears = useMemo(() => {
    if (!processedInvoices) return [];
    const years = new Set(processedInvoices.filter(inv => inv.enterprise === activeTab).map(inv => {
        const dateString = inv.billingMonth ? `${inv.billingMonth}-01` : inv.billDate;
        return format(parseISO(dateString), 'yyyy');
    }));
    return ['All', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
  }, [processedInvoices, activeTab]);

  const availableMonths = useMemo(() => {
    if (yearFilter === 'All' || !processedInvoices) return [];
    const months = new Set(
      processedInvoices
        .filter(inv => {
            const dateString = inv.billingMonth ? `${inv.billingMonth}-01` : inv.billDate;
            return format(parseISO(dateString), 'yyyy') === yearFilter && inv.enterprise === activeTab;
        })
        .map(inv => inv.billingMonth || format(parseISO(inv.billDate), 'yyyy-MM'))
    );
    return ['All', ...Array.from(months).sort()];
  }, [processedInvoices, yearFilter, activeTab]);

  const filteredInvoices = useMemo(() => {
    return processedInvoices.filter(invoice => {
      const enterpriseMatch = invoice.enterprise === activeTab;
      if (!enterpriseMatch) return false;

      const yearFromInvoice = invoice.billingMonth ? invoice.billingMonth.substring(0, 4) : format(parseISO(invoice.billDate), 'yyyy');
      const monthFromInvoice = invoice.billingMonth || format(parseISO(invoice.billDate), 'yyyy-MM');
      
      const yearMatch = yearFilter === 'All' || yearFromInvoice === yearFilter;
      const monthMatch = monthFilter === 'All' || monthFromInvoice === monthFilter;

      const companyMatch = companyFilter === 'All' || invoice.companyId === companyFilter;
      const statusMatch = statusFilters.length === 0 || statusFilters.includes(invoice.status);
      
      const searchLower = searchFilter.toLowerCase();
      const searchMatch = searchFilter === '' ||
        invoice.billNo.toString().includes(searchLower) ||
        invoice.companyName.toLowerCase().includes(searchLower);

      return yearMatch && monthMatch && companyMatch && statusMatch && searchMatch;
    });
  }, [processedInvoices, activeTab, companyFilter, statusFilters, searchFilter, yearFilter, monthFilter]);
  
  const monthlyGroupedInvoices = useMemo(() => {
    if (!filteredInvoices) return [];

    const groups = filteredInvoices.reduce((acc, invoice) => {
      const monthKey = invoice.billingMonth || format(parseISO(invoice.billDate), 'yyyy-MM');
      if (!acc[monthKey]) {
        acc[monthKey] = [];
      }
      acc[monthKey].push(invoice);
      return acc;
    }, {} as Record<string, ProcessedInvoice[]>);
    
    const sortedMonthKeys = Object.keys(groups).sort((a,b) => b.localeCompare(a));

    return sortedMonthKeys.map(monthKey => ({
      monthKey,
      monthLabel: format(parseISO(`${monthKey}-01`), 'MMMM yyyy'),
      invoices: groups[monthKey],
    }));
  }, [filteredInvoices]);

  const summary = useMemo(() => {
      const totalBilled = filteredInvoices.reduce((acc, inv) => acc + inv.grandTotal, 0);
      const totalPaid = filteredInvoices.reduce((acc, inv) => acc + inv.totalPaid, 0);
      const totalTds = filteredInvoices.reduce((acc, inv) => acc + inv.tdsAmount, 0);
      const totalPending = filteredInvoices.reduce((acc, inv) => acc + inv.balance, 0);
      return { totalBilled, totalPaid, totalTds, totalPending };
  }, [filteredInvoices]);

  const clearFilters = () => {
    setCompanyFilter('All');
    setStatusFilters([]);
    setSearchFilter('');
    setYearFilter('All');
    setMonthFilter('All');
  };
  
  const handleStartDownloadSummary = () => {
    if (filteredInvoices.length === 0) {
        toast({ variant: 'destructive', title: 'No Data', description: 'No invoices found for the current filters.' });
        return;
    }
    
    const selectedCompanyObj = companies?.find(c => c.id === companyFilter);
    const settings = activeTab === 'Vithal' ? vithalSettings : rvSettings;

    setTempClientName(selectedCompanyObj?.name || 'ESTEEMED CLIENT');
    setTempClientGstin(selectedCompanyObj?.gstin || '');
    setTempAddress(selectedCompanyObj?.address || '');
    setTempFirmGstin(settings?.gstin || '');
    setTempFirmMobiles("9987559327, 9821728079");
    setTempSalutation('Dear Sir,');
    
    let monthLabel = '';
    if (monthFilter !== 'All') {
        try {
            monthLabel = format(parseISO(`${monthFilter}-01`), 'MMMM');
        } catch(e) {}
    }
    const defaultSubject = `Balance Confirmation Statement for ${monthLabel} ${yearFilter !== 'All' ? yearFilter : ''}`.trim();
    setTempSubject(defaultSubject);

    const companyDisplay = selectedCompanyObj ? `M/s ${selectedCompanyObj.name.toUpperCase()}` : 'your esteemed organization';
    setTempDescription(`This is to inform you about the outstanding balance of ${companyDisplay} as per our records mentioned below:`);
    
    setIsDownloadPromptOpen(true);
  }

  const executeDownloadSummary = async () => {
    let selectedMonthLabel = 'All';
    if (monthFilter !== 'All') {
        try {
            selectedMonthLabel = format(parseISO(`${monthFilter}-01`), 'MMMM');
        } catch(e) {}
    }

    setIsGeneratingPdf(true);
    try {
        await generatePaymentSummaryPdf(filteredInvoices, activeTab, {
            company: tempClientName,
            address: tempAddress || '',
            gstin: tempClientGstin,
            month: selectedMonthLabel,
            year: yearFilter,
            firmGstin: tempFirmGstin,
            firmMobile: tempFirmMobiles,
            customSubject: tempSubject,
            customDescription: tempDescription,
            salutation: tempSalutation,
            columnConfigs: columnConfigs
        });
        toast({ title: 'Downloading', description: `Balance Confirmation Letter for ${tempClientName} is ready.` });
    } finally {
        setIsGeneratingPdf(false);
        setIsDownloadPromptOpen(false);
    }
  }

  const handleDownloadExcel = () => {
    if (filteredInvoices.length === 0) {
        toast({ variant: 'destructive', title: 'No Data', description: 'No records to export.' });
        return;
    }

    const data = filteredInvoices.map(inv => ({
        'Bill No': `${inv.billNo}-${inv.billNoSuffix || 'MHE'}`,
        'Date': format(new Date(inv.billDate), 'dd-MMM-yyyy'),
        'Company': inv.companyName.toUpperCase(), 
        'Grand Total': inv.grandTotal,
        'Taxable Amount': inv.taxableAmount,
        'TDS %': inv.tdsPercentage || 0,
        'TDS Amount': inv.tdsAmount,
        'Total Received': inv.totalPaid,
        'Balance Due': inv.balance,
        'Status': inv.status,
        'Enterprise': inv.enterprise
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payments");
    
    const fileName = `Payments_${activeTab}_${format(new Date(), 'dd-MMM-yyyy')}.xlsx`;
    XLSX.writeFile(wb, fileName);
    
    toast({ title: 'Excel Downloaded', description: 'Payment records saved to your device.' });
  }

  const handleOpenDetailsDialog = (invoice: ProcessedInvoice) => {
    closeAllDialogs();
    setInvoiceForDetails(invoice);
    setIsDetailsDialogOpen(true);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
  }

  const handleAddPayment = () => {
    if (!firestore || !selectedInvoiceForPayment) return;

    const received = parseFloat(receivedAmount.replace(/,/g, '')) || 0;
    const newOtherDeductions = parseFloat(otherDeductions.replace(/,/g, '')) || 0;
    const trimmedNotes = notes.trim();

    if (received <= 0 && newOtherDeductions <= 0 && !trimmedNotes) {
        toast({
            variant: "destructive",
            title: "Invalid Entry",
            description: "Please enter an amount, deductions, or a note.",
        });
        return;
    }
    
    const totalPayment = received + newOtherDeductions;
    const currentRoundedBalance = selectedInvoiceForPayment.balance;

    if (totalPayment > 0 && totalPayment > currentRoundedBalance + 0.5) {
        toast({
            variant: "destructive",
            title: "Payment Exceeds Balance",
            description: `Payment of ${formatCurrency(totalPayment)} is more than the pending amount of ${formatCurrency(currentRoundedBalance)}.`,
        });
        return;
    }

    const paymentData: Omit<Payment, 'id'> = {
        invoiceId: selectedInvoiceForPayment.id,
        companyId: selectedInvoiceForPayment.companyId,
        paymentDate: paymentDate,
        receivedAmount: received,
        tdsDeducted: 0, 
        otherDeductions: newOtherDeductions,
        notes: trimmedNotes,
        createdAt: new Date().toISOString(),
        paymentMode: paymentMode,
        chequeDetails: paymentMode === 'CHEQUE' ? chequeDetails : '',
    };
    
    addDocumentNonBlocking(collection(firestore, 'payments'), paymentData);

    toast({
        title: "Entry Recorded",
        description: `An entry for Bill No. ${selectedInvoiceForPayment.billNo} has been recorded.`,
    });

    setIsPaymentDialogOpen(false);
}

  const handleTdsUpdate = (invoiceId: string, value: string) => {
    if (!firestore) return;
    const percentage = Number(value);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        toast({
            variant: "destructive",
            title: "Invalid TDS %",
            description: "Please enter a number between 0 and 100.",
        });
        return;
    }
    const invoiceRef = doc(firestore, 'invoices', invoiceId);
    updateDocumentNonBlocking(invoiceRef, { tdsPercentage: percentage });
  }
  
  const handleDeletePayment = () => {
    if (firestore && paymentToDelete) {
        const paymentDocRef = doc(firestore, 'payments', paymentToDelete.id);
        deleteDocumentNonBlocking(paymentDocRef);
        toast({
            title: "Payment Deleted",
            description: `The payment record has been successfully deleted.`,
        });
        setPaymentToDelete(null);
    }
  }

  const getStatusBadge = (status: PaymentStatus) => {
    switch (status) {
      case 'Received':
        return <Badge className="bg-green-600/80 dark:bg-green-500/80 text-white text-[10px] sm:text-xs">Received</Badge>;
      case 'Partial':
        return <Badge className="bg-yellow-500/80 dark:bg-yellow-600/80 text-white text-[10px] sm:text-xs">Partial</Badge>;
      case 'Pending':
        return <Badge variant="destructive" className="text-[10px] sm:text-xs">Pending</Badge>;
      default:
        return <Badge variant="secondary" className="text-[10px] sm:text-xs">{status}</Badge>;
    }
  }

  const updateColumnConfig = (key: string, updates: Partial<ColumnConfig>) => {
    setColumnConfigs(prev => ({
        ...prev,
        [key]: { ...prev[key], ...updates }
    }));
  }

  const toggleStatusFilter = (status: PaymentStatus) => {
    setStatusFilters(prev => 
        prev.includes(status) 
            ? prev.filter(s => s !== status) 
            : [...prev, status]
    );
  };


  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:gap-6">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Enterprise)} className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader className="p-4 sm:p-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <CardTitle>Payment Tracking</CardTitle>
                    <CardDescription>Monitor and manage invoice payments.</CardDescription>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <Button 
                        onClick={handleDownloadExcel} 
                        variant="outline" 
                        size="sm" 
                        className="h-9 px-4 text-xs font-bold border-green-200 hover:bg-green-50 shadow-sm"
                        disabled={filteredInvoices.length === 0}
                    >
                        <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
                        Download as Excel
                    </Button>
                    <Button 
                        onClick={handleStartDownloadSummary} 
                        variant="outline" 
                        size="sm" 
                        className="h-9 px-4 text-xs font-bold border-primary/20 hover:bg-primary/5 shadow-sm"
                        disabled={filteredInvoices.length === 0}
                    >
                        <Download className="mr-2 h-4 w-4 text-primary" />
                        Download Summary Statement
                    </Button>
                </div>
              </div>
              <TabsList className="grid w-full grid-cols-2 mt-4">
                  <TabsTrigger value="Vithal" className="text-xs sm:text-sm">Vithal Enterprises</TabsTrigger>
                  <TabsTrigger value="RV" className="text-xs sm:text-sm">R.V Enterprises</TabsTrigger>
              </TabsList>
            </CardHeader>
          </Card>

          <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800 p-4">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300 uppercase">Total Billed</p>
                <div className="text-lg sm:text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(summary.totalBilled)}</div>
              </div>
            </Card>
            <Card className="bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800 p-4">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-green-700 dark:text-blue-300 uppercase">Total Received</p>
                <div className="text-lg sm:text-2xl font-bold text-green-900 dark:text-blue-100">{formatCurrency(summary.totalPaid)}</div>
              </div>
            </Card>
            <Card className="bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800 p-4">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-orange-700 dark:text-orange-300 uppercase">Total TDS</p>
                <div className="text-lg sm:text-2xl font-bold text-green-900 dark:text-blue-100">{formatCurrency(summary.totalTds)}</div>
              </div>
            </Card>
            <Card className="bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800 p-4">
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-red-700 dark:text-red-300 uppercase">Total Pending</p>
                <div className="text-lg sm:text-2xl font-bold text-red-900 dark:text-blue-100">{formatCurrency(summary.totalPending)}</div>
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3 p-4 sm:p-6">
              <div className="flex flex-col gap-3 sm:gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 w-full flex-wrap">
                  <div className="relative flex-1 min-w-full sm:min-w-[200px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                        placeholder="Search Bill No. or Company..."
                        className="pl-8 w-full h-9 text-xs sm:text-sm"
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
                    <Select value={yearFilter} onValueChange={setYearFilter}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Year" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableYears.map(year => (
                          <SelectItem key={year} value={year} className="text-xs">{year === 'All' ? 'All Years' : year}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={monthFilter} onValueChange={setMonthFilter} disabled={yearFilter === 'All'}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Month" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableMonths.map(month => (
                          <SelectItem key={month} value={month} className="text-xs">
                            {month === 'All' ? 'All Months' : format(parseISO(`${month}-01`), 'MMMM')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
                    <Select value={companyFilter} onValueChange={setCompanyFilter}>
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="Company" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="All" className="text-xs">All Companies</SelectItem>
                        {companies?.map(c => <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-9 text-xs font-normal justify-between min-w-[120px]">
                                <div className="flex items-center gap-2">
                                    <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
                                    {statusFilters.length === 0 ? "All Statuses" : `${statusFilters.length} Selected`}
                                </div>
                                <ChevronDown className="ml-1 h-3 w-3 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-48 p-2" align="start">
                            <div className="space-y-1">
                                <p className="text-[10px] font-black uppercase text-muted-foreground px-2 py-1 tracking-wider">Filter Status</p>
                                <Separator className="mb-1" />
                                {(['Received', 'Partial', 'Pending'] as PaymentStatus[]).map(s => (
                                    <div 
                                        key={s} 
                                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-accent rounded-md cursor-pointer transition-colors"
                                        onClick={() => toggleStatusFilter(s)}
                                    >
                                        <Checkbox 
                                            id={`status-${s}`} 
                                            checked={statusFilters.includes(s)}
                                            onCheckedChange={() => toggleStatusFilter(s)}
                                        />
                                        <label 
                                            htmlFor={`status-${s}`} 
                                            className="text-xs font-medium cursor-pointer flex-1 leading-none"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            {s}
                                        </label>
                                    </div>
                                ))}
                                {statusFilters.length > 0 && (
                                    <>
                                        <Separator className="my-1" />
                                        <Button 
                                            variant="ghost" 
                                            className="w-full h-7 text-[10px] font-bold uppercase text-primary hover:text-primary"
                                            onClick={() => setStatusFilters([])}
                                        >
                                            Reset Status
                                        </Button>
                                    </>
                                )}
                            </div>
                        </PopoverContent>
                    </Popover>
                  </div>
                  <Button variant="ghost" onClick={clearFilters} className="w-full sm:w-auto h-9 text-xs">
                      <XCircle className="mr-2 h-4 w-4"/> Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 pt-0">
               <div className="px-4 py-2 text-[10px] sm:text-sm text-muted-foreground">
                {isLoading
                    ? 'Loading records...'
                    : `Showing ${filteredInvoices.length} of ${
                        processedInvoices.filter(inv => inv.enterprise === activeTab).length
                        } invoices.`}
              </div>

              {/* Mobile View */}
              <div className="md:hidden">
                {monthlyGroupedInvoices.length > 0 ? (
                  monthlyGroupedInvoices.map(({ monthKey, monthLabel, invoices: monthInvoices }) => (
                    <div key={monthKey} className="space-y-3">
                      <div className="bg-muted/50 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sticky top-0 z-10 border-y">
                        {monthLabel}
                      </div>
                      <div className="px-3 pb-4 space-y-3">
                        {monthInvoices.map((invoice) => (
                          <div key={invoice.id} className="border rounded-lg p-3 space-y-3 bg-card shadow-sm">
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <div className="text-xs font-bold">Bill No: {invoice.billNo}-{invoice.billNoSuffix || 'MHE'}</div>
                                <div className="text-[10px] text-muted-foreground font-medium">{invoice.companyName}</div>
                                <div className="text-[9px] text-muted-foreground">{format(parseISO(invoice.billDate), 'dd MMM yyyy')}</div>
                              </div>
                              <div className="flex gap-1.5">
                                 <Button variant="outline" size="icon" onClick={() => handleOpenDetailsDialog(invoice)} className="h-8 w-8">
                                    <Info className="h-4 w-4" />
                                </Button>
                                <Button variant="outline" size="icon" onClick={() => handleOpenPaymentDialog(invoice)} className="h-8 w-8">
                                    <PlusCircle className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-y-3 gap-x-4 border-t pt-3">
                              <div className="space-y-0.5">
                                <p className="text-[9px] text-muted-foreground uppercase">Grand Total</p>
                                <p className="text-xs font-bold">{formatCurrency(invoice.grandTotal)}</p>
                              </div>
                              <div className="space-y-0.5 text-right">
                                <p className="text-[9px] text-muted-foreground uppercase">Status</p>
                                {getStatusBadge(invoice.status)}
                              </div>
                              <div className="space-y-0.5">
                                <p className="text-[9px] text-muted-foreground uppercase">Received</p>
                                <p className="text-xs font-bold text-green-600 dark:text-green-400">{formatCurrency(invoice.totalPaid)}</p>
                              </div>
                              <div className="space-y-0.5 text-right">
                                <p className="text-[9px] text-muted-foreground uppercase">Balance Due</p>
                                <p className="text-xs font-bold text-orange-600 dark:text-orange-400">{formatCurrency(invoice.balance)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                               <Label className="text-[9px] text-muted-foreground uppercase whitespace-nowrap">TDS %:</Label>
                               <Input
                                  type="number"
                                  defaultValue={invoice.tdsPercentage || ''}
                                  onBlur={(e) => handleTdsUpdate(invoice.id, e.target.value)}
                                  className="h-6 w-12 text-center text-[10px] p-1"
                                  placeholder="%"
                                />
                                <span className="text-[10px] text-red-600 dark:text-red-400 font-medium">
                                  ({formatCurrency(invoice.tdsAmount)})
                                </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-muted-foreground text-sm">No records found.</div>
                )}
              </div>

              {/* Desktop View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">Bill No.</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Total / Taxable</TableHead>
                      <TableHead className="text-center w-28">TDS %</TableHead>
                      <TableHead className="text-right">TDS Amt</TableHead>
                      <TableHead className="text-right">Received</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right w-[100px]"><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">Loading payments...</TableCell>
                      </TableRow>
                    ) : monthlyGroupedInvoices.length > 0 ? (
                      monthlyGroupedInvoices.map(({ monthKey, monthLabel, invoices: monthInvoices }) => (
                        <React.Fragment key={monthKey}>
                          <TableRow className="border-b-0 hover:bg-transparent">
                            <TableCell colSpan={9} className="pt-10 pb-1">
                              <div className="relative">
                                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                      <div className="w-full border-t" />
                                  </div>
                                  <div className="relative flex justify-center">
                                      <span className="bg-background px-4 text-base font-bold uppercase tracking-wider text-muted-foreground">
                                          {monthLabel}
                                      </span>
                                  </div>
                              </div>
                            </TableCell>
                          </TableRow>
                          {monthInvoices.map((invoice) => (
                             <TableRow key={invoice.id}>
                              <TableCell className="font-medium text-center p-2 text-sm">{invoice.billNo}-{invoice.billNoSuffix || 'MHE'}</TableCell>
                              <TableCell className="p-2">
                                <div className="font-medium truncate max-w-[200px] text-sm uppercase">{invoice.companyName}</div>
                                <div className="text-[10px] text-muted-foreground">{format(parseISO(invoice.billDate), 'dd-MMM-yyyy')}</div>
                              </TableCell>
                              <TableCell className="text-right p-2 text-xs">
                                <div className="text-[10px] text-muted-foreground">{formatCurrency(invoice.taxableAmount)}</div>
                                <div className="font-bold">{formatCurrency(invoice.grandTotal)}</div>
                              </TableCell>
                              <TableCell className="text-center p-1">
                                <Input
                                  type="number"
                                  defaultValue={invoice.tdsPercentage || ''}
                                  onBlur={(e) => handleTdsUpdate(invoice.id, e.target.value)}
                                  className="h-7 w-16 text-center mx-auto text-xs"
                                  placeholder="%"
                                />
                              </TableCell>
                              <TableCell className={cn("text-right p-2 text-xs font-medium text-red-600 dark:text-red-400", invoice.tdsAmount === 0 && "opacity-50")}>{formatCurrency(invoice.tdsAmount)}</TableCell>
                              <TableCell className="text-right p-2 text-xs font-medium text-green-600 dark:text-green-400">{formatCurrency(invoice.totalPaid)}</TableCell>
                              <TableCell className={cn("text-right p-2 text-xs font-bold text-orange-600 dark:text-orange-400", invoice.balance === 0 && "opacity-50")}>{formatCurrency(invoice.balance)}</TableCell>
                              <TableCell className="text-center p-2">{getStatusBadge(invoice.status)}</TableCell>
                              <TableCell className="text-right p-2">
                                  <div className="flex items-center justify-end gap-2">
                                      <Button variant="outline" size="icon" onClick={() => handleOpenDetailsDialog(invoice)} className="h-8 w-8">
                                          <Info className="h-4 w-4" />
                                          <span className="sr-only">View</span>
                                      </Button>
                                      <Button variant="outline" size="icon" onClick={() => handleOpenPaymentDialog(invoice)} className="h-8 w-8">
                                          <PlusCircle className="h-4 w-4" />
                                          <span className="sr-only">Add</span>
                                      </Button>
                                  </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </React.Fragment>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={9} className="h-24 text-center">No matching invoices found.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </Tabs>
        
        {/* Download Summary Customization Dialog */}
        <Dialog open={isDownloadPromptOpen} onOpenChange={setIsDownloadPromptOpen}>
            <DialogContent className="max-w-[95vw] sm:max-w-4xl rounded-2xl border-none shadow-2xl p-0 overflow-hidden max-h-[95vh] sm:max-h-[90vh] flex flex-col">
                <DialogHeader className="p-4 sm:p-6 bg-primary/5 border-b border-primary/10 shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        Download Customization
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                        Review and edit details for the Balance Confirmation Letter. 
                    </DialogDescription>
                </DialogHeader>
                
                <div className="flex-1 overflow-y-auto">
                    <div className="p-4 sm:p-6 space-y-8">
                        {/* Section: Table Columns Selection & Names */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                                <CheckSquare2 className="h-3 w-3" /> Table Columns & Alignment
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {Object.keys(columnConfigs).map((id) => (
                                    <div key={id} className="bg-muted/20 p-3 rounded-xl border border-dashed space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex flex-col">
                                                <span className="text-[10px] font-black uppercase text-foreground/80">{columnConfigs[id].title}</span>
                                                <div className="flex items-center space-x-2 mt-1">
                                                    <Checkbox 
                                                        id={`col-${id}`} 
                                                        checked={columnConfigs[id].visible} 
                                                        onCheckedChange={(checked) => updateColumnConfig(id, { visible: !!checked })} 
                                                    />
                                                    <Label htmlFor={`col-${id}`} className="text-[10px] font-bold text-muted-foreground uppercase cursor-pointer">Include in Table</Label>
                                                </div>
                                            </div>
                                            <div className="flex items-center bg-background rounded-lg border p-0.5">
                                                {(['left', 'center', 'right'] as const).map(align => (
                                                    <Button 
                                                        key={align} 
                                                        variant={columnConfigs[id].align === align ? 'default' : 'ghost'} 
                                                        size="icon" 
                                                        className="h-6 w-6 rounded-md"
                                                        onClick={() => updateColumnConfig(id, { align })}
                                                    >
                                                        {align === 'left' && <AlignLeft className="h-3 w-3" />}
                                                        {align === 'center' && <AlignCenter className="h-3 w-3" />}
                                                        {align === 'right' && <AlignRight className="h-3 w-3" />}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-[9px] font-bold uppercase text-muted-foreground">PDF Header Label</Label>
                                            <Input 
                                                value={columnConfigs[id].label}
                                                onChange={(e) => updateColumnConfig(id, { label: e.target.value })}
                                                className="h-8 text-xs font-bold"
                                                placeholder="Header Name"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <Separator className="opacity-50" />

                        {/* Section: Document Metadata */}
                        <div className="space-y-4">
                            <h3 className="text-[10px] font-black uppercase text-primary tracking-widest flex items-center gap-2">
                                <FileText className="h-3 w-3" /> Letter Content
                            </h3>
                            <div className="grid gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="tempSalutation" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Salutation</Label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Select value={tempSalutation} onValueChange={setTempSalutation}>
                                            <SelectTrigger className="h-10 rounded-xl font-bold text-sm sm:w-1/2">
                                                <SelectValue placeholder="Salutation" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="Dear Sir,">Dear Sir,</SelectItem>
                                                <SelectItem value="Dear Madam,">Dear Madam,</SelectItem>
                                                <SelectItem value="Dear Sir / Madam,">Dear Sir / Madam,</SelectItem>
                                                <SelectItem value="Respected Sir,">Respected Sir,</SelectItem>
                                                <SelectItem value="To whom it may concern,">To whom it may concern,</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Input 
                                            id="tempSalutation"
                                            value={tempSalutation}
                                            onChange={(e) => setTempSalutation(e.target.value)}
                                            placeholder="Custom Salutation..."
                                            className="h-10 rounded-xl font-bold text-sm flex-1"
                                        />
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="tempSubject" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Document Subject</Label>
                                    <Input 
                                        id="tempSubject"
                                        value={tempSubject}
                                        onChange={(e) => setTempSubject(e.target.value)}
                                        className="h-10 rounded-xl font-bold text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="tempDescription" className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Introduction Paragraph</Label>
                                    <Textarea 
                                        id="tempDescription"
                                        value={tempDescription}
                                        onChange={(e) => setTempDescription(e.target.value)}
                                        className="min-h-[100px] text-sm leading-relaxed rounded-xl focus-visible:ring-primary/20"
                                    />
                                </div>
                            </div>
                        </div>

                        <Separator className="opacity-50" />

                        {/* Section: Client & Firm Info */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            {/* Client Column */}
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase text-blue-600 tracking-widest flex items-center gap-2">
                                    <Building2 className="h-3 w-3" /> Recipient Details
                                </h3>
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-bold uppercase text-muted-foreground">Client Name</Label>
                                        <div className="relative">
                                            <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                            <Input value={tempClientName} onChange={e => setTempClientName(e.target.value)} className="pl-8 h-9 text-xs font-bold" />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-bold uppercase text-muted-foreground">Client GSTIN</Label>
                                        <div className="relative">
                                            <Fingerprint className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                            <Input value={tempClientGstin} onChange={e => setTempClientGstin(e.target.value)} className="pl-8 h-9 text-xs font-mono" />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-bold uppercase text-muted-foreground">Client Address</Label>
                                        <div className="relative">
                                            <MapPin className="absolute left-3 top-3 h-3 w-3 text-muted-foreground/50" />
                                            <Textarea value={tempAddress} onChange={e => setTempAddress(e.target.value)} className="pl-8 min-h-[80px] text-xs resize-none" />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Firm Column */}
                            <div className="space-y-4">
                                <h3 className="text-[10px] font-black uppercase text-amber-600 tracking-widest flex items-center gap-2">
                                    <User className="h-3 w-3" /> Sender Details
                                </h3>
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-bold uppercase text-muted-foreground">Your GSTIN</Label>
                                        <div className="relative">
                                            <Fingerprint className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                            <Input value={tempFirmGstin} onChange={e => setTempFirmGstin(e.target.value)} className="pl-8 h-9 text-xs font-mono" />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[9px] font-bold uppercase text-muted-foreground">Contact Mobiles</Label>
                                        <div className="relative">
                                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                                            <Input value={tempFirmMobiles} onChange={e => setTempFirmMobiles(e.target.value)} className="pl-8 h-9 text-xs font-mono" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="p-4 sm:p-6 bg-muted/10 gap-3 shrink-0 border-t flex flex-row">
                    <Button variant="ghost" onClick={() => setIsDownloadPromptOpen(false)} className="flex-1 rounded-xl font-bold h-11" disabled={isGeneratingPdf}>Cancel</Button>
                    <Button onClick={executeDownloadSummary} className="flex-[1.5] rounded-xl font-bold px-8 shadow-lg shadow-primary/20 h-11" disabled={isGeneratingPdf}>
                        {isGeneratingPdf ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</> : <><Download className="mr-2 h-4 w-4" /> Generate PDF</>}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
            <DialogContent className="max-w-[95vw] sm:max-w-md p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>Record Payment</DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm">
                        Bill No. {selectedInvoiceForPayment?.billNo} to {selectedInvoiceForPayment?.companyName}. <br/>
                        <span className="font-bold">Pending: {formatCurrency(selectedInvoiceForPayment?.balance || 0)}</span>
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 sm:gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="paymentDate" className="text-right text-xs">Date</Label>
                        <Input id="paymentDate" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="col-span-3 h-9 text-sm" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="paymentMode" className="text-right text-xs">Mode</Label>
                        <Select value={paymentMode} onValueChange={(value) => setPaymentMode(value as PaymentMode)}>
                            <SelectTrigger className="col-span-3 h-9 text-sm">
                                <SelectValue placeholder="Select mode" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="RTGS">RTGS</SelectItem>
                                <SelectItem value="NEFT">NEFT</SelectItem>
                                <SelectItem value="IMPS">IMPS</SelectItem>
                                <SelectItem value="CHEQUE">CHEQUE</SelectItem>
                                <SelectItem value="CASH">CASH</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {paymentMode === 'CHEQUE' && (
                        <div className="grid grid-cols-4 items-center gap-3">
                            <Label htmlFor="chequeDetails" className="text-right text-xs">Details</Label>
                            <Input id="chequeDetails" value={chequeDetails} onChange={(e) => setChequeDetails(e.target.value)} className="col-span-3 h-9 text-sm" placeholder="No., bank" />
                        </div>
                    )}
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="receivedAmount" className="text-right text-xs">Amount</Label>
                        <Input id="receivedAmount" value={receivedAmount} onChange={(e) => setReceivedAmount(e.target.value)} className="col-span-3 h-9 text-sm" placeholder="e.g., 50000" />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-3">
                        <Label htmlFor="otherDeductions" className="text-right text-xs">Deductions</Label>
                        <Input id="otherDeductions" value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} className="col-span-3 h-9 text-sm" placeholder="e.g., 20" />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-3">
                        <Label htmlFor="notes" className="text-right text-xs mt-2">Notes</Label>
                        <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="col-span-3 text-sm min-h-[60px]" placeholder="Optional notes" />
                    </div>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => setIsPaymentDialogOpen(false)} className="h-9 text-xs sm:text-sm">Cancel</Button>
                    <Button onClick={handleAddPayment} className="h-9 text-xs sm:text-sm">Save</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <Dialog open={isDetailsDialogOpen} onOpenChange={(open) => { if (!open) closeAllDialogs()}}>
            <DialogContent className="max-w-[95vw] sm:max-w-2xl p-4 sm:p-6">
                <DialogHeader>
                    <DialogTitle>Payment History</DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm">
                        Bill No. {invoiceForDetails?.billNo}-{invoiceForDetails?.billNoSuffix || 'MHE'}.
                    </DialogDescription>
                </DialogHeader>
                <div className="py-2 max-h-[50vh] overflow-y-auto">
                    {invoiceForDetails ? (
                        (() => {
                            const invoicePayments = payments?.filter(p => p.invoiceId === invoiceForDetails.id) || [];
                            const hasAdvance = invoiceForDetails.advanceReceived && invoiceForDetails.advanceReceived > 0;
                            
                            if (invoicePayments.length === 0 && !hasAdvance) {
                                return <p className="text-xs sm:text-sm text-muted-foreground text-center py-8">No records found.</p>;
                            }

                            return (
                                <div className="space-y-3 sm:space-y-4">
                                    {hasAdvance && (
                                        <div className="p-3 rounded-md border bg-muted/50 dark:bg-muted/20">
                                            <h4 className="text-[10px] sm:text-sm font-semibold mb-1 uppercase tracking-tight">Advance Payment</h4>
                                            <div className="flex justify-between items-center text-xs">
                                                <span className="text-muted-foreground">Amount:</span>
                                                <span className="font-medium">{formatCurrency(invoiceForDetails.advanceReceived!)}</span>
                                            </div>
                                        </div>
                                    )}
                                    {invoicePayments.length > 0 && (
                                        <div className="border rounded-md overflow-hidden">
                                          <Table>
                                              <TableHeader className="bg-muted/50">
                                                  <TableRow>
                                                      <TableHead className="p-2 h-8 text-[10px] sm:text-xs">Date</TableHead>
                                                      <TableHead className="p-2 h-8 text-[10px] sm:text-xs">Mode</TableHead>
                                                      <TableHead className="p-2 h-8 text-right text-[10px] sm:text-xs">Amount</TableHead>
                                                      <TableHead className="p-2 h-8 text-right text-[10px] sm:text-xs">Actions</TableHead>
                                                  </TableRow>
                                              </TableHeader>
                                              <TableBody>
                                                  {invoicePayments.map(payment => (
                                                      <TableRow key={payment.id}>
                                                          <TableCell className="p-2 text-[10px] sm:text-xs">{format(parseISO(payment.paymentDate), 'dd-MMM-yy')}</TableCell>
                                                          <TableCell className="p-2 text-[10px] sm:text-xs">
                                                              <div className="font-medium">{payment.paymentMode}</div>
                                                          </TableCell>
                                                          <TableCell className="p-2 text-right text-[10px] sm:text-xs font-medium text-green-600 dark:text-green-400">{formatCurrency(payment.receivedAmount)}</TableCell>
                                                          <TableCell className="p-2 text-right">
                                                              <Button variant="ghost" size="icon" onClick={() => setPaymentToDelete(payment)} className="h-6 w-6">
                                                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                                              </Button>
                                                          </TableCell>
                                                      </TableRow>
                                                  ))}
                                              </TableBody>
                                          </Table>
                                        </div>
                                    )}
                                </div>
                            )
                        })()
                    ) : (
                        <p className="text-center py-4 text-xs sm:text-sm">Loading details...</p>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDetailsDialogOpen(false)} className="h-9 w-full sm:w-auto text-xs sm:text-sm">Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <Dialog open={!!paymentToDelete} onOpenChange={(open) => { if (!open) setPaymentToDelete(null); }}>
            <DialogContent className="max-w-[90vw] sm:max-w-md p-4">
                <DialogHeader>
                    <DialogTitle>Delete Payment?</DialogTitle>
                    <DialogDescription className="text-xs sm:text-sm">
                        This action cannot be undone.
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter className="gap-2 sm:gap-0 mt-4">
                    <Button variant="outline" onClick={() => setPaymentToDelete(null)} className="h-9 text-xs sm:text-sm">Cancel</Button>
                    <Button variant="destructive" onClick={handleDeletePayment} className="h-9 text-xs sm:text-sm">Delete</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

      </div>
    </AppLayout>
  );
}
