'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO, differenceInDays } from 'date-fns';

type ProcessedInvoice = {
    billNo: number;
    billNoSuffix?: string;
    billDate: string;
    companyName: string;
    grandTotal: number;
    totalPaid: number;
    tdsAmount: number;
    balance: number;
    enterprise: string;
};

export type ColumnConfig = {
    label: string;
    align: 'left' | 'center' | 'right';
    visible: boolean;
};

const loadImage = (url: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject('Server environment');
            return;
        }
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => {
            reject(err);
        };
        img.src = url;
    });
};

export const generatePaymentSummaryPdf = async (
    invoices: ProcessedInvoice[], 
    enterprise: string,
    filters: { 
        company?: string; 
        address?: string; 
        gstin?: string; 
        month?: string; 
        year?: string;
        firmGstin?: string;
        firmMobile?: string;
        customSubject?: string;
        customDescription?: string;
        salutation?: string;
        columnConfigs: Record<string, ColumnConfig>;
    }
) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    const configs = filters.columnConfigs;
    
    const isRV = enterprise.toLowerCase().includes('rv');
    const themeColor: [number, number, number] = isRV ? [0, 51, 102] : [200, 0, 0]; 

    const topPadding = 8; 

    if ((doc as any).setCharSpace) {
        (doc as any).setCharSpace(0);
    }

    // --- Header Section ---
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);
    doc.text(`GSTIN: ${filters.firmGstin || 'N/A'}`, 15, topPadding + 8);
    
    if (isRV) {
        doc.text(`Mob: 9987559327`, pageWidth - 15, topPadding + 8, { align: 'right' });
        doc.setFontSize(8);
        doc.text(`Email: rvent1953@gmail.com`, pageWidth - 15, topPadding + 12, { align: 'right' });
    } else {
        doc.text(`Mob: ${filters.firmMobile || '9821728079, 9987559327'}`, pageWidth - 15, topPadding + 8, { align: 'right' });
    }

    if (isRV) {
        doc.setFontSize(36);
        doc.setFont('times', 'bold');
        doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);
        doc.text(`R.V. ENTERPRISES`, pageWidth / 2, topPadding + 22, { align: 'center' });

        const subtitle = "Suppliers of Material Handling Equipment & Labour";
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        const subWidth = doc.getTextWidth(subtitle);
        const subX = pageWidth / 2;
        const subY = topPadding + 28;
        doc.text(subtitle, subX, subY, { align: 'center' });

        const edgeGap = 10;
        const textGap = 3; 
        const lineSpacing = 0.7;
        
        doc.setLineWidth(0.15);
        doc.setDrawColor(themeColor[0], themeColor[1], themeColor[2]); 
        
        const leftEndX = subX - (subWidth / 2) - textGap;
        const leftStartX = edgeGap;
        [0, lineSpacing, lineSpacing * 2].forEach(offset => {
            doc.line(leftStartX, subY - 1.5 + offset, leftEndX, subY - 1.5 + offset);
        });

        const rightStartX = subX + (subWidth / 2) + textGap;
        const rightEndX = pageWidth - edgeGap;
        [0, lineSpacing, lineSpacing * 2].forEach(offset => {
            doc.line(rightStartX, subY - 1.5 + offset, rightEndX, subY - 1.5 + offset);
        });

        doc.setLineWidth(0.5);
        doc.line(0, topPadding + 34, pageWidth, topPadding + 34);
    } else {
        doc.setFontSize(30);
        doc.setFont('times', 'bold');
        doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);
        doc.text(`${enterprise.toUpperCase()} ENTERPRISES`, pageWidth / 2, topPadding + 21, { align: 'center' });
        
        doc.setDrawColor(themeColor[0], themeColor[1], themeColor[2]);
        doc.setLineWidth(0.5);
        doc.line(0, topPadding + 25, pageWidth, topPadding + 25);
        
        doc.setFontSize(9.5); 
        doc.setFont('helvetica', 'normal'); 
        doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]); 
        const addressStr = `Pratik Apartments, C - 101, Waitiwadi, Wagle Estate, Thane - 400 604.  .  Email : vithal_enterprises@yahoo.in`;
        doc.text(addressStr, pageWidth / 2, topPadding + 28.5, { align: 'center' });
        doc.line(0, topPadding + 30.5, pageWidth, topPadding + 30.5);
    }

    let currentY = isRV ? topPadding + 54 : topPadding + 48;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`Date: ${format(new Date(), 'dd MMM yyyy')}`, pageWidth - 15, currentY - 5, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.text('To,', 15, currentY);
    currentY += 6;

    if (filters.company && filters.company !== 'All') {
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(filters.company.toUpperCase(), 15, currentY);
        currentY += 6;

        if (filters.address) {
            doc.setFontSize(8.5); 
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(60, 60, 60);
            const addressLines = doc.splitTextToSize(filters.address.toUpperCase(), 120);
            doc.text(addressLines, 15, currentY);
            currentY += (addressLines.length * 4.5) + 2;
        }

        if (filters.gstin) {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`GSTIN: ${filters.gstin}`, 15, currentY);
            currentY += 8;
        }
    }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    const subject = `Sub : ${filters.customSubject || 'Balance Confirmation Statement'}`.trim();
    doc.text(subject, pageWidth / 2, currentY, { align: 'center' });
    
    const subjWidth = doc.getTextWidth(subject);
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.1);
    doc.line((pageWidth / 2) - (subjWidth / 2), currentY + 1, (pageWidth / 2) + (subjWidth / 2), currentY + 1);
    
    currentY += 12;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(filters.salutation || 'Dear Sir,', 15, currentY);
    currentY += 6;

    doc.setFont('helvetica', 'normal');
    const introText = filters.customDescription || `This is to inform you about the outstanding balance as per our records mentioned below:`;
    const introLines = doc.splitTextToSize(introText, pageWidth - 30);
    doc.text(introLines, 15, currentY);
    currentY += (introLines.length * 5) + 5;

    // --- Dynamic Column Building ---
    const activeColIds = [
        'billNo', 'date', 'company', 'billed', 'received', 'tds', 'balance', 'dueDays'
    ].filter(id => configs[id]?.visible);

    const headers = activeColIds.map(id => configs[id].label);
    const columnStyles: Record<number, any> = {};
    activeColIds.forEach((id, index) => {
        columnStyles[index] = { halign: configs[id].align };
    });

    const today = new Date();
    const tableBody = invoices.map(inv => {
        const row: string[] = [];
        activeColIds.forEach(id => {
            switch(id) {
                case 'billNo': row.push(`${inv.billNo}-${inv.billNoSuffix || 'MHE'}`); break;
                case 'date': row.push(format(new Date(inv.billDate), 'dd-MMM-yy')); break;
                case 'company': row.push(inv.companyName.toUpperCase()); break;
                case 'billed': row.push(inv.grandTotal.toLocaleString('en-IN')); break;
                case 'received': row.push(inv.totalPaid.toLocaleString('en-IN')); break;
                case 'tds': row.push(inv.tdsAmount.toLocaleString('en-IN')); break;
                case 'balance': row.push(inv.balance.toLocaleString('en-IN')); break;
                case 'dueDays': 
                    const billDate = parseISO(inv.billDate);
                    const days = differenceInDays(today, billDate);
                    row.push(days > 0 ? `${days} Days` : '0'); 
                    break;
            }
        });
        return row;
    });

    const totalBalance = invoices.reduce((sum, inv) => sum + inv.balance, 0);
    const totalBilled = invoices.reduce((sum, inv) => sum + inv.grandTotal, 0);
    const totalPaid = invoices.reduce((sum, inv) => sum + inv.totalPaid, 0);
    const totalTds = invoices.reduce((sum, inv) => sum + inv.tdsAmount, 0);

    const footRow = activeColIds.map((id, index) => {
        if (index === 0) return 'TOTAL';
        switch(id) {
            case 'billed': return totalBilled.toLocaleString('en-IN');
            case 'received': return totalPaid.toLocaleString('en-IN');
            case 'tds': return totalTds.toLocaleString('en-IN');
            case 'balance': return totalBalance.toLocaleString('en-IN');
            default: return '';
        }
    });

    autoTable(doc, {
        startY: currentY,
        head: [headers],
        body: tableBody,
        foot: [footRow],
        theme: 'grid',
        headStyles: { 
            fillColor: [255, 255, 255], 
            textColor: [0, 0, 0], 
            fontStyle: 'bold', 
            halign: 'center',
            lineWidth: 0.1,
            lineColor: [0, 0, 0]
        },
        footStyles: { 
            fillColor: [245, 245, 245], 
            textColor: [0, 0, 0], 
            fontStyle: 'bold', 
            halign: 'right',
            lineWidth: 0.1,
            lineColor: [0, 0, 0]
        },
        styles: { 
            fontSize: 8.5, 
            cellPadding: 1.5,
            overflow: 'linebreak',
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
            font: 'helvetica'
        },
        columnStyles: columnStyles
    });

    const finalY = (doc as any).lastAutoTable.finalY + 12;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('We request you to kindly verify the above statement and confirm the outstanding balance.', 15, finalY);
    
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Outstanding Balance: INR ${totalBalance.toLocaleString('en-IN')}/-`, 15, finalY + 7);
    
    let signY = finalY + 25;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('Thanking You,', 15, signY);
    signY += 6;
    doc.text('Yours truly,', 15, signY);

    signY += 6;
    doc.text(`For M/S ${enterprise.toUpperCase()} ENTERPRISES`, 15, signY);

    const signGap = 12; 
    const stampSize = 35;
    const stampY = signY + (signGap / 2) - (stampSize / 2);

    const stampFile = isRV ? '/rv-stamp.png' : '/vithal-stamp.png';
    try {
        const stampImg = await loadImage(stampFile);
        doc.addImage(stampImg, 'PNG', 75, stampY, stampSize, stampSize);
    } catch (e) { }
    
    signY += signGap; 
    doc.setFont('helvetica', 'bold');
    doc.text('TEJAS.R.MAVLANKAR', 15, signY);
    signY += 5;
    doc.setFontSize(9);
    doc.text('Mob: 9987559327', 15, signY);

    const footerY = isRV ? 279 : 284; 
    
    doc.setDrawColor(themeColor[0], themeColor[1], themeColor[2]);
    doc.setLineWidth(0.5);
    doc.line(0, footerY, pageWidth, footerY);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(themeColor[0], themeColor[1], themeColor[2]);

    const drawCenteredBoldLabelLine = (label: string, value: string, y: number) => {
        doc.setFont('helvetica', 'bold');
        const labelWidth = doc.getTextWidth(label);
        doc.setFont('helvetica', 'normal');
        const valueWidth = doc.getTextWidth(value);
        const totalWidth = labelWidth + valueWidth;
        const startX = (pageWidth - totalWidth) / 2;

        doc.setFont('helvetica', 'bold');
        doc.text(label, startX, y);
        doc.setFont('helvetica', 'normal');
        doc.text(value, startX + labelWidth, y);
    };

    if (isRV) {
        drawCenteredBoldLabelLine("Office : ", "A/404, Astraea, Rustomjee Urbania, Off Eastern Express Highway, Majiwada, Thane - 400601", footerY + 6);
        drawCenteredBoldLabelLine("Work : ", "S. No. 14/6A, Khot Banglow, Nr. Transformer, Bhandarli, Pimpri, Thane - 400 612", footerY + 11);
    } else {
        drawCenteredBoldLabelLine("Works : ", "S. No. 14/6A, Khot Banglow, Nr Transformer, Bhandarli, Pimpri, Thane - 400 612", footerY + 6);
    }

    const sanitizedCompanyName = filters.company && filters.company !== 'All' 
        ? filters.company.replace(/[^a-zA-Z0-9]/g, '_') 
        : 'Payment_Summary';
    
    const fileName = `Balance_Confirmation_${enterprise}_${sanitizedCompanyName}.pdf`;
    doc.save(fileName);
};