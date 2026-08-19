
'use client';

import React from 'react';
import type { Invoice, Company, CompanySettings, DownloadOptions, BankAccount, InvoiceItem } from '@/lib/data';
import { format, parseISO } from 'date-fns';
import { ToWords } from 'to-words';
import { Separator } from './ui/separator';

interface InvoicePreviewProps {
  invoice: Invoice | null;
  company: Company | null; // This is now the client company snapshot
  myCompanyDetails: CompanySettings | null;
  downloadOptions: DownloadOptions;
}

const toWords = new ToWords({
    localeCode: 'en-IN',
    converterOptions: {
      currency: true,
      ignoreDecimal: true,
      ignoreZeroCurrency: false,
    }
});

const formatCurrency = (amount: number) => amount.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });


export function InvoicePreview({ invoice, company, myCompanyDetails, downloadOptions }: InvoicePreviewProps) {
  if (!invoice || !company || !myCompanyDetails) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        Select an invoice to see the preview. If company details are missing, they may not have been saved with the invoice.
      </div>
    );
  }
  
  const amountInWords = toWords.convert(invoice.grandTotal);
  const opts = downloadOptions;
  const selectedBank = invoice.selectedBankAccount;

  const tableBodyFontSize = invoice.documentSettings?.tableBodyFontSize || 11;
  const getColumnStyle = (columnId: 'sr_no' | keyof InvoiceItem) => {
    const column = invoice.template?.columns.find(c => c.id === columnId);
    return {
        fontSize: column?.fontSize ? `${column.fontSize}pt` : `${tableBodyFontSize}pt`,
        textAlign: column?.align || 'left',
    } as React.CSSProperties;
  }

  const discountAmount = invoice.discount || 0;
  const advanceAmount = invoice.advanceReceived || 0;
  
  const discountType = invoice.discountType || 'after_gst';

  const taxableAmount = discountType === 'before_gst' ? invoice.netTotal - discountAmount : invoice.netTotal;
  const cgst = taxableAmount * 0.09;
  const sgst = taxableAmount * 0.09;

  const subTotalAfterGst = taxableAmount + cgst + sgst;
  
  const balanceDue = invoice.grandTotal - advanceAmount;

  const billingMonthDisplay = invoice.billingMonth
    ? format(parseISO(invoice.billingMonth), 'MMM yyyy').toUpperCase()
    : format(parseISO(invoice.billDate), 'MMM yyyy').toUpperCase();

  return (
    <div className="bg-white text-black p-8 rounded-lg shadow-lg max-w-4xl mx-auto font-['Calibri',_sans-serif] text-sm">
      <header className="text-center mb-8">
        <h1 className="text-2xl font-bold uppercase tracking-wider">Invoice</h1>
      </header>

      <section className="grid grid-cols-2 gap-4 mb-8">
        <div>
          <p>To,</p>
          <p className="font-bold text-base">{company.name}</p>
          <p className="whitespace-pre-wrap">{company.address}</p>
          {opts.clientCompany.showGstin && company.gstin && <p>GSTIN: {company.gstin}</p>}
        </div>
        <div className="text-right">
          <p>
            <span className="font-bold">Bill Date: </span>
            {format(parseISO(invoice.billDate), 'dd/MM/yyyy')}
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4 mb-4">
         <div>
          <p><span className="font-bold">Bill No:</span> {invoice.billNo}-{invoice.billNoSuffix || 'MHE'}</p>
          <p><span className="font-bold">MONTH:</span> {billingMonthDisplay}</p>
        </div>
        <div className="text-right">
          <p><span className="font-bold">PO.NO:</span> {invoice.poNumber || 'AGREEMENT'}</p>
          <p><span className="font-bold">Site:</span> {invoice.site || 'N/A'}</p>
        </div>
      </section>
      
      <p className="font-bold mb-2">CHARGES AS FOLLOWS: -</p>

      <table className="w-full border-collapse border border-black mb-4">
        <thead>
          <tr>
            <th className="border border-black p-2 w-[8%]" style={getColumnStyle('sr_no')}>Sr. No</th>
            <th className="border border-black p-2" style={getColumnStyle('particulars')}>Particulars</th>
            <th className="border border-black p-2 w-[15%]" style={getColumnStyle('rate')}>Rate</th>
            <th className="border border-black p-2 w-[18%]" style={getColumnStyle('amount')}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={index}>
              <td className="border border-black p-2" style={getColumnStyle('sr_no')}>{index + 1}</td>
              <td className="border border-black p-2 whitespace-pre-wrap" style={getColumnStyle('particulars')}>{item.particulars}</td>
              <td className="border border-black p-2" style={getColumnStyle('rate')}>{item.rate || ''}</td>
              <td className="border border-black p-2" style={getColumnStyle('amount')}>{item.amount.toFixed(2)}/-</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} className="border border-black p-2 text-right font-bold">Net total=</td>
            <td className="border border-black p-2"></td>
            <td className="border border-black p-2 text-right font-bold">{formatCurrency(invoice.netTotal)}</td>
          </tr>
          {discountType === 'before_gst' && discountAmount > 0 && (
             <tr>
                <td colSpan={2} className="border border-black p-2 text-right font-bold">Discount</td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2 text-right font-bold text-red-600">- {formatCurrency(discountAmount)}</td>
             </tr>
          )}
           {discountType === 'before_gst' && discountAmount > 0 && (
             <tr>
                <td colSpan={2} className="border border-black p-2 text-right font-bold">Taxable Amount</td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2 text-right font-bold">{formatCurrency(taxableAmount)}</td>
             </tr>
          )}
          <tr>
            <td colSpan={2} className="border border-black p-2 text-right font-bold">CGST@9%</td>
             <td className="border border-black p-2"></td>
            <td className="border border-black p-2 text-right font-bold">{formatCurrency(cgst)}</td>
          </tr>
          <tr>
            <td colSpan={2} className="border border-black p-2 text-right font-bold">SGST@9%</td>
             <td className="border border-black p-2"></td>
            <td className="border border-black p-2 text-right font-bold">{formatCurrency(sgst)}</td>
          </tr>
          {discountType === 'after_gst' && discountAmount > 0 && (
             <tr>
                <td colSpan={2} className="border border-black p-2 text-right font-bold">Discount</td>
                <td className="border border-black p-2"></td>
                <td className="border border-black p-2 text-right font-bold text-red-600">- {formatCurrency(discountAmount)}</td>
             </tr>
          )}
          <tr className="font-bold text-base">
            <td colSpan={2} className="border border-black p-2 text-right">{advanceAmount > 0 ? 'GRAND TOTAL' : 'TOTAL AMOUNT PAYABLE'}</td>
             <td className="border border-black p-2"></td>
            <td className="border border-black p-2 text-right">{formatCurrency(invoice.grandTotal)}</td>
          </tr>
           {advanceAmount > 0 && (
            <>
              <tr>
                  <td colSpan={2} className="border border-black p-2 text-right font-bold">Advance Received</td>
                  <td className="border border-black p-2"></td>
                  <td className="border border-black p-2 text-right font-bold">- {formatCurrency(advanceAmount)}</td>
              </tr>
              <tr className="font-bold text-base">
                  <td colSpan={2} className="border border-black p-2 text-right">TOTAL AMOUNT PAYABLE</td>
                  <td className="border border-black p-2"></td>
                  <td className="border border-black p-2 text-right">{formatCurrency(balanceDue)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>

      <p className="mb-6">
        <span className="font-bold">In words:</span> {amountInWords}
      </p>
      
      <section className="space-y-4">
        <div className="grid grid-cols-2 gap-4 border p-4">
            <div>
                <p className="font-bold">{myCompanyDetails.companyName}</p>
                {opts.myCompany.showPan && <p><span className="font-bold">PAN CARD NO:</span> {myCompanyDetails.pan}</p>}
                {opts.myCompany.showGstin && <p><span className="font-bold">GSTIN:</span> {myCompanyDetails.gstin}</p>}
                {opts.myCompany.showSacCode && <p><span className="font-bold">SAC code:</span> {myCompanyDetails.sacCode}</p>}
                {opts.myCompany.showServiceTaxCode && myCompanyDetails.serviceTaxCode && <p><span className="font-bold">SERVICE TAX CODE:</span> {myCompanyDetails.serviceTaxCode}</p>}
            </div>
            <div>
                {opts.myCompany.showBankDetails && selectedBank && (
                <>
                    <p className="font-bold">Bank Details</p>
                    <p><span className="font-bold">Bank Name:</span> {selectedBank.bankName}</p>
                    <p><span className="font-bold">A/C No:</span> {selectedBank.accountNumber}</p>
                    <p><span className="font-bold">IFSC Code:</span> {selectedBank.ifscCode}</p>
                    <p><span className="font-bold">Branch:</span> {selectedBank.bankBranch}</p>
                </>
                )}
            </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border p-4">
            <div>
                <p className="font-bold">{company.name}</p>
            </div>
            <div>
                 {opts.clientCompany.showGstin && company.gstin && <p><span className="font-bold">GSTIN:</span> {company.gstin}</p>}
            </div>
        </div>
      </section>

      <footer className="mt-12">
        <p>Thanking you,</p>
        <p>Yours truly,</p>
        <p>For M/s {myCompanyDetails.companyName}</p>
        <br />
        <br />
        <p className="font-bold">{myCompanyDetails.contactPerson}</p>
        <p>{myCompanyDetails.contactNumber}</p>
      </footer>
    </div>
  );
}
