
'use client';
import { useState, useEffect } from 'react';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Company } from '@/lib/data';
import { Separator } from './ui/separator';

export type CompanyFormData = {
  name: string;
  address: string;
  gstin: string;
  kindAttn: string;
  contactNumber: string;
};

interface CompanyFormProps {
  onSubmit: (data: CompanyFormData) => void;
  onCancel?: () => void;
  initialData?: Company;
  mode: 'add' | 'edit';
}

export function CompanyForm({ onSubmit, initialData, mode }: CompanyFormProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<CompanyFormData>({
    name: '',
    address: '',
    gstin: '',
    kindAttn: '',
    contactNumber: '',
  });

  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setFormData({
        name: initialData.name,
        address: initialData.address,
        gstin: initialData.gstin || '',
        kindAttn: initialData.kindAttn || '',
        contactNumber: initialData.contactNumber || '',
      });
    } else {
      setFormData({
        name: '',
        address: '',
        gstin: '',
        kindAttn: '',
        contactNumber: '',
      });
    }
  }, [initialData, mode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.address) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please fill out company name and address.",
      });
      return;
    }
    onSubmit(formData);
  };

  return (
    <form id="company-form" onSubmit={handleSubmit} className="grid gap-6 py-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Company Name</Label>
        <Input id="name" value={formData.name} onChange={handleInputChange} placeholder="e.g., Bisleri International Pvt. Ltd." required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="address">Address</Label>
        <Textarea id="address" value={formData.address} onChange={handleInputChange} placeholder="Enter full address" required />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="gstin">GSTIN</Label>
        <Input id="gstin" value={formData.gstin} onChange={handleInputChange} placeholder="e.g., 27AACCA4355K1ZL" />
      </div>
      <Separator />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="grid gap-2">
            <Label htmlFor="kindAttn">Kind Attn</Label>
            <Input id="kindAttn" value={formData.kindAttn} onChange={handleInputChange} placeholder="e.g., Mr. Ajay Sharma" />
        </div>
        <div className="grid gap-2">
            <Label htmlFor="contactNumber">Mobile Number</Label>
            <Input id="contactNumber" value={formData.contactNumber} onChange={handleInputChange} placeholder="e.g., 9821000000" />
        </div>
      </div>
    </form>
  );
}
