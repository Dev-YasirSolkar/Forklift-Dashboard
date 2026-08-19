
'use client';

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Employee } from "@/lib/data";
import { Separator } from "./ui/separator";
import { Send, MessageSquare, Briefcase, Calendar, CreditCard, ShieldCheck, Phone } from "lucide-react";

export type EmployeeFormData = {
  fullName: string;
  empCode: string;
  specialization: string;
  department: string;
  contactNumber: string;
  whatsappNumber: string;
  workLocation: string;
  availability: boolean;
  doj: string;
  baseSalary: string;
  otCalculationType: 'fixed' | 'pro-rata';
  otHourlyRate: string;
  panNumber: string;
  pfNumber: string;
  uanNumber: string;
  esicNumber: string;
  bankName: string;
  bankAccountNumber: string;
  telegramChatId: string;
};

export type EmployeeFormSubmitData = Omit<EmployeeFormData, 'baseSalary' | 'otHourlyRate'> & {
  baseSalary: number;
  otHourlyRate: number;
};

interface EmployeeFormProps {
  onSubmit: (data: EmployeeFormSubmitData) => void;
  initialData?: Employee;
  mode: 'add' | 'edit';
}

export function EmployeeForm({ onSubmit, initialData, mode }: EmployeeFormProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<EmployeeFormData>({
    fullName: '',
    empCode: '',
    specialization: '',
    department: '',
    contactNumber: '',
    whatsappNumber: '',
    workLocation: '',
    availability: true,
    doj: '',
    baseSalary: '0',
    otCalculationType: 'pro-rata',
    otHourlyRate: '0',
    panNumber: '',
    pfNumber: '',
    uanNumber: '',
    esicNumber: '',
    bankName: '',
    bankAccountNumber: '',
    telegramChatId: '',
  });

  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setFormData({
        fullName: initialData.fullName || '',
        empCode: initialData.empCode || '',
        specialization: initialData.specialization || '',
        department: initialData.department || '',
        contactNumber: initialData.contactNumber || '',
        whatsappNumber: initialData.whatsappNumber || '',
        workLocation: initialData.workLocation || '',
        availability: initialData.availability ?? true,
        doj: initialData.doj || '',
        baseSalary: initialData.baseSalary?.toString() || '0',
        otCalculationType: initialData.otCalculationType || 'pro-rata',
        otHourlyRate: initialData.otHourlyRate?.toString() || '0',
        panNumber: initialData.panNumber || '',
        pfNumber: initialData.pfNumber || '',
        uanNumber: initialData.uanNumber || '',
        esicNumber: initialData.esicNumber || '',
        bankName: initialData.bankName || '',
        bankAccountNumber: initialData.bankAccountNumber || '',
        telegramChatId: initialData.telegramChatId || '',
      });
    } else {
        setFormData({
            fullName: '',
            empCode: '',
            specialization: '',
            department: '',
            contactNumber: '',
            whatsappNumber: '',
            workLocation: '',
            availability: true,
            doj: '',
            baseSalary: '0',
            otCalculationType: 'pro-rata',
            otHourlyRate: '0',
            panNumber: '',
            pfNumber: '',
            uanNumber: '',
            esicNumber: '',
            bankName: '',
            bankAccountNumber: '',
            telegramChatId: '',
        });
    }
  }, [initialData, mode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id: keyof EmployeeFormData, value: string) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleAvailabilityChange = (checked: boolean) => {
    setFormData(prev => ({ ...prev, availability: checked }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.fullName) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please fill out the full name.",
      });
      return;
    }
    
    const salary = parseFloat(formData.baseSalary) || 0;
    const hourlyRate = parseFloat(formData.otHourlyRate) || 0;
    onSubmit({ ...formData, baseSalary: salary, otHourlyRate: hourlyRate });
  };

  return (
    <form id="employee-form" onSubmit={handleSubmit} className="grid gap-6">
        {/* Personal & Designation */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5" /> Identity & Role
            </h3>
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input id="fullName" value={formData.fullName} onChange={handleInputChange} placeholder="e.g., John Doe" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="empCode">Employee ID / Code</Label>
                        <Input id="empCode" value={formData.empCode} onChange={handleInputChange} placeholder="VE-001" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="doj">Joining Date</Label>
                        <Input id="doj" type="date" value={formData.doj} onChange={handleInputChange} />
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="specialization">Designation / Role</Label>
                        <Input id="specialization" value={formData.specialization} onChange={handleInputChange} placeholder="e.g., Technician" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="department">Department</Label>
                        <Input id="department" value={formData.department} onChange={handleInputChange} placeholder="e.g., Service" />
                    </div>
                </div>
            </div>
        </div>

        <Separator />

        {/* Contact Info */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" /> Communication
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="contactNumber">Contact Number</Label>
                    <Input id="contactNumber" value={formData.contactNumber} onChange={handleInputChange} placeholder="+91 9876543210" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="whatsappNumber">WhatsApp Number</Label>
                    <Input id="whatsappNumber" value={formData.whatsappNumber} onChange={handleInputChange} placeholder="919876543210" />
                </div>
            </div>
        </div>
        
        <Separator />
        
        {/* Payroll Setup */}
        <div className="space-y-4 bg-muted/20 p-4 rounded-lg border border-primary/10">
            <div className="grid gap-2">
                <Label htmlFor="baseSalary" className="text-primary font-bold uppercase tracking-tight">Monthly Base Salary (Fixed)</Label>
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-muted-foreground">₹</span>
                    <Input 
                        id="baseSalary" 
                        type="number" 
                        value={formData.baseSalary} 
                        onChange={handleInputChange} 
                        placeholder="Enter fixed salary" 
                        className="h-10 text-lg font-black"
                    />
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label className="text-[10px] font-bold uppercase text-muted-foreground">OT Calculation Type</Label>
                    <Select value={formData.otCalculationType} onValueChange={(v) => handleSelectChange('otCalculationType', v)}>
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="pro-rata">Salary Pro-rata (Actual Month Days / 8h)</SelectItem>
                            <SelectItem value="fixed">Fixed Hourly Rate</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="otHourlyRate" className="text-[10px] font-bold uppercase text-muted-foreground">OT Price (per hr)</Label>
                    <Input 
                        id="otHourlyRate" 
                        type="number" 
                        value={formData.otHourlyRate} 
                        onChange={handleInputChange} 
                        disabled={formData.otCalculationType === 'pro-rata'}
                        className="h-9 font-bold"
                        placeholder={formData.otCalculationType === 'pro-rata' ? 'Auto calculated' : 'Enter amount'}
                    />
                </div>
            </div>
        </div>

        <Separator />
        
        {/* Statutory Details */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> Statutory & Compliance
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="panNumber">PAN Number</Label>
                    <Input id="panNumber" value={formData.panNumber} onChange={handleInputChange} placeholder="ABCDE1234F" className="font-mono" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="pfNumber">PF Account No.</Label>
                    <Input id="pfNumber" value={formData.pfNumber} onChange={handleInputChange} placeholder="PF Number" />
                </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="uanNumber">UAN Number</Label>
                    <Input id="uanNumber" value={formData.uanNumber} onChange={handleInputChange} placeholder="Universal Account No." />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="esicNumber">ESIC Number</Label>
                    <Input id="esicNumber" value={formData.esicNumber} onChange={handleInputChange} placeholder="ESIC ID" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Banking Info */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <CreditCard className="h-3.5 w-3.5" /> Banking Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="bankName">Bank Name</Label>
                    <Input id="bankName" value={formData.bankName} onChange={handleInputChange} placeholder="e.g., HDFC Bank" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="bankAccountNumber">Account Number</Label>
                    <Input id="bankAccountNumber" value={formData.bankAccountNumber} onChange={handleInputChange} placeholder="Account Number" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Telegram Integration */}
        <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-100 dark:border-blue-900/30">
            <h3 className="text-xs font-black uppercase tracking-wider text-blue-700 dark:text-blue-400 mb-3 flex items-center gap-2">
                <Send className="h-3 w-3" /> Telegram Bot ID
            </h3>
            <div className="grid gap-2">
                <Label htmlFor="telegramChatId" className="text-[10px] font-bold uppercase text-muted-foreground">Chat ID</Label>
                <Input 
                    id="telegramChatId" 
                    value={formData.telegramChatId} 
                    onChange={handleInputChange} 
                    placeholder="Enter Chat ID for PDF slips" 
                    className="h-9 font-mono"
                />
            </div>
        </div>

        <Separator />

        {/* Logistics */}
        <div className="grid gap-4">
            <div className="grid gap-2">
                <Label htmlFor="workLocation">Standard Work Location</Label>
                <Input id="workLocation" value={formData.workLocation} onChange={handleInputChange} placeholder="e.g., Workshop, On-Site" />
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="availability" checked={formData.availability} onCheckedChange={handleAvailabilityChange} />
                <Label htmlFor="availability">Mark as Available for Assignment</Label>
            </div>
        </div>
    </form>
  );
}
