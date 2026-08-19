'use client';
import {
  Card,
  CardContent,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button";
import { Forklift, JobCard, Company } from "@/lib/data";
import { EllipsisVertical, Pencil, PlusCircle, Search, Warehouse, User, Phone, Wrench, ListFilter, Upload, AlertTriangle, ChevronDown, XCircle, Download, MapPin, CalendarDays, Zap, Ruler, Hash } from "lucide-react";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, doc, query, where, orderBy, deleteField } from "firebase/firestore";
import { useState, useMemo, Fragment, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { ForkliftForm, ForkliftFormData } from "@/components/forklift-form";
import { ForkliftImportDialog } from "@/components/forklift-import-dialog";
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from "@/firebase/non-blocking-updates";
import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { ForkliftIcon } from "@/components/icons/forklift-icon";
import AppLayout from "@/components/app-layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toBlob } from 'html-to-image';
import { Checkbox } from "@/components/ui/checkbox";


type SearchField = 'All' | 'serialNumber' | 'make' | 'model' | 'siteCompany' | 'siteArea';
const searchFieldLabels: Record<SearchField, string> = {
  All: 'All Fields',
  serialNumber: 'Serial No.',
  make: 'Make',
  model: 'Model',
  siteCompany: 'Site / Company',
  siteArea: 'Site Area'
};

type VisibleFields = {
    serialNumber: boolean;
    makeModel: boolean;
    status: boolean;
    mfgYear: boolean;
    firm: boolean;
    locationDate: boolean;
    poNo: boolean;
    capacity: boolean;
    type: boolean;
    voltage: boolean;
    mastHeight: boolean;
    siteInfo: boolean;
    remarks: boolean;
};

const defaultVisibleFields: VisibleFields = {
    serialNumber: true,
    makeModel: true,
    status: true,
    mfgYear: true,
    firm: true,
    locationDate: true,
    poNo: true,
    capacity: true,
    type: true,
    voltage: true,
    mastHeight: true,
    siteInfo: true,
    remarks: true,
};

const SETTINGS_STORAGE_KEY = 've_forklift_card_prefs_v2';

export default function ForkliftsPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const router = useRouter();
  
  const [isAddEditDialogOpen, setIsAddEditDialogOpen] = useState(false);
  const [forkliftToDelete, setForkliftToDelete] = useState<Forklift | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedForklift, setSelectedForklift] = useState<Forklift | null>(null);

  // Download Settings State
  const [isDownloadSettingsOpen, setIsDownloadSettingsOpen] = useState(false);
  const [forkliftToDownload, setForkliftToDownload] = useState<Forklift | null>(null);
  const [visibleFields, setVisibleFields] = useState<VisibleFields>(defaultVisibleFields);

  const [locationFilter, setLocationFilter] = useState('All');
  const [equipmentTypeFilter, setEquipmentTypeFilter] = useState('All');
  const [capacityFilter, setCapacityFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('All');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  const forkliftsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'forklifts'), orderBy('srNumber', 'asc')) : null, [firestore, user]);
  const activeJobCardsQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'jobCards'), where('status', 'in', ['Pending', 'Assigned', 'In Progress'])) : null, [firestore, user]);
  const companiesQuery = useMemoFirebase(() => firestore && user ? query(collection(firestore, 'companies'), orderBy('name', 'asc')) : null, [firestore, user]);
  
  const { data: forklifts, isLoading: isLoadingForklifts } = useCollection<Forklift>(forkliftsQuery);
  const { data: activeJobCards, isLoading: isLoadingJobs } = useCollection<JobCard>(activeJobCardsQuery);
  const { data: companies, isLoading: isLoadingCompanies } = useCollection<Company>(companiesQuery);
  
  const isLoading = isLoadingForklifts || isLoadingJobs || isLoadingCompanies;

  // Load saved preferences from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (saved) {
      try {
        setVisibleFields(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved card preferences", e);
      }
    }
  }, []);

  const stats = useMemo(() => {
    const total = forklifts?.length || 0;
    const inWorkshop = forklifts?.filter(f => f.locationType === 'Workshop').length || 0;
    const onSite = forklifts?.filter(f => f.locationType === 'On-Site').length || 0;
    const notConfirmed = forklifts?.filter(f => f.locationType === 'Not Confirm').length || 0;
    return { total, inWorkshop, onSite, notConfirmed };
  }, [forklifts]);

  const handleDelayedAction = (action: () => void) => {
    setTimeout(action, 100);
  };

  const openAddEditDialog = useCallback((forklift: Forklift | null) => {
    setSelectedForklift(forklift);
    handleDelayedAction(() => setIsAddEditDialogOpen(true));
  }, []);

  const openDeleteDialog = useCallback((forklift: Forklift) => {
    handleDelayedAction(() => setForkliftToDelete(forklift));
  }, []);

  const openImportDialog = useCallback(() => {
    handleDelayedAction(() => setIsImportDialogOpen(true));
  }, []);

  const openDownloadSettings = (forklift: Forklift) => {
      setForkliftToDownload(forklift);
      handleDelayedAction(() => setIsDownloadSettingsOpen(true));
  }

  // Persistent preferences update handler
  const updateVisibleFields = (updates: Partial<VisibleFields>) => {
    setVisibleFields(prev => {
      const newFields = { ...prev, ...updates };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(newFields));
      return newFields;
    });
  };

  const equipmentTypes = useMemo(() => {
    if (!forklifts) return [];
    const types = new Set(forklifts.map(f => f.equipmentType).filter(Boolean));
    return ['All', ...Array.from(types)];
  }, [forklifts]);

  const capacities = useMemo(() => {
    if (!forklifts) return [];
    const caps = new Set(forklifts.map(f => f.capacity).filter(Boolean));
    return ['All', ...Array.from(caps)];
  }, [forklifts]);
  
  const locationOptions = useMemo(() => {
      if (!forklifts) return ['All', 'Workshop', 'On-Site', 'Not Confirm'];
      const sites = new Set(forklifts.map(f => f.siteCompany).filter(Boolean));
      return ['All', 'Workshop', 'On-Site', 'Not Confirm', ...Array.from(sites)];
  }, [forklifts]);

  const handleClearFilters = () => {
    setLocationFilter('All');
    setEquipmentTypeFilter('All');
    setCapacityFilter('All');
    setSearchTerm('');
    setSearchField('All');
  };
  
  const anyFilterActive = useMemo(() => {
      return locationFilter !== 'All' || equipmentTypeFilter !== 'All' || capacityFilter !== 'All' || searchTerm !== '';
  }, [locationFilter, equipmentTypeFilter, capacityFilter, searchTerm]);


  const filteredForklifts = useMemo(() => {
    if (!forklifts) return [];
    const lowercasedSearchTerm = searchTerm.toLowerCase();
    return forklifts.filter(forklift => {
      const typeMatch = equipmentTypeFilter === 'All' ? true : forklift.equipmentType === equipmentTypeFilter;
      const capacityMatch = capacityFilter === 'All' ? true : forklift.capacity === capacityFilter;
      
      let locationMatch = true;
      if (locationFilter !== 'All') {
          if (['Workshop', 'On-Site', 'Not Confirm'].includes(locationFilter)) {
              locationMatch = forklift.locationType === locationFilter;
          } else {
              locationMatch = forklift.siteCompany === locationFilter;
          }
      }
      
      if (!searchTerm) return typeMatch && capacityMatch && locationMatch;

      const searchInField = (field: keyof Forklift) => {
          const value = forklift[field as keyof Forklift];
          return value ? value.toString().toLowerCase().includes(lowercasedSearchTerm) : false;
      };

      let searchMatch = false;
      if (searchField === 'All') {
        searchMatch = 
          searchInField('serialNumber') || 
          searchInField('make') || 
          searchInField('model') ||
          searchInField('siteCompany') ||
          searchInField('siteArea');
      } else {
        searchMatch = searchInField(searchField as keyof Forklift);
      }

      return typeMatch && capacityMatch && locationMatch && searchMatch;
    });
  }, [forklifts, equipmentTypeFilter, capacityFilter, locationFilter, searchTerm, searchField]);

  const searchPlaceholder = useMemo(() => {
    if (searchField === 'All') {
      return "Search fleet...";
    }
    return `Search by ${searchFieldLabels[searchField]}...`;
  }, [searchField]);

  const handleDelete = () => {
    if (!firestore || !forkliftToDelete) return;
    
    const forkliftDocRef = doc(firestore, 'forklifts', forkliftToDelete.id);
    deleteDocumentNonBlocking(forkliftDocRef);

    toast({
      title: "Forklift Deleted",
      description: `Forklift ${forkliftToDelete.serialNumber} has been removed.`,
    });

    setForkliftToDelete(null);
  };

  const handleFormSubmit = (formData: Partial<ForkliftFormData>) => {
    if (!firestore) return;

    const { firm, ...restOfFormData } = formData;
    
    const dataToSubmit: any = {
      ...restOfFormData,
      year: formData.year ? parseInt(formData.year, 10) : new Date().getFullYear(),
    };

    if (formData.locationType === 'Workshop' || formData.locationType === 'Not Confirm') {
      dataToSubmit.siteCompany = '';
      dataToSubmit.siteArea = '';
      dataToSubmit.siteContactPerson = '';
      dataToSubmit.siteContactNumber = '';
    }

    if (selectedForklift) {
        if (firm === 'Vithal' || firm === 'RV') {
            dataToSubmit.firm = firm;
        } else {
            dataToSubmit.firm = deleteField();
        }
        const forkliftDocRef = doc(firestore, 'forklifts', selectedForklift.id);
        updateDocumentNonBlocking(forkliftDocRef, dataToSubmit);
        toast({ title: "Success", description: "Forklift updated successfully." });
    } else {
        if (firm === 'Vithal' || firm === 'RV') {
            dataToSubmit.firm = firm;
        }
        const maxSrNumber = forklifts ? Math.max(0, ...forklifts.map(f => f.srNumber || 0)) : 0;
        dataToSubmit.srNumber = maxSrNumber + 1;
        const forkliftsCollection = collection(firestore, 'forklifts');
        addDocumentNonBlocking(forkliftsCollection, dataToSubmit);
        toast({ title: "Success", description: "Forklift added successfully." });
    }

    setIsAddEditDialogOpen(false);
    setSelectedForklift(null);
  };

  const handleImportComplete = (count: number) => {
    toast({
      title: 'Import Successful',
      description: `${count} forklift(s) have been added to your fleet.`,
    });
    setIsImportDialogOpen(false);
  };

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  const executeDownload = async () => {
    if (!forkliftToDownload) return;
    const forklift = forkliftToDownload;
    const node = document.getElementById(`share-card-${forklift.id}`);
    if (!node) return;

    setIsDownloading(forklift.id);
    setIsDownloadSettingsOpen(false); 

    try {
      const blob = await toBlob(node, { 
        backgroundColor: '#FFFFFF',
        pixelRatio: 3, 
        width: 600,
        style: {
          display: 'block'
        }
      });
      
      if (!blob) throw new Error("Failed to generate image");

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `forklift-${forklift.serialNumber}.png`;
      link.href = url;
      link.click();
      
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      toast({ title: "Success", description: "Image downloaded successfully." });
    } catch (error) {
      console.error('Error downloading:', error);
      toast({ variant: 'destructive', title: "Download Error", description: "Failed to create image." });
    } finally {
      setIsDownloading(null);
      setForkliftToDownload(null);
    }
  };
  
  const cardClassName = "border-none shadow-lg transition-all hover:scale-[1.02] cursor-pointer active:scale-95 overflow-hidden";
  
  const getLocationIcon = (locationType: Forklift['locationType']) => {
    switch (locationType) {
      case 'Workshop':
        return <Warehouse className="mr-1.5 h-3 w-3" />;
      case 'On-Site':
        return <ForkliftIcon className="mr-1.5 h-3 w-3" />;
      case 'Not Confirm':
        return <AlertTriangle className="mr-1.5 h-3 w-3" />;
      default:
        return null;
    }
  }
  
  const getLocationText = (forklift: Forklift) => {
    let text: string;
    switch (forklift.locationType) {
      case 'Workshop':
        text = 'Workshop';
        break;
      case 'On-Site':
        text = forklift.siteCompany || 'On-Site';
        break;
      case 'Not Confirm':
        text = 'Not Confirmed';
        break;
      default:
        text = 'Unknown';
    }
    
    return text;
  }
  
  const getLocationBadgeClass = (locationType: Forklift['locationType']) => {
    switch (locationType) {
      case 'Workshop':
        return 'border-green-500/60 bg-green-50 text-green-700 dark:border-green-400/50 dark:bg-green-900/20 dark:text-green-400';
      case 'On-Site':
        return 'border-amber-500/60 bg-amber-50 text-amber-700 dark:border-amber-400/50 dark:bg-amber-900/20 dark:text-amber-400';
      case 'Not Confirm':
        return 'border-red-500/60 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/20 dark:text-red-400';
      default:
        return '';
    }
  }

  const getFirmBadgeClass = (firm: Forklift['firm']) => {
    switch (firm) {
      case 'Vithal':
        return 'border-red-500/60 bg-red-50 text-red-700 dark:border-red-400/50 dark:bg-red-900/20 dark:text-red-400';
      case 'RV':
        return 'border-blue-800/60 bg-blue-50 text-blue-900 dark:border-blue-500/50 dark:bg-blue-900/20 dark:text-blue-400';
      default:
        return '';
    }
  }

  const hasActiveRequest = (forkliftId: string) => {
      if (!user) return false;
      return activeJobCards?.some(job => job.forkliftId === forkliftId);
  }
  
  const renderActions = (forklift: Forklift) => (
      <DropdownMenu>
          <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 p-0" onClick={(e) => e.stopPropagation()}>
                  <EllipsisVertical className="h-4 w-4" />
              </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-48" align="end" onMouseLeave={(e) => (e.currentTarget as HTMLElement).blur()}>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDownloadSettings(forklift); }} disabled={isDownloading === forklift.id}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Card
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openAddEditDialog(forklift); }}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openDeleteDialog(forklift); }} className="text-destructive hover:text-destructive">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
              </DropdownMenuItem>
          </DropdownMenuContent>
      </DropdownMenu>
  );

  return (
    <AppLayout>
      <div className="flex flex-col gap-4 sm:gap-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Forklift Fleet</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Search, filter, and manage your fleet of forklifts.</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button onClick={openImportDialog} variant="outline" size="sm" className="flex-1 sm:flex-none text-xs">
              <Upload className="mr-2 h-3.5 w-3.5" />
              Import
            </Button>
            <Button onClick={() => openAddEditDialog(null)} size="sm" className="flex-1 sm:flex-none text-xs">
              <PlusCircle className="mr-2 h-3.5 w-3.5" />
              Add Forklift
            </Button>
          </div>
        </div>

        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          <Card onClick={() => setLocationFilter('Workshop')} className={cn(cardClassName, "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-emerald-500/20")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.15em] opacity-80">In Workshop</CardTitle>
              <Warehouse className="h-5 w-5 text-white/70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black tracking-tighter">{isLoading ? '...' : stats.inWorkshop}</div>
              <p className="text-[10px] font-medium text-white/70 mt-1 uppercase tracking-tight">Ready for deployment</p>
            </CardContent>
          </Card>
          <Card onClick={() => setLocationFilter('On-Site')} className={cn(cardClassName, "bg-gradient-to-br from-amber-500 to-amber-600 text-white shadow-amber-500/20")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.15em] opacity-80">On-Site</CardTitle>
              <ForkliftIcon className="h-5 w-5 text-white/70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black tracking-tighter">{isLoading ? '...' : stats.onSite}</div>
              <p className="text-[10px] font-medium text-white/70 mt-1 uppercase tracking-tight">Active duty units</p>
            </CardContent>
          </Card>
          <Card onClick={() => setLocationFilter('Not Confirm')} className={cn(cardClassName, "bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-rose-500/20")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.15em] opacity-80">Not Confirm</CardTitle>
              <AlertTriangle className="h-5 w-5 text-white/70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black tracking-tighter">{isLoading ? '...' : stats.notConfirmed}</div>
              <p className="text-[10px] font-medium text-white/70 mt-1 uppercase tracking-tight">Updates required</p>
            </CardContent>
          </Card>
          <Card onClick={handleClearFilters} className={cn(cardClassName, "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-blue-500/20")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.15em] opacity-80">Total Fleet</CardTitle>
              <ListFilter className="h-5 w-5 text-white/70" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-black tracking-tighter">{isLoading ? '...' : stats.total}</div>
              <p className="text-[10px] font-medium text-white/70 mt-1 uppercase tracking-tight">Total registered units</p>
            </CardContent>
          </Card>
        </div>
        
        <div className="space-y-3">
            <div className="flex items-center w-full">
                <Select value={searchField} onValueChange={(value) => setSearchField(value as SearchField)}>
                <SelectTrigger className="w-auto px-2 sm:px-3 border-r-0 rounded-r-none focus:ring-0 focus:ring-offset-0 h-9 text-xs">
                    <ListFilter className="h-3.5 w-3.5 text-muted-foreground" />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(searchFieldLabels).map(([key, label]) => (
                    <SelectItem key={key} value={key} className="text-xs">{label}</SelectItem>
                    ))}
                </SelectContent>
                </Select>
                <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder={searchPlaceholder}
                    className="pl-8 rounded-l-none w-full h-9 text-xs"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
                </div>
            </div>
            <div className="grid grid-cols-2 sm:flex sm:flex-row flex-wrap items-center gap-2 w-full">
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="h-9 text-[10px] sm:text-xs">
                    <SelectValue placeholder="Location" />
                </SelectTrigger>
                <SelectContent>
                     {locationOptions.map(loc => (
                      <SelectItem key={loc ?? ''} value={loc ?? ''} className="text-xs">
                        {loc === 'All' ? 'All Locations' : loc}
                      </SelectItem>
                    ))}
                </SelectContent>
                </Select>
                <Select value={equipmentTypeFilter} onValueChange={setEquipmentTypeFilter}>
                <SelectTrigger className="h-9 text-[10px] sm:text-xs">
                    <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                    {equipmentTypes.map(type => (
                    <SelectItem key={type ?? ''} value={type ?? ''} className="text-xs">{type}</SelectItem>
                    ))}
                </SelectContent>
                </Select>
                <Select value={capacityFilter} onValueChange={setCapacityFilter}>
                <SelectTrigger className="h-9 text-[10px] sm:text-xs">
                    <SelectValue placeholder="Capacity" />
                </SelectTrigger>
                <SelectContent>
                    {capacities.map(capacity => (
                    <SelectItem key={capacity ?? ''} value={capacity ?? ''} className="text-xs">{capacity}</SelectItem>
                    ))}
                </SelectContent>
                </Select>
                 {anyFilterActive && (
                    <Button variant="ghost" size="sm" onClick={handleClearFilters} className="h-9 col-span-2 sm:col-span-1 text-[10px] sm:text-xs">
                        <XCircle className="mr-1.5 h-3.5 w-3.5" />
                        Clear Filters
                    </Button>
                )}
            </div>
        </div>

        <div className="text-[10px] sm:text-xs text-muted-foreground px-1">
          {isLoading ? 'Loading fleet database...' : `Found ${filteredForklifts.length} matches in total fleet of ${forklifts?.length || 0}.`}
        </div>

        <Card className="border-none sm:border shadow-none sm:shadow-sm overflow-hidden">
          <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center items-center h-64">
              <p className="text-muted-foreground text-sm animate-pulse">Synchronizing fleet data...</p>
            </div>
          ) : filteredForklifts && filteredForklifts.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow>
                        <TableHead className="w-[50px] hidden sm:table-cell">Sr.</TableHead>
                        <TableHead className="w-[40px] p-2"></TableHead>
                        <TableHead className="text-xs">Serial Number</TableHead>
                        <TableHead className="hidden md:table-cell text-xs">Make/Model</TableHead>
                        <TableHead className="hidden md:table-cell text-xs">Firm</TableHead>
                        <TableHead className="text-xs w-[120px] sm:w-auto">Location</TableHead>
                        <TableHead className="w-[50px] text-right"><span className="sr-only">Actions</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filteredForklifts.map((forklift) => (
                        <Fragment key={forklift.id}>
                            <TableRow onClick={() => toggleRow(forklift.id)} className={cn("cursor-pointer border-b transition-colors", expandedRow === forklift.id && "bg-accent/30")}>
                                <TableCell className="font-medium hidden sm:table-cell text-xs">{forklift.srNumber || ''}</TableCell>
                                <TableCell className="p-2 text-center">
                                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-300", expandedRow === forklift.id && "rotate-180 text-primary")} />
                                </TableCell>
                                <TableCell className="p-3">
                                  <div className="flex items-center gap-1.5">
                                      {hasActiveRequest(forklift.id) && (
                                          <Wrench className="h-3.5 w-3.5 text-orange-500" aria-label="Active Service Request" />
                                      )}
                                      <span className="font-bold text-xs sm:text-sm">{forklift.serialNumber}</span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground md:hidden mt-0.5">{forklift.make} {forklift.model}</div>
                                </TableCell>
                                <TableCell className="hidden md:table-cell text-xs">{forklift.make} {forklift.model}</TableCell>
                                <TableCell className="hidden md:table-cell">
                                  {forklift.firm ? (
                                    <Badge variant={'outline'} className={cn('text-[10px] font-bold px-2 py-0.5', getFirmBadgeClass(forklift.firm))}>
                                      {forklift.firm}
                                    </Badge>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground italic">None</span>
                                  )}
                                </TableCell>
                                <TableCell className="p-2">
                                    <div className="flex items-center">
                                        <Badge 
                                            variant={'outline'} 
                                            className={cn(
                                                'font-black pointer-events-none text-[9px] sm:text-[10px] flex items-center max-w-[110px] sm:max-w-none rounded-md px-2 py-1 uppercase tracking-tight', 
                                                getLocationBadgeClass(forklift.locationType)
                                            )}
                                        >
                                            {getLocationIcon(forklift.locationType)}
                                            <span className="truncate">{getLocationText(forklift)}</span>
                                        </Badge>
                                    </div>
                                </TableCell>
                                <TableCell className="text-right p-3">
                                    {renderActions(forklift)}
                                </TableCell>
                            </TableRow>
                            {expandedRow === forklift.id && (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={8} className="p-0 border-b bg-muted/10">
                                        <div className="p-4 sm:p-6 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                                          <div className="flex justify-end gap-2">
                                              <Button 
                                                variant="outline" 
                                                size="sm" 
                                                className="h-8 text-[10px] sm:text-xs font-bold border-primary/20 hover:bg-primary/5" 
                                                onClick={(e) => { e.stopPropagation(); openDownloadSettings(forklift); }}
                                                disabled={isDownloading === forklift.id}
                                              >
                                                  <Download className="mr-1.5 h-3.5 w-3.5 text-primary" />
                                                  {isDownloading === forklift.id ? 'Generating Image...' : 'Download Professional Card'}
                                              </Button>
                                          </div>
                                          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">MFG Year</Label>
                                              <p className="text-sm font-bold">{forklift.year || 'N/A'}</p>
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Enterprise Firm</Label>
                                              <div>
                                                {forklift.firm ? (
                                                  <Badge variant={'outline'} className={cn('font-bold text-[10px]', getFirmBadgeClass(forklift.firm))}>
                                                    {forklift.firm} Enterprises
                                                  </Badge>
                                                ) : (
                                                  <span className="text-sm font-medium">-</span>
                                                )}
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                                  <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Location Set On</Label>
                                                  <p className="text-sm font-bold flex items-center gap-1.5">
                                                      <CalendarDays className="h-3 w-3 text-primary" />
                                                      {forklift.locationAssignmentDate 
                                                          ? format(parseISO(forklift.locationAssignmentDate), 'dd MMM yyyy') 
                                                          : 'Not Set'}
                                                  </p>
                                              </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">PO/PI Number</Label>
                                              <p className="text-sm font-bold text-blue-600 dark:text-blue-400">{forklift.poPiNumber || 'N/A'}</p>
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Capacity</Label>
                                              <p className="text-sm font-bold">{forklift.capacity || 'N/A'}</p>
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Equipment Type</Label>
                                              <p className="text-sm font-bold">{forklift.equipmentType || 'N/A'}</p>
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Voltage</Label>
                                              <p className="text-sm font-bold">{forklift.voltage || 'N/A'}</p>
                                            </div>
                                            <div className="space-y-1">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Mast Height</Label>
                                              <p className="text-sm font-bold">{forklift.mastHeight || 'N/A'}</p>
                                            </div>
                                          </div>
                                          
                                          {forklift.locationType === 'On-Site' && (
                                            <div className="space-y-4 pt-4 border-t border-border/50">
                                              <h4 className="text-[10px] uppercase font-black text-primary tracking-[0.2em]">Deployed Site Information</h4>
                                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 bg-background/50 p-4 rounded-xl border border-primary/10">
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] font-bold text-muted-foreground/80 uppercase">Site / Company</Label>
                                                  <p className="text-sm font-black text-foreground">{forklift.siteCompany || 'N/A'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] font-bold text-muted-foreground/80 uppercase">Geographical Area</Label>
                                                  <p className="text-sm font-bold">{forklift.siteArea || 'N/A'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] font-bold text-muted-foreground/80 uppercase flex items-center gap-1.5"><User className="h-3 w-3 text-primary" /> Contact Person</Label>
                                                  <p className="text-sm font-bold">{forklift.siteContactPerson || 'N/A'}</p>
                                                </div>
                                                <div className="space-y-1">
                                                  <Label className="text-[10px] font-bold text-muted-foreground/80 uppercase flex items-center gap-1.5"><Phone className="h-3 w-3 text-primary" /> Contact Number</Label>
                                                  <p className="text-sm font-bold text-green-600 dark:text-green-400">{forklift.siteContactNumber || 'N/A'}</p>
                                                </div>
                                              </div>
                                            </div>
                                          )}

                                          {forklift.remarks && (
                                            <div className="space-y-2 pt-2">
                                              <Label className="text-[10px] uppercase font-black text-muted-foreground/70 tracking-widest">Technician Remarks</Label>
                                              <div className="text-xs text-foreground whitespace-pre-wrap leading-relaxed italic bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-100 dark:border-amber-900/30">
                                                {forklift.remarks}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </Fragment>
                        ))}
                    </TableBody>
                </Table>
              </div>
          ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <ForkliftIcon className="h-8 w-8 text-muted-foreground/40" />
                </div>
                <h3 className="text-lg font-bold text-foreground">No units found</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs leading-relaxed">
                  We couldn't find any forklifts matching your current filter criteria. Try adjusting your search.
                </p>
                {anyFilterActive && (
                    <Button variant="link" onClick={handleClearFilters} className="mt-2 text-primary text-xs font-black uppercase tracking-wider">
                        Reset All Filters
                    </Button>
                )}
              </div>
          )}
          </CardContent>
        </Card>

        {/* Professional Download Image Template (Hidden) */}
        <div className="fixed -left-[9999px] top-0 pointer-events-none" aria-hidden="true">
            {forkliftToDownload && (
                <div 
                  id={`share-card-${forkliftToDownload.id}`} 
                  className="bg-white p-8 w-[600px] border-4 border-[#10b981] rounded-2xl shadow-none overflow-hidden text-black font-sans"
                >
                    <div className="flex items-center justify-between mb-8 border-b-2 border-slate-100 pb-6">
                        <div className="flex items-center gap-4">
                            <div className="bg-[#10b981]/10 p-3 rounded-xl">
                                <ForkliftIcon className="h-10 w-10 text-[#10b981]" />
                            </div>
                            <div>
                                <h2 className="text-2xl font-black text-[#10b981] uppercase tracking-tight leading-none">Forklift Summary</h2>
                                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-1.5">VE Enterprise Fleet Management</p>
                            </div>
                        </div>
                        {visibleFields.firm && (
                            <div className={cn(
                                "px-4 py-1.5 rounded-lg border-2 text-xs font-black uppercase tracking-wider",
                                (forkliftToDownload.firm || 'Vithal') === 'Vithal' ? "border-red-500 text-red-600 bg-red-50" : "border-blue-600 text-blue-700 bg-blue-50"
                            )}>
                                {(forkliftToDownload.firm || 'Vithal')} Enterprises
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-2 gap-x-10 gap-y-8">
                        {visibleFields.serialNumber && (
                            <div className="space-y-1.5">
                                <Label className="text-[10px] uppercase font-black text-slate-400 tracking-[0.2em] flex items-center gap-1.5"><Hash className="h-3 w-3"/> Serial Number</Label>
                                <p className="text-3xl font-black text-slate-900 leading-none">{forkliftToDownload.serialNumber || 'N/A'}</p>
                            </div>
                        )}
                        {visibleFields.status && (
                            <div className="space-y-1.5">
                                <Label className="text-[10px] uppercase font-black text-slate-400 tracking-[0.2em]">Current Location</Label>
                                <div className="flex items-center">
                                    <div className={cn(
                                        "text-[11px] font-black py-1.5 px-4 rounded-full border-2",
                                        forkliftToDownload.locationType === 'Workshop' ? "border-green-500 text-green-700 bg-green-50" : 
                                        forkliftToDownload.locationType === 'On-Site' ? "border-amber-500 text-amber-700 bg-amber-50" : 
                                        "border-red-500 text-red-700 bg-red-50"
                                    )}>
                                        {getLocationText(forkliftToDownload).toUpperCase()}
                                    </div>
                                </div>
                            </div>
                        )}

                        {visibleFields.makeModel && (
                            <div className="col-span-2 space-y-1">
                                <Label className="text-[10px] uppercase font-black text-slate-400 tracking-[0.2em]">Make & Model No.</Label>
                                <p className="text-xl font-black text-slate-900 leading-none uppercase">
                                    {forkliftToDownload.make} {forkliftToDownload.model}
                                </p>
                            </div>
                        )}
                        
                        {/* Detail Row 1: General Info */}
                        <div className="col-span-2 grid grid-cols-4 gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-100">
                            {visibleFields.mfgYear && (
                                <div className="space-y-1.5">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider">MFG Year</Label>
                                    <p className="text-sm font-bold text-slate-900">{forkliftToDownload.year || '-'}</p>
                                </div>
                            )}
                            {visibleFields.firm && (
                                <div className="space-y-1.5">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Firm</Label>
                                    <p className="text-sm font-bold text-slate-900">{forkliftToDownload.firm || '-'}</p>
                                </div>
                            )}
                            {visibleFields.locationDate && (
                                <div className="space-y-1.5">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider flex items-center gap-1"><CalendarDays className="h-2.5 w-2.5"/> Updated On</Label>
                                    <p className="text-sm font-bold text-slate-900 truncate">
                                        {forkliftToDownload.locationAssignmentDate 
                                            ? format(parseISO(forkliftToDownload.locationAssignmentDate), 'dd MMM yyyy') 
                                            : 'Not Set'}
                                    </p>
                                </div>
                            )}
                            {visibleFields.poNo && (
                                <div className="space-y-1.5">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider">PO/PI No.</Label>
                                    <p className="text-sm font-bold text-slate-900 truncate">{forkliftToDownload.poPiNumber || '-'}</p>
                                </div>
                            )}
                        </div>

                        {/* Detail Row 2: Specs */}
                        <div className="col-span-2 grid grid-cols-4 gap-2">
                            {visibleFields.capacity && (
                                <div className="space-y-1.5 text-center border-r border-slate-100 px-1">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Capacity</Label>
                                    <p className="text-[13px] font-black text-slate-900">{forkliftToDownload.capacity || '-'}</p>
                                </div>
                            )}
                            {visibleFields.type && (
                                <div className="space-y-1.5 text-center border-r border-slate-100 px-1">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider">Type</Label>
                                    <p className="text-[13px] font-black text-slate-900 truncate">{forkliftToDownload.equipmentType || '-'}</p>
                                </div>
                            )}
                            {visibleFields.voltage && (
                                <div className="space-y-1.5 text-center border-r border-slate-100 px-1">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider flex items-center justify-center gap-1"><Zap className="h-2.5 w-2.5"/> Voltage</Label>
                                    <p className="text-[13px] font-black text-slate-900">{forkliftToDownload.voltage || '-'}</p>
                                </div>
                            )}
                            {visibleFields.mastHeight && (
                                <div className="space-y-1.5 text-center px-1">
                                    <Label className="text-[9px] uppercase font-black text-slate-500 tracking-wider flex items-center justify-center gap-1"><Ruler className="h-2.5 w-2.5"/> Mast Height</Label>
                                    <p className="text-[13px] font-black text-slate-900">{forkliftToDownload.mastHeight || '-'}</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {visibleFields.siteInfo && forkliftToDownload.locationType === 'On-Site' && (
                        <div className="mt-8 p-6 bg-white rounded-2xl border-2 border-slate-100">
                            <h4 className="text-[11px] font-black text-[#10b981] uppercase tracking-[0.2em] mb-5 flex items-center gap-2.5">
                                <MapPin className="h-4 w-4" /> Site Information
                            </h4>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
                                <div className="space-y-1">
                                    <Label className="text-[9px] font-black text-slate-500 uppercase">Site / Company</Label>
                                    <p className="text-sm font-bold text-slate-900 truncate">{forkliftToDownload.siteCompany || 'N/A'}</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[9px] font-black text-slate-500 uppercase">Geographical Area</Label>
                                    <p className="text-sm font-bold text-slate-900">{forkliftToDownload.siteArea || '-'}</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[9px] font-black text-slate-500 uppercase">Contact Person</Label>
                                    <p className="text-sm font-bold text-slate-900 truncate">{forkliftToDownload.siteContactPerson || '-'}</p>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[9px] font-black text-slate-500 uppercase">Mobile Number</Label>
                                    <p className="text-sm font-bold text-slate-900">{forkliftToDownload.siteContactNumber || '-'}</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {visibleFields.remarks && (
                        <div className="mt-6 p-4 bg-slate-50 rounded-xl border border-slate-100">
                            <Label className="text-[9px] uppercase font-black text-slate-400 tracking-wider">Notes & Remarks</Label>
                            <p className="text-[11px] text-slate-600 mt-1 italic leading-relaxed">
                                {forkliftToDownload.remarks || "No additional technical remarks provided for this unit."}
                            </p>
                        </div>
                    )}

                    <div className="mt-10 pt-6 border-t border-slate-100 flex justify-between items-center italic text-[10px] text-slate-400">
                        <span>Vehicle Status Information System</span>
                        <span className="font-medium">System Generated: {format(new Date(), 'dd MMM yyyy, p')}</span>
                    </div>
                </div>
            )}
        </div>

        {/* Download Customization Dialog */}
        <Dialog open={isDownloadSettingsOpen} onOpenChange={setIsDownloadSettingsOpen}>
            <DialogContent className="max-w-[95vw] sm:max-w-lg p-0 overflow-hidden rounded-2xl border-none shadow-2xl max-h-[90vh] flex flex-col">
                <DialogHeader className="p-6 pb-0">
                    <DialogTitle className="text-xl font-black flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Download className="h-4 w-4 text-primary" />
                        </div>
                        Card Customization
                    </DialogTitle>
                    <DialogDescription className="text-xs pt-1">
                        Choose details to display for <span className="font-bold text-foreground">{forkliftToDownload?.serialNumber}</span>. Your preferences are saved automatically.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-grow overflow-y-auto p-6 pt-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-6">
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-[0.2em]">Main Details</h4>
                            <div className="space-y-3">
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-serial" checked={visibleFields.serialNumber} onCheckedChange={(c) => updateVisibleFields({serialNumber: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-serial" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Serial Number</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-makemodel" checked={visibleFields.makeModel} onCheckedChange={(c) => updateVisibleFields({makeModel: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-makemodel" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Make & Model No.</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-status" checked={visibleFields.status} onCheckedChange={(c) => updateVisibleFields({status: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-status" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Current Status</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-firm" checked={visibleFields.firm} onCheckedChange={(c) => updateVisibleFields({firm: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-firm" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Enterprise Firm</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-date" checked={visibleFields.locationDate} onCheckedChange={(c) => updateVisibleFields({locationDate: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-date" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Location Set Date</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-po" checked={visibleFields.poNo} onCheckedChange={(c) => updateVisibleFields({poNo: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-po" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">PO/PI Number</Label>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <h4 className="text-[10px] font-black uppercase text-muted-foreground/60 tracking-[0.2em]">Specifications</h4>
                            <div className="space-y-3">
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-mfg" checked={visibleFields.mfgYear} onCheckedChange={(c) => updateVisibleFields({mfgYear: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-mfg" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">MFG Year</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-capacity" checked={visibleFields.capacity} onCheckedChange={(c) => updateVisibleFields({capacity: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-capacity" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Lifting Capacity</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-type" checked={visibleFields.type} onCheckedChange={(c) => updateVisibleFields({type: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-type" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Equipment Type</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-voltage" checked={visibleFields.voltage} onCheckedChange={(c) => updateVisibleFields({voltage: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-voltage" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Battery Voltage</Label>
                                </div>
                                <div className="flex items-center space-x-3 group">
                                    <Checkbox id="field-mast" checked={visibleFields.mastHeight} onCheckedChange={(c) => updateVisibleFields({mastHeight: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-mast" className="text-sm font-medium cursor-pointer group-hover:text-primary transition-colors py-1">Mast Height</Label>
                                </div>
                                <div className="pt-2">
                                    <div className="flex items-center space-x-3 group p-2 rounded-lg bg-primary/5 border border-primary/10">
                                        <Checkbox id="field-site" checked={visibleFields.siteInfo} onCheckedChange={(c) => updateVisibleFields({siteInfo: !!c})} className="h-5 w-5" />
                                        <Label htmlFor="field-site" className="text-xs font-black uppercase tracking-tight cursor-pointer text-primary">Include Site Info</Label>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-3 group p-2 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-100 dark:border-amber-900/20">
                                    <Checkbox id="field-remarks" checked={visibleFields.remarks} onCheckedChange={(c) => updateVisibleFields({remarks: !!c})} className="h-5 w-5" />
                                    <Label htmlFor="field-remarks" className="text-xs font-black uppercase tracking-tight cursor-pointer text-amber-700 dark:text-amber-400">Include Remarks</Label>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <DialogFooter className="p-6 pt-4 border-t border-border/50 bg-muted/10 flex flex-row gap-2">
                    <Button variant="ghost" onClick={() => setIsDownloadSettingsOpen(false)} className="flex-1 h-11 rounded-xl font-bold text-muted-foreground hover:text-foreground">Cancel</Button>
                    <Button onClick={executeDownload} className="flex-1 h-11 rounded-xl font-bold bg-primary shadow-lg shadow-primary/20">
                        <Download className="mr-2 h-4 w-4" />
                        Download
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <Dialog open={isAddEditDialogOpen} onOpenChange={setIsAddEditDialogOpen}>
          <DialogContent className="max-w-[95vw] sm:max-w-2xl max-h-[90vh] flex flex-col p-0 rounded-2xl overflow-hidden border-none shadow-2xl">
            <DialogHeader className="p-6 pb-0">
              <DialogTitle className="text-2xl font-black">{selectedForklift ? 'Modify Unit' : 'Register Forklift'}</DialogTitle>
              <DialogDescription className="text-xs pt-1">
                {selectedForklift ? `Updating Serial: ${selectedForklift.serialNumber}` : 'Enter the official technical details for the new fleet unit.'}
              </DialogDescription>
            </DialogHeader>
            <div className='flex-grow overflow-y-auto px-6 py-4'>
                <ForkliftForm
                  onSubmit={handleFormSubmit}
                  onCancel={() => { setIsAddEditDialogOpen(false); }}
                  initialData={selectedForklift || undefined}
                  mode={selectedForklift ? 'edit' : 'add'}
                  companies={companies || []}
                  isLoadingCompanies={isLoadingCompanies}
                />
            </div>
            <DialogFooter className="p-6 pt-4 border-t border-border/50 bg-muted/10 flex flex-col-reverse sm:flex-row gap-3">
                 <Button variant="ghost" type="button" onClick={() => { setIsAddEditDialogOpen(false); }} className="h-11 rounded-xl font-bold text-muted-foreground hover:text-foreground">
                    Discard Changes
                </Button>
                <Button type="submit" form="forklift-form" className="h-11 rounded-xl font-bold bg-primary px-8 shadow-lg shadow-primary/20">
                  {selectedForklift ? 'Update Fleet Database' : 'Add to Active Fleet'}
                </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        
        <AlertDialog open={!!forkliftToDelete} onOpenChange={(open) => !open && setForkliftToDelete(null)}>
          <AlertDialogContent className="max-w-[90vw] sm:max-w-md rounded-2xl border-none shadow-2xl p-6">
            <AlertDialogHeader>
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-2 mx-auto sm:mx-0">
                  <Trash2 className="h-6 w-6 text-destructive" />
              </div>
              <AlertDialogTitle className="text-xl font-black">Remove from Fleet?</AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium leading-relaxed">
                This action will permanently delete unit <span className="font-bold text-foreground">"{forkliftToDelete?.serialNumber}"</span> from the database. All linked site history will be lost.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6 flex flex-col sm:flex-row gap-2">
              <AlertDialogCancel className="h-11 rounded-xl font-bold border-muted">Keep Unit</AlertDialogCancel>
              <AlertDialogAction onClick={handleDelete} className="h-11 rounded-xl font-bold bg-destructive hover:bg-destructive/90 shadow-lg shadow-destructive/20">Yes, Remove Unit</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <ForkliftImportDialog
          isOpen={isImportDialogOpen}
          onClose={() => setIsImportDialogOpen(false)}
          onImportComplete={handleImportComplete}
        />
      </div>
    </AppLayout>
  );
}
