
'use client';
import React, { useState, useMemo, useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import AppLayout from "@/components/app-layout";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useCollection, useFirebase, useMemoFirebase, useDoc } from '@/firebase';
import { collection, query, orderBy, doc, setDoc, writeBatch, deleteField } from 'firebase/firestore';
import { Company, Invoice, CompanySettings, PageMargin, DownloadOptions, BankAccount, InvoiceTemplate, InvoiceItem as LibInvoiceItem, DocumentSettings } from '@/lib/data';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Plus, Trash2, Pencil, PlusCircle, EllipsisVertical, Download, Eye, FileText, Settings, Folder, FilePlus2, Copy, X, Bold, Pilcrow, AlignLeft, AlignCenter, AlignRight, ChevronDown, CalendarDays } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ToWords } from 'to-words';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { generateAndDownloadInvoice, type PageSettings } from '@/lib/invoice-generator';
import { Textarea } from '@/components/ui/textarea';
import { InvoicePreview } from '@/components/invoice-preview';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuPortal } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';


const AutoHeightTextarea = React.memo(forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement);

    useEffect(() => {
        const textarea = internalRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
        }
    }, [props.value]);

    return <Textarea ref={internalRef} {...props} />;
}));
AutoHeightTextarea.displayName = 'AutoHeightTextarea';


type InvoiceItem = Omit<LibInvoiceItem, 'id'> & { key: string };
type ActiveInput = { key: string; field: 'particulars' | 'rate' } | null;
type Enterprise = 'Vithal' | 'RV';
type DiscountType = 'before_gst' | 'after_gst';

const DocumentSettingsFields = React.memo(forwardRef<HTMLDivElement, {
    settings: Partial<DocumentSettings>, 
    onSettingsChange: (field: keyof DocumentSettings, value: any) => void,
    onMarginChange: (field: keyof PageMargin, value: string) => void,
    onFontSizeChange: (field: 'pageFontSize' | 'addressFontSize' | 'tableBodyFontSize', value: string) => void,
    prefix?: string,
}>(({ settings, onSettingsChange, onMarginChange, onFontSizeChange, prefix="page" }, ref) => {
    return (
      <div className="grid gap-4" ref={ref}>
          <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor={`${prefix}Size`}>Page Size</Label>
              <Select value={settings.pageSize} onValueChange={(value) => onSettingsChange('pageSize', value)} >
                  <SelectTrigger id={`${prefix}Size`} className="col-span-2 h-8">
                      <SelectValue placeholder="Select page size" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="LETTER">Letter</SelectItem>
                      <SelectItem value="LEGAL">Legal</SelectItem>
                  </SelectContent>
              </Select>
          </div>
          <div className="grid grid-cols-3 items-start gap-4">
              <Label>Margins (cm)</Label>
              <div className="col-span-2 grid grid-cols-2 gap-2">
                  <Input type="text" inputMode="decimal" placeholder="Top" value={settings.pageMargins?.top ?? ''} onChange={(e) => onMarginChange('top', e.target.value)} className="h-8"/>
                  <Input type="text" inputMode="decimal" placeholder="Bottom" value={settings.pageMargins?.bottom ?? ''} onChange={(e) => onMarginChange('bottom', e.target.value)} className="h-8"/>
                  <Input type="text" inputMode="decimal" placeholder="Left" value={settings.pageMargins?.left ?? ''} onChange={(e) => onMarginChange('left', e.target.value)} className="h-8"/>
                  <Input type="text" inputMode="decimal" placeholder="Right" value={settings.pageMargins?.right ?? ''} onChange={(e) => onMarginChange('right', e.target.value)} className="h-8"/>
              </div>
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor={`${prefix}FontSize`}>Page Font</Label>
              <Input id={`${prefix}FontSize`} type="number" value={settings.pageFontSize ?? ''} onChange={(e) => onFontSizeChange('pageFontSize', e.target.value)} className="col-span-2 h-8" placeholder="e.g., 11"/>
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor={`${prefix}AddressFontSize`}>Address Font</Label>
              <Input id={`${prefix}AddressFontSize`} type="number" value={settings.addressFontSize ?? ''} onChange={(e) => onFontSizeChange('addressFontSize', e.target.value)} className="col-span-2 h-8" placeholder="e.g., 10"/>
          </div>
          <div className="grid grid-cols-3 items-center gap-4">
              <Label htmlFor={`${prefix}TableBodyFontSize`}>Table Font</Label>
              <Input id={`${prefix}TableBodyFontSize`} type="number" value={settings.tableBodyFontSize ?? ''} onChange={(e) => onFontSizeChange('tableBodyFontSize', e.target.value)} className="col-span-2 h-8" placeholder="e.g., 11"/>
          </div>
      </div>
    );
}));
DocumentSettingsFields.displayName = 'DocumentSettingsFields';

const ColumnAlignmentFields = React.memo(({ template, onTemplateChange, onTemplateFontSizeChange, items }: { 
    template: InvoiceTemplate, 
    onTemplateChange: (id: string, align: 'left' | 'center' | 'right') => void,
    onTemplateFontSizeChange: (id: string, size: string) => void,
    items: InvoiceItem[]
  }) => {
    const hasRateColumn = useMemo(() => items.some(item => item.rate && String(item.rate).trim() !== ''), [items]);
    const columnsToShow = useMemo(() => template.columns.filter(col => hasRateColumn || col.id !== 'rate'), [template.columns, hasRateColumn]);
    
    return (
        <div className="space-y-4">
             <h4 className="font-semibold text-foreground">Column Styles</h4>
             <div className="space-y-4">
                {columnsToShow.map(col => (
                    <div key={col.id} className="grid gap-2">
                        <Label>{col.label}</Label>
                        <div className="flex items-center gap-2">
                            <div className="flex-1 p-1 bg-muted rounded-md flex items-center justify-between">
                                {(['left', 'center', 'right'] as const).map(align => (
                                    <Button 
                                        key={align} 
                                        type="button" 
                                        variant={col.align === align ? 'default' : 'ghost'} 
                                        size="icon" 
                                        className="h-7 w-7 flex-1"
                                        onClick={() => onTemplateChange(col.id, align)}
                                    >
                                        {align === 'left' && <AlignLeft className="h-4 w-4" />}
                                        {align === 'center' && <AlignCenter className="h-4 w-4" />}
                                        {align === 'right' && <AlignRight className="h-4 w-4" />}
                                    </Button>
                                ))}
                            </div>
                            <Input 
                                type="number" 
                                placeholder="Size" 
                                value={col.fontSize ?? ''} 
                                onChange={(e) => onTemplateFontSizeChange(col.id, e.target.value)}
                                className="h-9 w-20"
                            />
                        </div>
                    </div>
                ))}
             </div>
        </div>
    );
});
ColumnAlignmentFields.displayName = 'ColumnAlignmentFields';


const DownloadOptionsFields = React.memo(({ options, setOptions }: { options: DownloadOptions, setOptions: React.Dispatch<React.SetStateAction<DownloadOptions>> }) => {
    return (
        <div className="space-y-6">
            <div className="space-y-4">
                <h4 className="font-semibold text-foreground">My Company Details</h4>
                <div className="flex items-center space-x-2">
                    <Checkbox id="myGstin" checked={options.myCompany.showGstin} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, myCompany: {...prev.myCompany, showGstin: !!checked} }))} />
                    <Label htmlFor="myGstin">Show GSTIN</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="myPan" checked={options.myCompany.showPan} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, myCompany: {...prev.myCompany, showPan: !!checked} }))} />
                    <Label htmlFor="myPan">Show PAN Number</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="myBank" checked={options.myCompany.showBankDetails} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, myCompany: {...prev.myCompany, showBankDetails: !!checked} }))} />
                    <Label htmlFor="myBank">Show Bank Details</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="mySac" checked={options.myCompany.showSacCode} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, myCompany: {...prev.myCompany, showSacCode: !!checked} }))} />
                    <Label htmlFor="mySac">Show SAC Code</Label>
                </div>
                <div className="flex items-center space-x-2">
                    <Checkbox id="myServiceTax" checked={options.myCompany.showServiceTaxCode} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, myCompany: {...prev.myCompany, showServiceTaxCode: !!checked} }))} />
                    <Label htmlFor="myServiceTax">Show Service Tax Code</Label>
                </div>
            </div>
            <Separator />
            <div className="space-y-4">
                <h4 className="font-semibold text-foreground">Client Company Details</h4>
                <div className="flex items-center space-x-2">
                    <Checkbox id="clientGstin" checked={options.clientCompany.showGstin} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, clientCompany: {...prev.clientCompany, showGstin: !!checked} }))} />
                    <Label htmlFor="clientGstin">Show GSTIN</Label>
                </div>
            </div>
            <Separator />
            <div className="space-y-4">
                <h4 className="font-semibold text-foreground">Filename Options</h4>
                <div className="flex items-center space-x-2">
                    <Checkbox id="includeSite" checked={options.includeSiteInFilename} onCheckedChange={(checked) => setOptions(prev => ({ ...prev, includeSiteInFilename: !!checked }))} />
                    <Label htmlFor="includeSite">Include Site in Filename</Label>
                </div>
            </div>
        </div>
    );
});
DownloadOptionsFields.displayName = 'DownloadOptionsFields';

const InvoiceActions = ({
  invoice,
  openPreviewDialog,
  handleDownloadWord,
  openFormDialog,
  openDuplicateDialog,
  openDeleteDialog
}: {
  invoice: Invoice
  openPreviewDialog: (invoice: Invoice) => void
  handleDownloadWord: (invoice: Invoice) => Promise<void>
  openFormDialog: (invoice: Invoice | null) => void
  openDuplicateDialog: (invoice: Invoice) => void
  openDeleteDialog: (invoice: Invoice) => void
}) => (
  <div
    className="relative z-50 shrink-0"
    onClick={(e) => e.stopPropagation()}
  >
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:inline-flex h-8 w-8 p-0 cursor-pointer"
          type="button"
        >
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuPortal>
        <DropdownMenuContent
          className="w-40 z-[200]"
          align="end"
          sideOffset={6}
        >
          <DropdownMenuItem onClick={() => openPreviewDialog(invoice)}>
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => handleDownloadWord(invoice)}>
            <Download className="mr-2 h-4 w-4" />
            Download
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => openFormDialog(invoice)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>

          <DropdownMenuItem onClick={() => openDuplicateDialog(invoice)}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Duplicate
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => openDeleteDialog(invoice)}
            className="text-destructive"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenuPortal>
    </DropdownMenu>
  </div>
);

const InvoiceList = ({ 
    invoices, 
    isLoadingInvoices, 
    openYearAccordions, 
    setOpenYearAccordions, 
    openMonthAccordions, 
    setOpenMonthAccordions, 
    selectedInvoices, 
    handleSelectInvoice, 
    getCompanyDisplay,
    setActiveInvoiceForAction,
    ...actionProps
}: {
    invoices: any[];
    isLoadingInvoices: boolean;
    openYearAccordions: string[];
    setOpenYearAccordions: (value: string[]) => void;
    openMonthAccordions: string[];
    setOpenMonthAccordions: (value: string[]) => void;
    selectedInvoices: string[];
    handleSelectInvoice: (invoiceId: string, checked: boolean) => void;
    getCompanyDisplay: (invoice: Invoice) => string;
    setActiveInvoiceForAction: (invoice: Invoice) => void;
} & Omit<React.ComponentProps<typeof InvoiceActions>, 'invoice'>) => (
  <div className="w-full max-w-full overflow-hidden">
    {isLoadingInvoices ? (
        <div className="text-center py-10 text-muted-foreground">Loading invoices...</div>
    ) : invoices.length > 0 ? (
        <Accordion type="multiple" className="w-full" value={openYearAccordions} onValueChange={setOpenYearAccordions}>
            {invoices.map((year: any) => (
                 <AccordionItem value={`year-${year.key}`} key={year.key} className="mb-2 border-0">
                    <AccordionTrigger className="px-3 sm:px-4 py-3 bg-muted/50 hover:bg-muted/80 rounded-md text-xs sm:text-sm font-medium hover:no-underline">
                        <div className="flex items-center gap-2 sm:gap-3">
                          <Folder className="h-4 w-4 sm:h-5 w-5 text-amber-500 fill-amber-500/20" />
                          <span>{year.label}</span>
                        </div>
                    </AccordionTrigger>
                    <AccordionContent className="pt-2 pl-0 md:pl-4">
                         <Accordion type="multiple" className="w-full" value={openMonthAccordions} onValueChange={setOpenMonthAccordions}>
                            {year.months.map((month: any) => {
                                return (
                                <AccordionItem value={`month-${month.key}`} key={month.key} className="border-l-0 md:border-l-2 border-dashed border-border pl-0 md:pl-4 py-1">
                                    <AccordionTrigger className="flex items-center justify-between flex-1 text-[10px] sm:text-xs font-medium hover:no-underline p-2 sm:p-3 bg-muted/50 hover:bg-muted/80 rounded-md">
                                         <div className="flex items-center gap-2">
                                              <Folder className="h-3.5 w-3.5 sm:h-4 w-4 text-amber-500 fill-amber-500/20" />
                                              <span>{month.label}</span>
                                         </div>
                                    </AccordionTrigger>
                                    <AccordionContent className="pt-2">
                                        {/* Mobile Optimized Compact List */}
                                        <div className="md:hidden w-full max-w-full overflow-hidden">
                                            <div className="space-y-2 p-1">
                                            {month.invoices.map((invoice: Invoice) => {
                                                const isSelected = selectedInvoices.includes(invoice.id);
                                                const selectionIndex = isSelected ? selectedInvoices.indexOf(invoice.id) + 1 : 0;
                                                const isVithal = invoice.enterprise === 'Vithal';
                                                
                                                const rawName = getCompanyDisplay(invoice);
                                                const companyName = rawName.length > 25 ? rawName.substring(0, 25) + "..." : rawName;
                                                
                                                return (
                                                    <div 
                                                        key={invoice.id} 
                                                        onClick={() => actionProps.openPreviewDialog(invoice)}
                                                        onContextMenu={(e) => {
                                                            e.preventDefault();
                                                            if ('vibrate' in navigator) navigator.vibrate(50);
                                                            setActiveInvoiceForAction(invoice);
                                                        }}
                                                        className={cn(
                                                            "relative group border rounded-xl p-2 bg-card active:scale-[0.98] transition-all shadow-sm select-none border-l-4 w-full max-w-full overflow-hidden",
                                                            isVithal ? "border-l-emerald-500" : "border-l-blue-600",
                                                            isSelected && "ring-2 ring-primary ring-offset-2"
                                                        )}
                                                    >
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div
                                                                id={`select-inv-mob-${invoice.id}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleSelectInvoice(invoice.id, !isSelected);
                                                                }}
                                                                className={cn(
                                                                    "h-5 w-5 shrink-0 rounded-md border-2 border-primary flex items-center justify-center cursor-pointer transition-colors",
                                                                    isSelected ? "bg-primary text-primary-foreground" : "bg-background"
                                                                )}
                                                                role="checkbox"
                                                                aria-checked={isSelected}
                                                            >
                                                                {isSelected && (
                                                                    <span className="text-[10px] font-black leading-none">{selectionIndex}</span>
                                                                )}
                                                            </div>
                                                            
                                                            <div className="flex-1 min-w-0">
                                                                <div className="flex justify-between items-start gap-2">
                                                                    <div className="min-w-0 flex-1">
                                                                        <div className="text-[10px] font-black tracking-tight text-foreground truncate uppercase opacity-70 flex items-center gap-1.5 h-4">
                                                                            {invoice.billNo}-{invoice.billNoSuffix || 'MHE'}
                                                                            {invoice.isDuplicate && (
                                                                                <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 text-[7px] py-0 px-1 rounded-sm h-3.5 uppercase font-black">Duplicate</Badge>
                                                                            )}
                                                                        </div>
                                                                        <p className="text-xs font-bold text-foreground truncate leading-tight">
                                                                            {companyName}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
                                                                        <p className="text-xs font-black text-primary">
                                                                            {invoice.grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                                                                        </p>
                                                                        <p className="text-[9px] font-medium text-muted-foreground">
                                                                            Net: {invoice.netTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                                
                                                                <div className="mt-1 flex items-center justify-between border-t border-border/30 pt-1">
                                                                    <div className="flex items-center gap-3 text-[9px] font-medium text-muted-foreground">
                                                                        <span className="flex items-center gap-1">
                                                                            <CalendarDays className="h-2.5 w-2.5" />
                                                                            {format(parseISO(invoice.billDate), 'dd MMM')}
                                                                        </span>
                                                                    </div>
                                                                    <div className={cn(
                                                                        "px-1 py-0.5 rounded-[4px] text-[7px] font-black uppercase tracking-widest",
                                                                        isVithal ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-700"
                                                                    )}>
                                                                        {invoice.enterprise}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                            </div>
                                        </div>
                                        {/* Desktop Table View */}
                                        <Table className="hidden md:table">
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="w-12 px-4"></TableHead>
                                                    <TableHead>Bill No.</TableHead>
                                                    <TableHead>Company</TableHead>
                                                    <TableHead>Bill Date</TableHead>
                                                    <TableHead className="text-right">Amount</TableHead>
                                                    <TableHead className="w-[100px] text-right"><span className="sr-only">Actions</span></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {month.invoices.map((invoice: Invoice) => {
                                                    const isSelected = selectedInvoices.includes(invoice.id);
                                                    const selectionIndex = isSelected ? selectedInvoices.indexOf(invoice.id) + 1 : 0;
                                                    return (
                                                        <TableRow key={invoice.id} data-state={isSelected ? "selected" : ""}>
                                                            <TableCell className="px-4 py-2">
                                                                <div 
                                                                  id={`select-inv-desk-${invoice.id}`}
                                                                  onClick={(e) => {
                                                                      e.stopPropagation();
                                                                      handleSelectInvoice(invoice.id, !isSelected);
                                                                  }}
                                                                  className={cn(
                                                                      "h-4 w-4 rounded-sm border border-primary flex items-center justify-center cursor-pointer ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                                                      isSelected && "bg-primary text-primary-foreground"
                                                                  )}
                                                                  aria-label={`Select invoice ${invoice.billNo}`}
                                                                  role="checkbox"
                                                                  aria-checked={isSelected}
                                                                >
                                                                    {isSelected && (
                                                                        <span className="text-[10px] font-bold leading-none">{selectionIndex}</span>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell className="font-medium cursor-pointer py-2" onClick={() => actionProps.openPreviewDialog(invoice)}>
                                                                <div className="flex items-center gap-2">
                                                                    {invoice.billNo}-{invoice.billNoSuffix || 'MHE'}
                                                                    {invoice.isDuplicate && (
                                                                        <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 text-[10px] py-0 px-1 uppercase font-bold">Duplicate</Badge>
                                                                    )}
                                                                </div>
                                                            </TableCell>
                                                            <TableCell onClick={() => actionProps.openPreviewDialog(invoice)} className="cursor-pointer py-2">{getCompanyDisplay(invoice)}</TableCell>
                                                            <TableCell onClick={() => actionProps.openPreviewDialog(invoice)} className="cursor-pointer py-2">{format(parseISO(invoice.billDate), 'dd MMM, yyyy')}</TableCell>
                                                            <TableCell className="text-right cursor-pointer py-2" onClick={() => actionProps.openPreviewDialog(invoice)}>{invoice.grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</TableCell>
                                                            <TableCell className="text-right py-2">
                                                                <InvoiceActions invoice={invoice} {...actionProps} />
                                                            </TableCell>
                                                        </TableRow>
                                                    );
                                                })}
                                            </TableBody>
                                        </Table>
                                    </AccordionContent>
                                </AccordionItem>
                                )
                            })}
                        </Accordion>
                    </AccordionContent>
                </AccordionItem>
            ))}
        </Accordion>
    ) : (
        <div className="text-center py-10 text-muted-foreground">
            No invoices found for this enterprise. Click "Add Invoice" to get started.
        </div>
    )}
  </div>
);

export default function BillingPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<Enterprise>('Vithal');
  const [formEnterprise, setFormEnterprise] = useState<Enterprise>(activeTab);
  
  const toMonthString = (date: Date) => {
    return format(date, 'yyyy-MM');
  }
  
  const defaultDocumentSettings: DocumentSettings = {
    pageSize: 'A4',
    pageOrientation: 'portrait',
    pageMargins: { top: 1.27, right: 1.27, bottom: 1.27, left: 1.27 },
    pageFontSize: 11,
    addressFontSize: 10,
    tableBodyFontSize: 11,
  };
  
  const defaultDownloadOptions: DownloadOptions = {
      myCompany: { showGstin: true, showPan: true, showBankDetails: true, showSacCode: true, showServiceTaxCode: true },
      clientCompany: { showGstin: true },
      includeSiteInFilename: false,
  };

  const defaultTemplate: InvoiceTemplate = {
      columns: [
          { id: 'sr_no', label: 'Sr. No', align: 'center' },
          { id: 'particulars', label: 'Particulars', align: 'left' },
          { id: 'rate', label: 'Rate', align: 'right' },
          { id: 'amount', label: 'Amount', align: 'right' },
      ],
  };
  
  const initialFormState = {
    companyId: '',
    billDate: format(new Date(), 'yyyy-MM-dd'),
    billingMonth: toMonthString(new Date()),
    poNumber: 'AGREEMENT',
    site: '',
    items: [{ key: `item-${Date.now()}`, particulars: '', rate: '', amount: 0 }],
    selectedBankAccountId: 'no_bank',
    discount: '',
    discountType: 'after_gst' as DiscountType,
    advanceReceived: '',
    tdsPercentage: '',
  };

  const [companyId, setCompanyId] = useState<string>('');
  const [billDate, setBillDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [billingMonth, setBillingMonth] = useState<string>(toMonthString(new Date()));
  const [poNumber, setPoNumber] = useState('AGREEMENT');
  const [site, setSite] = useState('');
  const [items, setItems] = useState<InvoiceItem[]>(initialFormState.items);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('no_bank');
  const [activeInput, setActiveInput] = useState<ActiveInput>(null);
  const [discount, setDiscount] = useState<string>('');
  const [discountType, setDiscountType] = useState<DiscountType>('after_gst');
  const [advanceReceived, setAdvanceReceived] = useState<string>('');
  const [tdsPercentage, setTdsPercentage] = useState<string>('');

    
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [invoicePageSettings, setInvoicePageSettings] = useState<DocumentSettings>(defaultDocumentSettings);
  const [formDownloadOptions, setFormDownloadOptions] = useState<DownloadOptions>(defaultDownloadOptions);
  const [formTemplate, setFormTemplate] = useState<InvoiceTemplate>(defaultTemplate);

  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [invoiceToDuplicate, setInvoiceToDuplicate] = useState<Invoice | null>(null);
  const [newBillDateForDuplicate, setNewBillDateForDuplicate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [isBulkDuplicateDialogOpen, setIsBulkDuplicateDialogOpen] = useState(false);
  const [newBillDateForBulk, setNewBillDateForBulk] = useState<string>(format(new Date(), 'yyyy-MM-dd'));


  const [isFormDialogOpen, setIsFormDialogOpen] = useState(false);
  const [billNoOverride, setBillNoOverride] = useState<number | null>(null);
  
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [invoiceForPreview, setInvoiceForPreview] = useState<Invoice | null>(null);
  
  const [isSettingsPopoverOpen, setIsSettingsPopoverOpen] = useState(false);
  const [globalPageSettings, setGlobalPageSettings] = useState<Partial<CompanySettings> | any>(defaultDocumentSettings);
  const [isSubmittingSettings, setIsSubmittingSettings] = useState(false);
  
  const [openYearAccordions, setOpenYearAccordions] = useState<string[]>([]);
  const [openMonthAccordions, setOpenMonthAccordions] = useState<string[]>([]);

  const [activeInvoiceForAction, setActiveInvoiceForAction] = useState<Invoice | null>(null);


  // Queries
  const companiesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'companies'), orderBy('name')) : null, [firestore, user]);
  const allInvoicesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'invoices'), orderBy('billNo', 'asc')) : null, [firestore, user]);
  
  const vithalSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'vithal') : null, [firestore, user]);
  const rvSettingsRef = useMemoFirebase(() => firestore && user ? doc(firestore, 'companySettings', 'rv') : null, [firestore, user]);

  const vithalBankAccountsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'companySettings', 'vithal', 'bankAccounts'), orderBy('nickname')) : null, [firestore, user]);
  const rvBankAccountsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'companySettings', 'rv', 'bankAccounts'), orderBy('nickname')) : null, [firestore, user]);


  // Data
  const { data: companies, isLoading: isLoadingCompanies } = useCollection<Company>(companiesQuery);
  const { data: allInvoices, isLoading: isLoadingInvoices } = useCollection<Invoice>(allInvoicesQuery);
  
  const { data: vithalCompanyDetails, isLoading: isLoadingVinalSettings } = useDoc<CompanySettings>(vithalSettingsRef);
  const { data: rvCompanyDetails, isLoading: isLoadingRvSettings } = useDoc<CompanySettings>(rvSettingsRef);

  const { data: vithalBankAccounts, isLoading: isLoadingVithalBanks } = useCollection<BankAccount>(vithalBankAccountsQuery);
  const { data: rvBankAccounts, isLoading: isLoadingRvBanks } = useCollection<BankAccount>(rvBankAccountsQuery);
  const isLoadingBankAccounts = isLoadingVithalBanks || isLoadingRvBanks;
  
  const myCompanyDetails = activeTab === 'Vithal' ? vithalCompanyDetails : rvCompanyDetails;


  useEffect(() => {
    if (myCompanyDetails) {
        setGlobalPageSettings(myCompanyDetails);
    }
  }, [myCompanyDetails]);

  // AI Voice Command Listener
  useEffect(() => {
    const handleVoiceFill = (event: any) => {
        const { intent, data } = event.detail;
        if (intent === 'invoice') {
            openFormDialog(null);
            if (data.companyName) {
                const matched = companies?.find(c => c.name.toLowerCase().includes(data.companyName.toLowerCase()));
                if (matched) setCompanyId(matched.id);
            }
            if (data.amount) {
                setItems([{ key: `item-${Date.now()}`, particulars: 'Service Charge', rate: '', amount: data.amount }]);
            }
            if (data.billingMonth) {
                setBillingMonth(data.billingMonth);
            }
        }
    };
    window.addEventListener('ai-form-fill', handleVoiceFill);
    return () => window.removeEventListener('ai-form-fill', handleVoiceFill);
  }, [companies, openFormDialog]);
  
  const handleDelayedAction = (action: () => void) => {
    setTimeout(action, 100);
  };
  
  const liveDefaultPageSettings = useMemo((): DocumentSettings => {
    if (!myCompanyDetails) return defaultDocumentSettings;
    return {
        pageSize: myCompanyDetails.pageSize || defaultDocumentSettings.pageSize,
        pageOrientation: myCompanyDetails.pageOrientation || defaultDocumentSettings.pageOrientation,
        pageMargins: myCompanyDetails.pageMargins || defaultDocumentSettings.pageMargins,
        pageFontSize: myCompanyDetails.pageFontSize || defaultDocumentSettings.pageFontSize,
        addressFontSize: myCompanyDetails.addressFontSize || defaultDocumentSettings.addressFontSize,
        tableBodyFontSize: myCompanyDetails.tableBodyFontSize || defaultDocumentSettings.tableBodyFontSize,
    }
  }, [myCompanyDetails]);
  
  const liveDefaultTemplate = useMemo((): InvoiceTemplate => {
      return myCompanyDetails?.template || defaultTemplate;
  }, [myCompanyDetails]);

  const resetForm = useCallback(() => {
      setCompanyId(initialFormState.companyId);
      setBillDate(initialFormState.billDate);
      setBillingMonth(initialFormState.billingMonth);
      setPoNumber(initialFormState.poNumber);
      setSite(initialFormState.site);
      setItems(initialFormState.items);
      setSelectedBankAccountId(initialFormState.selectedBankAccountId);
      setDiscount(initialFormState.discount);
      setDiscountType(initialFormState.discountType);
      setAdvanceReceived(initialFormState.advanceReceived);
      setTdsPercentage(initialFormState.tdsPercentage);
      setEditingInvoice(null);
      setInvoicePageSettings(liveDefaultPageSettings);
      setFormDownloadOptions(defaultDownloadOptions);
      setFormTemplate(liveDefaultTemplate);
  }, [liveDefaultPageSettings, liveDefaultTemplate]);

  const openFormDialog = useCallback((invoice: Invoice | null, billNoToFill?: number) => {
    if (invoice) {
      setEditingInvoice(invoice);
      setFormEnterprise(invoice.enterprise);
      setCompanyId(invoice.companyId);
      setBillDate(invoice.billDate);
      setBillingMonth(invoice.billingMonth || format(parseISO(invoice.billDate), 'yyyy-MM'));
      setPoNumber(invoice.poNumber || 'AGREEMENT');
      setSite(invoice.site || '');
      setItems(invoice.items.map((item, index) => ({ ...item, key: `item-${Date.now()}-${index}` })));
      setSelectedBankAccountId(invoice.selectedBankAccount?.id || 'no_bank');
      setDiscount(String(invoice.discount || ''));
      setDiscountType(invoice.discountType || 'after_gst');
      setAdvanceReceived(String(invoice.advanceReceived || ''));
      setTdsPercentage(String(invoice.tdsPercentage || ''));
      setInvoicePageSettings({
          pageSize: invoice.documentSettings?.pageSize || liveDefaultPageSettings.pageSize,
          pageOrientation: invoice.documentSettings?.pageOrientation || liveDefaultPageSettings.pageOrientation,
          pageMargins: invoice.documentSettings?.pageMargins || liveDefaultPageSettings.pageMargins,
          pageFontSize: invoice.documentSettings?.pageFontSize || liveDefaultPageSettings.pageFontSize,
          addressFontSize: invoice.addressFontSize || liveDefaultPageSettings.addressFontSize,
          tableBodyFontSize: invoice.tableBodyFontSize || liveDefaultPageSettings.tableBodyFontSize,
      });
      setFormDownloadOptions(invoice.downloadOptions || defaultDownloadOptions);
      setFormTemplate(invoice.template || liveDefaultTemplate);
      setBillNoOverride(null);
    } else {
      resetForm();
      setFormEnterprise(activeTab);
      if (billNoToFill) {
          setBillNoOverride(billNoToFill);
      } else {
          setBillNoOverride(null);
      }
    }
    handleDelayedAction(() => setIsFormDialogOpen(true));
  }, [ activeTab, liveDefaultPageSettings, liveDefaultTemplate, resetForm ]);


  const openPreviewDialog = useCallback((invoice: Invoice) => {
    setInvoiceForPreview(invoice);
    handleDelayedAction(() => setIsPreviewOpen(true));
  }, []);

  const openDeleteDialog = useCallback((invoice: Invoice) => {
    handleDelayedAction(() => setInvoiceToDelete(invoice));
  }, []);

  const openDuplicateDialog = useCallback((invoice: Invoice) => {
    setNewBillDateForDuplicate(format(new Date(), 'yyyy-MM-dd'));
    handleDelayedAction(() => setInvoiceToDuplicate(invoice));
  }, []);
  
  const openBulkDuplicateDialog = useCallback(() => {
    handleDelayedAction(() => setIsBulkDuplicateDialogOpen(true));
  }, []);


  const selectedCompanyForNewInvoice = useMemo(() => companies?.find(c => c.id === companyId), [companies, companyId]);

  
  const handleDownloadWord = async (invoice: Invoice) => {
    if (!invoice.clientCompanyDetails) {
      toast({ variant: 'destructive', title: 'Error', description: 'Could not find client company details for this invoice.' });
      return;
    }
    if (!invoice.myCompanyDetails) {
      toast({ variant: 'destructive', title: 'Error', description: 'Your company details were not saved with this invoice.' });
      return;
    }
    
    const pageSettingsToUse: PageSettings = {
        size: invoice.documentSettings?.pageSize || liveDefaultPageSettings.pageSize || 'A4',
        orientation: invoice.documentSettings?.pageOrientation || liveDefaultPageSettings.pageOrientation || 'portrait',
        pageMargins: invoice.documentSettings?.pageMargins || liveDefaultPageSettings.pageMargins || { top: 1.27, right: 1.27, bottom: 1.27, left: 1.27 },
        pageFontSize: invoice.documentSettings?.pageFontSize || liveDefaultPageSettings.pageFontSize,
        addressFontSize: invoice.addressFontSize || liveDefaultPageSettings.addressFontSize,
        tableBodyFontSize: invoice.tableBodyFontSize || liveDefaultPageSettings.tableBodyFontSize,
    }

    try {
        await generateAndDownloadInvoice(invoice, invoice.clientCompanyDetails, invoice.myCompanyDetails, pageSettingsToUse, invoice.template, invoice.downloadOptions);
    } catch (e) {
        toast({
            variant: 'destructive',
            title: 'Download Error',
            description: 'Could not generate Word document.',
        });
        console.error(e);
    }
  };

  const handleBulkDownload = async () => {
    if (selectedInvoices.length === 0 || !allInvoices) {
      toast({ variant: "destructive", title: "No Invoices Selected", description: "Please select invoices to download." });
      return;
    }

    const invoicesToDownload = selectedInvoices
      .map(id => allInvoices.find(inv => inv.id === id))
      .filter((inv): inv is Invoice => !!inv);

    toast({ title: "Download Started", description: `Downloading ${invoicesToDownload.length} invoices.` });

    for (const invoice of invoicesToDownload) {
      try {
        await handleDownloadWord(invoice);
        // Add a small delay between downloads to avoid browser issues
        await new Promise(resolve => setTimeout(resolve, 300));
      } catch (error) {
        toast({ variant: "destructive", title: `Error Downloading Bill No. ${invoice.billNo}`, description: "This invoice might be missing required details." });
      }
    }
    
    setSelectedInvoices([]);
  };

  const filteredInvoices = useMemo(() => {
    return allInvoices?.filter(inv => inv.enterprise === activeTab) || [];
  }, [allInvoices, activeTab]);

  const nextBillNumber = useMemo(() => {
    if (isLoadingInvoices) return 1;

    const targetSettings = activeTab === 'Vithal' ? vithalCompanyDetails : rvCompanyDetails;
    
    if (!filteredInvoices || filteredInvoices.length === 0) {
        return targetSettings?.nextBillNo || 1;
    }

    const maxBillNo = Math.max(0, ...filteredInvoices.map(inv => inv.billNo));
    return maxBillNo + 1;
  }, [filteredInvoices, activeTab, vithalCompanyDetails, rvCompanyDetails, isLoadingInvoices]);
  
  const nextBillNumberForForm = useMemo(() => {
    if (!allInvoices || isLoadingVinalSettings || isLoadingRvSettings) return 1;

    const targetInvoices = allInvoices.filter(inv => inv.enterprise === formEnterprise);
    const targetSettings = formEnterprise === 'Vithal' ? vithalCompanyDetails : rvCompanyDetails;

    if (targetInvoices.length === 0) {
        return targetSettings?.nextBillNo || 1;
    }

    const maxBillNo = Math.max(0, ...targetInvoices.map(inv => inv.billNo));
    return maxBillNo + 1;
  }, [formEnterprise, allInvoices, vithalCompanyDetails, rvCompanyDetails, isLoadingVinalSettings, isLoadingRvSettings]);

  const skippedBillNumbers = useMemo(() => {
    if (!filteredInvoices || filteredInvoices.length < 2) return [];

    const billNumbers = filteredInvoices.map(inv => inv.billNo).sort((a, b) => a - b);
    if (billNumbers.length === 0) return [];

    const min = billNumbers[0];
    const max = billNumbers[billNumbers.length - 1];
    const skipped: number[] = [];
    const numberSet = new Set(billNumbers);

    for (let i = min; i <= max; i++) {
      if (!numberSet.has(i)) {
        skipped.push(i);
      }
    }
    
    return skipped;
  }, [filteredInvoices]);


  const organizedInvoices = useMemo(() => {
    if (!filteredInvoices) return [];

    const getFinancialYear = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth(); // 0-11
      // Financial year starts in April (month 3)
      return month >= 3 ? year : year - 1;
    };

    const groupedByYear = filteredInvoices.reduce((acc, invoice) => {
      const dateForGrouping = invoice.billingMonth ? parseISO(`${invoice.billingMonth}-01`) : parseISO(invoice.billDate);
      const financialYearStart = getFinancialYear(dateForGrouping);
      const yearKey = `${financialYearStart}-${financialYearStart + 1}`;
      
      if (!acc[yearKey]) {
        acc[yearKey] = [];
      }
      acc[yearKey].push(invoice);
      return acc;
    }, {} as Record<string, Invoice[]>);
    
    const sortedYearKeys = Object.keys(groupedByYear).sort((a, b) => a.localeCompare(b));

    return sortedYearKeys.map((yearKey, index) => {
      const yearInvoices = groupedByYear[yearKey];
      const [startYear] = yearKey.split('-').map(Number);
      const endYear = startYear + 1;

      const minBill = Math.min(...yearInvoices.map(inv => inv.billNo));
      const maxBill = Math.max(...yearInvoices.map(inv => inv.billNo));
      
      const groupedByMonth = yearInvoices.reduce((acc, invoice) => {
        const monthKey = invoice.billingMonth || format(parseISO(invoice.billDate), 'yyyy-MM');
        if (!acc[monthKey]) {
          acc[monthKey] = [];
        }
        acc[monthKey].push(invoice);
        return acc;
      }, {} as Record<string, Invoice[]>);
      
      const months = Object.entries(groupedByMonth).map(([monthKey, monthInvoices]) => {
        const monthMinBill = Math.min(...monthInvoices.map(inv => inv.billNo));
        const monthMaxBill = Math.max(...monthInvoices.map(inv => inv.billNo));
        const monthDate = parseISO(`${monthKey}-01`);
        
        // Sort invoices within the month by bill number ascending
        const sortedMonthInvoices = monthInvoices.sort((a,b) => a.billNo - b.billNo);

        return {
          key: monthKey,
          label: `${format(monthDate, 'MM-MMM yyyy').toUpperCase()} (BILL NO-${monthMinBill}-${monthMaxBill})`,
          invoices: sortedMonthInvoices,
        };
      }).sort((a, b) => a.key.localeCompare(b.key));

      return {
        key: yearKey,
        label: `${index + 1}-April ${startYear}-March ${endYear} (Bill-${minBill} to ${maxBill})`,
        months: months,
      };
    });

  }, [filteredInvoices]);


  const calculations = useMemo(() => {
    const netTotal = items.reduce((acc, item) => acc + (Number(item.amount) || 0), 0);
    const discountAmount = Number(String(discount).replace(/,/g, '')) || 0;
    const advanceAmount = Number(String(advanceReceived).replace(/,/g, '')) || 0;

    let taxableAmount = netTotal;
    if (discountType === 'before_gst' && discountAmount > 0) {
        taxableAmount = netTotal - discountAmount;
    }

    const cgst = taxableAmount * 0.09;
    const sgst = taxableAmount * 0.09;

    const totalBeforeFinalDiscount = taxableAmount + cgst + sgst;

    let finalGrandTotal = totalBeforeFinalDiscount;
    if (discountType === 'after_gst' && discountAmount > 0) {
        finalGrandTotal = totalBeforeFinalDiscount - discountAmount;
    }
    
    const grandTotal = Math.round(finalGrandTotal);
    const balanceDue = grandTotal - advanceAmount;

    return { netTotal, taxableAmount, cgst, sgst, grandTotal, balanceDue, discountAmount, advanceAmount };
  }, [items, discount, discountType, advanceReceived]);
  
  const toWords = new ToWords({
    localeCode: 'en-IN',
    converterOptions: {
      currency: true,
      ignoreDecimal: true,
      ignoreZeroCurrency: false,
    }
  });

  const amountInWords = useMemo(() => {
    return toWords.convert(calculations.grandTotal).toUpperCase();
  },[calculations.grandTotal]);

  const handleAddItem = () => {
    setItems([...items, { key: `item-${Date.now()}`, particulars: '', rate: '', amount: 0 }]);
  };

  const handleRemoveItem = (key: string) => {
    const newItems = items.filter((item) => item.key !== key);
    setItems(newItems);
  };

  const handleItemChange = (key: string, field: keyof Omit<InvoiceItem, 'key'>, value: string | number) => {
    const newItems = items.map(item => {
        if(item.key === key) {
            let parsedValue;
            if (field === 'amount') {
                const numericString = String(value).replace(/,/g, '');
                parsedValue = parseFloat(numericString) || 0;
            } else {
                parsedValue = value;
            }
            return { ...item, [field]: parsedValue };
        }
        return item;
    });
    setItems(newItems);
  };

  const applyMarkdown = (markdown: 'bold' | 'size', size?: number) => {
    if (!activeInput) {
        toast({ title: "Select item first", description: "Click inside an item field to apply styling." });
        return;
    };

    const { key, field } = activeInput;
    const textarea = document.getElementById(`${field}-${key}`) as HTMLTextAreaElement;
    if (!textarea) return;
    
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selectedText = value.substring(start, end);

    let snippet = "";
    let cursorOffset = 0;
    let finalSelectionLength = 0;

    if (markdown === 'bold') {
        if (selectedText) {
            snippet = `**${selectedText}**`;
            finalSelectionLength = snippet.length;
        } else {
            snippet = "****";
            cursorOffset = 2;
        }
    } else if (markdown === 'size' && size) {
        if (selectedText) {
            snippet = `<s:${size}>${selectedText}</s:${size}>`;
            finalSelectionLength = snippet.length;
        } else {
            snippet = `<s:${size}></s:${size}>`;
            cursorOffset = 5 + String(size).length;
        }
    }

    const newText = value.substring(0, start) + snippet + value.substring(end);
    handleItemChange(key, field, newText);
    
    setTimeout(() => {
        const updatedTextarea = document.getElementById(`${field}-${key}`) as HTMLTextAreaElement;
        if (updatedTextarea) {
            updatedTextarea.focus();
            if (selectedText) {
                updatedTextarea.setSelectionRange(start, start + finalSelectionLength);
            } else {
                updatedTextarea.setSelectionRange(start + cursorOffset, start + cursorOffset);
            }
        }
    }, 50);
  };
  
  const handleFormSubmit = async () => {
    if (!companyId || !billDate || !billingMonth || items.some(i => !i.particulars)) {
      toast({
        variant: 'destructive',
        title: 'Missing Information',
        description: 'Please select a company, date, billing month, and fill all invoice items.',
      });
      return;
    }
    
    const myCompanyDetailsForForm = formEnterprise === 'Vithal' ? vithalCompanyDetails : rvCompanyDetails;

    if (!myCompanyDetailsForForm && !editingInvoice) {
      toast({
        variant: 'destructive',
        title: 'Company Settings Missing',
        description: 'Your company details are not set. Please go to the Settings page to add them before creating an invoice.',
      });
      return;
    }
    
    if (!selectedCompanyForNewInvoice) {
        toast({
            variant: 'destructive',
            title: 'Company Not Found',
            description: 'Please select a valid company.',
        });
        return;
    }

    let selectedBankAccount: BankAccount | undefined;
    if (selectedBankAccountId && selectedBankAccountId !== 'no_bank') {
        const sourceList = formEnterprise === 'Vithal' ? vithalBankAccounts : rvBankAccounts;
        selectedBankAccount = sourceList?.find(b => b.id === selectedBankAccountId);
        if (!selectedBankAccount) {
            toast({ variant: 'destructive', title: 'Bank Account Error', description: 'Could not find the selected bank account.' });
            return;
        }
    }

    const settingsDocRef = formEnterprise === 'Vithal' ? vithalSettingsRef : rvSettingsRef;

    if (firestore && settingsDocRef) {
      const billNoToUse = editingInvoice ? editingInvoice.billNo : (billNoOverride || nextBillNumberForForm || 1);

      if (isNaN(billNoToUse)) {
        toast({ variant: 'destructive', title: 'Invalid Bill Number', description: 'Could not determine bill number.' });
        return;
      }
      
      const itemsToSave = items.map(({ key, ...rest }) => rest);
      
      const currentDocumentSettings: DocumentSettings = {
          pageSize: invoicePageSettings.pageSize,
          pageOrientation: invoicePageSettings.pageOrientation,
          pageMargins: {
            top: parseFloat(String(invoicePageSettings.pageMargins?.top || 0)) || 0,
            right: parseFloat(String(invoicePageSettings.pageMargins?.right || 0)) || 0,
            bottom: parseFloat(String(invoicePageSettings.pageMargins?.bottom || 0)) || 0,
            left: parseFloat(String(invoicePageSettings.pageMargins?.left || 0)) || 0,
          },
          pageFontSize: invoicePageSettings.pageFontSize,
          addressFontSize: invoicePageSettings.addressFontSize,
          tableBodyFontSize: invoicePageSettings.tableBodyFontSize,
        };

      const invoiceData: Omit<Invoice, 'id'> = {
        enterprise: formEnterprise,
        billNo: billNoToUse,
        billNoSuffix: 'MHE',
        billDate: billDate,
        billingMonth: billingMonth,
        companyId,
        poNumber,
        site,
        items: itemsToSave,
        netTotal: calculations.netTotal,
        cgst: calculations.cgst,
        sgst: calculations.sgst,
        grandTotal: calculations.grandTotal,
        tdsPercentage: Number(tdsPercentage) || 0,
        discount: calculations.discountAmount,
        discountType: discountType,
        advanceReceived: calculations.advanceAmount,
        isDuplicate: false, // Explicitly set to false on save to "finalize"
        myCompanyDetails: editingInvoice?.myCompanyDetails || myCompanyDetailsForForm!,
        clientCompanyDetails: selectedCompanyForNewInvoice,
        selectedBankAccount: selectedBankAccount,
        documentSettings: currentDocumentSettings,
        downloadOptions: formDownloadOptions,
        template: formTemplate,
      };

      try {
        if (editingInvoice) {
          const invoiceDocRef = doc(firestore, 'invoices', editingInvoice.id);
          const dataForUpdate: {[key: string]: any} = {
            ...invoiceData,
            myCompanyDetails: editingInvoice.myCompanyDetails, // Preserve snapshot
          };

          if (!selectedBankAccount) {
            dataForUpdate.selectedBankAccount = deleteField();
          }

          updateDocumentNonBlocking(invoiceDocRef, dataForUpdate);

          toast({
              title: 'Invoice Updated',
              description: `Invoice No. ${invoiceData.billNo}-MHE has been updated.`,
          });
        } else {
            const { selectedBankAccount: _, ...dataForCreate } = invoiceData;

            const finalData = selectedBankAccount 
                ? { ...dataForCreate, selectedBankAccount: selectedBankAccount } 
                : dataForCreate;

            addDocumentNonBlocking(collection(firestore, 'invoices'), finalData);
            toast({
                title: 'Invoice Saved',
                description: `Invoice No. ${billNoToUse}-MHE has been saved.`,
            });
        }
        setIsFormDialogOpen(false);
        
      } catch (error) {
         toast({
            variant: 'destructive',
            title: 'Save Error',
            description: 'Could not save the invoice. Please try again.',
        });
      }
    }
  };
  
  const handleConfirmDuplicate = () => {
    const settingsDocRef = activeTab === 'Vithal' ? vithalSettingsRef : rvSettingsRef;

    if (!invoiceToDuplicate || !firestore || !nextBillNumber || !settingsDocRef) {
        toast({ variant: "destructive", title: "Error", description: "Could not duplicate invoice. Please try again." });
        return;
    }

    const { id, billNo, billDate, ...restOfInvoice } = invoiceToDuplicate;

    const duplicatedInvoiceData: Omit<Invoice, 'id'> = {
        ...restOfInvoice,
        billNo: nextBillNumber,
        billDate: newBillDateForDuplicate,
        billingMonth: format(parseISO(newBillDateForDuplicate), 'yyyy-MM'),
        enterprise: activeTab,
        isDuplicate: true, // Tag as duplicate
    };
    
    addDocumentNonBlocking(collection(firestore, 'invoices'), duplicatedInvoiceData);

    toast({
        title: "Invoice Duplicated",
        description: `New invoice No. ${nextBillNumber}-MHE created.`,
    });
    setInvoiceToDuplicate(null);
  };
  
  const handleConfirmBulkDuplicate = async () => {
    if (!firestore || !nextBillNumber || selectedInvoices.length === 0) {
        toast({ variant: "destructive", title: "Error", description: "Could not duplicate invoices. Please try again." });
        return;
    }

    const batch = writeBatch(firestore);
    const invoicesToDuplicateItems = selectedInvoices.map(id => allInvoices?.find(inv => inv.id === id)).filter((inv): inv is Invoice => !!inv);

    let currentBillNumber = nextBillNumber;

    for (const invoice of invoicesToDuplicateItems) {
        const { id, billNo, billDate, ...restOfInvoice } = invoice;
        const newInvoiceRef = doc(collection(firestore, 'invoices'));
        batch.set(newInvoiceRef, {
            ...restOfInvoice,
            billNo: currentBillNumber,
            billDate: newBillDateForBulk,
            billingMonth: format(parseISO(newBillDateForBulk), 'yyyy-MM'),
            enterprise: activeTab,
            isDuplicate: true, // Tag as duplicate
        });
        currentBillNumber++;
    }
    
    try {
        await batch.commit();
        toast({
            title: "Invoices Duplicated",
            description: `${selectedInvoices.length} invoices have been duplicated with new bill numbers starting from ${nextBillNumber}.`,
        });
        setSelectedInvoices([]);
        setIsBulkDuplicateDialogOpen(false);
    } catch(e) {
        toast({ variant: "destructive", title: "Error", description: "An error occurred during bulk duplication." });
    }
  };


  const handleDeleteInvoice = () => {
    if (!firestore || !invoiceToDelete) return;
    const invoiceDocRef = doc(firestore, 'invoices', invoiceToDelete.id);
    deleteDocumentNonBlocking(invoiceDocRef);
    toast({
        title: "Invoice Deleted",
        description: `Invoice No. ${invoiceToDelete.billNo}-MHE has been deleted.`,
    });
    setInvoiceToDelete(null);
  };
  
  const handleGlobalSettingsChange = (field: keyof CompanySettings, value: any) => {
    setGlobalPageSettings((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleGlobalMarginChange = (field: keyof PageMargin, value: string) => {
      if (/^(\d*\.?\d*)?$/.test(value)) {
        setGlobalPageSettings((prev: any) => ({
            ...prev,
            pageMargins: {
                ...(prev.pageMargins || {top:0,left:0,bottom:0,right:0}),
                [field]: value
            }
        }));
      }
  };

  const handleGlobalFontSizeChange = (field: 'pageFontSize' | 'addressFontSize' | 'tableBodyFontSize', value: string) => {
      const numValue = value === '' ? '' : parseInt(value, 10);
      if (numValue === '' || !isNaN(numValue as number)) {
        handleGlobalSettingsChange(field, numValue);
      }
  };

  const handleSaveDefaultSettings = async () => {
    const settingsDocRef = activeTab === 'Vithal' ? vithalSettingsRef : rvSettingsRef;
    if (!firestore || !settingsDocRef) return;
    setIsSubmittingSettings(true);

    const settingsToSave = JSON.parse(JSON.stringify(globalPageSettings));
    if (settingsToSave.pageMargins) {
        settingsToSave.pageMargins.top = parseFloat(String(settingsToSave.pageMargins.top)) || 0;
        settingsToSave.pageMargins.right = parseFloat(String(settingsToSave.pageMargins.right)) || 0;
        settingsToSave.pageMargins.bottom = parseFloat(String(settingsToSave.pageMargins.bottom)) || 0;
        settingsToSave.pageMargins.left = parseFloat(String(settingsToSave.pageMargins.left)) || 0;
    }

    try {
        await setDoc(settingsDocRef, settingsToSave, { merge: true });
        toast({ title: "Success", description: "Default settings updated." });
        setIsSettingsPopoverOpen(false);
    } catch (e) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not save default settings.' });
    } finally {
        setIsSubmittingSettings(false);
    }
  };
  
  const handleTemplateChange = (id: string, align: 'left' | 'center' | 'right') => {
    setFormTemplate(prev => ({
        ...prev,
        columns: prev.columns.map(col => col.id === id ? { ...col, align } : col)
    }));
  };

  const handleTemplateFontSizeChange = (id: string, size: string) => {
    const numValue = size === '' ? undefined : parseInt(size, 10);
    if (size === '' || (numValue !== undefined && !isNaN(numValue))) {
        setFormTemplate(prev => ({
            ...prev,
            columns: prev.columns.map(col => col.id === id ? { ...col, fontSize: numValue } : col)
        }));
    }
};

  const handleDocSettingsChange = useCallback((field: keyof DocumentSettings, value: any) => {
    setInvoicePageSettings(prev => ({...prev, [field]: value}));
  }, []);

  const handleDocMarginChange = useCallback((field: keyof PageMargin, value: string) => {
    if (/^(\d*\.?\d*)?$/.test(value)) {
        setInvoicePageSettings(prev => ({
            ...prev,
            pageMargins: {
                ...(prev.pageMargins || {top:0,left:0,bottom:0,right:0}),
                [field]: value
            }
        }));
    }
  }, []);

  const handleDocFontSizeChange = useCallback((field: 'pageFontSize' | 'addressFontSize' | 'tableBodyFontSize', value: string) => {
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) || value === '') {
        setInvoicePageSettings(prev => ({...prev, [field]: value === '' ? 0 : numValue}));
    }
  }, []);

  const handleSelectInvoice = (invoiceId: string, checked: boolean) => {
    setSelectedInvoices(prev => {
      const newSelection = checked
        ? [...prev, invoiceId]
        : prev.filter(id => id !== invoiceId);
      return newSelection;
    });
  };

  const getCompanyDisplay = (invoice: Invoice) => {
    const companyName = invoice.clientCompanyDetails?.name || 'Unknown';
    if (invoice.site && invoice.downloadOptions?.includeSiteInFilename) {
      return `${companyName} - ${invoice.site}`;
    }
    return companyName;
  }

  const bankAccountsForForm = formEnterprise === 'Vithal' ? vithalBankAccounts : rvBankAccounts;

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:gap-6">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Enterprise)} className="w-full">
            <Card>
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                        <div>
                            <CardTitle>Invoices</CardTitle>
                            <CardDescription>View and manage your professional invoices.</CardDescription>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                            {selectedInvoices.length > 0 && (
                                <div className="flex items-center gap-1.5">
                                    <Button variant="outline" size="sm" onClick={handleBulkDownload} className="h-8 px-2 text-xs">
                                        <Download className="mr-1.5 h-3.5 w-3.5" />
                                        Download ({selectedInvoices.length})
                                    </Button>
                                    <Button variant="outline" size="sm" onClick={openBulkDuplicateDialog} className="h-8 px-2 text-xs">
                                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                                        Duplicate
                                    </Button>
                                    <Button variant="ghost" size="icon" onClick={() => setSelectedInvoices([])} className="h-8 w-8">
                                        <X className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            )}
                            <Popover open={isSettingsPopoverOpen} onOpenChange={setIsSettingsPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" size="icon" className="h-8 w-8">
                                        <Settings className="h-3.5 w-3.5" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 sm:w-96">
                                    <div className="space-y-4">
                                        <h4 className="font-medium leading-none">Default Document Settings</h4>
                                        <p className="text-xs text-muted-foreground">Set the default layout for new invoices for <span className="font-bold">{activeTab} Enterprises</span>.</p>
                                        <DocumentSettingsFields 
                                            settings={globalPageSettings} 
                                            onSettingsChange={handleGlobalSettingsChange}
                                            onMarginChange={handleGlobalMarginChange}
                                            onFontSizeChange={handleGlobalFontSizeChange}
                                            prefix="global"
                                        />
                                        <Button onClick={handleSaveDefaultSettings} disabled={isSubmittingSettings} className="w-full h-9">
                                            {isSubmittingSettings ? 'Saving...' : 'Save Defaults'}
                                        </Button>
                                    </div>
                                </PopoverContent>
                            </Popover>
                            <div onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <Button 
                                            variant="outline" 
                                            size="sm" 
                                            disabled={skippedBillNumbers.length === 0} 
                                            className="h-8 text-xs focus-visible:ring-0"
                                        >
                                            <FilePlus2 className="mr-1.5 h-3.5 w-3.5" />
                                            Fill Missing
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuPortal>
                                        <DropdownMenuContent className="z-[100]" align="end" sideOffset={5}>
                                            <DropdownMenuLabel className="text-xs">Select a missing bill no.</DropdownMenuLabel>
                                            <DropdownMenuSeparator />
                                            <ScrollArea className="h-60 sm:h-72">
                                                {skippedBillNumbers.map(num => (
                                                    <DropdownMenuItem key={num} onSelect={() => openFormDialog(null, num)} className="text-xs">
                                                        Invoice No. {num}
                                                    </DropdownMenuItem>
                                                ))}
                                            </ScrollArea>
                                        </DropdownMenuContent>
                                    </DropdownMenuPortal>
                                </DropdownMenu>
                            </div>
                            <Button onClick={() => openFormDialog(null)} size="sm" className="h-8 text-xs">
                                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                                Add Invoice
                            </Button>
                        </div>
                    </div>
                     <TabsList className="grid w-full grid-cols-2 mt-4 h-9">
                        <TabsTrigger value="Vithal" className="text-xs">Vithal</TabsTrigger>
                        <TabsTrigger value="RV" className="text-xs">RV</TabsTrigger>
                    </TabsList>
                </CardHeader>
                <CardContent>
                    <p className="px-1 py-1 text-[10px] sm:text-sm text-muted-foreground">Next bill number: <span className='font-bold'>{nextBillNumber || '1'}</span>.</p>
                    <TabsContent value="Vithal">
                      <InvoiceList 
                        invoices={organizedInvoices}
                        isLoadingInvoices={isLoadingInvoices}
                        openYearAccordions={openYearAccordions}
                        setOpenYearAccordions={setOpenYearAccordions}
                        openMonthAccordions={openMonthAccordions}
                        setOpenMonthAccordions={setOpenMonthAccordions}
                        selectedInvoices={selectedInvoices}
                        handleSelectInvoice={handleSelectInvoice}
                        getCompanyDisplay={getCompanyDisplay}
                        openPreviewDialog={openPreviewDialog}
                        handleDownloadWord={handleDownloadWord}
                        openFormDialog={openFormDialog}
                        openDuplicateDialog={openDuplicateDialog}
                        openDeleteDialog={openDeleteDialog}
                        setActiveInvoiceForAction={setActiveInvoiceForAction}
                      />
                    </TabsContent>
                    <TabsContent value="RV">
                      <InvoiceList 
                        invoices={organizedInvoices}
                        isLoadingInvoices={isLoadingInvoices}
                        openYearAccordions={openYearAccordions}
                        setOpenYearAccordions={setOpenYearAccordions}
                        openMonthAccordions={openMonthAccordions}
                        setOpenMonthAccordions={setOpenMonthAccordions}
                        selectedInvoices={selectedInvoices}
                        handleSelectInvoice={handleSelectInvoice}
                        getCompanyDisplay={getCompanyDisplay}
                        openPreviewDialog={openPreviewDialog}
                        handleDownloadWord={handleDownloadWord}
                        openFormDialog={openFormDialog}
                        openDuplicateDialog={openDuplicateDialog}
                        openDeleteDialog={openDeleteDialog}
                        setActiveInvoiceForAction={setActiveInvoiceForAction}
                      />
                    </TabsContent>
                </CardContent>
            </Card>
        </Tabs>

        {/* Invoice Form Dialog */}
        <Dialog open={isFormDialogOpen} onOpenChange={(open) => setIsFormDialogOpen(open)}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col p-0">
                <DialogHeader className="p-4 sm:p-6 pr-14 pb-0">
                    <div className="flex items-start justify-between">
                        <div className="space-y-1">
                            <DialogTitle className="text-lg sm:text-xl">
                                {editingInvoice ? 'Edit Invoice' : (billNoOverride ? `Fill Missing No. ${billNoOverride}` : 'New Invoice')}
                            </DialogTitle>
                            <DialogDescription className="text-xs sm:text-sm">
                                {editingInvoice ? `Updating No. ${editingInvoice.billNo}-MHE` : `Creating for ${formEnterprise} Enterprises.`}
                            </DialogDescription>
                        </div>
                        {!editingInvoice && !billNoOverride && (
                            <DropdownMenu modal={false}>
                                <DropdownMenuTrigger asChild>
                                    <Button 
                                        variant="outline" 
                                        size="sm" 
                                        className="ml-4 shrink-0 h-8 text-xs"
                                    >
                                        {formEnterprise}
                                        <ChevronDown className="ml-1.5 h-3 w-3" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="z-50">
                                    <DropdownMenuRadioGroup value={formEnterprise} onValueChange={(value) => setFormEnterprise(value as Enterprise)}>
                                        <DropdownMenuRadioItem value="Vithal" className="text-xs">Vithal</DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="RV" className="text-xs">RV</DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        )}
                    </div>
                </DialogHeader>
                <div className="flex-grow overflow-y-auto px-4 sm:px-6 py-4">
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="company" className="text-xs sm:text-sm">Bill To</Label>
                                <Select value={companyId} onValueChange={setCompanyId} disabled={isLoadingCompanies}>
                                    <SelectTrigger id="company" className="w-full h-9 text-xs sm:text-sm">
                                        <SelectValue placeholder="Select a company..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {isLoadingCompanies ? (
                                            <SelectItem value="loading" disabled>Loading companies...</SelectItem>
                                        ) : (
                                            companies?.map(company => (
                                                <SelectItem key={company.id} value={company.id} className="text-xs sm:text-sm">
                                                    {company.name}
                                                </SelectItem>
                                            ))
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="billDate" className="text-xs sm:text-sm">Bill Date</Label>
                                <Input
                                    id="billDate"
                                    type="date"
                                    value={billDate}
                                    onChange={(e) => setBillDate(e.target.value)}
                                    className="w-full h-9 text-xs sm:text-sm"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="billingMonth" className="text-xs sm:text-sm">Billing Month</Label>
                                <Input
                                    id="billingMonth"
                                    type="month"
                                    value={billingMonth}
                                    onChange={(e) => setBillingMonth(e.target.value)}
                                    className="w-full h-9 text-xs sm:text-sm"
                                />
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="bankAccount" className="text-xs sm:text-sm">Bank Account</Label>
                                <Select value={selectedBankAccountId} onValueChange={setSelectedBankAccountId} disabled={isLoadingBankAccounts}>
                                    <SelectTrigger id="bankAccount" className="h-9 text-xs sm:text-sm">
                                        <SelectValue placeholder="Select bank account" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {isLoadingBankAccounts ? (
                                            <SelectItem value="loading" disabled>Loading accounts...</SelectItem>
                                        ) : (
                                            <>
                                                <SelectItem value="no_bank" className="text-xs sm:text-sm">No Bank</SelectItem>
                                                {bankAccountsForForm?.map(account => (
                                                    <SelectItem key={account.id} value={account.id} className="text-xs sm:text-sm">{account.nickname}</SelectItem>
                                                ))}
                                            </>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="poNumber" className="text-xs sm:text-sm">PO.NO</Label>
                                <Input id="poNumber" value={poNumber} onChange={e => setPoNumber(e.target.value)} className="h-9 text-xs sm:text-sm" />
                            </div>
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="site" className="text-xs sm:text-sm">Site</Label>
                                <Input id="site" value={site} onChange={e => setSite(e.target.value)} placeholder="e.g., THANE DEPOT" className="h-9 text-xs sm:text-sm" />
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <Label className="text-xs sm:text-sm">Particulars Editor</Label>
                                <div className="flex items-center gap-1 border rounded-md p-1 bg-muted/50">
                                    <Button type="button" variant="outline" size="icon" title="Bold" className="h-7 w-7" onClick={() => applyMarkdown('bold')}>
                                        <Bold className="h-3.5 w-3.5" />
                                    </Button>

                                    <DropdownMenu modal={false}>
                                        <DropdownMenuTrigger asChild>
                                            <Button 
                                                type="button" 
                                                variant="outline" 
                                                className="h-7 px-2 text-[10px] sm:text-xs"
                                            >
                                                <Pilcrow className="h-3 w-3 mr-1" />
                                                Size
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuPortal>
                                            <DropdownMenuContent className="z-[150]">
                                                {[9, 10, 11, 12, 14, 16].map(s => (
                                                    <DropdownMenuItem key={s} onSelect={() => applyMarkdown('size', s)} className="text-xs cursor-pointer">
                                                        {s} pt
                                                    </DropdownMenuItem>
                                                ))}
                                            </DropdownMenuContent>
                                        </DropdownMenuPortal>
                                    </DropdownMenu>
                                </div>
                            </div>
                            {items.map((item) => (
                                <div key={item.key} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 border sm:border-0 rounded-lg p-2 sm:p-0">
                                    <AutoHeightTextarea
                                        id={`particulars-${item.key}`}
                                        value={item.particulars}
                                        onChange={(e) => handleItemChange(item.key, 'particulars', e.target.value)}
                                        onFocus={() => setActiveInput({ key: item.key, field: 'particulars' })}
                                        placeholder="Item description"
                                        className="flex-grow resize-none overflow-hidden text-xs sm:text-sm"
                                        rows={1}
                                    />
                                    <div className="flex items-center gap-2 w-full sm:w-auto">
                                        <AutoHeightTextarea
                                            id={`rate-${item.key}`}
                                            value={item.rate || ''}
                                            onChange={(e) => handleItemChange(item.key, 'rate', e.target.value)}
                                            onFocus={() => setActiveInput({ key: item.key, field: 'rate' })}
                                            placeholder="Rate"
                                            className="w-full sm:w-32 md:w-40 resize-none overflow-hidden text-xs sm:text-sm"
                                            rows={1}
                                        />
                                        <Input
                                            type="text"
                                            placeholder="Amount"
                                            value={item.amount ? new Intl.NumberFormat('en-IN').format(item.amount) : (item.amount === 0 ? '0' : '')}
                                            onChange={(e) => handleItemChange(item.key, 'amount', e.target.value)}
                                            className="w-full sm:w-32 md:w-48 text-right h-9 text-xs sm:text-sm"
                                        />
                                        <Button variant="ghost" size="icon" onClick={() => handleRemoveItem(item.key)} disabled={items.length === 1} className="h-8 w-8">
                                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                            <Button variant="outline" size="sm" onClick={handleAddItem} className="h-8 text-xs">
                                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Item
                            </Button>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                            <div className="space-y-4">
                               <div className="space-y-2">
                                    <Label htmlFor="discount" className="text-xs sm:text-sm">Discount</Label>
                                    <div className="flex flex-col sm:flex-row gap-2">
                                        <Input 
                                            id="discount"
                                            type="text"
                                            placeholder="Amount" 
                                            value={discount} 
                                            onChange={(e) => setDiscount(e.target.value)}
                                            className="flex-1 h-9 text-xs sm:text-sm"
                                        />
                                        <RadioGroup value={discountType} onValueChange={(v) => setDiscountType(v as DiscountType)} className="flex items-center gap-1 rounded-md border p-1 h-9 bg-muted/50">
                                            <Label htmlFor="before_gst" className={cn("flex-1 text-center cursor-pointer text-[10px] px-2 py-1 rounded-sm transition-colors", discountType === 'before_gst' && "bg-background shadow font-bold")}>
                                                <RadioGroupItem value="before_gst" id="before_gst" className="sr-only"/>
                                                Before GST
                                            </Label>
                                            <Label htmlFor="after_gst" className={cn("flex-1 text-center cursor-pointer text-[10px] px-2 py-1 rounded-sm transition-colors", discountType === 'after_gst' && "bg-background shadow font-bold")}>
                                                <RadioGroupItem value="after_gst" id="after_gst" className="sr-only"/>
                                                After GST
                                            </Label>
                                        </RadioGroup>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="advanceReceived" className="text-xs sm:text-sm">Advance</Label>
                                        <Input 
                                            id="advanceReceived" 
                                            type="text"
                                            placeholder="0" 
                                            value={advanceReceived} 
                                            onChange={(e) => setAdvanceReceived(e.target.value)} 
                                            className="h-9 text-xs sm:text-sm"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="tdsPercentage" className="text-xs sm:text-sm">TDS %</Label>
                                        <Input 
                                            id="tdsPercentage" 
                                            type="number"
                                            placeholder="e.g., 2" 
                                            value={tdsPercentage} 
                                            onChange={(e) => setTdsPercentage(e.target.value)} 
                                            className="h-9 text-xs sm:text-sm"
                                        />
                                    </div>
                                </div>
                            </div>
                           <div className="w-full space-y-1.5 pt-2 self-end text-xs sm:text-sm">
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">Net Total</span>
                                    <span>{calculations.netTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                </div>

                                {discountType === 'before_gst' && calculations.discountAmount > 0 && (
                                    <div className="flex justify-between text-destructive">
                                        <span className="text-muted-foreground">Discount</span>
                                        <span>- {calculations.discountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                )}
                                
                                {discountType === 'before_gst' && calculations.discountAmount > 0 && (
                                    <>
                                    <Separator className="my-1"/>
                                    <div className="flex justify-between font-medium">
                                        <span className="text-muted-foreground">Taxable Amount</span>
                                        <span>{calculations.taxableAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                    <Separator className="my-1"/>
                                    </>
                                )}

                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">CGST @ 9%</span>
                                    <span>{calculations.cgst.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-muted-foreground">SGST @ 9%</span>
                                    <span>{calculations.sgst.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                </div>
                                
                                {discountType === 'after_gst' && calculations.discountAmount > 0 && (
                                    <div className="flex justify-between text-destructive">
                                        <span className="text-muted-foreground">Discount</span>
                                        <span>- {calculations.discountAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                    </div>
                                )}
                                <Separator className="my-1" />
                                <div className="flex justify-between font-bold text-sm sm:text-lg">
                                    <span>{calculations.advanceAmount > 0 ? 'Grand Total' : 'Amount Payable'}</span>
                                    <span>{calculations.grandTotal.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                </div>
                                {calculations.advanceAmount > 0 && (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Advance Received</span>
                                            <span>- {calculations.advanceAmount.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                        </div>
                                        <Separator className="my-1" />
                                        <div className="flex justify-between font-bold text-sm sm:text-lg">
                                            <span>Total Amount Payable</span>
                                            <span>{calculations.balanceDue.toLocaleString('en-IN', { style: 'currency', currency: 'INR' })}</span>
                                        </div>
                                    </>
                                )}
                                <div className="text-[10px] sm:text-xs text-muted-foreground pt-1 italic">
                                    In words: <span className="font-medium text-foreground">{amountInWords}</span>
                                </div>
                            </div>
                        </div>


                        {editingInvoice && (
                          <>
                            <Separator />
                            <div className="space-y-4">
                                <h3 className="text-base sm:text-lg font-medium">Document Settings</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    <div className="p-3 sm:p-4 border rounded-lg bg-card/50">
                                      <DocumentSettingsFields 
                                         settings={invoicePageSettings} 
                                         onSettingsChange={handleDocSettingsChange}
                                         onMarginChange={handleDocMarginChange}
                                         onFontSizeChange={handleDocFontSizeChange}
                                      />
                                    </div>
                                    <div className="p-3 sm:p-4 border rounded-lg bg-card/50">
                                      <DownloadOptionsFields options={formDownloadOptions} setOptions={setFormDownloadOptions} />
                                    </div>
                                     <div className="p-3 sm:p-4 border rounded-lg bg-card/50">
                                      <ColumnAlignmentFields template={formTemplate} onTemplateChange={handleTemplateChange} onTemplateFontSizeChange={handleTemplateFontSizeChange} items={items} />
                                    </div>
                                </div>
                            </div>
                          </>
                        )}
                    </div>
                </div>
                <DialogFooter className="p-4 sm:p-6 pt-4 border-t flex gap-2">
                    <Button variant="outline" onClick={() => setIsFormDialogOpen(false)} className="h-9 text-xs sm:text-sm">Cancel</Button>
                    <Button onClick={handleFormSubmit} className="h-9 text-xs sm:text-sm">
                        {editingInvoice ? 'Update Invoice' : 'Save Invoice'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        {/* Delete Confirmation Alert */}
        <AlertDialog open={!!invoiceToDelete} onOpenChange={(open) => !open && setInvoiceToDelete(null)}>
            <AlertDialogContent className="max-w-[90vw] sm:max-w-md p-4 sm:p-6">
                <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                    This will permanently delete Invoice No. <span className="font-medium">{invoiceToDelete?.billNo}-MHE</span>.
                </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={(e) => { e.preventDefault(); handleDeleteInvoice(); }} className="h-9">Delete</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Single Duplicate Dialog */}
        <AlertDialog open={!!invoiceToDuplicate} onOpenChange={(open) => !open && setInvoiceToDuplicate(null)}>
            <AlertDialogContent className="max-w-[90vw] sm:max-w-md p-4 sm:p-6">
                <AlertDialogHeader>
                    <AlertDialogTitle>Duplicate Invoice</AlertDialogTitle>
                    <AlertDialogDescription>
                        Select a new bill date for the duplicated invoice. It will be marked as "DUPLICATE" until updated.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-2">
                    <Label htmlFor="newBillDate" className="text-xs">New Bill Date</Label>
                    <Input
                        id="newBillDate"
                        type="date"
                        value={newBillDateForDuplicate}
                        onChange={(e) => setNewBillDateForDuplicate(e.target.value)}
                        className="w-full mt-1.5 h-9 text-sm"
                    />
                </div>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmDuplicate} className="h-9">Duplicate</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Duplicate Dialog */}
        <AlertDialog open={isBulkDuplicateDialogOpen} onOpenChange={setIsBulkDuplicateDialogOpen}>
            <AlertDialogContent className="max-w-[95vw] sm:max-w-md p-4 sm:p-6">
                <AlertDialogHeader>
                    <AlertDialogTitle>Bulk Duplicate Invoices</AlertDialogTitle>
                    <AlertDialogDescription>
                        You are about to duplicate <span className="font-bold">{selectedInvoices.length}</span> invoices starting from <span className="font-bold">{nextBillNumber}</span>.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-2">
                    <Label htmlFor="newBillDateForBulk" className="text-xs">New Bill Date</Label>
                    <Input
                        id="newBillDateForBulk"
                        type="date"
                        value={newBillDateForBulk}
                        onChange={(e) => setNewBillDateForBulk(e.target.value)}
                        className="w-full mt-1.5 h-9 text-sm"
                    />
                </div>
                <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel className="h-9">Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleConfirmBulkDuplicate} className="h-9 text-xs">Duplicate {selectedInvoices.length} Invoices</AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        
        {/* Preview Dialog */}
        <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
            <DialogContent className="max-w-4xl p-0">
                 <DialogHeader className="p-4 sm:p-6 pb-2">
                    <DialogTitle>Invoice Preview</DialogTitle>
                    <DialogDescription className="text-xs">
                        No. {invoiceForPreview?.billNo}-{invoiceForPreview?.billNoSuffix || 'MHE'}.
                    </DialogDescription>
                </DialogHeader>
                <div className={cn("px-4 sm:px-6 pb-6 overflow-y-auto max-h-[80vh]", "hide-scrollbar")}>
                   <InvoicePreview 
                    invoice={invoiceForPreview} 
                    company={invoiceForPreview?.clientCompanyDetails || null} 
                    myCompanyDetails={invoiceForPreview?.myCompanyDetails || null}
                    downloadOptions={invoiceForPreview?.downloadOptions || defaultDownloadOptions}
                  />
                </div>
            </DialogContent>
        </Dialog>

        {/* Mobile Actions Dialog (Triggered by Long Press) */}
        <Dialog open={!!activeInvoiceForAction} onOpenChange={(open) => !open && setActiveInvoiceForAction(null)}>
            <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-xs p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
                <DialogHeader className="p-4 bg-muted/30 border-b flex flex-col items-start space-y-0.5">
                    <DialogTitle className="text-[10px] font-bold text-muted-foreground uppercase">Invoice Actions</DialogTitle>
                    <DialogDescription className="text-xs font-black text-foreground">
                        Bill No. {activeInvoiceForAction?.billNo}-{activeInvoiceForAction?.billNoSuffix || 'MHE'}
                    </DialogDescription>
                </DialogHeader>
                <div className="p-2 grid gap-1">
                    <Button variant="ghost" className="justify-start h-12 gap-3 px-4 font-bold text-sm rounded-xl" onClick={() => { const inv = activeInvoiceForAction!; setActiveInvoiceForAction(null); openPreviewDialog(inv); }}>
                        <Eye className="h-4 w-4 text-primary" /> Preview Invoice
                    </Button>
                    <Button variant="ghost" className="justify-start h-12 gap-3 px-4 font-bold text-sm rounded-xl" onClick={() => { const inv = activeInvoiceForAction!; setActiveInvoiceForAction(null); handleDownloadWord(inv); }}>
                        <Download className="h-4 w-4 text-blue-500" /> Download Document
                    </Button>
                    <Button variant="ghost" className="justify-start h-12 gap-3 px-4 font-bold text-sm rounded-xl" onClick={() => { const inv = activeInvoiceForAction!; setActiveInvoiceForAction(null); openFormDialog(inv); }}>
                        <Pencil className="h-4 w-4 text-amber-500" /> Edit Details
                    </Button>
                    <Button variant="ghost" className="justify-start h-12 gap-3 px-4 font-bold text-sm rounded-xl" onClick={() => { const inv = activeInvoiceForAction!; setActiveInvoiceForAction(null); openDuplicateDialog(inv); }}>
                        <Copy className="h-4 w-4 text-indigo-500" /> Duplicate Bill
                    </Button>
                    <Separator className="my-1 mx-2" />
                    <Button variant="ghost" className="justify-start h-12 gap-3 px-4 font-bold text-sm text-destructive hover:text-destructive hover:bg-destructive/10 rounded-xl" onClick={() => { const inv = activeInvoiceForAction!; setActiveInvoiceForAction(null); openDeleteDialog(inv); }}>
                        <Trash2 className="h-4 w-4" /> Delete Invoice
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
        
      </div>
    </AppLayout>
  );
}
