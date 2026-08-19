'use client';

import { useEffect, useState, Fragment } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import type { Forklift, Company } from "@/lib/data";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "./ui/textarea";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, parseISO } from "date-fns";


export type ForkliftFormData = {
  serialNumber: string;
  make: string;
  model: string;
  year: string;
  capacity: string;
  equipmentType: string;
  firm: 'Vithal' | 'RV' | '';
  voltage: string;
  mastHeight: string;
  locationType: 'Workshop' | 'On-Site' | 'Not Confirm';
  locationAssignmentDate: string;
  siteCompany: string;
  siteArea: string;
  siteContactPerson: string;
  siteContactNumber: string;
  remarks: string;
  poPiNumber: string;
};

interface ForkliftFormProps {
  onSubmit: (data: Partial<ForkliftFormData>) => void;
  onCancel: () => void;
  initialData?: Forklift;
  mode: 'add' | 'edit';
  companies: Company[];
  isLoadingCompanies: boolean;
}

export function ForkliftForm({ onSubmit, onCancel, initialData, mode, companies, isLoadingCompanies }: ForkliftFormProps) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<ForkliftFormData>({
    serialNumber: '',
    make: '',
    model: '',
    year: '',
    capacity: '',
    equipmentType: '',
    firm: '',
    voltage: '',
    mastHeight: '',
    locationType: 'Workshop',
    locationAssignmentDate: '',
    siteCompany: '',
    siteArea: '',
    siteContactPerson: '',
    siteContactNumber: '',
    remarks: '',
    poPiNumber: '',
  });

  useEffect(() => {
    if (mode === 'edit' && initialData) {
      setFormData({
        serialNumber: initialData.serialNumber ?? '',
        make: initialData.make ?? '',
        model: initialData.model ?? '',
        year: initialData.year?.toString() ?? '',
        capacity: initialData.capacity ?? '',
        equipmentType: initialData.equipmentType ?? '',
        firm: initialData.firm ?? '',
        voltage: initialData.voltage ?? '',
        mastHeight: initialData.mastHeight ?? '',
        locationType: initialData.locationType ?? 'Workshop',
        locationAssignmentDate: initialData.locationAssignmentDate || new Date().toISOString(),
        siteCompany: initialData.siteCompany ?? '',
        siteArea: initialData.siteArea ?? '',
        siteContactPerson: initialData.siteContactPerson ?? '',
        siteContactNumber: initialData.siteContactNumber ?? '',
        remarks: initialData.remarks ?? '',
        poPiNumber: initialData.poPiNumber ?? '',
      });
    } else if (mode === 'add') {
        setFormData({
            serialNumber: '',
            make: '',
            model: '',
            year: '',
            capacity: '',
            equipmentType: '',
            firm: '',
            voltage: '',
            mastHeight: '',
            locationType: 'Workshop',
            locationAssignmentDate: new Date().toISOString(),
            siteCompany: '',
            siteArea: '',
            siteContactPerson: '',
            siteContactNumber: '',
            remarks: '',
            poPiNumber: '',
        });
    }
  }, [initialData, mode]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };
  
  const handleLocationChange = (value: ForkliftFormData['locationType']) => {
    setFormData(prev => ({ 
        ...prev, 
        locationType: value,
        locationAssignmentDate: new Date().toISOString()
    }));
  };

  const handleSiteCompanyChange = (value: string) => {
    setFormData(prev => ({ ...prev, siteCompany: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.serialNumber || !formData.make || !formData.model || !formData.year) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please fill out all required forklift details.",
      });
      return;
    }
    
    if (formData.locationType === 'On-Site' && !formData.siteCompany) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please provide a site/company name for on-site forklifts.",
      });
      return;
    }
    
    const dataToSubmit: Partial<ForkliftFormData> = {
      ...formData,
      year: formData.year,
    };

    if (formData.locationType === 'Workshop' || formData.locationType === 'Not Confirm') {
      dataToSubmit.siteCompany = '';
      dataToSubmit.siteArea = '';
      dataToSubmit.siteContactPerson = '';
      dataToSubmit.siteContactNumber = '';
    }

    onSubmit(dataToSubmit);
  };
  
  return (
    <form id="forklift-form" onSubmit={handleSubmit} className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="serialNumber">Serial Number</Label>
                <Input id="serialNumber" value={formData.serialNumber} onChange={handleInputChange} placeholder="e.g., F12345" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="poPiNumber">PO/PI Number</Label>
                <Input id="poPiNumber" value={formData.poPiNumber} onChange={handleInputChange} placeholder="e.g., PO-789" />
            </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="make">Make</Label>
                <Input id="make" value={formData.make} onChange={handleInputChange} placeholder="e.g., Toyota" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="model">Model</Label>
                <Input id="model" value={formData.model} onChange={handleInputChange} placeholder="e.g., 8FGCU25" required />
            </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="year">Year</Label>
                <Input id="year" type="number" value={formData.year} onChange={handleInputChange} placeholder="e.g., 2021" required />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="capacity">Capacity</Label>
                <Input id="capacity" value={formData.capacity} onChange={handleInputChange} placeholder="e.g., 5000 lbs" />
            </div>
        </div>
         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="grid gap-2">
                <Label htmlFor="voltage">Voltage</Label>
                <Input id="voltage" value={formData.voltage} onChange={handleInputChange} placeholder="e.g., 36V" />
            </div>
            <div className="grid gap-2">
                <Label htmlFor="mastHeight">Mast Height</Label>
                <Input id="mastHeight" value={formData.mastHeight} onChange={handleInputChange} placeholder="e.g., 189 inches" />
            </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="grid gap-2">
              <Label htmlFor="equipmentType">Equipment Type</Label>
              <Input id="equipmentType" value={formData.equipmentType} onChange={handleInputChange} placeholder="e.g., Reach Truck" />
          </div>
           <div className="grid gap-2">
              <Label htmlFor="firm">Firm</Label>
              <RadioGroup
                  value={formData.firm || '__none__'}
                  onValueChange={(value) => {
                      const firmValue = value === '__none__' ? '' : value as 'Vithal' | 'RV';
                      setFormData(prev => ({...prev, firm: firmValue}));
                  }}
                  className="flex flex-wrap gap-4 mt-1"
              >
                  <div className="flex items-center space-x-2">
                      <RadioGroupItem value="__none__" id="firm-none" />
                      <Label htmlFor="firm-none" className="cursor-pointer font-normal text-foreground">None</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                      <RadioGroupItem value="Vithal" id="firm-vithal" className="text-red-600 border-red-600 dark:text-red-400 dark:border-red-400" />
                      <Label htmlFor="firm-vithal" className="cursor-pointer text-red-700 dark:text-red-400 font-medium">Vithal</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                      <RadioGroupItem value="RV" id="firm-rv" className="text-blue-800 border-blue-800 dark:text-blue-400 dark:border-blue-400" />
                      <Label htmlFor="firm-rv" className="cursor-pointer text-blue-900 dark:text-blue-400 font-medium">RV</Label>
                  </div>
              </RadioGroup>
          </div>
        </div>
        
        <Separator />
        
        <div className="grid gap-4">
          <h3 className="text-lg font-medium text-foreground">Location Details</h3>
           <div className="grid gap-2">
                <RadioGroup
                    value={formData.locationType}
                    onValueChange={handleLocationChange}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-1"
                >
                    <div className="flex items-center space-x-2 p-3 rounded-lg border border-orange-200 dark:border-orange-900/50 bg-transparent">
                        <RadioGroupItem value="Workshop" id="Workshop" />
                        <Label htmlFor="Workshop" className="cursor-pointer font-medium text-orange-800 dark:text-orange-400">Workshop</Label>
                    </div>
                    <div className="flex items-center space-x-2 p-3 rounded-lg border border-green-200 dark:border-green-900/50 bg-transparent">
                        <RadioGroupItem value="On-Site" id="On-Site" />
                        <Label htmlFor="On-Site" className="cursor-pointer font-medium text-green-800 dark:text-green-400">On-Site</Label>
                    </div>
                    <div className="flex items-center space-x-2 p-3 rounded-lg border border-red-200 dark:border-red-900/50 bg-transparent">
                        <RadioGroupItem value="Not Confirm" id="Not Confirm" />
                        <Label htmlFor="Not Confirm" className="cursor-pointer font-medium text-red-800 dark:text-red-400">Not Confirmed</Label>
                    </div>
                </RadioGroup>
           </div>

           <div className="grid gap-2 max-w-xs">
                <Label htmlFor="locationAssignmentDate">Location Set Date</Label>
                <Input
                    id="locationAssignmentDate"
                    type="datetime-local"
                    value={formData.locationAssignmentDate ? format(parseISO(formData.locationAssignmentDate), "yyyy-MM-dd'T'HH:mm") : ''}
                    onChange={(e) => {
                        const date = new Date(e.target.value);
                        if (!isNaN(date.getTime())) {
                            setFormData(prev => ({ ...prev, locationAssignmentDate: date.toISOString() }));
                        }
                    }}
                    className="bg-background text-foreground"
                />
                <p className="text-[10px] text-muted-foreground">Changes automatically when location type changes, or set manually.</p>
            </div>

          {formData.locationType === 'On-Site' && (
            <div className="grid gap-4 mt-2 border-l-2 border-primary pl-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                   <div className="grid gap-2 col-span-2 sm:col-span-1">
                    <Label htmlFor="siteCompany">Site / Company</Label>
                      <div className="flex w-full items-center">
                        <Input
                          id="siteCompany"
                          placeholder="Type or select a company"
                          value={formData.siteCompany}
                          onChange={handleInputChange}
                          className="rounded-r-none"
                        />
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="icon" className="rounded-l-none border-l-0">
                              <ChevronDown className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <ScrollArea className="h-72">
                                {isLoadingCompanies ? (
                                <DropdownMenuItem disabled>Loading companies...</DropdownMenuItem>
                                ) : companies.length > 0 ? (
                                    companies.map((company, index) => (
                                        <Fragment key={company.id}>
                                            <DropdownMenuItem
                                            onSelect={() => handleSiteCompanyChange(company.name)}
                                            >
                                            {company.name}
                                            </DropdownMenuItem>
                                            {index < companies.length - 1 && <DropdownMenuSeparator />}
                                        </Fragment>
                                    ))
                                ) : (
                                  <DropdownMenuItem disabled>No companies found.</DropdownMenuItem>
                                )}
                            </ScrollArea>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                  </div>
                  <div className="grid gap-2 col-span-2 sm:col-span-1">
                    <Label htmlFor="siteArea">Area</Label>
                    <Input id="siteArea" value={formData.siteArea} onChange={handleInputChange} placeholder="e.g., Downtown" />
                  </div>
                </div>
                 <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="siteContactPerson">Contact Person</Label>
                    <Input id="siteContactPerson" value={formData.siteContactPerson} onChange={handleInputChange} placeholder="e.g., Jane Smith" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="siteContactNumber">Contact Number</Label>
                    <Input id="siteContactNumber" value={formData.siteContactNumber} onChange={handleInputChange} placeholder="e.g., +1 555-1234" />
                  </div>
                </div>
            </div>
          )}
        </div>
        
        <Separator />

        <div className="grid gap-2">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" value={formData.remarks} onChange={handleInputChange} placeholder="Add any extra notes or remarks here..." />
        </div>
    </form>
  );
}
