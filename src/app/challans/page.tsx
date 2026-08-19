'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import AppLayout from "@/components/app-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { Company, CompanySettings, Forklift, Challan } from '@/lib/data';
import { FileDown, Plus, Trash2, Printer, Search, Building2, Car, CalendarDays, Hash, Info, Loader2, XCircle, Type, Ruler, LayoutTemplate, Settings2, Save, History, Clock, ListFilter, ArrowLeft, PlusCircle, Eye, Filter, Pencil, ChevronRight, FolderOpen, EllipsisVertical, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { generateChallanPdf, type ChallanItem } from '@/lib/challan-generator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ForkliftIcon } from '@/components/icons/forklift-icon';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

const DEFAULT_ADDRESS = "S. No. 14/6A, Khot Banglow, Nr Transformer, Bhandarli, Pimpri, Thane - 400 612";

export default function ChallansPage() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();

    // View State
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [isViewOpen, setIsViewOpen] = useState(false);
    const [selectedChallanForView, setSelectedChallanForView] = useState<Challan | null>(null);

    // Form State
    const [editingChallanId, setEditingChallanId] = useState<string | null>(null);
    const [enterprise, setEnterprise] = useState<'Vithal' | 'RV'>('Vithal');
    const [challanNo, setChallanNo] = useState('');
    const [vehicleNo, setVehicleNo] = useState('');
    const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [includeStamp, setIncludeStamp] = useState(false);
    
    // Layout Customization State
    const [fromAddressFontSize, setFromAddressFontSize] = useState(10);
    const [deliveryToAddressFontSize, setDeliveryToAddressFontSize] = useState(10);
    const [headerHeight, setHeaderHeight] = useState(20);
    const [footerHeight, setFooterHeight] = useState(20);
    const [srWidth, setSrWidth] = useState(15);
    const [amountWidth, setAmountWidth] = useState(30);
    const [particularsFontSize, setParticularsFontSize] = useState(9);
    const [titleFontSize, setTitleFontSize] = useState(10);
    const [headerDetailsFontSize, setHeaderDetailsFontSize] = useState(8.5);
    
    // "From" Selection
    const [fromId, setFromId] = useState('enterprise');
    const [manualFromName, setManualFromName] = useState('');
    const [fromAddress, setFromAddress] = useState(DEFAULT_ADDRESS);

    // "Delivery To" Selection
    const [deliveryToId, setDeliveryToId] = useState('');
    const [manualDeliveryToName, setManualDeliveryToName] = useState('');
    const [deliveryToAddress, setDeliveryToAddress] = useState('');
    
    const [items, setItems] = useState<ChallanItem[]>([{ particulars: '', amount: 0 }]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    // Search & Filter State
    const [historySearch, setHistorySearch] = useState('');
    const [firmFilter, setFirmFilter] = useState<'All' | 'Vithal' | 'RV'>('All');
    const [clientFilter, setClientFilter] = useState('All');
    
    // Picker State
    const [isForkliftDialogOpen, setIsForkliftDialogOpen] = useState(false);
    const [activeItemIndex, setActiveItemIndex] = useState<number | null>(null);
    const [forkliftSearch, setForkliftSearch] = useState('');

    // Data fetching
    const companiesQuery = useMemoFirebase(() => 
        firestore && user ? query(collection(firestore, 'companies'), orderBy('name', 'asc')) : null, 
        [firestore, user]
    );
    const { data: companies } = useCollection<Company>(companiesQuery);

    const forkliftsQuery = useMemoFirebase(() => 
        firestore && user ? query(collection(firestore, 'forklifts'), orderBy('serialNumber', 'asc')) : null, 
        [firestore, user]
    );
    const { data: forklifts } = useCollection<Forklift>(forkliftsQuery);

    const challansQuery = useMemoFirebase(() => 
        firestore && user ? query(collection(firestore, 'challans'), orderBy('date', 'desc')) : null, 
        [firestore, user]
    );
    const { data: savedChallans, isLoading: isLoadingHistory } = useCollection<Challan>(challansQuery);

    const settingsRef = useMemoFirebase(() => 
        firestore && user ? doc(firestore, 'companySettings', enterprise.toLowerCase()) : null,
        [firestore, user, enterprise]
    );
    const { data: settings } = useDoc<CompanySettings>(settingsRef);

    const selectedFromCompany = useMemo(() => 
        companies?.find(c => c.id === fromId), 
        [companies, fromId]
    );

    const selectedDeliveryCompany = useMemo(() => 
        companies?.find(c => c.id === deliveryToId), 
        [companies, deliveryToId]
    );

    // Sync From Address
    useEffect(() => {
        if (fromId === 'enterprise') {
            setFromAddress(settings?.address || DEFAULT_ADDRESS);
        } else if (fromId !== 'manual' && selectedFromCompany) {
            setFromAddress(selectedFromCompany.address);
        }
    }, [fromId, selectedFromCompany, settings]);

    // Sync Delivery Address
    useEffect(() => {
        if (deliveryToId === 'enterprise') {
            setDeliveryToAddress(settings?.address || DEFAULT_ADDRESS);
        } else if (deliveryToId !== 'manual' && selectedDeliveryCompany) {
            setDeliveryToAddress(selectedDeliveryCompany.address);
        }
    }, [deliveryToId, selectedDeliveryCompany, settings]);

    const filteredForklifts = useMemo(() => {
        if (!forklifts) return [];
        if (!forkliftSearch) return forklifts;
        const lower = forkliftSearch.toLowerCase();
        return forklifts.filter(f => 
            String(f.serialNumber || '').toLowerCase().includes(lower) || 
            String(f.make || '').toLowerCase().includes(lower) || 
            String(f.model || '').toLowerCase().includes(lower)
        );
    }, [forklifts, forkliftSearch]);

    const groupedHistory = useMemo(() => {
        if (!savedChallans) return [];
        
        let list = savedChallans;

        if (firmFilter !== 'All') {
            list = list.filter(c => c.enterprise === firmFilter);
        }

        if (clientFilter !== 'All') {
            list = list.filter(c => c.deliveryToName === clientFilter);
        }

        if (historySearch) {
            const lower = historySearch.toLowerCase();
            list = list.filter(c => 
                c.challanNo.toLowerCase().includes(lower) || 
                c.deliveryToName.toLowerCase().includes(lower) ||
                (c.vehicleNo || '').toLowerCase().includes(lower) ||
                c.fromName.toLowerCase().includes(lower) ||
                c.items.some(item => item.particulars.toLowerCase().includes(lower))
            );
        }

        const groups: Record<string, Challan[]> = {};
        list.forEach(challan => {
            const monthKey = format(parseISO(challan.date), 'MMMM yyyy');
            if (!groups[monthKey]) groups[monthKey] = [];
            groups[monthKey].push(challan);
        });

        return Object.entries(groups)
            .sort((a, b) => b[0].localeCompare(a[0])) 
            .map(([month, items]) => ({
                month,
                items: items.sort((a, b) => 
                    (a.challanNo || '').localeCompare(b.challanNo || '', undefined, { numeric: true, sensitivity: 'base' })
                )
            }));
    }, [savedChallans, historySearch, firmFilter, clientFilter]);

    const handleAddItem = () => {
        setItems([...items, { particulars: '', amount: 0 }]);
    };

    const handleRemoveItem = (index: number) => {
        if (items.length === 1) return;
        setItems(items.filter((_, i) => i !== index));
    };

    const handleItemChange = (index: number, field: keyof ChallanItem, value: string | number) => {
        const newItems = [...items];
        if (field === 'amount') {
            newItems[index].amount = parseFloat(String(value)) || 0;
        } else {
            newItems[index].particulars = String(value);
        }
        setItems(newItems);
    };

    const handleApplyFormatting = (index: number, text: string) => {
        const textarea = document.getElementById(`particulars-${index}`) as HTMLTextAreaElement;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentVal = items[index].particulars;
        
        let newVal = '';
        let cursorOffset = text.length;

        if (text === '[H]' || text === '[B]') {
            if (start !== end) {
                newVal = currentVal.substring(0, start) + text + currentVal.substring(start, end) + text.replace('[', '[/') + currentVal.substring(end);
            } else {
                newVal = currentVal.substring(0, start) + text + currentVal.substring(end);
            }
        } else {
            newVal = currentVal.substring(0, start) + text + currentVal.substring(end);
        }

        handleItemChange(index, 'particulars', newVal);

        setTimeout(() => {
            textarea.focus();
            const pos = start + cursorOffset;
            textarea.setSelectionRange(pos, pos);
        }, 0);
    };

    const openForkliftPicker = (index: number) => {
        setActiveItemIndex(index);
        setForkliftSearch('');
        setIsForkliftDialogOpen(true);
    };

    const handleSelectForklift = (forklift: Forklift) => {
        if (activeItemIndex === null) return;
        const machineType = forklift.equipmentType || 'FORKLIFT';
        const details = [
            `[H]${machineType.toUpperCase()}[/H]`,
            `• S.No: ${forklift.serialNumber}`,
            `• Capacity: ${forklift.capacity || 'N/A'}`,
            `• Make: ${forklift.make} | Model: ${forklift.model}`,
            `• Volt: ${forklift.voltage || 'N/A'} | Mfg Year: ${forklift.year}`
        ].join('\n');

        handleItemChange(activeItemIndex, 'particulars', details);
        setIsForkliftDialogOpen(false);
        setActiveItemIndex(null);
    };

    const handleSaveRecord = async () => {
        if (!challanNo || !date) {
            toast({ variant: 'destructive', title: 'Error', description: 'Challan No. and Date are required to save.' });
            return;
        }

        const fromName = fromId === 'enterprise' 
            ? (enterprise === 'Vithal' ? 'Vithal Enterprises' : 'R.V. Enterprises')
            : fromId === 'manual' ? manualFromName : (selectedFromCompany?.name || '');

        const deliveryToName = deliveryToId === 'enterprise'
            ? (enterprise === 'Vithal' ? 'Vithal Enterprises' : 'R.V. Enterprises')
            : deliveryToId === 'manual' ? manualDeliveryToName : (selectedDeliveryCompany?.name || '');

        setIsSaving(true);
        try {
            const challanData: Omit<Challan, 'id'> = {
                enterprise,
                challanNo,
                vehicleNo,
                date,
                fromName,
                fromAddress,
                deliveryToName,
                deliveryToAddress,
                items,
                layoutSettings: {
                    fromAddressFontSize,
                    deliveryToAddressFontSize,
                    headerHeight,
                    footerHeight,
                    srWidth,
                    amountWidth,
                    particularsFontSize,
                    titleFontSize,
                    headerDetailsFontSize,
                    includeStamp
                },
                createdAt: editingChallanId ? (savedChallans?.find(c => c.id === editingChallanId)?.createdAt || new Date().toISOString()) : new Date().toISOString()
            };
            
            if (editingChallanId) {
                const docRef = doc(firestore!, 'challans', editingChallanId);
                updateDocumentNonBlocking(docRef, challanData);
                toast({ title: 'Record Updated', description: `Challan ${challanNo} information saved.` });
            } else {
                await addDocumentNonBlocking(collection(firestore!, 'challans'), challanData);
                toast({ title: 'Record Saved', description: `Challan ${challanNo} added to Dashboard.` });
            }
            setIsFormOpen(false); 
            setEditingChallanId(null);
        } catch (e) {
            toast({ variant: 'destructive', title: 'Save Failed', description: 'Could not store record.' });
        } finally {
            setIsSaving(false);
        }
    };

    const loadHistoryRecord = (record: Challan) => {
        setEditingChallanId(record.id);
        setEnterprise(record.enterprise as 'Vithal' | 'RV');
        setChallanNo(record.challanNo);
        setVehicleNo(record.vehicleNo || '');
        setDate(record.date);
        
        setFromId('manual');
        setManualFromName(record.fromName);
        setFromAddress(record.fromAddress);
        
        setDeliveryToId('manual');
        setManualDeliveryToName(record.deliveryToName);
        setDeliveryToAddress(record.deliveryToAddress);
        
        setItems(record.items);

        if (record.layoutSettings) {
            setFromAddressFontSize(record.layoutSettings.fromAddressFontSize);
            setDeliveryToAddressFontSize(record.layoutSettings.deliveryToAddressFontSize);
            setHeaderHeight(record.layoutSettings.headerHeight);
            setFooterHeight(record.layoutSettings.footerHeight);
            setSrWidth(record.layoutSettings.srWidth);
            setAmountWidth(record.layoutSettings.amountWidth);
            setParticularsFontSize(record.layoutSettings.particularsFontSize);
            setTitleFontSize(record.layoutSettings.titleFontSize);
            setHeaderDetailsFontSize(record.layoutSettings.headerDetailsFontSize);
            setIncludeStamp(record.layoutSettings.includeStamp);
        }

        setIsFormOpen(true);
        toast({ title: 'Record Loaded', description: `Challan ${record.challanNo} details restored.` });
    };

    const handleOpenView = (record: Challan) => {
        setSelectedChallanForView(record);
        setIsViewOpen(true);
    }

    const handleDeleteRecord = async (id: string) => {
        if (!firestore) return;
        try {
            await deleteDoc(doc(firestore, 'challans', id));
            toast({ title: 'Record Deleted' });
        } catch (e) {
            toast({ variant: 'destructive', title: 'Delete Failed' });
        }
    }

    const handleGenerate = async () => {
        if (!challanNo || !date) {
            toast({ variant: 'destructive', title: 'Error', description: 'Challan No. and Date are required.' });
            return;
        }

        const fromName = fromId === 'enterprise' 
            ? (enterprise === 'Vithal' ? 'Vithal Enterprises' : 'R.V. Enterprises')
            : fromId === 'manual' ? manualFromName : (selectedFromCompany?.name || '');

        const deliveryToName = deliveryToId === 'enterprise'
            ? (enterprise === 'Vithal' ? 'Vithal Enterprises' : 'R.V. Enterprises')
            : deliveryToId === 'manual' ? manualDeliveryToName : (selectedDeliveryCompany?.name || '');

        setIsGenerating(true);
        try {
            await generateChallanPdf({
                enterprise,
                challanNo,
                vehicleNo,
                date,
                fromName,
                fromAddress,
                deliveryToName,
                deliveryToAddress,
                items,
                pan: settings?.pan || 'N/A',
                gstin: settings?.gstin || 'N/A',
                includeStamp,
                fromAddressFontSize,
                deliveryToAddressFontSize,
                headerHeight,
                footerHeight,
                srWidth,
                amountWidth,
                titleFontSize,
                particularsFontSize,
                headerDetailsFontSize
            });
            toast({ title: 'Success', description: 'Challan PDF generated.' });
        } catch (e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Error', description: 'Failed to generate PDF.' });
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCreateNew = useCallback(() => {
        setEditingChallanId(null);
        setChallanNo('');
        setVehicleNo('');
        setDate(format(new Date(), 'yyyy-MM-dd'));
        setItems([{ particulars: '', amount: 0 }]);
        setFromId('enterprise');
        setDeliveryToId('');
        setManualDeliveryToName('');
        setManualFromName('');
        setIsFormOpen(true);
    }, []);

    const resetFilters = () => {
        setHistorySearch('');
        setFirmFilter('All');
        setClientFilter('All');
    }

    return (
        <AppLayout>
            <div className="flex flex-col gap-6 max-w-6xl mx-auto animate-in fade-in duration-500 pb-20">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-foreground flex items-center gap-2">
                            <FileDown className="h-7 w-7 text-primary" />
                            {isFormOpen ? (editingChallanId ? "Edit Challan" : "Create Challan") : "Challan Records"}
                        </h1>
                        <p className="text-sm text-muted-foreground uppercase font-bold tracking-widest opacity-70">
                            {isFormOpen ? "Document Editor" : "Delivery tracking & history"}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isFormOpen ? (
                            <>
                                <Button variant="ghost" onClick={() => { setIsFormOpen(false); setEditingChallanId(null); }} className="h-10 rounded-xl font-bold">
                                    <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
                                </Button>
                                <Button variant="secondary" onClick={handleSaveRecord} disabled={isSaving || !challanNo} className="h-10 rounded-xl font-bold uppercase tracking-widest">
                                    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save</>}
                                </Button>
                                <Button onClick={handleGenerate} disabled={isGenerating} className="h-10 rounded-xl font-black uppercase tracking-widest shadow-lg shadow-primary/20">
                                    {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Printer className="mr-2 h-4 w-4" /> PDF</>}
                                </Button>
                            </>
                        ) : (
                            <Button onClick={handleCreateNew} className="h-12 px-6 rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-primary/20">
                                <PlusCircle className="mr-2 h-5 w-5" /> Add New Challan
                            </Button>
                        )}
                    </div>
                </div>

                {!isFormOpen ? (
                    <div className="space-y-8">
                        <Card className="border-none shadow-sm bg-muted/20 rounded-3xl p-6">
                            <div className="flex flex-col gap-4">
                                <div className="relative group w-full">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
                                    <Input 
                                        placeholder="Search by Bill No, Client, Vehicle, or Spec..." 
                                        value={historySearch}
                                        onChange={(e) => setHistorySearch(e.target.value)}
                                        className="pl-10 h-12 rounded-2xl border-muted-foreground/10 bg-background focus-visible:ring-primary/20 text-sm font-medium"
                                    />
                                    {historySearch && (
                                        <button onClick={() => setHistorySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                            <XCircle className="h-5 w-5" />
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    <Select value={firmFilter} onValueChange={(v: any) => setFirmFilter(v)}>
                                        <SelectTrigger className="h-10 w-full sm:w-44 rounded-xl font-bold bg-background border-muted-foreground/10">
                                            <div className="flex items-center gap-2">
                                                <Filter className="h-3 w-3 text-muted-foreground" />
                                                <SelectValue placeholder="All Firms" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="All">All Firms</SelectItem>
                                            <SelectItem value="Vithal">Vithal Enterprises</SelectItem>
                                            <SelectItem value="RV">R.V. Enterprises</SelectItem>
                                        </SelectContent>
                                    </Select>

                                    <Select value={clientFilter} onValueChange={setClientFilter}>
                                        <SelectTrigger className="h-10 w-full sm:w-64 rounded-xl font-bold bg-background border-muted-foreground/10">
                                            <div className="flex items-center gap-2">
                                                <Building2 className="h-3 w-3 text-muted-foreground" />
                                                <SelectValue placeholder="Filter by Client" />
                                            </div>
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="All">All Clients</SelectItem>
                                            {companies?.map(c => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>

                                    {(firmFilter !== 'All' || clientFilter !== 'All' || historySearch !== '') && (
                                        <Button variant="ghost" size="sm" onClick={resetFilters} className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                                            Reset Filters
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </Card>

                        {isLoadingHistory ? (
                            <div className="space-y-4">
                                {Array.from({ length: 3 }).map((_, i) => (
                                    <div key={i} className="h-24 w-full rounded-2xl bg-muted animate-pulse" />
                                ))}
                            </div>
                        ) : groupedHistory.length > 0 ? (
                            groupedHistory.map(group => {
                                const [monthName, year] = group.month.split(' ');
                                return (
                                <div key={group.month} className="space-y-6">
                                    <div className="px-2">
                                        <span className="text-lg font-black uppercase tracking-tight leading-none text-foreground block">
                                            {monthName}
                                        </span>
                                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] mt-1 opacity-60 block">
                                            {year} • {group.items.length} Records
                                        </span>
                                    </div>
                                    
                                    <div className="space-y-2">
                                        {group.items.map(challan => (
                                            <Card key={challan.id} className={cn(
                                                "group relative bg-card border-none shadow-sm hover:shadow-md transition-all duration-200 rounded-2xl overflow-hidden border-l-4",
                                                challan.enterprise === 'Vithal' ? "border-l-emerald-500" : "border-l-blue-600"
                                            )}>
                                                <div className="flex flex-row items-center justify-between p-3 sm:p-4 gap-4">
                                                    <div className="flex items-center gap-4 flex-1 min-w-0">
                                                        <div className="space-y-0.5 min-w-0 flex-1">
                                                            <div className="flex items-center gap-2">
                                                                <p className="font-black text-sm tracking-tight text-foreground truncate">{challan.challanNo}</p>
                                                                <Badge variant="outline" className="text-[7px] font-black py-0 h-3.5 border-muted-foreground/10 uppercase shrink-0">{challan.enterprise}</Badge>
                                                            </div>
                                                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                                                <span className="flex items-center gap-1 shrink-0"><Clock className="h-2.5 w-2.5" /> {format(parseISO(challan.date), 'dd MMM')}</span>
                                                                <span className="opacity-20 shrink-0">|</span>
                                                                <span className="flex items-center gap-1 text-primary whitespace-normal break-words leading-tight"><Building2 className="h-2.5 w-2.5 shrink-0" /> {challan.deliveryToName}</span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-4 shrink-0">
                                                        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-muted/30 rounded-lg border">
                                                            <Car className="h-3 w-3 text-muted-foreground" />
                                                            <p className="text-[10px] font-black text-foreground uppercase truncate">{challan.vehicleNo || 'SELF'}</p>
                                                        </div>

                                                        <div className="flex items-center" onClick={e => e.stopPropagation()}>
                                                            <DropdownMenu modal={false}>
                                                                <DropdownMenuTrigger asChild>
                                                                    <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-muted transition-all">
                                                                        <EllipsisVertical className="h-4 w-4" />
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent align="end" className="w-44 rounded-2xl p-1.5 shadow-xl border-none z-[100]">
                                                                    <DropdownMenuItem onClick={() => handleOpenView(challan)} className="rounded-xl h-10 cursor-pointer">
                                                                        <Eye className="mr-2 h-4 w-4 text-primary" /> 
                                                                        <span className="font-bold text-xs uppercase tracking-tight">View Details</span>
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuItem onClick={() => loadHistoryRecord(challan)} className="rounded-xl h-10 cursor-pointer">
                                                                        <Pencil className="mr-2 h-4 w-4 text-amber-500" />
                                                                        <span className="font-bold text-xs uppercase tracking-tight">Edit Record</span>
                                                                    </DropdownMenuItem>
                                                                    <DropdownMenuSeparator className="my-1.5 opacity-50" />
                                                                    <DropdownMenuItem onClick={() => handleDeleteRecord(challan.id)} className="rounded-xl h-10 cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/5">
                                                                        <Trash2 className="mr-2 h-4 w-4" />
                                                                        <span className="font-bold text-xs uppercase tracking-tight">Delete Record</span>
                                                                    </DropdownMenuItem>
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                        </div>
                                                    </div>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                </div>
                            )})
                        ) : (
                            <div className="py-32 text-center flex flex-col items-center gap-4">
                                <div className="h-24 w-24 rounded-full bg-muted/50 flex items-center justify-center opacity-30">
                                    <History className="h-12 w-12" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-lg font-black uppercase tracking-widest text-muted-foreground">No records found</p>
                                    <p className="text-sm font-medium text-muted-foreground/60">Start by creating a new delivery challan</p>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-in slide-in-from-right-4 duration-500">
                        <Card className="lg:col-span-8 border-none shadow-2xl rounded-[32px] overflow-hidden">
                            <CardHeader className="bg-muted/30 border-b p-6 sm:p-8">
                                <div className="flex flex-col sm:flex-row justify-between gap-4">
                                    <div className="space-y-1">
                                        <CardTitle>{editingChallanId ? "Update Challan" : "Challan Editor"}</CardTitle>
                                        <CardDescription>{editingChallanId ? `Editing record ${challanNo}` : "Enter details and item specifications."}</CardDescription>
                                    </div>
                                    <Select value={enterprise} onValueChange={(v: any) => setEnterprise(v)}>
                                        <SelectTrigger className="w-full sm:w-40 h-10 font-bold bg-background rounded-xl border-primary/20">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Vithal">Vithal Ent.</SelectItem>
                                            <SelectItem value="RV">R.V. Ent.</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </CardHeader>
                            <CardContent className="p-6 sm:p-8 space-y-8">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Hash className="h-3 w-3" /> Challan No.</Label>
                                        <Input value={challanNo} onChange={e => setChallanNo(e.target.value)} placeholder="001/24-25" className="h-11 font-bold rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><Car className="h-3 w-3" /> Vehicle No.</Label>
                                        <Input value={vehicleNo} onChange={e => setVehicleNo(e.target.value)} placeholder="MH-04-XX-1234" className="h-11 font-bold rounded-xl" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"><CalendarDays className="h-3 w-3" /> Date</Label>
                                        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="h-11 font-bold rounded-xl" />
                                    </div>
                                </div>

                                <Separator />

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary">From Selection</Label>
                                        <Select value={fromId} onValueChange={setFromId}>
                                            <SelectTrigger className="h-11 text-xs font-bold rounded-xl">
                                                <SelectValue placeholder="Select Source" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="enterprise">Default Enterprise</SelectItem>
                                                <SelectItem value="manual">-- Manual Entry --</SelectItem>
                                                <Separator className="my-1" />
                                                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        {fromId === 'manual' && (
                                            <Input placeholder="From Name" value={manualFromName} onChange={e => setManualFromName(e.target.value)} className="h-10 text-xs font-bold rounded-xl" />
                                        )}
                                        <div className="space-y-2">
                                            <Label className="text-[9px] font-bold text-muted-foreground/60 uppercase">Sender Address</Label>
                                            <Textarea value={fromAddress} onChange={e => setFromAddress(e.target.value)} className="min-h-[100px] text-xs leading-relaxed rounded-xl" />
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Delivery To Selection</Label>
                                        <Select value={deliveryToId} onValueChange={setDeliveryToId}>
                                            <SelectTrigger className="h-11 text-xs font-bold rounded-xl">
                                                <SelectValue placeholder="Select Destination" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="enterprise">Default Enterprise</SelectItem>
                                                <SelectItem value="manual">-- Manual Entry --</SelectItem>
                                                <Separator className="my-1" />
                                                {companies?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        {deliveryToId === 'manual' && (
                                            <Input placeholder="Client Name" value={manualDeliveryToName} onChange={e => setManualDeliveryToName(e.target.value)} className="h-10 text-xs font-bold rounded-xl" />
                                        )}
                                        <div className="space-y-2">
                                            <Label className="text-[9px] font-bold text-muted-foreground/60 uppercase">Delivery Address</Label>
                                            <Textarea value={deliveryToAddress} onChange={e => setDeliveryToAddress(e.target.value)} className="min-h-[100px] text-xs leading-relaxed rounded-xl" />
                                        </div>
                                    </div>
                                </div>

                                <Separator />

                                <div className="space-y-6">
                                    <div className="flex justify-between items-center">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Particulars & Amount</Label>
                                        <Button variant="outline" size="sm" onClick={handleAddItem} className="h-9 rounded-xl text-[10px] font-black uppercase border-primary/20 bg-primary/5 text-primary hover:bg-primary/10">
                                            <Plus className="mr-1.5 h-4 w-4" /> Add Line Item
                                        </Button>
                                    </div>
                                    <div className="space-y-4">
                                        {items.map((item, index) => (
                                            <div key={index} className="flex gap-3 items-start group animate-in slide-in-from-left-2 duration-300">
                                                <div className="flex flex-col gap-1 shrink-0 w-10">
                                                    <div className="h-6 w-full flex items-center justify-center text-[10px] font-black text-muted-foreground/50 border rounded-t-xl bg-muted/20">{index + 1}</div>
                                                    <Button 
                                                        variant="outline" 
                                                        size="icon" 
                                                        onClick={() => openForkliftPicker(index)}
                                                        className="h-8 w-full rounded-none border-primary/20 bg-primary/5 hover:bg-primary/10 text-primary"
                                                        title="Load Fleet Specs"
                                                    >
                                                        <ForkliftIcon className="h-3.5 w-3.5" />
                                                    </Button>
                                                    <DropdownMenu modal={false}>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="outline" size="icon" className="h-8 w-full rounded-none rounded-b-xl bg-muted/10">
                                                                <Type className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="start" className="w-48 p-2 rounded-2xl shadow-xl z-[150]">
                                                            <div className="grid gap-1">
                                                                <DropdownMenuItem onClick={() => handleApplyFormatting(index, '[H]')} className="text-xs font-black uppercase rounded-lg h-9">Heading Style</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleApplyFormatting(index, '[B]')} className="text-xs font-bold uppercase rounded-lg h-9">Bold Text</DropdownMenuItem>
                                                                <DropdownMenuItem onClick={() => handleApplyFormatting(index, '[S:8]')} className="text-xs uppercase rounded-lg h-9">Small Size (8pt)</DropdownMenuItem>
                                                                <DropdownMenuSeparator className="opacity-50" />
                                                                <div className="grid grid-cols-5 p-1 gap-1">
                                                                    {['•', '✓', '→', '»', '⦿'].map(s => (
                                                                        <Button key={s} variant="ghost" size="icon" className="h-7 w-7 text-sm font-bold" onClick={() => handleApplyFormatting(index, s + ' ')}>{s}</Button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </div>
                                                <Textarea 
                                                    id={`particulars-${index}`}
                                                    value={item.particulars} 
                                                    onChange={e => handleItemChange(index, 'particulars', e.target.value)} 
                                                    placeholder="Detailed technical description..."
                                                    className="flex-1 min-h-[44px] h-32 py-3 text-xs font-bold leading-snug rounded-xl resize-none"
                                                />
                                                <div className="space-y-1">
                                                    <Input 
                                                        type="number" 
                                                        value={item.amount || ''} 
                                                        onChange={e => handleItemChange(index, 'amount', e.target.value)} 
                                                        placeholder="Amt"
                                                        className="w-28 h-11 text-right font-mono font-black rounded-xl"
                                                    />
                                                    <Button variant="ghost" size="sm" onClick={() => handleRemoveItem(index)} className="w-full h-8 text-destructive hover:bg-destructive/5 rounded-lg text-[9px] font-black uppercase">
                                                        <Trash2 className="mr-1 h-3 w-3" /> Remove
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="lg:col-span-4 space-y-6">
                            <Card className="border-none shadow-xl bg-card rounded-[32px] overflow-hidden sticky top-24">
                                <CardHeader className="bg-muted/30 border-b pb-4 p-6">
                                    <CardTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                                        <Settings2 className="h-4 w-4 text-primary" />
                                        Layout Settings
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="p-6 space-y-8">
                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-1.5">
                                            <Ruler className="h-3 w-3" /> Section Heights (mm)
                                        </h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-bold text-muted-foreground uppercase">Firm Header</Label>
                                                <Input type="number" value={headerHeight} onChange={e => setHeaderHeight(parseInt(e.target.value) || 20)} className="h-9 text-xs font-bold rounded-xl" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-bold text-muted-foreground uppercase">Sign Footer</Label>
                                                <Input type="number" value={footerHeight} onChange={e => setFooterHeight(parseInt(e.target.value) || 20)} className="h-9 text-xs font-bold rounded-xl" />
                                            </div>
                                        </div>
                                    </div>

                                    <Separator className="bg-border/30 my-1" />

                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-1.5">
                                            <LayoutTemplate className="h-3 w-3" /> Column Widths (mm)
                                        </h4>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-bold text-muted-foreground uppercase">SR. Col</Label>
                                                <Input type="number" value={srWidth} onChange={e => setSrWidth(parseInt(e.target.value) || 15)} className="h-9 text-xs font-bold rounded-xl" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label className="text-[9px] font-bold text-muted-foreground uppercase">Amount Col</Label>
                                                <Input type="number" value={amountWidth} onChange={e => setAmountWidth(parseInt(e.target.value) || 30)} className="h-9 text-xs font-bold rounded-xl" />
                                            </div>
                                        </div>
                                    </div>

                                    <Separator className="bg-border/30 my-1" />

                                    <div className="space-y-4">
                                        <h4 className="text-[10px] font-black text-primary uppercase tracking-[0.2em] flex items-center gap-1.5">
                                            <Type className="h-3 w-3" /> Typography (PT)
                                        </h4>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
                                            <div className="space-y-1">
                                                <Label className="text-[8px] font-black text-muted-foreground uppercase">Sender Addr</Label>
                                                <Input type="number" value={fromAddressFontSize} onChange={e => setFromAddressFontSize(parseInt(e.target.value) || 10)} className="h-8 text-xs font-bold rounded-lg" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[8px] font-black text-muted-foreground uppercase">Client Addr</Label>
                                                <Input type="number" value={deliveryToAddressFontSize} onChange={e => setDeliveryToAddressFontSize(parseInt(e.target.value) || 10)} className="h-8 text-xs font-bold rounded-lg" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[8px] font-black text-muted-foreground uppercase">Listing Font</Label>
                                                <Input type="number" value={particularsFontSize} onChange={e => setParticularsFontSize(parseInt(e.target.value) || 9)} className="h-8 text-xs font-bold rounded-lg" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label className="text-[8px] font-black text-muted-foreground uppercase">Title Font</Label>
                                                <Input type="number" value={titleFontSize} onChange={e => setTitleFontSize(parseInt(e.target.value) || 10)} className="h-8 text-xs font-bold rounded-lg" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center justify-between p-4 bg-primary/5 rounded-2xl border border-primary/10 transition-colors hover:bg-primary/10">
                                        <div className="space-y-0.5">
                                            <Label htmlFor="stamp-side" className="text-[10px] font-black uppercase tracking-wider cursor-pointer">Include Firm Stamp</Label>
                                            <p className="text-[8px] text-muted-foreground uppercase font-bold tracking-tight">Bottom Right Placement</p>
                                        </div>
                                        <Switch id="stamp-side" checked={includeStamp} onCheckedChange={setIncludeStamp} />
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                )}
            </div>

            <Dialog open={isViewOpen} onOpenChange={setIsViewOpen}>
                <DialogContent className="max-w-[95vw] sm:max-w-2xl p-0 rounded-3xl overflow-hidden border-none shadow-2xl">
                    {selectedChallanForView && (
                        <>
                            <DialogHeader className="p-6 bg-muted/30 border-b">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <Badge className={cn(
                                            "mb-2 text-[9px] font-black uppercase tracking-widest",
                                            selectedChallanForView.enterprise === 'Vithal' ? "bg-emerald-500 text-white" : "bg-blue-600 text-white"
                                        )}>
                                            {selectedChallanForView.enterprise} Enterprises
                                        </Badge>
                                        <DialogTitle className="text-2xl font-black">{selectedChallanForView.challanNo}</DialogTitle>
                                        <DialogDescription className="text-xs uppercase font-bold flex items-center gap-1.5 mt-1">
                                            <CalendarDays className="h-3 w-3" /> {format(parseISO(selectedChallanForView.date), 'dd MMMM yyyy')}
                                        </DialogDescription>
                                    </div>
                                    <Button variant="outline" size="sm" onClick={() => { setIsViewOpen(false); loadHistoryRecord(selectedChallanForView); }} className="rounded-xl font-bold">
                                        <Pencil className="h-4 w-4 mr-2" /> Edit Record
                                    </Button>
                                </div>
                            </DialogHeader>
                            <ScrollArea className="max-h-[60vh]">
                                <div className="p-6 space-y-6">
                                    <div className="grid grid-cols-2 gap-8">
                                        <div className="space-y-2">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary">From</Label>
                                            <p className="text-sm font-black uppercase">{selectedChallanForView.fromName}</p>
                                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{selectedChallanForView.fromAddress}</p>
                                        </div>
                                        <div className="space-y-2 text-right">
                                            <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Delivery To</Label>
                                            <p className="text-sm font-black uppercase">{selectedChallanForView.deliveryToName}</p>
                                            <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{selectedChallanForView.deliveryToAddress}</p>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-primary">Particulars Listing</Label>
                                        <div className="border rounded-2xl overflow-hidden">
                                            <Table>
                                                <TableHeader className="bg-muted/50">
                                                    <TableRow>
                                                        <TableHead className="w-12 text-center text-[10px] font-black uppercase">SR.</TableHead>
                                                        <TableHead className="text-[10px] font-black uppercase">Item Details</TableHead>
                                                        <TableHead className="w-32 text-right text-[10px] font-black uppercase">Amount</TableHead>
                                                    </TableRow>
                                                </TableHeader>
                                                <TableBody>
                                                    {selectedChallanForView.items.map((item, i) => (
                                                        <TableRow key={i}>
                                                            <TableCell className="text-center font-bold text-xs">{i + 1}</TableCell>
                                                            <TableCell className="text-xs leading-relaxed whitespace-pre-wrap font-medium">
                                                                {item.particulars.replace(/\[\/?(H|B|S:\d+)\]/g, '')}
                                                            </TableCell>
                                                            <TableCell className="text-right font-mono font-bold text-xs text-primary">
                                                                {item.amount ? `₹${item.amount.toLocaleString('en-IN')}` : '-'}
                                                            </TableCell>
                                                        </TableRow>
                                                    ))}
                                                </TableBody>
                                            </Table>
                                        </div>
                                    </div>

                                    {selectedChallanForView.vehicleNo && (
                                        <div className="p-4 bg-muted/20 rounded-2xl border border-dashed flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-xl bg-background flex items-center justify-center border shadow-sm">
                                                    <Car className="h-5 w-5 text-muted-foreground" />
                                                </div>
                                                <div className="space-y-0.5">
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Transport Vehicle</p>
                                                    <p className="text-sm font-black uppercase tracking-widest">{selectedChallanForView.vehicleNo}</p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </ScrollArea>
                            <DialogFooter className="p-6 bg-muted/30 border-t flex flex-row gap-3">
                                <Button variant="ghost" onClick={() => setIsViewOpen(false)} className="flex-1 h-12 rounded-xl font-bold uppercase tracking-widest">Close</Button>
                                <Button onClick={() => { 
                                    setIsViewOpen(false); 
                                    generateChallanPdf({
                                        ...selectedChallanForView,
                                        enterprise: selectedChallanForView.enterprise as 'Vithal' | 'RV',
                                        pan: settings?.pan || 'N/A',
                                        gstin: settings?.gstin || 'N/A',
                                        ...selectedChallanForView.layoutSettings
                                    });
                                }} className="flex-1 h-12 rounded-xl font-black uppercase tracking-widest shadow-lg shadow-primary/20">
                                    <Printer className="mr-2 h-5 w-5" /> Generate PDF
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={isForkliftDialogOpen} onOpenChange={setIsForkliftDialogOpen}>
                <DialogContent className="max-w-[95vw] sm:max-w-md p-0 rounded-3xl overflow-hidden border-none shadow-2xl">
                    <DialogHeader className="p-6 bg-primary/5 border-b border-primary/10">
                        <DialogTitle className="flex items-center gap-2 text-primary font-black">
                            <ForkliftIcon className="h-5 w-5" />
                            Select Technical Unit
                        </DialogTitle>
                        <DialogDescription className="text-xs uppercase font-bold tracking-widest opacity-60">Pull official specs from fleet database</DialogDescription>
                    </DialogHeader>
                    <div className="p-4 space-y-4">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
                            <Input 
                                placeholder="Search by Serial No, Make, or Model..." 
                                value={forkliftSearch}
                                onChange={(e) => setForkliftSearch(e.target.value)}
                                className="pl-9 h-11 border-muted bg-muted/10 rounded-2xl"
                            />
                        </div>
                        <ScrollArea className="h-[350px]">
                            {filteredForklifts.length > 0 ? (
                                <div className="grid gap-3 pr-4">
                                    {filteredForklifts.map(f => (
                                        <button 
                                            key={f.id} 
                                            onClick={() => handleSelectForklift(f)}
                                            className="w-full text-left p-4 rounded-2xl border-2 border-muted/50 hover:border-primary/50 hover:bg-primary/5 transition-all duration-200 group"
                                        >
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-1">
                                                    <p className="font-black text-sm text-foreground group-hover:text-primary transition-colors">{f.serialNumber}</p>
                                                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{f.make} {f.model}</p>
                                                    <div className="flex items-center gap-2 pt-1">
                                                        <Badge variant="outline" className="text-[8px] font-black px-1.5 uppercase h-4 bg-muted/20">{f.equipmentType || 'MHE'}</Badge>
                                                        <span className="text-[8px] font-black text-muted-foreground/60 uppercase">Year: {f.year}</span>
                                                    </div>
                                                </div>
                                                <Badge variant="secondary" className="text-[9px] font-black uppercase px-2 py-0.5 bg-primary/10 text-primary border-none">{f.capacity || 'N/A'}</Badge>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-20 text-muted-foreground italic text-sm">No units found matching search.</div>
                            )}
                        </ScrollArea>
                    </div>
                    <DialogFooter className="p-4 bg-muted/20 border-t">
                        <Button variant="ghost" onClick={() => setIsForkliftDialogOpen(false)} className="w-full h-11 font-black uppercase tracking-widest rounded-xl">Cancel Selection</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <style dangerouslySetInnerHTML={{ __html: `
                @media print {
                    @page { size: A4; margin: 0; }
                    body { background: white !important; margin: 0; padding: 0; }
                    .print\\:hidden { display: none !important; }
                    main { padding: 0 !important; overflow: visible !important; }
                }
            `}} />
        </AppLayout>
    );
}
