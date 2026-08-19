
'use client';

import { Packer, Document, Paragraph, TextRun, AlignmentType, BorderStyle, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, WidthType, VerticalAlign, PageOrientation } from 'docx';
import { saveAs } from 'file-saver';
import { format, parseISO } from 'date-fns';
import { ToWords } from 'to-words';
import type { Salary, Employee, CompanySettings } from './data';

const toWords = new ToWords({
    localeCode: 'en-IN',
    converterOptions: {
      currency: true,
      ignoreDecimal: true,
      ignoreZeroCurrency: false,
    }
});

export const generateSalarySlip = async (salary: Salary, employee: Employee, company: CompanySettings) => {
    const netSalaryWords = toWords.convert(salary.netSalary).toUpperCase();
    const monthDisplay = format(parseISO(`${salary.month}-01`), 'MMMM yyyy').toUpperCase();
    const paymentDateDisplay = salary.paymentDate ? format(parseISO(salary.paymentDate), 'dd/MM/yyyy') : 'N/A';
    const dojDisplay = employee.doj ? format(parseISO(employee.doj), 'dd/MM/yyyy') : 'N/A';
    const bankDisplay = employee.bankAccountNumber ? `****${employee.bankAccountNumber.slice(-4)}` : 'N/A';

    const grossEarnings = (salary.baseSalary || 0) + (salary.hra || 0) + (salary.conveyance || 0) + (salary.medical || 0) + (salary.special || 0) + (salary.bonus || 0) + (salary.ot || 0);
    const totalDeductions = (salary.pf || 0) + (salary.esic || 0) + (salary.tds || 0) + (salary.advance || 0) + (salary.otherDeductions || 0) + (salary.lwf || 0) + (salary.absentDeduction || 0);

    const cellMargins = { top: 80, bottom: 80, left: 100, right: 100 };
    const borderStyle = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

    const doc = new Document({
        styles: {
            default: {
                document: {
                    run: {
                        font: "Calibri",
                    },
                },
            },
        },
        sections: [{
            properties: {
                page: {
                    size: {
                        width: 11906,
                        height: 16838,
                    },
                    margin: { top: 720, right: 720, bottom: 720, left: 720 },
                },
            },
            children: [
                // Header: Company Details
                new Paragraph({
                    children: [new TextRun({ text: company.companyName.toUpperCase(), bold: true, size: 28, font: "Calibri" })],
                    alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                    children: [new TextRun({ text: company.address, size: 16, font: "Calibri" })],
                    alignment: AlignmentType.CENTER,
                }),
                ...(company.gstin && salary.showGstin !== false ? [
                    new Paragraph({
                        children: [new TextRun({ text: `GSTIN: ${company.gstin}`, bold: true, size: 16, font: "Calibri" })],
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 100 },
                    })
                ] : [
                    new Paragraph({ text: "", spacing: { after: 100 } })
                ]),
                
                // Line Separator
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [new DocxTableRow({ children: [new DocxTableCell({ children: [], borders: { top: borderStyle, bottom: noBorder, left: noBorder, right: noBorder } })] })]
                }),

                new Paragraph({
                    children: [new TextRun({ text: `SALARY SLIP - ${monthDisplay}`, bold: true, size: 22, font: "Calibri" })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 200, after: 300 },
                }),

                // Employee Information Section
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    borders: {
                        top: noBorder,
                        bottom: noBorder,
                        left: noBorder,
                        right: noBorder,
                        insideHorizontal: noBorder,
                        insideVertical: noBorder,
                    },
                    rows: [
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ children: [new TextRun({ text: "Employee Name: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: employee.fullName, size: 16, font: "Calibri" })] })],
                                    margins: { left: 0 },
                                }),
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ children: [new TextRun({ text: "Salary Month: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: monthDisplay, size: 16, font: "Calibri" })] })],
                                    margins: { left: 0 },
                                }),
                            ],
                        }),
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Employee ID: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: employee.empCode || 'N/A', size: 16, font: "Calibri" })] })],
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Total Work Days: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: String(salary.workingDays || 0), size: 16, font: "Calibri" })] })],
                                }),
                            ],
                        }),
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Designation: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: employee.specialization || 'N/A', size: 16, font: "Calibri" })] })],
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Present Days: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: String(salary.presentDays || 0), size: 16, font: "Calibri" })] })],
                                }),
                            ],
                        }),
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Date of Joining: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: dojDisplay, size: 16, font: "Calibri" })] })],
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Leave / Absent: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: String(salary.absentDays || 0), size: 16, font: "Calibri" })] })],
                                }),
                            ],
                        }),
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "PAN Number: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: employee.panNumber || 'N/A', size: 16, font: "Calibri" })] })],
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Pay Date: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: paymentDateDisplay, size: 16, font: "Calibri" })] })],
                                }),
                            ],
                        }),
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "UAN Number: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: employee.uanNumber || 'N/A', size: 16, font: "Calibri" })] })],
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ children: [new TextRun({ text: "Bank Account: ", bold: true, size: 16, font: "Calibri" }), new TextRun({ text: `${employee.bankName || ''} (${bankDisplay})`, size: 16, font: "Calibri" })] })],
                                }),
                            ],
                        }),
                    ],
                }),

                new Paragraph({ text: "", spacing: { before: 300 } }),

                // Earnings & Deductions Tables
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "EARNINGS", bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.CENTER })], borders: { top: borderStyle, bottom: borderStyle, left: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "AMOUNT (INR)", bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.CENTER })], borders: { top: borderStyle, bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "DEDUCTIONS", bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.CENTER })], borders: { top: borderStyle, bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "AMOUNT (INR)", bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.CENTER })], borders: { top: borderStyle, bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                            ]
                        }),
                        // Rows
                        ...[
                            { e: "Basic Salary", ev: salary.baseSalary, d: "Absent Deduction", dv: salary.absentDeduction },
                            { e: "H.R.A.", ev: salary.hra, d: "Provident Fund (PF)", dv: salary.pf },
                            { e: "Conveyance Allw.", ev: salary.conveyance, d: "E.S.I.C.", dv: salary.esic },
                            { e: "Medical Allowance", ev: salary.medical, d: "T.D.S.", dv: salary.tds },
                            { e: "Special Allowance", ev: salary.special, d: "Loan / Advance", dv: salary.advance },
                            { e: "Bonus / Incentive", ev: salary.bonus, d: "L.W.F.", dv: salary.lwf },
                            { e: "Overtime (OT)", ev: salary.ot, d: "Other Deductions", dv: salary.otherDeductions },
                        ].map(row => new DocxTableRow({
                            children: [
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.e, size: 16, font: "Calibri" })] })], borders: { bottom: borderStyle, left: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: (row.ev || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }), size: 16, font: "Calibri" })], alignment: AlignmentType.RIGHT })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: row.d, size: 16, font: "Calibri" })] })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: (row.dv || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 }), size: 16, font: "Calibri" })], alignment: AlignmentType.RIGHT })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                            ]
                        })),
                        // Totals Row
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Gross Total", bold: true, size: 16, font: "Calibri" })] })], borders: { bottom: borderStyle, left: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: grossEarnings.toLocaleString('en-IN', { minimumFractionDigits: 2 }), bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.RIGHT })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Total Deductions", bold: true, size: 16, font: "Calibri" })] })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                                new DocxTableCell({ children: [new Paragraph({ children: [new TextRun({ text: totalDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 }), bold: true, size: 16, font: "Calibri" })], alignment: AlignmentType.RIGHT })], borders: { bottom: borderStyle, right: borderStyle }, margins: cellMargins }),
                            ]
                        }),
                    ],
                }),

                new Paragraph({ text: "", spacing: { before: 300 } }),

                // Net Payable
                new Paragraph({
                    children: [
                        new TextRun({ text: "NET PAYABLE SALARY: ", bold: true, size: 20, font: "Calibri" }),
                        new TextRun({ text: `Rs. ${salary.netSalary.toLocaleString('en-IN', { minimumFractionDigits: 2 })}/-`, bold: true, size: 20, font: "Calibri" })
                    ],
                    spacing: { before: 100 },
                }),

                new Paragraph({
                    children: [new TextRun({ text: `Amount in words: ${netSalaryWords}`, font: "Calibri", italics: true, size: 16 })],
                    spacing: { before: 100 },
                }),

                new Paragraph({ text: "", spacing: { before: 400 } }),
                new Paragraph({
                    children: [new TextRun({ text: `This is a system generated salary slip and does not require a physical signature.`, size: 14, font: "Calibri", color: "666666" })],
                    alignment: AlignmentType.CENTER,
                }),
                new Paragraph({
                    children: [new TextRun({ text: `Generated on ${format(new Date(), 'dd MMM yyyy, p')}`, size: 14, font: "Calibri", color: "666666" })],
                    alignment: AlignmentType.CENTER,
                }),
            ],
        }],
    });

    const fileName = `SalarySlip_${employee.fullName.replace(/\s+/g, '_')}_${salary.month}.docx`;
    const blob = await Packer.toBlob(doc);
    saveAs(blob, fileName);
};
