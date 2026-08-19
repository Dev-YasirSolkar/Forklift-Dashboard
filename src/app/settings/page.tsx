
'use client';
import { useCallback, useEffect, useState, useMemo } from "react";
import AppLayout from "@/components/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useFirebase, useDoc, useMemoFirebase, useCollection } from "@/firebase";
import { collection, doc, query, setDoc, orderBy } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import type { CompanySettings, PageMargin, BankAccount, InvoiceTemplate } from "@/lib/data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { BankAccountForm, BankAccountFormData } from "@/components/bank-account-form";
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { Table, TableBody, TableCell, TableHeader, TableHead, TableRow } from "@/components/ui/table";
import { EllipsisVertical, Pencil, PlusCircle, Trash2, AlignLeft, AlignCenter, AlignRight, Send, Loader2, CheckCircle2, RefreshCw, Building2, CreditCard, LayoutTemplate, Settings2, Info } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { setupTelegramWebhook } from "@/app/actions/telegram";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";


type Enterprise = 'Vithal' | 'RV';

const ColumnAlignmentFields = ({ template, onTemplateChange, onTemplateFontSizeChange }: { 
    template: InvoiceTemplate, 
    onTemplateChange: (id: 'sr_no' | 'particulars' | 'rate' | 'amount', align: 'left' | 'center' | 'right') => void,
    onTemplateFontSizeChange: (id: 'sr_no' | 'particulars' | 'rate' | 'amount', size: string) => void,
}) => {
    return (
        <div className="space-y-2">
             <h4 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
                <LayoutTemplate className="h-3 w-3" /> Column Styles
             </h4>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
             {template.columns.map(col => (
                <div key={col.id} className="p-2 rounded-xl border bg-muted/10 space-y-2">
                    <Label className="text-[9px] font-bold uppercase">{col.label}</Label>
                    <div className="flex items-center gap-1.5">
                        <div className="flex-1 p-0.5 bg-background rounded-lg border flex items-center justify-between">
                            {(['left', 'center', 'right'] as const).map(align => (
                                <Button 
                                    key={align} 
                                    type="button" 
                                    variant={col.align === align ? 'default' : 'ghost'} 
                                    size="icon" 
                                    className="h-6 w-6 flex-1 rounded-md"
                                    onClick={() => onTemplateChange(col.id as 'sr_no' | 'particulars' | 'rate' | 'amount', align)}
                                >
                                    {align === 'left' && <AlignLeft className="h-3 w-3" />}
                                    {align === 'center' && <AlignCenter className="h-3 w-3" />}
                                    {align === 'right' && <AlignRight className="h-3 w-3" />}
                                </Button>
                            ))}
                        </div>
                         <Input 
                            type="number" 
                            placeholder="Size" 
                            value={col.fontSize ?? ''} 
                            onChange={(e) => onTemplateFontSizeChange(col.id as 'sr_no' | 'particulars' | 'rate' | 'amount', e.target.value)}
                            className="h-7 w-12 text-center font-bold text-[10px] px-1"
                        />
                    </div>
                </div>
             ))}
             </div>
        </div>
    );
};

const SettingsForm = ({ enterprise }: { enterprise: Enterprise }) => {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    
    const settingsDocRef = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return doc(firestore, "companySettings", enterprise.toLowerCase())
    }, [firestore, enterprise, user]);
    const { data: initialSettings, isLoading: isLoadingSettings } = useDoc<CompanySettings>(settingsDocRef);
    
    const [settings, setSettings] = useState<Partial<CompanySettings>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

     const defaultTemplate: InvoiceTemplate = {
      columns: [
          { id: 'sr_no', label: 'Sr. No', align: 'center' },
          { id: 'particulars', label: 'Particulars', align: 'left' },
          { id: 'rate', label: 'Rate', align: 'right' },
          { id: 'amount', label: 'Amount', align: 'right' },
      ],
    };

    const settingsWithTemplate = useMemo(() => {
        return {
            ...settings,
            template: settings.template || defaultTemplate
        }
    }, [settings, defaultTemplate]);
    
    useEffect(() => {
        if (initialSettings) {
            setSettings(initialSettings);
        } else {
            setSettings({});
        }
    }, [initialSettings]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { id, value, type } = e.target as HTMLInputElement;
        if (type === 'number') {
            const numValue = value === '' ? null : parseFloat(value);
            if (numValue === null || !isNaN(numValue as number)) {
                setSettings(prev => ({ ...prev, [id]: numValue }));
            }
        } else {
            setSettings(prev => ({ ...prev, [id]: value }));
        }
    };

    const handleSelectChange = (id: keyof CompanySettings, value: string) => {
        setSettings(prev => ({...prev, [id]: value}));
    }
    
    const handleMarginChange = (field: keyof PageMargin, value: string) => {
      const numValue = value === '' ? null : parseFloat(value);
       if (numValue === null || !isNaN(numValue as number)) {
        setSettings(prev => ({
            ...prev,
            pageMargins: { ...(prev.pageMargins || {top: 0, right: 0, bottom: 0, left: 0}), [field]: numValue }
        }));
      }
    }
    
    const handleFontSizeChange = (field: 'pageFontSize' | 'addressFontSize' | 'tableBodyFontSize', value: string) => {
        const numValue = value === '' ? null : parseInt(value, 10);
        if (numValue === null || !isNaN(numValue as number)) {
            setSettings(p => ({...p, [field]: numValue}));
        }
    }

     const handleTemplateChange = (id: 'sr_no' | 'particulars' | 'rate' | 'amount', align: 'left' | 'center' | 'right') => {
        setSettings(prev => ({
            ...prev,
            template: {
                ...(prev.template || defaultTemplate),
                columns: (prev.template?.columns || defaultTemplate.columns).map(col =>
                    col.id === id ? { ...col, align } : col
                ),
            },
        }));
    };

    const handleTemplateFontSizeChange = (id: 'sr_no' | 'particulars' | 'rate' | 'amount', size: string) => {
        const numValue = size === '' ? undefined : parseInt(size, 10);
        if (size === '' || (numValue !== undefined && !isNaN(numValue))) {
            setSettings(prev => ({
                ...prev,
                template: {
                    ...(prev.template || defaultTemplate),
                    columns: (prev.template?.columns || defaultTemplate.columns).map(col =>
                        col.id === id ? { ...col, fontSize: numValue } : col
                    ),
                },
            }));
        }
    };


    const handleSaveChanges = async () => {
        if (!firestore || !settingsDocRef) {
            toast({ variant: "destructive", title: "Error", description: "Could not connect to database." });
            return;
        }
        
        setIsSubmitting(true);
        try {
            await setDoc(settingsDocRef, settings, { merge: true });
            toast({ title: "Success", description: `${enterprise} settings updated successfully.` });
        } catch (error) {
            console.error("Error updating settings:", error);
            toast({ variant: "destructive", title: "Error", description: "Failed to update settings. Please try again." });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    if (isLoadingSettings) {
        return (
             <div className="space-y-4 p-2">
               <div className="space-y-2">
                    <Skeleton className="h-4 w-1/4" />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-full" /></div>
                        <div className="space-y-1"><Skeleton className="h-4 w-20" /><Skeleton className="h-8 w-full" /></div>
                    </div>
                </div>
             </div>
        )
    }

    return (
        <div className="space-y-2 animate-in fade-in duration-500 pb-4">
            <div className="space-y-2">
                <h3 className="text-[9px] font-black uppercase tracking-[0.1em] text-primary flex items-center gap-1.5">
                    <Building2 className="h-3 w-3" /> Basic Info
                </h3>
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                        <Label htmlFor="companyName" className="text-[8px] font-bold uppercase text-muted-foreground">Company Name</Label>
                        <Input id="companyName" value={settings.companyName || ''} onChange={handleInputChange} className="h-8 rounded-xl text-xs" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="address" className="text-[8px] font-bold uppercase text-muted-foreground">Address</Label>
                        <Textarea id="address" value={settings.address || ''} onChange={handleInputChange} placeholder="Document address" className="min-h-[60px] rounded-xl resize-none text-xs p-2" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="pan" className="text-[8px] font-bold uppercase text-muted-foreground">PAN</Label>
                            <Input id="pan" value={settings.pan || ''} onChange={handleInputChange} className="h-8 rounded-xl font-mono text-xs" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="gstin" className="text-[8px] font-bold uppercase text-muted-foreground">GSTIN</Label>
                            <Input id="gstin" value={settings.gstin || ''} onChange={handleInputChange} className="h-8 rounded-xl font-mono text-xs" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label htmlFor="sacCode" className="text-[8px] font-bold uppercase text-muted-foreground">SAC</Label>
                            <Input id="sacCode" value={settings.sacCode || ''} onChange={handleInputChange} className="h-8 rounded-xl font-mono text-xs" />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="serviceTaxCode" className="text-[8px] font-bold uppercase text-muted-foreground">Service Tax</Label>
                            <Input id="serviceTaxCode" value={settings.serviceTaxCode || ''} onChange={handleInputChange} className="h-8 rounded-xl font-mono text-xs" />
                        </div>
                    </div>
                </div>
            </div>

            <Separator className="bg-border/30 my-1" />
            
            <div className="space-y-2">
                <h3 className="text-[9px] font-black uppercase tracking-[0.1em] text-primary flex items-center gap-1.5">
                    <Settings2 className="h-3 w-3" /> Billing
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                        <Label htmlFor="contactPerson" className="text-[8px] font-bold uppercase text-muted-foreground">Person</Label>
                        <Input id="contactPerson" value={settings.contactPerson || ''} onChange={handleInputChange} className="h-8 rounded-xl text-xs" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="contactNumber" className="text-[8px] font-bold uppercase text-muted-foreground">Contact</Label>
                        <Input id="contactNumber" value={settings.contactNumber || ''} onChange={handleInputChange} className="h-8 rounded-xl text-xs" />
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="nextBillNo" className="text-[8px] font-bold uppercase text-muted-foreground">Next No.</Label>
                        <Input id="nextBillNo" type="number" value={settings.nextBillNo ?? ''} onChange={handleInputChange} className="h-8 rounded-xl font-bold text-blue-600 text-xs" />
                    </div>
                </div>
            </div>
            
            <Separator className="bg-border/30 my-1" />

            <div className="space-y-2">
                <h3 className="text-[9px] font-black uppercase tracking-[0.1em] text-primary flex items-center gap-1.5">
                    <LayoutTemplate className="h-3 w-3" /> Layout
                </h3>
                 <div className="p-2 sm:p-3 border rounded-2xl bg-muted/5 space-y-3">
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <div className="space-y-1">
                            <Label className="text-[8px] font-bold uppercase text-muted-foreground">Size</Label>
                            <Select value={settings.pageSize || 'A4'} onValueChange={(value) => handleSelectChange('pageSize', value)} >
                                <SelectTrigger className="h-7 rounded-xl bg-background text-[10px] px-2">
                                    <SelectValue placeholder="Size" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="A4" className="text-xs">A4</SelectItem>
                                    <SelectItem value="LETTER" className="text-xs">Letter</SelectItem>
                                    <SelectItem value="LEGAL" className="text-xs">Legal</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1 col-span-1">
                            <Label className="text-[8px] font-bold uppercase text-muted-foreground">Margins</Label>
                            <div className="grid grid-cols-4 gap-1">
                                <Input type="number" value={settings.pageMargins?.top ?? ''} onChange={(e) => handleMarginChange('top', e.target.value)} className="h-7 rounded-xl px-1 text-center text-[9px]"/>
                                <Input type="number" value={settings.pageMargins?.bottom ?? ''} onChange={(e) => handleMarginChange('bottom', e.target.value)} className="h-7 rounded-xl px-1 text-center text-[9px]"/>
                                <Input type="number" value={settings.pageMargins?.left ?? ''} onChange={(e) => handleMarginChange('left', e.target.value)} className="h-7 rounded-xl px-1 text-center text-[9px]"/>
                                <Input type="number" value={settings.pageMargins?.right ?? ''} onChange={(e) => handleMarginChange('right', e.target.value)} className="h-7 rounded-xl px-1 text-center text-[9px]"/>
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[8px] font-bold uppercase text-muted-foreground">Font</Label>
                            <Input type="number" value={settings.pageFontSize ?? ''} onChange={e => handleFontSizeChange('pageFontSize', e.target.value)} className="h-7 rounded-xl text-center font-bold text-xs" placeholder="11"/>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <Label className="text-[8px] font-bold uppercase text-muted-foreground">Address Font</Label>
                            <Input type="number" value={settings.addressFontSize ?? ''} onChange={e => handleFontSizeChange('addressFontSize', e.target.value)} className="h-7 rounded-xl text-xs" placeholder="10"/>
                        </div>
                        <div className="space-y-1">
                            <Label className="text-[8px] font-bold uppercase text-muted-foreground">Table Font</Label>
                            <Input type="number" value={settings.tableBodyFontSize ?? ''} onChange={e => handleFontSizeChange('tableBodyFontSize', e.target.value)} className="h-7 rounded-xl text-xs" placeholder="11"/>
                        </div>
                    </div>

                    <Separator className="bg-border/30" />
                    <ColumnAlignmentFields template={settingsWithTemplate.template} onTemplateChange={handleTemplateChange} onTemplateFontSizeChange={handleTemplateFontSizeChange} />
                 </div>
            </div>

            <div className="flex flex-row justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => window.location.reload()} className="h-8 rounded-xl font-bold text-muted-foreground px-4 text-[10px]">Discard</Button>
                <Button onClick={handleSaveChanges} disabled={isSubmitting} className="h-8 rounded-xl font-bold px-6 shadow-lg shadow-primary/10 text-[10px]">
                    {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : `Save ${enterprise}`}
                </Button>
            </div>
        </div>
    );
}


export default function SettingsPage() {
    const { firestore, user } = useFirebase();
    const { toast } = useToast();
    const [activeBankTab, setActiveBankTab] = useState<Enterprise>('Vithal');
    
    const [isBotSettingUp, setIsBotSettingUp] = useState(false);
    const [botReady, setBotBotReady] = useState(false);

    const bankAccountsQuery = useMemoFirebase(() => {
        if (!firestore || !user) return null;
        return query(collection(firestore, "companySettings", activeBankTab.toLowerCase(), "bankAccounts"), orderBy('nickname'));
    }, [firestore, user, activeBankTab]);
    const { data: bankAccounts, isLoading: isLoadingBankAccounts } = useCollection<BankAccount>(bankAccountsQuery);
    
    const [isBankAccountDialogOpen, setIsBankAccountDialogOpen] = useState(false);
    const [selectedBankAccount, setSelectedBankAccount] = useState<BankAccount | null>(null);
    const [bankAccountToDelete, setBankAccountToDelete] = useState<BankAccount | null>(null);

    
    const closeAllDialogs = useCallback(() => {
        setIsBankAccountDialogOpen(false);
        setBankAccountToDelete(null);
    }, []);

    const openBankAccountDialog = useCallback((bankAccount: BankAccount | null) => {
        setSelectedBankAccount(bankAccount);
        setIsBankAccountDialogOpen(true);
    }, []);

    const handleBankAccountFormSubmit = (formData: BankAccountFormData) => {
        if (!firestore) return;

        const bankAccountsCollectionRef = collection(firestore, "companySettings", activeBankTab.toLowerCase(), "bankAccounts");
        
        if (selectedBankAccount) { 
            const accountDocRef = doc(bankAccountsCollectionRef, selectedBankAccount.id);
            updateDocumentNonBlocking(accountDocRef, formData);
            toast({ title: "Updated", description: "Bank account saved." });
        } else { 
            addDocumentNonBlocking(bankAccountsCollectionRef, formData);
            toast({ title: "Added", description: "New account added." });
        }
        setIsBankAccountDialogOpen(false);
    };
    
    const openDeleteDialog = useCallback((bankAccount: BankAccount) => {
        setBankAccountToDelete(bankAccount);
    }, []);
    
    const handleDeleteBankAccount = () => {
        if (!firestore || !bankAccountToDelete) return;
        const accountDocRef = doc(firestore, "companySettings", activeBankTab.toLowerCase(), "bankAccounts", bankAccountToDelete.id);
        deleteDocumentNonBlocking(accountDocRef);
        toast({ title: "Deleted", description: "Account removed." });
        setBankAccountToDelete(null);
    }

    const handleInitTelegram = async () => {
        setIsBotSettingUp(true);
        try {
            const url = window.location.origin;
            const res = await setupTelegramWebhook(url);
            if (res.success) {
                setBotBotReady(true);
                toast({ title: "Bot Connected!", description: "Bot is ready." });
            }
        } catch (e: any) {
            toast({ variant: 'destructive', title: "Failed", description: e.message });
        } finally {
            setIsBotSettingUp(false);
        }
    }
    
    return (
        <AppLayout>
            <div className="flex flex-col gap-2 max-w-full overflow-x-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">
                
                <div className="space-y-0.5 px-1">
                    <h1 className="text-lg sm:text-2xl font-black tracking-tight text-foreground">Workshop Settings</h1>
                    <p className="text-[8px] sm:text-xs text-muted-foreground uppercase font-bold tracking-widest opacity-60">Configuration & Control</p>
                </div>

                <Card className="border-none shadow-lg bg-gradient-to-br from-blue-600 to-blue-800 text-white overflow-hidden relative group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none select-none">
                        <Send className="h-16 w-16 -rotate-12 pointer-events-none" />
                    </div>
                    <CardHeader className="p-3 sm:p-4 pb-3 relative z-10">
                        <div className="flex flex-row items-center justify-between gap-3">
                            <div className="space-y-1">
                                <CardTitle className="flex items-center gap-2 text-sm sm:text-lg font-black">
                                    <Send className="h-4 w-4" /> Telegram Bot Assistant
                                </CardTitle>
                                <CardDescription className="text-blue-100/80 text-[10px] sm:text-xs font-medium">
                                    Connect <a href="https://t.me/VE_ECC_bot" target="_blank" rel="noreferrer" className="underline font-bold text-white hover:text-blue-200">@VE_ECC_bot</a> for instant business queries & salary slips.
                                </CardDescription>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {botReady ? (
                                    <div className="flex items-center gap-1.5">
                                        <Badge className="bg-emerald-500 text-white border-none py-1 px-2.5 rounded-lg text-[9px] font-bold shadow-sm">
                                            <CheckCircle2 className="h-3 w-3 mr-1" /> Connected
                                        </Badge>
                                        <Button
                                            onClick={handleInitTelegram}
                                            disabled={isBotSettingUp}
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 text-white/80 hover:text-white hover:bg-white/10 rounded-lg text-[9px] px-2"
                                            title="Reconnect Webhook"
                                        >
                                            <RefreshCw className={cn("h-3 w-3", isBotSettingUp && "animate-spin")} />
                                        </Button>
                                    </div>
                                ) : (
                                    <Button
                                        onClick={handleInitTelegram}
                                        disabled={isBotSettingUp}
                                        size="sm"
                                        className="h-8 bg-white text-blue-700 hover:bg-blue-50 shadow-md rounded-xl font-bold uppercase tracking-tight text-[10px] px-4 cursor-pointer"
                                    >
                                        {isBotSettingUp ? (
                                            <>
                                                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                Connecting...
                                            </>
                                        ) : (
                                            "Connect Bot"
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-card/50 backdrop-blur-md">
                    <CardHeader className="p-3 sm:p-4 pb-1">
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-primary" />
                            <div>
                                <CardTitle className="text-sm sm:text-base font-black">Enterprise Data</CardTitle>
                                <CardDescription className="text-[8px] sm:text-xs">Document configurations.</CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 sm:p-4 pt-0">
                       <Tabs defaultValue="Vithal" className="w-full">
                            <div className="px-3 sm:px-0">
                                <TabsList className="grid w-full grid-cols-2 h-8 p-0.5 rounded-xl bg-muted/30 border">
                                    <TabsTrigger value="Vithal" className="rounded-lg font-bold text-[8px] sm:text-[10px] uppercase tracking-wide h-7">Vithal Ent.</TabsTrigger>
                                    <TabsTrigger value="RV" className="rounded-lg font-bold text-[8px] sm:text-[10px] uppercase tracking-wide h-7">RV Ent.</TabsTrigger>
                                </TabsList>
                            </div>
                            <TabsContent value="Vithal" className="pt-2 px-3 sm:px-0">
                                <SettingsForm enterprise="Vithal" />
                            </TabsContent>
                            <TabsContent value="RV" className="pt-2 px-3 sm:px-0">
                                <SettingsForm enterprise="RV" />
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>

                <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-card/50 backdrop-blur-md">
                    <CardHeader className="p-3 sm:p-4 pb-1">
                        <div className="flex flex-row items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                <CreditCard className="h-4 w-4 text-primary" />
                                <div>
                                    <CardTitle className="text-sm sm:text-base font-black">Banking</CardTitle>
                                    <CardDescription className="text-[8px] sm:text-xs">Accounts info.</CardDescription>
                                </div>
                            </div>
                            <Button onClick={() => openBankAccountDialog(null)} size="sm" className="h-7 rounded-xl px-3 font-bold text-[9px]">
                                <PlusCircle className="mr-1 h-3 w-3" /> Add
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="p-0 sm:p-4 pt-0">
                        <Tabs value={activeBankTab} onValueChange={(value) => setActiveBankTab(value as Enterprise)} className="px-3 sm:px-0">
                            <TabsList className="grid w-full grid-cols-2 h-7 p-0.5 rounded-lg bg-muted/20 border-none mb-2">
                                <TabsTrigger value="Vithal" className="rounded-md text-[8px] font-bold uppercase h-6">Vithal</TabsTrigger>
                                <TabsTrigger value="RV" className="rounded-md text-[8px] font-bold uppercase h-6">RV</TabsTrigger>
                            </TabsList>
                            
                            <div className="md:hidden space-y-1.5 pb-2">
                                {isLoadingBankAccounts ? (
                                    <div className="py-4 text-center animate-pulse text-[8px] font-bold text-muted-foreground uppercase">Syncing...</div>
                                ) : bankAccounts && bankAccounts.length > 0 ? (
                                    bankAccounts.map(account => (
                                        <div key={account.id} className="p-2 rounded-xl border bg-card/50 shadow-sm space-y-1 relative active:scale-[0.99] transition-transform">
                                            <div className="flex justify-between items-start">
                                                <div className="space-y-0.5">
                                                    <h4 className="font-black text-[10px] leading-tight text-foreground">{account.nickname}</h4>
                                                    <p className="text-[7px] font-bold text-muted-foreground uppercase">{account.bankName}</p>
                                                </div>
                                                <Badge variant="outline" className="text-[7px] py-0 h-3 font-mono border-primary/20 text-primary px-1">
                                                    {account.ifscCode}
                                                </Badge>
                                            </div>
                                            <div className="pt-1 border-t border-border/20 flex justify-between items-end">
                                                <div className="space-y-0.5">
                                                    <p className="text-[9px] font-mono font-bold tracking-tight text-primary">{account.accountNumber}</p>
                                                </div>
                                                <div className="flex gap-0.5">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-amber-500 rounded-lg" onClick={() => openBankAccountDialog(account)}>
                                                        <Pencil className="h-3 w-3" />
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive rounded-lg" onClick={() => openDeleteDialog(account)}>
                                                        <Trash2 className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="py-4 text-center border-2 border-dashed rounded-xl bg-muted/5">
                                        <p className="text-[8px] text-muted-foreground font-bold uppercase tracking-widest">Empty</p>
                                    </div>
                                )}
                            </div>

                            <div className="hidden md:block">
                                <Table>
                                    <TableHeader className="bg-muted/20">
                                        <TableRow className="border-none h-8">
                                            <TableHead className="rounded-l-lg pl-4 text-[10px]">Nickname</TableHead>
                                            <TableHead className="text-[10px]">Bank</TableHead>
                                            <TableHead className="text-[10px]">Details</TableHead>
                                            <TableHead className="text-right pr-4 rounded-r-lg text-[10px]">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isLoadingBankAccounts ? (
                                            <TableRow><TableCell colSpan={4} className="text-center py-4">...</TableCell></TableRow>
                                        ) : bankAccounts && bankAccounts.length > 0 ? (
                                            bankAccounts.map(account => (
                                                <TableRow key={account.id} className="hover:bg-muted/10 border-b border-border/30 h-10">
                                                    <TableCell className="font-bold pl-4 text-xs">{account.nickname}</TableCell>
                                                    <TableCell className="text-xs">{account.bankName}</TableCell>
                                                    <TableCell>
                                                        <div className="font-mono text-[10px] font-bold">{account.accountNumber}</div>
                                                    </TableCell>
                                                    <TableCell className="text-right pr-4">
                                                        <div className="flex justify-end gap-0.5">
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-500" onClick={() => openBankAccountDialog(account)}>
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => openDeleteDialog(account)}>
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))
                                        ) : (
                                            <TableRow><TableCell colSpan={4} className="text-center h-12 text-muted-foreground text-[10px]">No data.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={isBankAccountDialogOpen} onOpenChange={setIsBankAccountDialogOpen}>
                <DialogContent className="max-w-[95vw] sm:max-w-md rounded-3xl p-0 overflow-hidden border-none shadow-2xl">
                    <DialogHeader className="p-4 bg-primary/5 border-b border-primary/10">
                        <DialogTitle className="text-base font-black">{selectedBankAccount ? 'Edit Bank' : `New Account`}</DialogTitle>
                    </DialogHeader>
                    <div className="p-4">
                        <BankAccountForm 
                            onSubmit={handleBankAccountFormSubmit}
                            onCancel={() => setIsBankAccountDialogOpen(false)}
                            initialData={selectedBankAccount || undefined}
                            mode={selectedBankAccount ? 'edit' : 'add'}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!bankAccountToDelete} onOpenChange={(open) => !open && setBankAccountToDelete(null)}>
                <AlertDialogContent className="rounded-3xl border-none shadow-2xl p-4">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-sm font-black">Remove Bank Account?</AlertDialogTitle>
                        <AlertDialogDescription className="text-[10px] leading-relaxed">
                            Permanently delete <span className="font-bold text-foreground">"{bankAccountToDelete?.nickname}"</span>?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="mt-4 flex flex-row gap-2">
                        <AlertDialogCancel className="h-8 rounded-xl font-bold border-muted text-[10px] flex-1">Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDeleteBankAccount} className="h-8 rounded-xl font-bold bg-destructive hover:bg-destructive/90 text-[10px] flex-1">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </AppLayout>
    );
}
