
'use client';

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import AppLayout from "@/components/app-layout";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, orderBy, doc, where, getDocs } from 'firebase/firestore';
import { Employee, Salary, CompanySettings, Attendance } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PlusCircle, Search, Download, Pencil, Trash2, Banknote, FileText, WalletCards, XCircle, Calculator, CalendarCheck, Info, Loader2, Send, MessageSquare, FileDown } from 'lucide-react';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { generateSalaryPdfSlip, generateSalaryPdfData } from '@/lib/salary-pdf-generator';
import { generateSalarySlip } from '@/lib/salary-generator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from '@/components/ui/separator';
import { sendTelegramDocument } from '@/app/actions/telegram';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';

type Enterprise = 'Vithal' | 'RV';

export default function SalaryPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Enterprise>('Vithal');
  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState('All');
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isFetchingAttendance, setIsFetchingAttendance] = useState(false);
  const [isSendingTelegram, setIsSendingTelegram] = useState<string | null>(null);
  const [editingSalary, setEditingSalary] = useState<Salary | null>(null);
  const [salaryToDelete, setSalaryToDelete] = useState<Salary | null>(null);

  // Form State
  const [employeeId, setEmployeeId] = useState('');
  const [month, setMonth] = useState(format(new Date(), 'yyyy-MM'));
  
  // Attendance
  const [workingDays, setWorkingDays] = useState('0');
  const [presentDays, setPresentDays] = useState('0');
  const [absentDays, setAbsentDays] = useState('0');

  // Earnings
  const [baseSalary, setBaseSalary] = useState('0');
  const [hra, setHra] = useState('0');
  const [conveyance, setConveyance] = useState('0');
  const [medical, setMedical] = useState('0');
  const [special, setSpecial] = useState('0');
  const [bonus, setBonus] = useState('0');
  const [ot, setOt] = useState('0');
  
  // Deductions
  const [pf, setPf] = useState('0');
  const [esic, setEsic] = useState('0');
  const [tds, setTds] = useState('0');
  const [lwf, setLwf] = useState('0');
  const [advance, setAdvance] = useState('0');
  const [otherDeductions, setOtherDeductions] = useState('0');

  const [paymentDate, setPaymentDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [status, setStatus] = useState<'Paid' | 'Pending'>('Paid');
  const [notes, setNotes] = useState('');
  const [showGstin, setShowGstin] = useState(true);

  // Data fetching
  const employeesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'employees'), orderBy('fullName')) : null, [firestore, user]);
  const salariesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'salaries'), orderBy('month', 'desc')) : null, [firestore, user]);
  
  const vithalSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'vithal') : null, [firestore, user]);
  const rvSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'rv') : null, [firestore, user]);

  const { data: employees, isLoading: isLoadingEmployees } = useCollection<Employee>(employeesQuery);
  const { data: salaries, isLoading: isLoadingSalaries } = useCollection<Salary>(salariesQuery);
  const { data: vithalSettings } = useDoc<CompanySettings>(vithalSettingsRef);
  const { data: rvSettings } = useDoc<CompanySettings>(rvSettingsRef);

  const calculations = useMemo(() => {
    const basic = parseFloat(baseSalary) || 0;
    const v_hra = parseFloat(hra) || 0;
    const v_conveyance = parseFloat(conveyance) || 0;
    const v_medical = parseFloat(medical) || 0;
    const v_special = parseFloat(special) || 0;
    const v_bonus = parseFloat(bonus) || 0;
    const v_ot = parseFloat(ot) || 0;
    
    const v_pf = parseFloat(pf) || 0;
    const v_esic = parseFloat(esic) || 0;
    const v_tds = parseFloat(tds) || 0;
    const v_lwf = parseFloat(lwf) || 0;
    const v_advance = parseFloat(advance) || 0;
    const v_other = parseFloat(otherDeductions) || 0;

    const totalDays = parseFloat(workingDays) || 1;
    const absDays = parseFloat(absentDays) || 0;
    const absentDeduction = Math.round((basic / totalDays) * absDays);

    const grossEarnings = basic + v_hra + v_conveyance + v_medical + v_special + v_bonus + v_ot;
    const totalDeductions = v_pf + v_esic + v_tds + v_lwf + v_advance + v_other + absentDeduction;
    const netPay = Math.max(0, grossEarnings - totalDeductions);

    return { grossEarnings, totalDeductions, netPay, absentDeduction };
  }, [baseSalary, hra, conveyance, medical, special, bonus, ot, pf, esic, tds, lwf, advance, otherDeductions, workingDays, absentDays]);

  useEffect(() => {
    if (employeeId && !editingSalary) {
        const emp = employees?.find(e => e.id === employeeId);
        if (emp && emp.baseSalary) {
            setBaseSalary(emp.baseSalary.toString());
        } else {
            setBaseSalary('0');
        }
    }
  }, [employeeId, employees, editingSalary]);

  const filteredSalaries = useMemo(() => {
    if (!salaries) return [];
    return salaries.filter(s => {
      const emp = employees?.find(e => e.id === s.employeeId);
      const nameMatch = emp?.fullName.toLowerCase().includes(searchTerm.toLowerCase()) || false;
      const monthMatch = monthFilter === 'All' || s.month === monthFilter;
      const enterpriseMatch = s.enterprise === activeTab;
      return nameMatch && monthMatch && enterpriseMatch;
    });
  }, [salaries, employees, searchTerm, monthFilter, activeTab]);

  const groupedSalaries = useMemo(() => {
    const groups = filteredSalaries.reduce((acc, salary) => {
      const monthKey = salary.month;
      if (!acc[monthKey]) {
        acc[monthKey] = [];
      }
      acc[monthKey].push(salary);
      return acc;
    }, {} as Record<string, Salary[]>);

    return Object.entries(groups)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([monthKey, items]) => ({
        monthKey,
        monthLabel: format(parseISO(`${monthKey}-01`), 'MMMM yyyy'),
        items: items.sort((a, b) => {
            const nameA = employees?.find(e => e.id === a.employeeId)?.fullName || '';
            const nameB = employees?.find(e => e.id === b.employeeId)?.fullName || '';
            return nameA.localeCompare(nameB);
        }),
      }));
  }, [filteredSalaries, employees]);

  const resetForm = useCallback(() => {
    setEmployeeId('');
    setMonth(format(new Date(), 'yyyy-MM'));
    setWorkingDays('0');
    setPresentDays('0');
    setAbsentDays('0');
    setBaseSalary('0');
    setHra('0');
    setConveyance('0');
    setMedical('0');
    setSpecial('0');
    setBonus('0');
    setOt('0');
    setPf('0');
    setEsic('0');
    setTds('0');
    setLwf('0');
    setAdvance('0');
    setOtherDeductions('0');
    setPaymentDate(format(new Date(), 'yyyy-MM-dd'));
    setStatus('Paid');
    setNotes('');
    setShowGstin(true);
    setEditingSalary(null);
  }, []);

  const handleOpenForm = (salary: Salary | null) => {
    if (salary) {
      setEditingSalary(salary);
      setEmployeeId(salary.employeeId);
      setMonth(salary.month);
      setWorkingDays(salary.workingDays?.toString() || '0');
      setPresentDays(salary.presentDays?.toString() || '0');
      setAbsentDays(salary.absentDays?.toString() || '0');
      setBaseSalary(salary.baseSalary?.toString() || '0');
      setHra(salary.hra?.toString() || '0');
      setConveyance(salary.conveyance?.toString() || '0');
      setMedical(salary.medical?.toString() || '0');
      setSpecial(salary.special?.toString() || '0');
      setBonus(salary.bonus?.toString() || '0');
      setOt(salary.ot?.toString() || '0');
      setPf(salary.pf?.toString() || '0');
      setEsic(salary.esic?.toString() || '0');
      setTds(salary.tds?.toString() || '0');
      setLwf(salary.lwf?.toString() || '0');
      setAdvance(salary.advance?.toString() || '0');
      setOtherDeductions(salary.otherDeductions?.toString() || '0');
      setPaymentDate(salary.paymentDate || '');
      setStatus(salary.status);
      setNotes(salary.notes || '');
      setShowGstin(salary.showGstin ?? true);
    } else {
      resetForm();
    }
    setIsFormOpen(true);
  };

  const handleFormSubmit = async () => {
    if (!employeeId || !month) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please fill required fields.' });
      return;
    }

    const salaryData: Omit<Salary, 'id'> = {
      employeeId,
      enterprise: activeTab,
      month,
      workingDays: parseFloat(workingDays) || 0,
      presentDays: parseFloat(presentDays) || 0,
      absentDays: parseFloat(absentDays) || 0,
      baseSalary: parseFloat(baseSalary) || 0,
      hra: parseFloat(hra) || 0,
      conveyance: parseFloat(conveyance) || 0,
      medical: parseFloat(medical) || 0,
      special: parseFloat(special) || 0,
      bonus: parseFloat(bonus) || 0,
      ot: parseFloat(ot) || 0,
      pf: parseFloat(pf) || 0,
      esic: parseFloat(esic) || 0,
      pt: 0,
      tds: parseFloat(tds) || 0,
      lwf: parseFloat(lwf) || 0,
      advance: parseFloat(advance) || 0,
      absentDeduction: calculations.absentDeduction,
      otherDeductions: parseFloat(otherDeductions) || 0,
      netSalary: calculations.netPay,
      paymentDate,
      status,
      notes,
      showGstin,
      createdAt: editingSalary?.createdAt || new Date().toISOString(),
    };

    if (firestore) {
      if (editingSalary) {
        updateDocumentNonBlocking(doc(firestore, 'salaries', editingSalary.id), salaryData);
        toast({ title: 'Success', description: 'Salary updated successfully.' });
      } else {
        addDocumentNonBlocking(collection(firestore, 'salaries'), salaryData);
        toast({ title: 'Success', description: 'Salary record added.' });
      }
      setIsFormOpen(false);
    }
  };

  const handleDeleteSalary = () => {
    if (firestore && salaryToDelete) {
      deleteDocumentNonBlocking(doc(firestore, 'salaries', salaryToDelete.id));
      toast({ title: 'Deleted', description: 'Salary record removed.' });
      setSalaryToDelete(null);
    }
  };

  const handleDownloadPdfSlip = async (salary: Salary) => {
    const employee = employees?.find(e => e.id === salary.employeeId);
    const settings = salary.enterprise === 'Vithal' ? vithalSettings : rvSettings;

    if (!employee || !settings) {
      toast({ variant: 'destructive', title: 'Error', description: 'Employee or Company settings missing.' });
      return;
    }

    try {
      await generateSalaryPdfSlip(salary, employee, settings);
      toast({ title: 'Success', description: 'PDF Salary slip generated.' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to generate PDF.' });
    }
  };

  const handleDownloadWordSlip = async (salary: Salary) => {
    const employee = employees?.find(e => e.id === salary.employeeId);
    const settings = salary.enterprise === 'Vithal' ? vithalSettings : rvSettings;

    if (!employee || !settings) {
      toast({ variant: 'destructive', title: 'Error', description: 'Employee or Company settings missing.' });
      return;
    }

    try {
      await generateSalarySlip(salary, employee, settings);
      toast({ title: 'Success', description: 'Word Salary slip generated.' });
    } catch (e) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to generate Word file.' });
    }
  };

  const handleSendToTelegram = async (salary: Salary) => {
    const employee = employees?.find(e => e.id === salary.employeeId);
    const settings = salary.enterprise === 'Vithal' ? vithalSettings : rvSettings;

    if (!employee || !settings) {
      toast({ variant: 'destructive', title: 'Data Missing', description: 'Technician or Company details not found.' });
      return;
    }

    if (!employee.telegramChatId) {
      toast({ variant: 'destructive', title: 'No Chat ID', description: 'Please set the Telegram Chat ID in Technician Profile first.' });
      return;
    }

    setIsSendingTelegram(salary.id);
    try {
      const doc = await generateSalaryPdfData(salary, employee, settings);
      const pdfBase64 = doc.output('datauristring');
      const fileName = `Salary_Slip_${salary.month}_${employee.fullName.replace(/\s+/g, '_')}.pdf`;

      await sendTelegramDocument(employee.telegramChatId, pdfBase64, fileName);

      toast({ title: 'Sent Successfully', description: `Salary slip has been sent to ${employee.fullName} via Telegram.` });
    } catch (e: any) {
      console.error(e);
      toast({ variant: 'destructive', title: 'Telegram Error', description: e.message || 'Failed to send document.' });
    } finally {
      setIsSendingTelegram(null);
    }
  };

  const handleSendWhatsAppSummary = (salary: Salary) => {
    const employee = employees?.find(e => e.id === salary.employeeId);
    if (!employee || !employee.whatsappNumber) {
        toast({ variant: 'destructive', title: 'No WhatsApp Number', description: 'Please set the WhatsApp Number in Technician Profile.' });
        return;
    }

    const monthLabel = format(parseISO(`${salary.month}-01`), 'MMMM yyyy');
    const netSalaryStr = salary.netSalary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
    
    const message = `*SALARY SUMMARY: ${monthLabel}*\n\n` +
        `👤 *Name:* ${employee.fullName}\n` +
        `🏢 *Firm:* ${salary.enterprise} Enterprises\n` +
        `✅ *Attendance:* ${salary.presentDays}/${salary.workingDays} Days\n` +
        `🕒 *Overtime:* ₹${salary.ot || 0}\n` +
        `💰 *NET PAYABLE:* ${netSalaryStr}\n` +
        `🏁 *Status:* ${salary.status === 'Paid' ? 'PAID' : 'PENDING'}\n\n` +
        `_Note: Contact HR for the detailed PDF slip._`;

    const encodedMessage = encodeURIComponent(message);
    const whatsappUrl = `https://wa.me/${employee.whatsappNumber}?text=${encodedMessage}`;
    
    window.open(whatsappUrl, '_blank');
    toast({ title: 'Opening WhatsApp', description: `Sending summary to ${employee.fullName}.` });
  };

  const autoFillHaazri = async () => {
    if (!firestore || !employeeId || !month) {
        toast({ variant: 'destructive', title: 'Action Required', description: 'Please select an employee and month first.' });
        return;
    };
    
    setIsFetchingAttendance(true);
    const start = format(startOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd');
    const end = format(endOfMonth(parseISO(`${month}-01`)), 'yyyy-MM-dd');
    const totalMonthDays = endOfMonth(parseISO(`${month}-01`)).getDate();

    try {
        const attendanceRef = collection(firestore, 'attendance');
        const q = query(
            attendanceRef, 
            where('employeeId', '==', employeeId)
        );
        
        const querySnapshot = await getDocs(q);
        const records = querySnapshot.docs
            .map(doc => doc.data() as Attendance)
            .filter(rec => rec.date >= start && rec.date <= end);

        if (records.length === 0) {
            toast({ 
                title: 'No Records Found', 
                description: 'No attendance marked for this technician in the selected month.' 
            });
            setWorkingDays(String(totalMonthDays));
            setPresentDays('0');
            setAbsentDays('0');
            setOt('0');
        } else {
            let totalPresent = 0;
            let totalAbsent = 0;
            let totalOTHours = 0;

            records.forEach(rec => {
                // Present, Holiday, and Holiday-Working are all paid days
                if (rec.status === 'Present' || rec.status === 'Holiday' || rec.status === 'Holiday-Working') {
                    totalPresent += 1;
                } else if (rec.status === 'Half-Day') {
                    totalPresent += 0.5;
                    totalAbsent += 0.5;
                } else if (rec.status === 'Absent') {
                    totalAbsent += 1;
                }
                
                if (rec.overtimeHours) {
                    totalOTHours += rec.overtimeHours;
                }
            });

            setWorkingDays(String(totalMonthDays));
            setPresentDays(String(totalPresent));
            setAbsentDays(String(totalAbsent));

            const emp = employees?.find(e => e.id === employeeId);
            let calculatedOTPrice = 0;

            if (emp) {
                if (emp.baseSalary) setBaseSalary(emp.baseSalary.toString());
                
                const currentSalary = emp.baseSalary || 0;
                if (emp.otCalculationType === 'fixed' && emp.otHourlyRate) {
                    calculatedOTPrice = totalOTHours * emp.otHourlyRate;
                } else {
                    const hourlyVal = currentSalary / totalMonthDays / 8;
                    calculatedOTPrice = totalOTHours * hourlyVal;
                }
            }

            setOt(Math.round(calculatedOTPrice).toString());

            toast({ 
                title: 'Sync Complete', 
                description: `Fetched ${records.length} records. Calculated ${totalPresent} Paid days.` 
            });
        }
    } catch (e) {
        toast({ variant: 'destructive', title: 'Sync Error', description: 'Failed to fetch attendance data.' });
    } finally {
        setIsFetchingAttendance(false);
    }
  }

  return (
    <AppLayout>
      <TooltipProvider delayDuration={300}>
      <div className="flex flex-col gap-4 sm:gap-6 animate-in fade-in duration-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Banknote className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
              Payroll Management
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Manage employee monthly salaries and generate slips.</p>
          </div>
          <Button onClick={() => handleOpenForm(null)} className="shadow-lg shadow-primary/20 h-10 group">
            <PlusCircle className="mr-2 h-4 w-4 transition-transform group-hover:rotate-90" />
            Add Salary Record
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Enterprise)} className="w-full">
          <Card className="border-none shadow-sm bg-card/50 backdrop-blur-sm overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <TabsList className="grid w-full md:w-[400px] grid-cols-2 h-10">
                  <TabsTrigger value="Vithal" className="text-xs">Vithal Enterprises</TabsTrigger>
                  <TabsTrigger value="RV" className="text-xs">R.V Enterprises</TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2 flex-1 md:max-w-md">
                  <div className="relative flex-1 group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                    <Input
                      placeholder="Search employee..."
                      className="pl-9 h-10"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <Input
                    type="month"
                    className="w-[160px] h-10"
                    value={monthFilter === 'All' ? '' : monthFilter}
                    onChange={(e) => setMonthFilter(e.target.value || 'All')}
                  />
                  <Button variant="ghost" size="icon" onClick={() => { setSearchTerm(''); setMonthFilter('All'); }} className="h-10 w-10">
                    <XCircle className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6 w-[250px]">Employee</TableHead>
                      <TableHead>Attendance</TableHead>
                      <TableHead className="text-right">Net Salary</TableHead>
                      <TableHead className="text-center">Status</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingSalaries ? (
                      <TableRow><TableCell colSpan={5} className="text-center py-10">Loading payroll data...</TableCell></TableRow>
                    ) : groupedSalaries.length > 0 ? (
                      groupedSalaries.map(({ monthKey, monthLabel, items }) => (
                        <React.Fragment key={monthKey}>
                          <TableRow className="border-b-0 hover:bg-transparent">
                            <TableCell colSpan={5} className="pt-10 pb-2">
                              <div className="relative">
                                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                      <div className="w-full border-t" />
                                  </div>
                                  <div className="relative flex justify-center">
                                      <span className="bg-background px-4 text-sm font-black uppercase tracking-[0.2em] text-muted-foreground">
                                          {monthLabel}
                                      </span>
                                  </div>
                              </div>
                            </TableCell>
                          </TableRow>
                          {items.map(salary => {
                            const employee = employees?.find(e => e.id === salary.employeeId);
                            const isSending = isSendingTelegram === salary.id;
                            return (
                              <TableRow key={salary.id} className="group hover:bg-muted/30 border-b">
                                <TableCell className="pl-6 py-4">
                                  <div className="font-bold text-sm">{employee?.fullName || 'Unknown'}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase">{employee?.specialization || 'N/A'}</div>
                                </TableCell>
                                <TableCell>
                                  <div className="text-sm font-medium">{salary.presentDays} / {salary.workingDays} Days</div>
                                  <div className="text-[10px] text-orange-600 font-bold">{salary.ot > 0 ? `+ ₹${salary.ot} OT` : ''}</div>
                                </TableCell>
                                <TableCell className="text-right font-bold text-sm">
                                  {salary.netSalary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant={salary.status === 'Paid' ? 'outline' : 'destructive'} className={cn("text-[10px]", salary.status === 'Paid' && "border-green-500/50 text-green-600 bg-green-50 dark:bg-green-900/20")}>
                                    {salary.status}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right pr-6 space-x-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        onClick={() => handleSendWhatsAppSummary(salary)} 
                                        className="h-8 w-8 text-green-600 hover:bg-green-600/10"
                                      >
                                        <MessageSquare className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>WhatsApp Summary</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button 
                                        variant="ghost" 
                                        size="icon" 
                                        disabled={isSending}
                                        onClick={() => handleSendToTelegram(salary)} 
                                        className="h-8 w-8 text-blue-600 hover:bg-blue-600/10"
                                      >
                                        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Telegram PDF</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={() => handleDownloadPdfSlip(salary)} className="h-8 w-8 text-red-500 hover:bg-red-500/10">
                                        <FileText className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Download PDF</TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" onClick={() => handleDownloadWordSlip(salary)} className="h-8 w-8 text-blue-500 hover:bg-blue-500/10">
                                        <FileDown className="h-4 w-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Download Word</TooltipContent>
                                  </Tooltip>
                                  <Button variant="ghost" size="icon" onClick={() => handleOpenForm(salary)} className="h-8 w-8 text-amber-500 hover:bg-amber-500/10">
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => setSalaryToDelete(salary)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </React.Fragment>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={5} className="text-center py-20 text-muted-foreground">No records found matching filters.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="md:hidden">
                {groupedSalaries.length > 0 ? (
                  groupedSalaries.map(({ monthKey, monthLabel, items }) => (
                    <div key={monthKey} className="space-y-3">
                      <div className="bg-muted/50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground sticky top-0 z-10 border-y">
                        {monthLabel}
                      </div>
                      <div className="px-3 pb-4 space-y-3">
                        {items.map(salary => {
                          const employee = employees?.find(e => e.id === salary.employeeId);
                          const isSending = isSendingTelegram === salary.id;
                          return (
                            <div key={salary.id} className="border rounded-xl p-3 bg-card shadow-sm space-y-3">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-bold text-sm">{employee?.fullName || 'Unknown'}</div>
                                  <div className="text-[10px] text-muted-foreground uppercase">{employee?.specialization || 'N/A'}</div>
                                </div>
                                <Badge variant={salary.status === 'Paid' ? 'outline' : 'destructive'} className={cn("text-[10px]", salary.status === 'Paid' && "border-green-500/50 text-green-600 bg-green-50 dark:bg-green-900/20")}>
                                  {salary.status}
                                </Badge>
                              </div>
                              <div className="grid grid-cols-2 gap-4 text-[10px] uppercase font-bold text-muted-foreground border-t pt-2">
                                <div>Attendance: <span className="text-foreground">{salary.presentDays}/{salary.workingDays}</span></div>
                                <div className="text-right">Net Payable</div>
                              </div>
                              <div className="flex justify-between items-center">
                                <div className="text-xs italic text-muted-foreground">{salary.paymentDate ? format(parseISO(salary.paymentDate), 'dd MMM yyyy') : 'No Date'}</div>
                                <div className="text-sm font-black text-primary">
                                  {salary.netSalary.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}
                                </div>
                              </div>
                              <div className="flex justify-end gap-2 pt-2 border-t">
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    onClick={() => handleSendWhatsAppSummary(salary)} 
                                    className="h-8 w-8 text-green-600 hover:bg-green-600/10"
                                >
                                    <MessageSquare className="h-4 w-4" />
                                </Button>
                                <Button 
                                    variant="ghost" 
                                    size="icon" 
                                    disabled={isSending}
                                    onClick={() => handleSendToTelegram(salary)} 
                                    className="h-8 w-8 text-blue-600 hover:bg-blue-600/10"
                                >
                                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDownloadPdfSlip(salary)} className="h-8 w-8 text-red-600 hover:bg-red-500/10">
                                  <FileText className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDownloadWordSlip(salary)} className="h-8 w-8 text-blue-600 hover:bg-blue-500/10">
                                  <FileDown className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleOpenForm(salary)} className="h-8 w-8 text-amber-500 hover:bg-amber-500/10">
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => setSalaryToDelete(salary)} className="h-8 w-8 text-destructive hover:bg-destructive/10">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-muted-foreground text-sm">No records found.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </Tabs>

        {/* Salary Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
            <DialogHeader className="p-6 pb-0">
              <DialogTitle className="text-xl font-black">{editingSalary ? 'Modify Salary Record' : 'Record Monthly Salary'}</DialogTitle>
              <DialogDescription className="text-xs">Setting up detailed payroll for {activeTab} Enterprises.</DialogDescription>
            </DialogHeader>
            <div className="flex-grow overflow-y-auto px-6 py-4 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Select Employee</Label>
                  <Select value={employeeId} onValueChange={setEmployeeId} disabled={isLoadingEmployees}>
                    <SelectTrigger className="h-10"><SelectValue placeholder="Choose technician..." /></SelectTrigger>
                    <SelectContent>
                      {employees?.map(e => (
                        <SelectItem key={e.id} value={e.id}>{e.fullName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Salary Month</Label>
                  <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Payment Date</Label>
                  <Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className="h-10" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-sm text-blue-600 flex items-center gap-2">
                    <CalendarCheck className="h-4 w-4" /> Attendance Details
                    </h3>
                    {!editingSalary && (
                        <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={autoFillHaazri} 
                            disabled={isFetchingAttendance}
                            className="h-7 text-[10px] uppercase font-black border-primary/30 hover:bg-primary/5"
                        >
                            {isFetchingAttendance ? (
                                <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Syncing...</>
                            ) : (
                                <><Info className="h-3 w-3 mr-1" /> Auto-Fill Haazri</>
                            )}
                        </Button>
                    )}
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase">Working Days</Label>
                    <Input type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} className="h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase">Present Days</Label>
                    <Input type="number" value={presentDays} onChange={(e) => setPresentDays(e.target.value)} className="h-8" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase">Absent/Leave</Label>
                    <Input type="number" value={absentDays} onChange={(e) => setAbsentDays(e.target.value)} className="h-8" />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-green-600 flex items-center gap-2">
                    <Calculator className="h-4 w-4" /> Earnings
                  </h3>
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Basic Salary</Label>
                      <Input type="number" value={baseSalary} onChange={(e) => setBaseSalary(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">H.R.A.</Label>
                      <Input type="number" value={hra} onChange={(e) => setHra(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Conveyance Allw.</Label>
                      <Input type="number" value={conveyance} onChange={(e) => setConveyance(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Medical Allw.</Label>
                      <Input type="number" value={medical} onChange={(e) => setMedical(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Special Allw.</Label>
                      <Input type="number" value={special} onChange={(e) => setSpecial(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Bonus / Incentive</Label>
                      <Input type="number" value={bonus} onChange={(e) => setBonus(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Overtime (OT)</Label>
                      <Input type="number" value={ot} onChange={(e) => setOt(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 items-center gap-4 font-bold">
                      <Label className="text-xs">Gross Earnings</Label>
                      <div className="text-right text-sm">{calculations.grossEarnings.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-sm text-red-600 flex items-center gap-2">
                    <Calculator className="h-4 w-4" /> Deductions
                  </h3>
                  <div className="grid gap-3">
                    <div className="grid grid-cols-2 items-center gap-4 text-red-600">
                      <Label className="text-xs font-bold">Absent Deduction</Label>
                      <div className="text-right text-sm font-black">- ₹{calculations.absentDeduction.toLocaleString('en-IN')}</div>
                    </div>
                    
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">P.F.</Label>
                      <Input type="number" value={pf} onChange={(e) => setPf(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">E.S.I.C.</Label>
                      <Input type="number" value={esic} onChange={(e) => setEsic(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">T.D.S.</Label>
                      <Input type="number" value={tds} onChange={(e) => setTds(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Loan / Advance</Label>
                      <Input type="number" value={advance} onChange={(e) => setAdvance(e.target.value)} className="h-8 font-mono text-destructive" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">L.W.F.</Label>
                      <Input type="number" value={lwf} onChange={(e) => setLwf(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <div className="grid grid-cols-2 items-center gap-4">
                      <Label className="text-xs">Other Deductions</Label>
                      <Input type="number" value={otherDeductions} onChange={(e) => setOtherDeductions(e.target.value)} className="h-8 font-mono" />
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 items-center gap-4 font-bold">
                      <Label className="text-xs">Total Deductions</Label>
                      <div className="text-right text-sm text-destructive">{calculations.totalDeductions.toLocaleString('en-IN')}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-primary/5 border border-primary/10 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Net Payable Salary</p>
                  <p className="text-2xl font-black text-primary">{calculations.netPay.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</p>
                </div>
                <WalletCards className="h-10 w-10 text-primary opacity-20" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Payment Status</Label>
                    <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Paid">Paid</SelectItem>
                        <SelectItem value="Pending">Pending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Additional Notes</Label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ref no., mode etc." className="h-10" />
                  </div>
                </div>
                <div className="bg-muted/30 p-4 rounded-2xl border border-dashed flex items-center justify-between">
                    <div className="space-y-1">
                        <Label htmlFor="show-gstin" className="text-xs font-black uppercase tracking-tight cursor-pointer">Show GST on Slip</Label>
                        <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">Toggle enterprise GST visibility</p>
                    </div>
                    <Switch id="show-gstin" checked={showGstin} onCheckedChange={setShowGstin} />
                </div>
              </div>
            </div>
            <DialogFooter className="p-6 border-t bg-muted/10 gap-3">
              <Button variant="ghost" onClick={() => setIsFormOpen(false)} className="rounded-xl font-bold">Cancel</Button>
              <Button onClick={handleFormSubmit} className="rounded-xl font-bold px-8">{editingSalary ? 'Update Record' : 'Save Salary'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!salaryToDelete} onOpenChange={(o) => !o && setSalaryToDelete(null)}>
          <AlertDialogContent className="rounded-2xl border-none shadow-2xl">
            <AlertDialogHeader>
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2 mx-auto sm:mx-0">
                <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <AlertDialogTitle className="text-xl font-black">Delete Payroll Record?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                This will permanently erase the salary record for this employee.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6 flex flex-col sm:flex-row gap-2">
              <AlertDialogCancel className="h-11 rounded-xl font-bold border-muted">Keep Record</AlertDialogCancel>
              <AlertDialogAction onClick={handleDeleteSalary} className="h-11 rounded-xl font-bold bg-destructive hover:bg-destructive/90 shadow-lg shadow-destructive/20">Yes, Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      </TooltipProvider>
    </AppLayout>
  );
}
