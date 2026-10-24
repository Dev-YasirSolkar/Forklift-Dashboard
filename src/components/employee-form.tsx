
'use client';

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Employee } from "@/lib/data";
import { Separator } from "./ui/separator";
import { Send, Briefcase, CreditCard, ShieldCheck, Phone, Heart, MapPin, User, Camera, Trash2, Upload } from "lucide-react";

export type EmployeeFormData = {
  fullName: string;
  empCode: string;
  specialization: string;
  department: string;
  contactNumber: string;
  whatsappNumber: string;
  aadhaarNumber: string;
  panNumber: string;
  dateOfBirth: string;
  bloodGroup: string;
  permanentAddress: string;
  currentAddress: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactNumber: string;
  currentSiteName: string;
  workLocation: string;
  availability: boolean;
  doj: string;
  baseSalary: string;
  otCalculationType: 'fixed' | 'pro-rata';
  otHourlyRate: string;
  pfNumber: string;
  uanNumber: string;
  esicNumber: string;
  bankName: string;
  bankAccountNumber: string;
  telegramChatId: string;
  photoUrl: string;
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

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const getDefaults = (): EmployeeFormData => ({
  fullName: '',
  empCode: '',
  specialization: '',
  department: '',
  contactNumber: '',
  whatsappNumber: '',
  aadhaarNumber: '',
  panNumber: '',
  dateOfBirth: '',
  bloodGroup: '',
  permanentAddress: '',
  currentAddress: '',
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactNumber: '',
  currentSiteName: '',
  workLocation: '',
  availability: true,
  doj: '',
  baseSalary: '0',
  otCalculationType: 'pro-rata',
  otHourlyRate: '0',
  pfNumber: '',
  uanNumber: '',
  esicNumber: '',
  bankName: '',
  bankAccountNumber: '',
  telegramChatId: '',
  photoUrl: '',
});

export function EmployeeForm({ onSubmit, initialData, mode }: EmployeeFormProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<EmployeeFormData>(getDefaults());

  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setFormData({
        fullName: initialData.fullName || '',
        empCode: initialData.empCode || '',
        specialization: initialData.specialization || '',
        department: initialData.department || '',
        contactNumber: initialData.contactNumber || '',
        whatsappNumber: initialData.whatsappNumber || '',
        aadhaarNumber: initialData.aadhaarNumber || '',
        panNumber: initialData.panNumber || '',
        dateOfBirth: initialData.dateOfBirth || '',
        bloodGroup: initialData.bloodGroup || '',
        permanentAddress: initialData.permanentAddress || '',
        currentAddress: initialData.currentAddress || '',
        emergencyContactName: initialData.emergencyContactName || '',
        emergencyContactRelationship: initialData.emergencyContactRelationship || '',
        emergencyContactNumber: initialData.emergencyContactNumber || '',
        currentSiteName: initialData.currentSiteName || '',
        workLocation: initialData.workLocation || '',
        availability: initialData.availability ?? true,
        doj: initialData.doj || '',
        baseSalary: initialData.baseSalary?.toString() || '0',
        otCalculationType: initialData.otCalculationType || 'pro-rata',
        otHourlyRate: initialData.otHourlyRate?.toString() || '0',
        pfNumber: initialData.pfNumber || '',
        uanNumber: initialData.uanNumber || '',
        esicNumber: initialData.esicNumber || '',
        bankName: initialData.bankName || '',
        bankAccountNumber: initialData.bankAccountNumber || '',
        telegramChatId: initialData.telegramChatId || '',
        photoUrl: initialData.photoUrl || '',
      });
    } else {
      setFormData(getDefaults());
    }
  }, [initialData, mode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSelectChange = (id: keyof EmployeeFormData, value: string) => {
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleAvailabilityChange = (checked: boolean) => {
    setFormData(prev => ({ ...prev, availability: checked }));
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        variant: "destructive",
        title: "Invalid File",
        description: "Please select an image file (JPG, PNG, WebP).",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 320;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        setFormData(prev => ({ ...prev, photoUrl: compressedDataUrl }));
        toast({
          title: "Photo Uploaded",
          description: "Employee photo ready for ID Card.",
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setFormData(prev => ({ ...prev, photoUrl: '' }));
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
        {/* Profile Photo */}
        <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-xl border border-border/50">
          <div className="relative shrink-0">
            {formData.photoUrl ? (
              <img
                src={formData.photoUrl}
                alt="Profile Preview"
                className="h-16 w-16 rounded-xl object-cover border-2 border-primary/20 shadow-sm"
              />
            ) : (
              <div className="h-16 w-16 rounded-xl bg-gradient-to-br from-indigo-500/20 to-blue-500/20 border-2 border-dashed border-primary/30 flex flex-col items-center justify-center text-muted-foreground">
                <Camera className="h-6 w-6 text-primary/60" />
              </div>
            )}
          </div>
          <div className="space-y-1.5 flex-1 min-w-0">
            <Label className="text-xs font-bold">ID Card Photo</Label>
            <p className="text-[11px] text-muted-foreground">Upload passport size photo for employee ID badge.</p>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg hover:bg-primary/90 transition-colors shadow-xs">
                <Upload className="h-3.5 w-3.5" />
                <span>Upload</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
              </label>
              {formData.photoUrl && (
                <button
                  type="button"
                  onClick={removePhoto}
                  className="inline-flex items-center gap-1 text-xs text-destructive hover:underline font-semibold"
                >
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Personal & Designation */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Briefcase className="h-3.5 w-3.5" /> Identity & Role
            </h3>
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="fullName">Full Name *</Label>
                    <Input id="fullName" value={formData.fullName} onChange={handleInputChange} placeholder="e.g., Ramesh Kumar" required />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="empCode">Employee ID / Code</Label>
                        <Input id="empCode" value={formData.empCode} onChange={handleInputChange} placeholder="VE-001" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="doj">Date of Joining</Label>
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
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="dateOfBirth">Date of Birth</Label>
                        <Input id="dateOfBirth" type="date" value={formData.dateOfBirth} onChange={handleInputChange} />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="bloodGroup">Blood Group</Label>
                        <Select value={formData.bloodGroup} onValueChange={(v) => handleSelectChange('bloodGroup', v)}>
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                {BLOOD_GROUPS.map(bg => (
                                    <SelectItem key={bg} value={bg}>{bg}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>
        </div>

        <Separator />

        {/* KYC / Identity Documents */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> KYC / Identity Documents
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="aadhaarNumber">Aadhaar Card Number</Label>
                    <Input id="aadhaarNumber" value={formData.aadhaarNumber} onChange={handleInputChange} placeholder="XXXX XXXX XXXX" className="font-mono" maxLength={14} />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="panNumber">PAN Card Number</Label>
                    <Input id="panNumber" value={formData.panNumber} onChange={handleInputChange} placeholder="ABCDE1234F" className="font-mono uppercase" maxLength={10} />
                </div>
            </div>
        </div>

        <Separator />

        {/* Contact Info */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Phone className="h-3.5 w-3.5" /> Contact Details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="contactNumber">Mobile Number *</Label>
                    <Input id="contactNumber" value={formData.contactNumber} onChange={handleInputChange} placeholder="+91 9876543210" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="whatsappNumber">WhatsApp Number</Label>
                    <Input id="whatsappNumber" value={formData.whatsappNumber} onChange={handleInputChange} placeholder="919876543210" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Emergency Contact */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <Heart className="h-3.5 w-3.5" /> Emergency Contact
            </h3>
            <div className="grid gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label htmlFor="emergencyContactName">Contact Person Name</Label>
                        <Input id="emergencyContactName" value={formData.emergencyContactName} onChange={handleInputChange} placeholder="e.g., Father / Wife name" />
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="emergencyContactRelationship">Relationship</Label>
                        <Input id="emergencyContactRelationship" value={formData.emergencyContactRelationship} onChange={handleInputChange} placeholder="e.g., Father, Wife, Brother" />
                    </div>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="emergencyContactNumber">Emergency Mobile Number</Label>
                    <Input id="emergencyContactNumber" value={formData.emergencyContactNumber} onChange={handleInputChange} placeholder="+91 9876543210" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Address */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" /> Address Details
            </h3>
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="permanentAddress">Permanent Address</Label>
                    <Textarea id="permanentAddress" value={formData.permanentAddress} onChange={handleInputChange} placeholder="Village / Town, District, State, Pin Code" rows={2} className="resize-none text-sm" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="currentAddress">Current Address</Label>
                    <Textarea id="currentAddress" value={formData.currentAddress} onChange={handleInputChange} placeholder="Current living address (leave blank if same as permanent)" rows={2} className="resize-none text-sm" />
                </div>
            </div>
        </div>

        <Separator />

        {/* Work Location & Site */}
        <div className="space-y-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                <User className="h-3.5 w-3.5" /> Work Assignment
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label htmlFor="currentSiteName">Current Site Name</Label>
                    <Input id="currentSiteName" value={formData.currentSiteName} onChange={handleInputChange} placeholder="e.g., JSW Tarapur" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="workLocation">Standard Work Location</Label>
                    <Input id="workLocation" value={formData.workLocation} onChange={handleInputChange} placeholder="e.g., Workshop, On-Site" />
                </div>
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="availability" checked={formData.availability} onCheckedChange={handleAvailabilityChange} />
                <Label htmlFor="availability">Mark as Available for Assignment</Label>
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
                    <Label htmlFor="pfNumber">PF Account No.</Label>
                    <Input id="pfNumber" value={formData.pfNumber} onChange={handleInputChange} placeholder="PF Number" />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="uanNumber">UAN Number</Label>
                    <Input id="uanNumber" value={formData.uanNumber} onChange={handleInputChange} placeholder="Universal Account No." />
                </div>
            </div>
            <div className="grid gap-2">
                <Label htmlFor="esicNumber">ESIC Number</Label>
                <Input id="esicNumber" value={formData.esicNumber} onChange={handleInputChange} placeholder="ESIC ID" />
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
    </form>
  );
}
