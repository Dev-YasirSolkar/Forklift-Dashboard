'use client';

import { useState, useCallback, useRef } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EllipsisVertical,
  Pencil,
  PlusCircle,
  Trash2,
  Download,
  CreditCard,
  Phone,
  MapPin,
  Calendar,
  Droplets,
  Shield,
  Building2,
  Heart,
  Search,
  LayoutGrid,
  List,
  Printer,
  Loader2,
  X,
  UserCheck,
} from "lucide-react";
import type { Employee } from "@/lib/data";
import { useCollection, useFirebase, useMemoFirebase } from "@/firebase";
import { collection, doc, query, orderBy } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { EmployeeForm, type EmployeeFormSubmitData } from "@/components/employee-form";
import AppLayout from "@/components/app-layout";
import {
  addDocumentNonBlocking,
  deleteDocumentNonBlocking,
  updateDocumentNonBlocking,
} from "@/firebase/non-blocking-updates";
import { cn } from "@/lib/utils";

export default function EmployeesPage() {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();

  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [isAddEditDialogOpen, setIsAddEditDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [viewIdCardEmployee, setViewIdCardEmployee] = useState<Employee | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const previewCardRef = useRef<HTMLDivElement>(null);
  const cardElementRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const employeesQuery = useMemoFirebase(
    () =>
      firestore && user
        ? query(collection(firestore, 'employees'), orderBy('createdAt', 'asc'))
        : null,
    [firestore, user]
  );
  const { data: rawEmployees, isLoading } = useCollection<Employee>(employeesQuery);

  const employees = rawEmployees || [];

  // Filtered employees
  const filteredEmployees = employees.filter((emp) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      emp.fullName?.toLowerCase().includes(q) ||
      emp.empCode?.toLowerCase().includes(q) ||
      emp.contactNumber?.includes(q) ||
      emp.specialization?.toLowerCase().includes(q) ||
      emp.currentSiteName?.toLowerCase().includes(q) ||
      emp.bloodGroup?.toLowerCase().includes(q);

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && emp.availability) ||
      (statusFilter === 'inactive' && !emp.availability);

    return matchesSearch && matchesStatus;
  });

  const handleDelayedAction = (action: () => void) => {
    setTimeout(action, 100);
  };

  const openAddEditDialog = useCallback((employee: Employee | null) => {
    setSelectedEmployee(employee);
    setIsAddEditDialogOpen(true);
  }, []);

  const openDeleteDialog = useCallback((employee: Employee) => {
    setEmployeeToDelete(employee);
  }, []);

  const handleDelete = () => {
    if (!firestore || !employeeToDelete) return;

    const employeeDocRef = doc(firestore, 'employees', employeeToDelete.id);
    deleteDocumentNonBlocking(employeeDocRef);

    toast({
      title: "Employee Deleted",
      description: `Employee ${employeeToDelete.fullName} has been removed.`,
    });

    setEmployeeToDelete(null);
  };

  const handleFormSubmit = (formData: EmployeeFormSubmitData) => {
    if (!firestore) return;

    if (selectedEmployee) {
      const employeeDocRef = doc(firestore, 'employees', selectedEmployee.id);
      updateDocumentNonBlocking(employeeDocRef, formData);
      toast({ title: "Success", description: "Employee updated successfully." });
    } else {
      const employeesCollection = collection(firestore, 'employees');
      addDocumentNonBlocking(employeesCollection, {
        ...formData,
        createdAt: new Date().toISOString(),
      });
      toast({ title: "Success", description: "Employee added successfully." });
    }

    setIsAddEditDialogOpen(false);
    setSelectedEmployee(null);
  };

  // High-Resolution ID Card Download
  const downloadCardAsImage = useCallback(
    async (employee: Employee, customElement?: HTMLElement | null) => {
      const targetEl = customElement || cardElementRefs.current[employee.id] || previewCardRef.current;
      if (!targetEl) {
        toast({
          variant: 'destructive',
          title: "Download Error",
          description: "ID Card element not ready. Please try again.",
        });
        return;
      }

      setDownloadingId(employee.id);
      try {
        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(targetEl, {
          scale: 3,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        const link = document.createElement('a');
        const sanitizedName = (employee.fullName || 'Employee').replace(/\s+/g, '_');
        link.download = `${sanitizedName}_ID_CARD.png`;
        link.href = canvas.toDataURL('image/png', 1.0);
        link.click();

        toast({
          title: "ID Card Downloaded",
          description: `${employee.fullName} ka ID card high-resolution PNG image me save ho gaya.`,
        });
      } catch (err) {
        console.error('ID Card download error:', err);
        toast({
          variant: 'destructive',
          title: "Download Failed",
          description: "ID card image generation failed. Please try again.",
        });
      } finally {
        setDownloadingId(null);
      }
    },
    [toast]
  );

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const maskAadhaar = (aadhaar?: string) => {
    if (!aadhaar) return '—';
    const digits = aadhaar.replace(/\s/g, '');
    if (digits.length < 8) return aadhaar;
    return 'XXXX XXXX ' + digits.slice(-4);
  };

  const printIdCard = () => {
    window.print();
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-5 sm:gap-6">
        {/* ─── PAGE HEADER WITH SEARCH & CONTROLS ─── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-4 sm:p-5 rounded-2xl border shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold">
                <CreditCard className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight">
                  Employee ID Cards
                </h1>
                <p className="text-xs text-muted-foreground">
                  View, edit & download high-resolution employee ID cards
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* View Mode Toggle: Cards vs Table */}
            <div className="inline-flex items-center rounded-xl border bg-muted/40 p-1">
              <Button
                variant={viewMode === 'cards' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-xs font-bold gap-1.5 rounded-lg"
                onClick={() => setViewMode('cards')}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>ID Cards</span>
              </Button>
              <Button
                variant={viewMode === 'table' ? 'default' : 'ghost'}
                size="sm"
                className="h-8 px-3 text-xs font-bold gap-1.5 rounded-lg"
                onClick={() => setViewMode('table')}
              >
                <List className="h-3.5 w-3.5" />
                <span>Table</span>
              </Button>
            </div>

            {/* Add Employee Button */}
            <Button
              onClick={() => openAddEditDialog(null)}
              size="sm"
              className="h-9 px-4 text-xs font-bold gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-sm"
            >
              <PlusCircle className="h-4 w-4" />
              <span>Add Employee</span>
            </Button>
          </div>
        </div>

        {/* ─── SEARCH & FILTER TOOLBAR ─── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card px-4 py-3 rounded-xl border">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, ID code, mobile, site..."
              className="pl-9 h-9 text-xs rounded-lg"
            />
          </div>

          <div className="flex items-center gap-2 justify-between sm:justify-end">
            <div className="flex items-center gap-1">
              <Button
                variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[11px] font-bold px-2.5 rounded-md"
                onClick={() => setStatusFilter('all')}
              >
                All ({employees.length})
              </Button>
              <Button
                variant={statusFilter === 'active' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[11px] font-bold px-2.5 rounded-md text-green-700 dark:text-green-400"
                onClick={() => setStatusFilter('active')}
              >
                Active ({employees.filter((e) => e.availability).length})
              </Button>
              <Button
                variant={statusFilter === 'inactive' ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-[11px] font-bold px-2.5 rounded-md text-muted-foreground"
                onClick={() => setStatusFilter('inactive')}
              >
                Inactive ({employees.filter((e) => !e.availability).length})
              </Button>
            </div>
          </div>
        </div>

        {/* ─── MAIN CONTENT VIEW ─── */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            <p className="text-sm font-medium">Loading employee records...</p>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="text-center p-16 border rounded-2xl bg-card space-y-3">
            <CreditCard className="h-10 w-10 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-base font-bold">No Employees Found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {searchQuery
                ? `No employees match "${searchQuery}". Try a different keyword.`
                : "No employees added yet. Click 'Add Employee' to create your first employee ID."}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => openAddEditDialog(null)}
                size="sm"
                className="h-8 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 mt-2"
              >
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Add Employee
              </Button>
            )}
          </div>
        ) : viewMode === 'cards' ? (
          /* ═══════════════════════════════════════════════════════════
             ID CARDS GALLERY VIEW (PHYSICAL ID BADGE DESIGN)
             ═══════════════════════════════════════════════════════════ */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
            {filteredEmployees.map((employee) => {
              const initials = employee.fullName
                .split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2);

              const isDownloadingThis = downloadingId === employee.id;

              return (
                <div
                  key={employee.id}
                  className="flex flex-col items-center group transition-all duration-300"
                >
                  {/* Lanyard Top Attachment Slot Indicator */}
                  <div className="w-14 h-3 bg-muted-foreground/30 rounded-t-md -mb-1 flex items-center justify-center z-10">
                    <div className="w-8 h-1.5 bg-background rounded-full" />
                  </div>

                  {/* ID Card Shell */}
                  <div
                    ref={(el) => {
                      cardElementRefs.current[employee.id] = el;
                    }}
                    className="w-full max-w-[390px] rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl transition-shadow border border-border/60 bg-card text-card-foreground flex flex-col"
                    style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
                  >
                    {/* ─── CARD HEADER — Company Branding ─── */}
                    <div className="relative bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 px-4 pt-3.5 pb-12 text-white">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-black text-xs sm:text-sm tracking-wider uppercase leading-none">
                            Vithal Enterprises
                          </h3>
                          <p className="text-indigo-200 text-[8px] sm:text-[9px] font-semibold tracking-wide mt-1">
                            FORKLIFT SERVICES & HIRE
                          </p>
                        </div>
                        <div className="bg-white/20 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/20">
                          <span className="text-white text-[9px] font-black tracking-widest uppercase">
                            EMPLOYEE ID
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ─── AVATAR + NAME OVERLAP SECTION ─── */}
                    <div className="relative px-4 -mt-9 pb-2">
                      <div className="flex items-end gap-3.5">
                        {/* Profile Photo */}
                        <div className="relative shrink-0">
                          {employee.photoUrl ? (
                            <img
                              src={employee.photoUrl}
                              alt={employee.fullName}
                              className="h-18 w-18 sm:h-20 sm:w-20 rounded-xl object-cover border-4 border-card shadow-md bg-muted"
                            />
                          ) : (
                            <div className="h-18 w-18 sm:h-20 sm:w-20 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 border-4 border-card shadow-md flex items-center justify-center">
                              <span className="text-white text-xl sm:text-2xl font-black">
                                {initials}
                              </span>
                            </div>
                          )}
                          {/* Blood Group Corner Tag */}
                          {employee.bloodGroup && (
                            <span className="absolute -bottom-1 -right-1 bg-red-600 text-white text-[9px] font-black px-1.5 py-0.2 rounded-md shadow-sm border border-white dark:border-card">
                              {employee.bloodGroup}
                            </span>
                          )}
                        </div>

                        {/* Name & Role */}
                        <div className="min-w-0 pb-1 flex-1">
                          <h2 className="text-sm sm:text-base font-black tracking-tight truncate leading-tight">
                            {employee.fullName}
                          </h2>
                          <p className="text-[11px] text-muted-foreground font-semibold truncate">
                            {employee.specialization || 'Employee'}
                          </p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {employee.empCode && (
                              <span className="inline-block bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[9px] font-bold px-1.5 py-0.2 rounded">
                                ID: {employee.empCode}
                              </span>
                            )}
                            <Badge
                              variant={employee.availability ? 'outline' : 'secondary'}
                              className={cn(
                                'text-[9px] py-0 px-1.5 h-4 font-bold',
                                employee.availability
                                  ? 'border-green-600/40 text-green-700 dark:text-green-400 bg-green-500/10'
                                  : 'text-muted-foreground'
                              )}
                            >
                              {employee.availability ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ─── CARD BODY: ALL 14 FIELDS ─── */}
                    <div className="px-4 py-2 space-y-2 text-xs flex-1">
                      {/* Grid 1: Mobile + DOB */}
                      <div className="grid grid-cols-2 gap-2 p-2 bg-muted/20 rounded-lg">
                        <FieldItem
                          icon={<Phone className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Mobile Number"
                          value={employee.contactNumber || '—'}
                        />
                        <FieldItem
                          icon={<Calendar className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Date of Birth"
                          value={formatDate(employee.dateOfBirth)}
                        />
                      </div>

                      {/* Grid 2: Blood Group + DOJ */}
                      <div className="grid grid-cols-2 gap-2 p-2 bg-muted/20 rounded-lg">
                        <FieldItem
                          icon={<Droplets className="h-3 w-3 text-red-500" />}
                          label="Blood Group"
                          value={employee.bloodGroup || '—'}
                        />
                        <FieldItem
                          icon={<Calendar className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Date of Joining"
                          value={formatDate(employee.doj)}
                        />
                      </div>

                      {/* Grid 3: Aadhaar + PAN */}
                      <div className="grid grid-cols-2 gap-2 p-2 bg-muted/20 rounded-lg">
                        <FieldItem
                          icon={<Shield className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Aadhaar Card"
                          value={maskAadhaar(employee.aadhaarNumber)}
                          mono
                        />
                        <FieldItem
                          icon={<Shield className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="PAN Card"
                          value={employee.panNumber || '—'}
                          mono
                        />
                      </div>

                      {/* Grid 4: Current Site + Address */}
                      <div className="grid grid-cols-2 gap-2 p-2 bg-muted/20 rounded-lg">
                        <FieldItem
                          icon={<Building2 className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Current Site"
                          value={employee.currentSiteName || employee.workLocation || '—'}
                          truncate
                        />
                        <FieldItem
                          icon={<MapPin className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />}
                          label="Current Address"
                          value={employee.currentAddress || employee.permanentAddress || '—'}
                          truncate
                        />
                      </div>

                      {/* Emergency Contact Banner */}
                      {employee.emergencyContactName && (
                        <div className="bg-red-50 dark:bg-red-950/30 rounded-lg px-2.5 py-1.5 border border-red-200/60 dark:border-red-900/40">
                          <div className="flex items-center gap-1 mb-0.5">
                            <Heart className="h-2.5 w-2.5 text-red-600" />
                            <span className="text-[8px] font-black uppercase text-red-600 dark:text-red-400 tracking-wider">
                              Emergency Contact
                            </span>
                          </div>
                          <div className="flex items-center justify-between text-[11px] leading-tight">
                            <span className="font-bold">
                              {employee.emergencyContactName}
                              {employee.emergencyContactRelationship && (
                                <span className="text-muted-foreground font-normal">
                                  {' '}
                                  ({employee.emergencyContactRelationship})
                                </span>
                              )}
                            </span>
                            <span className="font-semibold text-muted-foreground font-mono">
                              {employee.emergencyContactNumber || ''}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ─── CARD FOOTER: Actions ─── */}
                    <div className="bg-muted/40 border-t p-2.5 flex items-center justify-between gap-1.5">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-[10px] font-bold px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white gap-1 rounded-lg flex-1 shadow-xs"
                        disabled={isDownloadingThis}
                        onClick={() => downloadCardAsImage(employee)}
                      >
                        {isDownloadingThis ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        <span>{isDownloadingThis ? 'Saving...' : 'Download ID'}</span>
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] font-bold px-2 rounded-lg"
                        onClick={() => setViewIdCardEmployee(employee)}
                        title="View Full ID Card"
                      >
                        <CreditCard className="h-3 w-3" />
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] font-bold px-2 rounded-lg"
                        onClick={() => openAddEditDialog(employee)}
                        title="Edit Employee"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[10px] font-bold px-2 text-destructive hover:bg-destructive/10 rounded-lg"
                        onClick={() => openDeleteDialog(employee)}
                        title="Delete Employee"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ═══════════════════════════════════════════════════════════
             TABLE VIEW
             ═══════════════════════════════════════════════════════════ */
          <Card className="rounded-2xl overflow-hidden border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="font-bold">Employee</TableHead>
                  <TableHead className="font-bold">Designation</TableHead>
                  <TableHead className="font-bold">Mobile</TableHead>
                  <TableHead className="font-bold">Blood Group</TableHead>
                  <TableHead className="font-bold">Current Site</TableHead>
                  <TableHead className="font-bold">Aadhaar</TableHead>
                  <TableHead className="font-bold">PAN</TableHead>
                  <TableHead className="font-bold">Emergency Contact</TableHead>
                  <TableHead className="font-bold">DOJ</TableHead>
                  <TableHead className="font-bold">Status</TableHead>
                  <TableHead className="text-right font-bold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmployees.map((employee) => (
                  <TableRow key={employee.id} className="hover:bg-muted/40 transition-colors">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        {employee.photoUrl ? (
                          <img
                            src={employee.photoUrl}
                            alt={employee.fullName}
                            className="h-9 w-9 rounded-lg object-cover border shrink-0"
                          />
                        ) : (
                          <div className="shrink-0 h-9 w-9 rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600 flex items-center justify-center text-white text-[11px] font-black">
                            {employee.fullName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{employee.fullName}</div>
                          {employee.empCode && (
                            <span className="text-[10px] text-muted-foreground font-mono">
                              {employee.empCode}
                            </span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs font-semibold">
                      {employee.specialization || '—'}
                    </TableCell>
                    <TableCell className="text-xs font-medium font-mono">
                      {employee.contactNumber || '—'}
                    </TableCell>
                    <TableCell>
                      {employee.bloodGroup ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-black border-red-300 text-red-600 bg-red-500/10"
                        >
                          {employee.bloodGroup}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs max-w-[130px] truncate">
                      {employee.currentSiteName || employee.workLocation || '—'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {maskAadhaar(employee.aadhaarNumber)}
                    </TableCell>
                    <TableCell className="text-xs font-mono uppercase">
                      {employee.panNumber || '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {employee.emergencyContactName ? (
                        <div>
                          <div className="font-semibold">{employee.emergencyContactName}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {employee.emergencyContactNumber || ''}
                          </div>
                        </div>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(employee.doj)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={employee.availability ? 'outline' : 'secondary'}
                        className={cn(
                          'text-[10px] font-bold',
                          employee.availability
                            ? 'border-green-600/40 text-green-700 bg-green-500/10'
                            : ''
                        )}
                      >
                        {employee.availability ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-indigo-600"
                          onClick={() => setViewIdCardEmployee(employee)}
                          title="View ID Card"
                        >
                          <CreditCard className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => downloadCardAsImage(employee)}
                          title="Download ID as Image"
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => openAddEditDialog(employee)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive"
                          onClick={() => openDeleteDialog(employee)}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* ─── ADD / EDIT EMPLOYEE DIALOG ─── */}
      <Dialog open={isAddEditDialogOpen} onOpenChange={setIsAddEditDialogOpen}>
        <DialogContent className="max-w-[95vw] sm:max-w-xl max-h-[92vh] flex flex-col p-0 overflow-hidden rounded-2xl">
          <DialogHeader className="p-6 pb-2 border-b bg-muted/20">
            <DialogTitle className="text-lg font-black tracking-tight flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-indigo-600" />
              <span>{selectedEmployee ? 'Edit Employee Details' : 'Add New Employee'}</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Fill in employee identity, KYC documents, emergency contact, site assignment, and ID card photo.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-grow overflow-y-auto px-6 py-4">
            <EmployeeForm
              onSubmit={handleFormSubmit}
              initialData={selectedEmployee || undefined}
              mode={selectedEmployee ? 'edit' : 'add'}
            />
          </div>
          <DialogFooter className="p-4 border-t bg-muted/10 flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() => setIsAddEditDialogOpen(false)}
              className="h-10 px-5 rounded-xl font-bold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="employee-form"
              className="h-10 px-7 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
            >
              {selectedEmployee ? 'Update Employee' : 'Save Employee'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── FULL ID CARD MODAL PREVIEW & DOWNLOAD ─── */}
      <Dialog
        open={!!viewIdCardEmployee}
        onOpenChange={(open) => !open && setViewIdCardEmployee(null)}
      >
        <DialogContent className="max-w-[95vw] sm:max-w-[460px] p-0 overflow-hidden bg-transparent border-0 shadow-none">
          {viewIdCardEmployee && (
            <div className="flex flex-col items-center gap-3">
              {/* Close Button */}
              <div className="w-full flex justify-end">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-8 w-8 rounded-full shadow-lg bg-card hover:bg-accent"
                  onClick={() => setViewIdCardEmployee(null)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Printable ID Card Element */}
              <div
                ref={previewCardRef}
                className="w-full max-w-[420px] rounded-2xl overflow-hidden shadow-2xl border border-border/40 bg-card text-card-foreground"
                style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
              >
                {/* ─── CARD HEADER — Brand Stripe ─── */}
                <div className="relative bg-gradient-to-r from-indigo-700 via-blue-700 to-indigo-800 px-5 pt-4 pb-14 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-black text-sm tracking-wider uppercase leading-none">
                        Vithal Enterprises
                      </h3>
                      <p className="text-indigo-200 text-[9px] font-medium tracking-wide mt-1">
                        FORKLIFT HIRE • SERVICE • SOLUTIONS
                      </p>
                    </div>
                    <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full border border-white/20">
                      <span className="text-white text-[10px] font-black tracking-wider uppercase">
                        EMPLOYEE ID
                      </span>
                    </div>
                  </div>
                </div>

                {/* ─── AVATAR + NAME ─── */}
                <div className="relative px-5 -mt-10 pb-3">
                  <div className="flex items-end gap-4">
                    <div className="relative shrink-0">
                      {viewIdCardEmployee.photoUrl ? (
                        <img
                          src={viewIdCardEmployee.photoUrl}
                          alt={viewIdCardEmployee.fullName}
                          className="h-20 w-20 rounded-xl object-cover border-4 border-card shadow-lg bg-muted"
                        />
                      ) : (
                        <div className="h-20 w-20 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600 border-4 border-card shadow-lg flex items-center justify-center">
                          <span className="text-white text-2xl font-black">
                            {viewIdCardEmployee.fullName
                              .split(' ')
                              .map((n) => n[0])
                              .join('')
                              .toUpperCase()
                              .slice(0, 2)}
                          </span>
                        </div>
                      )}
                      {viewIdCardEmployee.bloodGroup && (
                        <span className="absolute -bottom-1 -right-1 bg-red-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-sm border border-white dark:border-card">
                          {viewIdCardEmployee.bloodGroup}
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 pb-1 flex-1">
                      <h2 className="text-base font-black tracking-tight truncate leading-tight">
                        {viewIdCardEmployee.fullName}
                      </h2>
                      <p className="text-xs text-muted-foreground font-semibold truncate">
                        {viewIdCardEmployee.specialization || 'Employee'}
                      </p>
                      {viewIdCardEmployee.empCode && (
                        <span className="inline-block mt-0.5 bg-indigo-100 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-md">
                          ID: {viewIdCardEmployee.empCode}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* ─── CARD DETAILS ─── */}
                <div className="px-5 pb-4 space-y-2.5">
                  <div className="grid grid-cols-2 gap-3">
                    <FieldItem
                      icon={<Phone className="h-3 w-3 text-indigo-600" />}
                      label="Mobile Number"
                      value={viewIdCardEmployee.contactNumber || '—'}
                    />
                    <FieldItem
                      icon={<Calendar className="h-3 w-3 text-indigo-600" />}
                      label="Date of Birth"
                      value={formatDate(viewIdCardEmployee.dateOfBirth)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FieldItem
                      icon={<Droplets className="h-3 w-3 text-red-500" />}
                      label="Blood Group"
                      value={viewIdCardEmployee.bloodGroup || '—'}
                    />
                    <FieldItem
                      icon={<Calendar className="h-3 w-3 text-indigo-600" />}
                      label="Date of Joining"
                      value={formatDate(viewIdCardEmployee.doj)}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FieldItem
                      icon={<Shield className="h-3 w-3 text-indigo-600" />}
                      label="Aadhaar Card"
                      value={maskAadhaar(viewIdCardEmployee.aadhaarNumber)}
                      mono
                    />
                    <FieldItem
                      icon={<Shield className="h-3 w-3 text-indigo-600" />}
                      label="PAN Card"
                      value={viewIdCardEmployee.panNumber || '—'}
                      mono
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <FieldItem
                      icon={<Building2 className="h-3 w-3 text-indigo-600" />}
                      label="Current Site"
                      value={viewIdCardEmployee.currentSiteName || viewIdCardEmployee.workLocation || '—'}
                    />
                    <FieldItem
                      icon={<MapPin className="h-3 w-3 text-indigo-600" />}
                      label="Address"
                      value={viewIdCardEmployee.currentAddress || viewIdCardEmployee.permanentAddress || '—'}
                      truncate
                    />
                  </div>

                  {viewIdCardEmployee.emergencyContactName && (
                    <div className="bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2 border border-red-200/60 dark:border-red-900/40">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <Heart className="h-3 w-3 text-red-600" />
                        <span className="text-[9px] font-black uppercase text-red-600 dark:text-red-400 tracking-wider">
                          Emergency Contact
                        </span>
                      </div>
                      <p className="text-xs font-bold leading-tight">
                        {viewIdCardEmployee.emergencyContactName}
                        {viewIdCardEmployee.emergencyContactRelationship && (
                          <span className="text-muted-foreground font-normal">
                            {' '}
                            ({viewIdCardEmployee.emergencyContactRelationship})
                          </span>
                        )}
                      </p>
                      {viewIdCardEmployee.emergencyContactNumber && (
                        <p className="text-[11px] text-muted-foreground font-semibold font-mono">
                          {viewIdCardEmployee.emergencyContactNumber}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* ─── CARD FOOTER ─── */}
                <div className="bg-muted/40 border-t px-5 py-2.5 flex items-center justify-between text-[9px] text-muted-foreground">
                  <span>Property of Vithal Enterprises. If found, please return.</span>
                  <span className="font-bold">
                    {viewIdCardEmployee.availability ? '🟢 Active' : '🔴 Inactive'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="w-full max-w-[420px] flex gap-2">
                <Button
                  onClick={() => downloadCardAsImage(viewIdCardEmployee, previewCardRef.current)}
                  className="flex-1 h-11 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold gap-2 rounded-xl shadow-lg"
                  disabled={downloadingId === viewIdCardEmployee.id}
                >
                  {downloadingId === viewIdCardEmployee.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  <span>
                    {downloadingId === viewIdCardEmployee.id
                      ? 'Downloading Image...'
                      : 'Download ID as Image'}
                  </span>
                </Button>

                <Button
                  variant="outline"
                  onClick={printIdCard}
                  className="h-11 px-4 font-bold rounded-xl bg-card gap-1.5 shadow-md"
                  title="Print ID Card"
                >
                  <Printer className="h-4 w-4" />
                  <span>Print</span>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── DELETE CONFIRMATION ─── */}
      <AlertDialog
        open={!!employeeToDelete}
        onOpenChange={(open) => !open && setEmployeeToDelete(null)}
      >
        <AlertDialogContent className="max-w-[90vw] sm:max-w-md p-4 sm:p-6 rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Employee?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <span className="font-bold">{employeeToDelete?.fullName}</span>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="h-9 rounded-xl font-bold">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="h-9 rounded-xl font-bold bg-destructive hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}

/* ───── Helper Info Field Component ───── */
function FieldItem({
  icon,
  label,
  value,
  mono,
  truncate,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 mb-0.5 text-muted-foreground">
        {icon}
        <span className="text-[8px] sm:text-[9px] font-bold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p
        className={cn(
          "text-[11px] sm:text-xs font-semibold leading-tight",
          mono && "font-mono",
          truncate && "truncate"
        )}
      >
        {value}
      </p>
    </div>
  );
}
