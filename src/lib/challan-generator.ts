'use client';

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';

export type ChallanItem = {
    particulars: string;
    amount: number;
};

export type ChallanData = {
    enterprise: 'Vithal' | 'RV';
    challanNo: string;
    vehicleNo: string;
    date: string;
    fromName: string;
    fromAddress: string;
    deliveryToName: string;
    deliveryToAddress: string;
    items: ChallanItem[];
    pan: string;
    gstin: string;
    includeStamp?: boolean;
    // Customization Options
    fromAddressFontSize?: number;
    deliveryToAddressFontSize?: number;
    headerHeight?: number;
    footerHeight?: number;
    srWidth?: number;
    amountWidth?: number;
    titleFontSize?: number;
    particularsFontSize?: number;
    headerDetailsFontSize?: number;
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
        img.onerror = (err) => reject(err);
        img.src = url;
    });
};

/**
 * Parses line-level markdown-like tags for technical specs.
 * Supported: [H]Header[/H], [B]Bold[/B], [S:n]Size[/S]
 */
const renderRichLine = (doc: jsPDF, text: string, x: number, y: number, maxWidth: number, defaultSize: number): number => {
    let currentY = y;
    
    // Line-level style detection
    const isHeading = text.includes('[H]');
    const isBold = text.includes('[B]') || isHeading;
    
    let fontSize = defaultSize;
    if (isHeading) fontSize += 2;

    // Size detection [S:n]
    const sizeMatch = text.match(/\[S:(\d+)\]/);
    if (sizeMatch) {
        fontSize = parseInt(sizeMatch[1]);
    }

    // Clean text for measuring/drawing
    let cleanText = text.replace(/\[\/?(H|B|S:\d+)\]/g, '');

    doc.setFontSize(fontSize);
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');

    // Split text into wrapped lines
    const lines = doc.splitTextToSize(cleanText, maxWidth);
    const lineHeight = fontSize * 0.3527 * 1.25; // Pt to mm * line spacing

    lines.forEach((line: string, i: number) => {
        doc.text(line, x, currentY + (i * lineHeight));
        
        // Underline for first line of Heading
        if (isHeading && i === 0) {
            const tw = doc.getTextWidth(line);
            doc.setLineWidth(0.15);
            doc.line(x, currentY + (i * lineHeight) + 0.8, x + tw, currentY + (i * lineHeight) + 0.8);
        }
    });

    return lines.length * lineHeight;
};

export const generateChallanPdf = async (data: ChallanData) => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Configurable Layout Constants
    const margin = 10;
    const contentWidth = pageWidth - (margin * 2);
    const standardBorder = 0.3;
    
    const headerBlockHeight = data.headerHeight || 20;
    const footerHeight = data.footerHeight || 20;
    const srWidth = data.srWidth || 15;
    const amountWidth = data.amountWidth || 30;
    const particularsWidth = contentWidth - srWidth - amountWidth;
    
    const footerStartY = pageHeight - margin - footerHeight;

    // --- Main External Frame ---
    doc.setDrawColor(0);
    doc.setLineWidth(standardBorder);
    doc.rect(margin, margin, contentWidth, pageHeight - (margin * 2));

    // --- 1. Header: Firm Name ---
    const headerBlockY = margin;
    const enterpriseTitle = data.enterprise === 'RV' ? 'R.V. ENTERPRISES' : 'VITHAL ENTERPRISES';
    
    doc.setFontSize(22);
    doc.setFont('times', 'bold');
    doc.text(enterpriseTitle.toUpperCase(), pageWidth / 2, headerBlockY + (headerBlockHeight / 2) + 3, { align: 'center' });

    // Header Block Bottom Separator
    doc.setLineWidth(standardBorder);
    doc.line(margin, headerBlockY + headerBlockHeight, pageWidth - margin, headerBlockY + headerBlockHeight);

    let currentY = headerBlockY + headerBlockHeight + 5;

    // --- 2. Subtitles & Tax Info ---
    const detailFS = data.headerDetailsFontSize || 8.5;
    doc.setFontSize(detailFS + 1.5);
    doc.setFont('helvetica', 'bold');
    doc.text("Supplier of Material Handling Equipments & Labour", pageWidth / 2, currentY, { align: 'center' });
    currentY += 5;

    doc.setFontSize(detailFS);
    doc.setFont('helvetica', 'normal');
    doc.text("Off. : A/404, Astraea, Rustomjee Urbania, Near Lodha Paradise, Majiwada, Thane (W) - 400601.", pageWidth / 2, currentY, { align: 'center' });
    currentY += 4.5;
    doc.text("Work : Sr No. 14/6A, Khot Banglow, Near Transformer, Bhandarli, Pimpri, Thane - 400 612.", pageWidth / 2, currentY, { align: 'center' });
    currentY += 6;

    doc.setFont('helvetica', 'bold');
    doc.text(`PAN: ${data.pan} | GSTIN: ${data.gstin}`, pageWidth / 2, currentY, { align: 'center' });
    currentY += 6;

    // Line after header details
    doc.setLineWidth(standardBorder);
    doc.line(margin, currentY, pageWidth - margin, currentY);

    // --- 3. Info Row (CHALLAN / VEHICLE / DATE) ---
    const colW = contentWidth / 3;
    const infoY = currentY;
    
    const drawInfoCell = (title: string, value: string, x: number, width: number) => {
        doc.setFontSize(8); 
        doc.setFont('helvetica', 'normal');
        doc.text(title, x + 2, infoY + 5.2);
        const titleWidth = doc.getTextWidth(title);
        doc.setFontSize(10.5); 
        doc.setFont('helvetica', 'bold');
        doc.text(value, x + 2 + titleWidth + 2, infoY + 5.5);
        doc.setLineWidth(standardBorder);
        doc.rect(x, infoY, width, 8);
    };

    let formattedDate = "";
    if (data.date) {
        try {
            formattedDate = format(parseISO(data.date), 'dd-MMM-yyyy').toUpperCase();
        } catch (e) {
            formattedDate = (data.date || '').toUpperCase();
        }
    }

    drawInfoCell("CHALLAN NO:", (data.challanNo || '').toUpperCase(), margin, colW);
    drawInfoCell("VEHICLE NO:", (data.vehicleNo || '').toUpperCase(), margin + colW, colW);
    drawInfoCell("DATE:", formattedDate, margin + (colW * 2), colW);

    currentY += 8;

    // --- 4. Address Section ---
    autoTable(doc, {
        startY: currentY,
        body: [[
            `FROM :  ${data.fromName.toUpperCase()}`,
            `DELIVERY TO :  ${data.deliveryToName.toUpperCase()}`
        ]],
        theme: 'grid',
        styles: { fontSize: 9, fontStyle: 'bold', cellPadding: 2.5, lineColor: 0, lineWidth: standardBorder, textColor: 0 },
        columnStyles: { 0: { cellWidth: contentWidth / 2 }, 1: { cellWidth: contentWidth / 2 } },
        margin: { left: margin, right: margin },
    });

    currentY = (doc as any).lastAutoTable.finalY;

    autoTable(doc, {
        startY: currentY,
        body: [[
            data.fromAddress.toUpperCase(),
            data.deliveryToAddress.toUpperCase()
        ]],
        theme: 'grid',
        styles: { cellPadding: 3.5, font: 'helvetica', overflow: 'linebreak', lineColor: 0, lineWidth: standardBorder, valign: 'top', minCellHeight: 18 },
        columnStyles: { 
            0: { cellWidth: contentWidth / 2, fontSize: data.fromAddressFontSize || 9.5 }, 
            1: { cellWidth: contentWidth / 2, fontSize: data.deliveryToAddressFontSize || 9.5 } 
        },
        margin: { left: margin, right: margin },
    });

    currentY = (doc as any).lastAutoTable.finalY;

    // --- 5. Header Row ---
    const headerRowHeight = 8;
    const headerStartY = currentY;
    
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, headerStartY, contentWidth, headerRowHeight, 'F');
    doc.setLineWidth(standardBorder);
    doc.setDrawColor(0);
    doc.line(margin, headerStartY, margin + contentWidth, headerStartY);
    doc.line(margin, headerStartY + headerRowHeight, margin + contentWidth, headerStartY + headerRowHeight);
    doc.line(margin + srWidth, headerStartY, margin + srWidth, headerStartY + headerRowHeight);
    doc.line(margin + contentWidth - amountWidth, headerStartY, margin + contentWidth - amountWidth, headerStartY + headerRowHeight);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text("SR.", margin + (srWidth / 2), headerStartY + 5.5, { align: 'center' });
    doc.text("PARTICULARS", margin + srWidth + (particularsWidth / 2), headerStartY + 5.5, { align: 'center' });
    doc.text("AMOUNT", margin + contentWidth - (amountWidth / 2), headerStartY + 5.5, { align: 'center' });

    currentY = headerStartY + headerRowHeight;
    
    // --- 6. Independent Title: "(NOT FOR SALE)" ---
    doc.setFontSize(data.titleFontSize || 10);
    doc.setFont('helvetica', 'bold');
    const titleText = "(NOT FOR SALE)";
    const titleX = margin + srWidth + (particularsWidth / 2);
    const titleY = currentY + 8;
    doc.text(titleText, titleX, titleY, { align: 'center' });
    
    const tw = doc.getTextWidth(titleText);
    doc.setLineWidth(0.3);
    doc.line(titleX - (tw / 2), titleY + 1, titleX + (tw / 2), titleY + 1);

    // --- 7. Manual Item Listing with Rich Rendering ---
    let itemY = titleY + 10;
    const defaultPartSize = data.particularsFontSize || 9;

    data.items.filter(i => i.particulars.trim()).forEach((item, index) => {
        // Draw SR Number
        doc.setFontSize(defaultPartSize);
        doc.setFont('helvetica', 'bold');
        doc.text((index + 1).toString(), margin + (srWidth / 2), itemY, { align: 'center' });
        
        // Process Particulars line by line
        const lines = item.particulars.split('\n');
        let blockHeight = 0;
        
        lines.forEach(lineText => {
            const addedHeight = renderRichLine(doc, lineText, margin + srWidth + 2, itemY + blockHeight, particularsWidth - 4, defaultPartSize);
            blockHeight += addedHeight + 1.2; // Extra line spacing
        });
        
        // Draw Amount
        if (item.amount) {
            doc.setFontSize(defaultPartSize);
            doc.setFont('helvetica', 'bold');
            doc.text(`${item.amount.toFixed(2)}/-`, margin + contentWidth - 2, itemY, { align: 'right' });
        }
        
        itemY += blockHeight + 4; // Spacing between items
    });

    // --- 8. Vertical Dividers ---
    doc.setLineWidth(standardBorder);
    doc.line(margin + srWidth, headerStartY, margin + srWidth, footerStartY);
    doc.line(margin + contentWidth - amountWidth, headerStartY, margin + contentWidth - amountWidth, footerStartY);

    // --- 9. Footer ---
    autoTable(doc, {
        startY: footerStartY,
        body: [[
            'RECEIVED BY',
            `FOR ${data.enterprise === 'RV' ? 'R.V.' : 'VITHAL'} ENTERPRISES`
        ]],
        theme: 'grid',
        tableWidth: contentWidth,
        margin: { left: margin, right: margin, bottom: margin },
        styles: { fontSize: 9.5, fontStyle: 'bold', minCellHeight: footerHeight, valign: 'top', lineColor: 0, lineWidth: standardBorder, textColor: 0, cellPadding: 4 },
        columnStyles: { 0: { cellWidth: contentWidth * 0.7, halign: 'left' }, 1: { cellWidth: contentWidth * 0.3, halign: 'right' } },
        didDrawCell: (hook) => {
            if (hook.section === 'body' && hook.column.index === 1) {
                const cell = hook.cell;
                doc.setFontSize(7);
                doc.setFont('helvetica', 'normal');
                doc.text("Signature", cell.x + cell.width - 4, cell.y + cell.height - 3, { align: 'right' });
            }
        }
    });

    if (data.includeStamp) {
        const stampFile = data.enterprise === 'RV' ? '/rv-stamp.png' : '/vithal-stamp.png';
        try {
            const stampImg = await loadImage(stampFile);
            doc.addImage(stampImg, 'PNG', pageWidth - margin - 35, footerStartY - 5, 30, 30);
        } catch (e) { }
    }

    doc.save(`Challan_${data.challanNo.replace(/\//g, '-')}.pdf`);
};
