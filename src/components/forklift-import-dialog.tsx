
'use client';

import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useDropzone } from 'react-dropzone';
import * as XLSX from 'xlsx';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Forklift } from '@/lib/data';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { FileDown, FileUp, ListChecks, X } from 'lucide-react';
import { Progress } from './ui/progress';

interface ForkliftImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: (count: number) => void;
}

// User-defined header to internal field mapping
const columnMapping: Record<string, keyof Forklift> = {
  'SR.NO': 'srNumber',
  'Equipment Type': 'equipmentType',
  'Company Make': 'make',
  'Model No.': 'model',
  'Serial No.': 'serialNumber',
  'Mfg': 'year',
  'Voltage': 'voltage',
  'Capacity (TON)': 'capacity',
  'Mast Height': 'mastHeight',
  'Site': 'siteCompany',
  'AREA': 'siteArea',
  'Company Contact Person': 'siteContactPerson',
  'Mobile': 'siteContactNumber',
  'Sold To': 'soldToCustomer',
  'Sold Date': 'soldDate',
  'Sale Price': 'salePrice',
  'Sale Remarks': 'soldRemarks',
};

const userVisibleHeaders = Object.keys(columnMapping);
const internalFields = Object.values(columnMapping);
const requiredFields: (keyof Forklift)[] = ['serialNumber', 'make', 'model', 'year'];
const requiredHeaders = userVisibleHeaders.filter(header => requiredFields.includes(columnMapping[header]));


export function ForkliftImportDialog({ isOpen, onClose, onImportComplete }: ForkliftImportDialogProps) {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
  });

  const handleImport = async () => {
    if (files.length === 0 || !firestore) return;
    setIsProcessing(true);
    setProgress(0);

    const file = files[0];
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[] = XLSX.utils.sheet_to_json(worksheet);

        if (json.length === 0) {
          toast({ variant: 'destructive', title: 'Import Error', description: 'The file is empty.' });
          resetState();
          return;
        }
        
        const headers = Object.keys(json[0]);
        const missingHeaders = requiredHeaders.filter(header => !headers.includes(header));

        if (missingHeaders.length > 0) {
          toast({
            variant: 'destructive',
            title: 'Import Error',
            description: `Missing required columns: ${missingHeaders.join(', ')}`,
          });
          resetState();
          return;
        }

        let importedCount = 0;
        const totalRecords = json.length;

        for (let i = 0; i < totalRecords; i++) {
          const record = json[i];
          const newForklift: Partial<Forklift> = {};
          
          for (const header of userVisibleHeaders) {
              if (record[header] !== undefined && record[header] !== null) {
                  const internalField = columnMapping[header];
                  if(internalField) {
                    (newForklift as any)[internalField] = record[header];
                  }
              }
          }
          
          if(newForklift.year && typeof newForklift.year === 'string') {
            newForklift.year = parseInt(newForklift.year, 10);
          } else if (!newForklift.year) {
             newForklift.year = new Date().getFullYear();
          }

          if (newForklift.soldToCustomer) {
            newForklift.locationType = 'Sold';
          } else if (newForklift.siteCompany) {
            newForklift.locationType = 'On-Site';
          } else {
            newForklift.locationType = 'Workshop';
          }
          
          await addDocumentNonBlocking(collection(firestore, 'forklifts'), newForklift);
          importedCount++;
          setProgress(Math.round((importedCount / totalRecords) * 100));
        }

        onImportComplete(importedCount);
      } catch (error) {
        console.error('Import error:', error);
        toast({ variant: 'destructive', title: 'Import Error', description: 'Failed to read or process the file.' });
      } finally {
        resetState();
      }
    };
    
    reader.onerror = () => {
      console.error('File reading error');
      toast({ variant: 'destructive', title: 'File Error', description: 'Could not read the selected file.' });
      resetState();
    };

    reader.readAsBinaryString(file);
  };
  
  const resetState = () => {
      setIsProcessing(false);
      setFiles([]);
      setProgress(0);
  }

  const handleDownloadSample = () => {
    const csvContent = userVisibleHeaders.join(',') + '\n';
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-s8;' });
    const link = document.createElement('a');
    if (link.href) {
      URL.revokeObjectURL(link.href);
    }
    link.href = URL.createObjectURL(blob);
    link.download = 'sample_forklifts.csv';
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={!isProcessing ? onClose : undefined}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Forklifts from Excel/CSV</DialogTitle>
          <DialogDescription>
            Upload a file to bulk-add forklifts to your fleet.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-6">
            {!isProcessing ? (
                <>
                <div 
                    {...getRootProps()} 
                    className={`p-10 border-2 border-dashed rounded-lg text-center cursor-pointer transition-colors ${isDragActive ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'}`}
                >
                    <input {...getInputProps()} />
                    <div className='flex flex-col items-center gap-2 text-muted-foreground'>
                        <FileUp className="h-8 w-8" />
                        {isDragActive ? (
                        <p>Drop the file here...</p>
                        ) : (
                        <p>Drag & drop a file here, or click to select</p>
                        )}
                        <p className="text-xs">Supports .xlsx and .csv files</p>
                    </div>
                </div>

                {files.length > 0 && (
                    <div>
                        <h4 className="font-medium mb-2">Selected file:</h4>
                        <div className="flex items-center justify-between p-2.5 bg-muted/50 border rounded-md">
                            <p className="text-sm font-mono truncate">{files[0].name}</p>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setFiles([])}>
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}

                <Alert>
                    <ListChecks className="h-4 w-4" />
                    <AlertTitle>Required Columns</AlertTitle>
                    <AlertDescription className="flex flex-wrap gap-x-2 text-xs">
                        {requiredHeaders.map(field => <code key={field} className="font-mono bg-muted/60 px-1.5 py-0.5 rounded">{field}</code>)}
                    </AlertDescription>
                </Alert>
                </>
            ) : (
                <div className='flex flex-col items-center justify-center gap-4 py-8'>
                    <p>Processing your file, please wait...</p>
                    <Progress value={progress} className="w-full" />
                    <p className='text-sm text-muted-foreground'>{progress}% complete</p>
                </div>
            )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleDownloadSample}>
            <FileDown className="mr-2 h-4 w-4" />
            Download Sample
          </Button>
          <div className="flex-grow"></div>
          <Button variant="outline" onClick={onClose} disabled={isProcessing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={files.length === 0 || isProcessing}>
            {isProcessing ? 'Importing...' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
