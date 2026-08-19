
import { Packer, Document, Paragraph, TextRun, AlignmentType, BorderStyle, Table as DocxTable, TableRow as DocxTableRow, TableCell as DocxTableCell, WidthType, VerticalAlign, PageOrientation, TableLayoutType } from 'docx';
import { saveAs } from 'file-saver';
import { format, parseISO } from 'date-fns';
import { ToWords } from 'to-words';
import type { Invoice, Company, InvoiceTemplate, InvoiceItem, CompanySettings } from './data';

export type PageSettings = {
    size: 'A4' | 'LETTER' | 'LEGAL',
    orientation: 'portrait' | 'landscape',
    pageMargins: {
        top: number;
        right: number;
        bottom: number;
        left: number;
    },
    pageFontSize?: number,
    addressFontSize?: number,
    tableBodyFontSize?: number,
}

export type DownloadOptions = {
    myCompany: {
        showGstin: boolean;
        showPan: boolean;
        showBankDetails: boolean;
        showSacCode: boolean;
        showServiceTaxCode: boolean;
    };
    clientCompany: {
        showGstin: boolean;
    };
    includeSiteInFilename?: boolean;
};

const getPageSizeDimensions = (size: PageSettings['size'], orientation: 'portrait' | 'landscape') => {
    let width = 11906; // A4 default (twips)
    let height = 16838;
    switch (size) {
        case 'LETTER':
            width = 12240;
            height = 15840;
            break;
        case 'LEGAL':
            width = 12240;
            height = 20160;
            break;
        case 'A4':
        default:
            width = 11906;
            height = 16838;
            break;
    }
    if (orientation === 'landscape') {
        return {
            width: height,
            height: width,
            orientation: PageOrientation.LANDSCAPE,
        };
    }
    return {
        width,
        height,
        orientation: PageOrientation.PORTRAIT,
    };
};

const noTableBorders = {
    top: { style: BorderStyle.NONE, size: 0, color: "auto" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
    left: { style: BorderStyle.NONE, size: 0, color: "auto" },
    right: { style: BorderStyle.NONE, size: 0, color: "auto" },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
};

// Function to convert cm to Twips (1 cm = 567 Twips)
const convertCmToTwip = (cm: number): number => {
    return cm * 567;
}


const generateInvoiceDataForWord = (invoice: Invoice, clientCompany: Company, myCompanyDetails: CompanySettings, template?: InvoiceTemplate) => {
    const words = new ToWords({
      localeCode: 'en-IN',
      converterOptions: {
        currency: true,
        ignoreDecimal: true,
        ignoreZeroCurrency: false,
      }
    });
    const grandTotalInWords = words.convert(invoice.grandTotal).toUpperCase();
    
    const discountAmount = invoice.discount || 0;
    const discountType = invoice.discountType || 'after_gst';
    const taxableAmount = discountType === 'before_gst' ? invoice.netTotal - discountAmount : invoice.netTotal;
    const cgst = taxableAmount * 0.09;
    const sgst = taxableAmount * 0.09;

    return {
        to: {
          name: clientCompany.name.toUpperCase(),
          address: clientCompany.address.toUpperCase(),
          gstin: clientCompany.gstin || '',
        },
        myCompany: myCompanyDetails,
        selectedBank: invoice.selectedBankAccount,
        billDate: format(parseISO(invoice.billDate), 'dd/MM/yyyy'),
        billNo: `${invoice.billNo}-${invoice.billNoSuffix || 'MHE'}`.toUpperCase(),
        poNo: (invoice.poNumber || 'AGREEMENT').toUpperCase(),
        month: invoice.billingMonth
            ? format(parseISO(invoice.billingMonth), 'MMM yyyy').toUpperCase()
            : format(parseISO(invoice.billDate), 'MMM yyyy').toUpperCase(),
        site: (invoice.site || '').toUpperCase(),
        items: invoice.items,
        template: invoice.template,
        netTotal: invoice.netTotal,
        cgst: cgst,
        sgst: sgst,
        discount: discountAmount,
        discountType: discountType,
        grandTotal: invoice.grandTotal,
        advanceReceived: invoice.advanceReceived || 0,
        amountInWords: grandTotalInWords,
    }
}

const createFormattedTextRuns = (text: string | number | undefined, defaultSizeInPoints: number = 11): TextRun[] => {
    if (text === undefined || text === null) return [new TextRun({ text: "", font: "Calibri" })];

    function processText(subText: string, isBold: boolean, sizeInPoints: number): TextRun[] {
        const regex = /(\*\*[\s\S]*?\*\*|<s:\d+>[\s\S]*?<\/s:\d+>)/g;
        const parts = subText.split(regex).filter(part => part);
        
        return parts.flatMap(part => {
            // Handle nested bold
            if (part.startsWith('**') && part.endsWith('**')) {
                return processText(part.slice(2, -2), true, sizeInPoints);
            }

            // Handle nested font size
            const sizeMatch = part.match(/^<s:(\d+)>([\s\S]*?)<\/s:\d+>$/);
            if (sizeMatch) {
                const customSize = parseInt(sizeMatch[1], 10);
                const content = sizeMatch[2];
                return processText(content, isBold, customSize);
            }
            
            // Default text with current styles
            const lines = part.split('\n');
            return lines.flatMap((line, index) => {
                const runs: TextRun[] = [new TextRun({ 
                    text: line, 
                    bold: isBold, 
                    size: sizeInPoints * 2, // docx uses half-points
                    font: "Calibri" 
                })];
                if (index < lines.length - 1) {
                    runs.push(new TextRun({ break: 1, size: sizeInPoints * 2, font: "Calibri" }));
                }
                return runs;
            });
        });
    }

    const textAsString = String(text);
    return processText(textAsString, false, defaultSizeInPoints);
};


export const generateAndDownloadInvoice = async (
    invoice: Invoice, 
    clientCompany: Company, 
    myCompanyDetails: CompanySettings, 
    pageSettings?: PageSettings, 
    template?: InvoiceTemplate,
    options?: DownloadOptions
) => {
    const settings: PageSettings = pageSettings || { 
        size: 'A4', 
        orientation: 'portrait', 
        pageMargins: {top: 1.27, right: 1.27, bottom: 1.27, left: 1.27},
        pageFontSize: 11,
        addressFontSize: 10,
        tableBodyFontSize: 11
    };
    const defaultFontSize = (settings.pageFontSize || 11);

    const downloadOpts: DownloadOptions = options || {
        myCompany: { showGstin: true, showPan: true, showBankDetails: true, showSacCode: true, showServiceTaxCode: true },
        clientCompany: { showGstin: true },
        includeSiteInFilename: false,
    };

    const invoiceData = generateInvoiceDataForWord(invoice, clientCompany, myCompanyDetails, template);
    const formatCurrency = (amount: number) => amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    
    const hasRateColumn = invoiceData.items.some(item => item.rate && String(item.rate).trim() !== '');

    const tableHeaderBorders = {
        top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }
    };
    
    const tableCellBorders = {
        left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }
    };
    
    const tableBottomBorder = { bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }};
    
    const cellMargins = { top: 30, bottom: 30, left: 100, right: 100 };

    const getAlignment = (columnId: 'sr_no' | keyof InvoiceItem) => {
        const align = invoiceData.template?.columns.find(c => c.id === columnId)?.align || 'left';
        switch (align) {
            case 'center': return AlignmentType.CENTER;
            case 'right': return AlignmentType.RIGHT;
            default: return AlignmentType.LEFT;
        }
    };

    const headerCells = [
        new DocxTableCell({
            width: { size: 10, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Sr. No", bold: true, size: defaultFontSize * 2, font: "Calibri" })], alignment: getAlignment('sr_no') })],
            verticalAlign: VerticalAlign.CENTER,
            borders: tableHeaderBorders,
            margins: cellMargins
        }),
        new DocxTableCell({
            width: { size: hasRateColumn ? 55 : 70, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Particulars", bold: true, size: defaultFontSize * 2, font: "Calibri" })], alignment: getAlignment('particulars')})],
            verticalAlign: VerticalAlign.CENTER,
            borders: tableHeaderBorders,
            margins: cellMargins
        }),
    ];

    if (hasRateColumn) {
        headerCells.push(new DocxTableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Rate", bold: true, size: defaultFontSize * 2, font: "Calibri" })], alignment: getAlignment('rate') })],
            verticalAlign: VerticalAlign.CENTER,
            borders: tableHeaderBorders,
            margins: cellMargins
        }));
    }
    
    headerCells.push(new DocxTableCell({
        width: { size: 20, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: "Amount", bold: true, size: defaultFontSize * 2, font: "Calibri" })], alignment: getAlignment('amount') })],
        verticalAlign: VerticalAlign.CENTER,
        borders: tableHeaderBorders,
        margins: cellMargins
    }));
    
    const createTotalRow = (label: string, value: string, isGrandTotal = false, isNegative = false) => {
        const totalRowsBorders = {
            top: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "000000" },
        };
        const tableBodyFontSize = (settings.tableBodyFontSize || 11);
        const finalFontSize = isGrandTotal ? tableBodyFontSize * 2 : tableBodyFontSize * 2;

        const cells = [
             new DocxTableCell({
                children: [new Paragraph({ text: "" })],
                verticalAlign: VerticalAlign.CENTER,
                borders: totalRowsBorders,
                margins: cellMargins,
            }),
            new DocxTableCell({
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: finalFontSize, font: "Calibri" })], alignment: AlignmentType.RIGHT })],
                verticalAlign: VerticalAlign.CENTER,
                borders: totalRowsBorders,
                margins: cellMargins,
            }),
        ];

        if (hasRateColumn) {
            cells.push(new DocxTableCell({
                children: [new Paragraph({children: [new TextRun({text: '', font: "Calibri"})]})],
                borders: totalRowsBorders,
                margins: cellMargins,
                verticalAlign: VerticalAlign.CENTER,
            }));
        }

        cells.push(new DocxTableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `${isNegative ? '-' : ''}${value}/-`, bold: true, size: finalFontSize, font: "Calibri" })], alignment: getAlignment('amount') })],
            verticalAlign: VerticalAlign.CENTER,
            borders: totalRowsBorders,
            margins: cellMargins,
        }));

        return new DocxTableRow({ children: cells });
    }

    const totalRows = [];
    totalRows.push(createTotalRow('Net total=', `${formatCurrency(invoiceData.netTotal)}`));
    
    if (invoiceData.discountType === 'before_gst' && invoiceData.discount > 0) {
        totalRows.push(createTotalRow('Discount', formatCurrency(invoiceData.discount), false, true));
        const taxableAmount = invoiceData.netTotal - invoiceData.discount;
        totalRows.push(createTotalRow('Taxable Amount', formatCurrency(taxableAmount), true, false));
    }
    
    totalRows.push(createTotalRow('CGST@9%', `${formatCurrency(invoiceData.cgst)}`));
    totalRows.push(createTotalRow('SGST@9%', `${formatCurrency(invoiceData.sgst)}`));

    if (invoiceData.discountType === 'after_gst' && invoiceData.discount > 0) {
        totalRows.push(createTotalRow('Discount', `${formatCurrency(invoiceData.discount)}`, false, true));
    }

    totalRows.push(createTotalRow(invoiceData.advanceReceived > 0 ? 'GRAND TOTAL' : 'TOTAL AMOUNT PAYABLE', `${formatCurrency(invoiceData.grandTotal)}`, true));

    if (invoiceData.advanceReceived > 0) {
        totalRows.push(createTotalRow('Advance Received', `${formatCurrency(invoiceData.advanceReceived)}`, false, true));
        const balanceDue = invoiceData.grandTotal - invoiceData.advanceReceived;
        totalRows.push(createTotalRow('TOTAL AMOUNT PAYABLE', `${formatCurrency(balanceDue)}`, true));
    }


    const doc = new Document({
        styles: {
            paragraphStyles: [{
                id: "default",
                name: "default",
                run: { font: "Calibri", size: defaultFontSize * 2 }, 
                paragraph: { spacing: { after: 0, before: 0, line: 276 } }
            }],
        },
        sections: [{
            properties: {
                page: {
                    size: getPageSizeDimensions(settings.size, settings.orientation),
                    margin: { 
                        top: convertCmToTwip(settings.pageMargins.top), 
                        right: convertCmToTwip(settings.pageMargins.right), 
                        bottom: convertCmToTwip(settings.pageMargins.bottom), 
                        left: convertCmToTwip(settings.pageMargins.left) 
                    },
                },
            },
            children: [
                new Paragraph({
                    children: [new TextRun({ text: "INVOICE", bold: true, size: 28, font: "Calibri" })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 300 }
                }),

                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    borders: noTableBorders,
                    rows: [
                       new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({ children: [new TextRun({text: "To,", font: "Calibri", size: defaultFontSize * 2})] }),
                                        new Paragraph({ children: [new TextRun({ text: invoiceData.to.name, bold: true, font: "Calibri", size: defaultFontSize * 2 })] }),
                                        new Paragraph({ children: createFormattedTextRuns(invoiceData.to.address, settings.addressFontSize) }),
                                    ],
                                    margins: cellMargins,
                                    verticalAlign: VerticalAlign.TOP
                                }),
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({ children: [new TextRun({ text: `Bill Date: ${invoiceData.billDate}`, font: "Calibri", size: defaultFontSize * 2 })], alignment: AlignmentType.RIGHT }),
                                    ],
                                    verticalAlign: VerticalAlign.TOP,
                                    margins: cellMargins,
                                    }),
                            ],
                        }),
                    ]
                }),
                
                new Paragraph({ text: "", spacing: { before: 200 } }),
                
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    borders: noTableBorders,
                    rows: [
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({ children: [new TextRun({ text: "Bill No: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({ text: invoiceData.billNo, font: "Calibri", size: defaultFontSize * 2 })] }),
                                        new Paragraph({ children: [new TextRun({ text: "MONTH: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({ text: invoiceData.month, font: "Calibri", size: defaultFontSize * 2 })] }),
                                    ],
                                    margins: cellMargins,
                                    verticalAlign: VerticalAlign.CENTER
                                }),
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        new Paragraph({ children: [new TextRun({ text: "PO.NO: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({ text: invoiceData.poNo, font: "Calibri", size: defaultFontSize * 2 })], alignment: AlignmentType.RIGHT }),
                                        ...(invoiceData.site ? [new Paragraph({ children: [new TextRun({ text: "Site: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({ text: invoiceData.site, font: "Calibri", size: defaultFontSize * 2 })], alignment: AlignmentType.RIGHT })] : []),
                                    ],
                                    margins: cellMargins,
                                    verticalAlign: VerticalAlign.CENTER
                                }),
                            ],
                        }),
                    ],
                }),
                
                new Paragraph({ children: [new TextRun({ text: "CHARGES AS FOLLOWS: -", bold: true, font: "Calibri", size: defaultFontSize * 2 })], spacing: { before: 200, after: 100 } }),

                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    layout: TableLayoutType.FIXED,
                    rows: [
                        new DocxTableRow({
                            children: headerCells,
                        }),
                        ...invoiceData.items.map((item, index) => {
                            const tableBodyFontSize = (settings.tableBodyFontSize || 11);

                            const srNoCol = invoiceData.template?.columns.find(c => c.id === 'sr_no');
                            const particularsCol = invoiceData.template?.columns.find(c => c.id === 'particulars');
                            const rateCol = invoiceData.template?.columns.find(c => c.id === 'rate');
                            const amountCol = invoiceData.template?.columns.find(c => c.id === 'amount');
                            
                            const srNoFontSize = srNoCol?.fontSize || tableBodyFontSize;
                            const particularsFontSize = particularsCol?.fontSize || tableBodyFontSize;
                            const rateFontSize = rateCol?.fontSize || tableBodyFontSize;
                            const amountFontSize = amountCol?.fontSize || tableBodyFontSize;

                             const itemCells = [
                                new DocxTableCell({ verticalAlign: VerticalAlign.CENTER, children: [new Paragraph({ children: [new TextRun({ text: (index + 1).toString(), size: srNoFontSize * 2, font: "Calibri" })], alignment: getAlignment('sr_no') })], borders: {...tableCellBorders, ...tableBottomBorder}, margins: cellMargins }),
                                new DocxTableCell({
                                    verticalAlign: VerticalAlign.CENTER,
                                    children: [new Paragraph({ children: createFormattedTextRuns(item.particulars, particularsFontSize), alignment: getAlignment('particulars') })],
                                    borders: {...tableCellBorders, ...tableBottomBorder},
                                    margins: cellMargins
                                }),
                            ];

                            if (hasRateColumn) {
                                itemCells.push(new DocxTableCell({
                                    verticalAlign: VerticalAlign.CENTER,
                                    children: [new Paragraph({ children: createFormattedTextRuns(item.rate, rateFontSize), alignment: getAlignment('rate') })],
                                    borders: {...tableCellBorders, ...tableBottomBorder},
                                    margins: cellMargins
                                }));
                            }

                            itemCells.push(new DocxTableCell({
                                verticalAlign: VerticalAlign.CENTER,
                                children: [new Paragraph({ children: [new TextRun({ text: `${formatCurrency(item.amount)}/-`, size: amountFontSize * 2, font: "Calibri" })], alignment: getAlignment('amount') })],
                                borders: {...tableCellBorders, ...tableBottomBorder},
                                margins: cellMargins
                            }));

                            return new DocxTableRow({ children: itemCells });
                        }),
                        ...totalRows,
                    ],
                }),

                new Paragraph({ children: [new TextRun({ text: "In words: ", font: "Calibri", size: defaultFontSize * 2 }), new TextRun({ text: invoiceData.amountInWords, bold: true, font: "Calibri", size: defaultFontSize * 2 })], spacing: { before: 200, after: 200 } }),
                
                new DocxTable({
                    width: { size: 100, type: WidthType.PERCENTAGE },
                    rows: [
                       new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({text: invoiceData.myCompany.companyName, bold: true, size: defaultFontSize * 2, font: "Calibri"})] })],
                                    margins: cellMargins,
                                    borders: { ...tableHeaderBorders, right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } }
                                }),
                                new DocxTableCell({
                                    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({text: 'Bank Details', bold: true, size: defaultFontSize * 2, font: "Calibri"})] })],
                                    margins: cellMargins,
                                    borders: { ...tableHeaderBorders, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } }
                                }),
                            ]
                       }),
                       new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        ...(downloadOpts.myCompany.showPan ? [new Paragraph({ children: [new TextRun({ text: "PAN CARD NO: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.myCompany.pan, font: "Calibri", size: defaultFontSize * 2})] })] : []),
                                        ...(downloadOpts.myCompany.showGstin ? [new Paragraph({ children: [new TextRun({ text: "GSTIN: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.myCompany.gstin, font: "Calibri", size: defaultFontSize * 2})] })] : []),
                                        ...(downloadOpts.myCompany.showSacCode ? [new Paragraph({ children: [new TextRun({ text: "SAC code: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.myCompany.sacCode, font: "Calibri", size: defaultFontSize * 2})] })] : []),
                                        ...(downloadOpts.myCompany.showServiceTaxCode && invoiceData.myCompany.serviceTaxCode ? [new Paragraph({ children: [new TextRun({ text: "SERVICE TAX CODE: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.myCompany.serviceTaxCode, font: "Calibri", size: defaultFontSize * 2})] })] : []),
                                    ],
                                    verticalAlign: VerticalAlign.TOP,
                                    margins: cellMargins,
                                    borders: { left: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" } }
                                }),
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [
                                        ...(downloadOpts.myCompany.showBankDetails && invoiceData.selectedBank ? [
                                            new Paragraph({ children: [new TextRun({ text: "Bank Name: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.selectedBank.bankName, font: "Calibri", size: defaultFontSize * 2})] }),
                                            new Paragraph({ children: [new TextRun({ text: "A/C No: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.selectedBank.accountNumber, font: "Calibri", size: defaultFontSize * 2})] }),
                                            new Paragraph({ children: [new TextRun({ text: "IFSC Code: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.selectedBank.ifscCode, font: "Calibri", size: defaultFontSize * 2})] }),
                                            new Paragraph({ children: [new TextRun({ text: "Branch: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.selectedBank.bankBranch, font: "Calibri", size: defaultFontSize * 2})] }),
                                        ] : [new Paragraph({text: ""})]),
                                    ],
                                    verticalAlign: VerticalAlign.TOP,
                                    margins: cellMargins,
                                    borders: {right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }}
                                }),
                            ]
                       })
                    ],
                }),

                new Paragraph({ text: "", spacing: { before: 10 } }),

                new DocxTable({
                     width: { size: 100, type: WidthType.PERCENTAGE },
                     rows: [
                        new DocxTableRow({
                            children: [
                                new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({text: invoiceData.to.name, bold: true, size: defaultFontSize * 2, font: "Calibri"})] })],
                                    margins: cellMargins,
                                    borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, left: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, right: { style: BorderStyle.SINGLE, size: 6, color: "000000" } }
                                }),
                                 new DocxTableCell({
                                    width: { size: 50, type: WidthType.PERCENTAGE },
                                    verticalAlign: VerticalAlign.TOP,
                                    children: [
                                        ...(downloadOpts.clientCompany.showGstin && invoiceData.to.gstin ? [new Paragraph({ alignment: AlignmentType.LEFT, children: [new TextRun({ text: "GSTIN: ", bold: true, font: "Calibri", size: defaultFontSize * 2 }), new TextRun({text: invoiceData.to.gstin, font: "Calibri", size: defaultFontSize * 2})] })] : []),
                                    ],
                                    margins: cellMargins,
                                    borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, right: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, left: {style: BorderStyle.NONE} }
                                }),
                            ]
                        })
                     ]
                }),

                new Paragraph({ children: [new TextRun({text: "Thanking you,", font: "Calibri", size: defaultFontSize * 2})], spacing: { before: 200 } }),
                new Paragraph({ children: [new TextRun({text: "Yours truly,", font: "Calibri", size: defaultFontSize * 2})] }),
                new Paragraph({ children: [new TextRun({text: `For M/s ${invoiceData.myCompany.companyName}`, font: "Calibri", size: defaultFontSize * 2})] }),
                new Paragraph({ text: "", spacing: { before: 400 } }),
                new Paragraph({ children: [new TextRun({ text: invoiceData.myCompany.contactPerson, bold: true, font: "Calibri", size: defaultFontSize * 2 })] }),
                new Paragraph({ children: [new TextRun({text: invoiceData.myCompany.contactNumber, font: "Calibri", size: defaultFontSize * 2})] }),
            ],
        }],
    });

    const companyNameForFile = clientCompany.name.replace(/[^a-zA-Z0-9\s]/g, '').toUpperCase();
    const siteForFile = (invoice.site && downloadOpts.includeSiteInFilename) ? `(${invoice.site.replace(/[^a-zA-Z0-9\s]/g, '')})` : '';
    const monthYearForFile = invoice.billingMonth
        ? format(parseISO(invoice.billingMonth), 'MMM-yy').toUpperCase()
        : format(parseISO(invoice.billDate), 'MMM-yy').toUpperCase();
    
    const fileName = `Bill no.${invoice.billNo}-${invoice.billNoSuffix || 'MHE'}-${companyNameForFile}${siteForFile ? `-${siteForFile}` : ''}-(${monthYearForFile})-GST 18.docx`;

    const blob = await Packer.toBlob(doc);
    saveAs(blob, fileName);
}
