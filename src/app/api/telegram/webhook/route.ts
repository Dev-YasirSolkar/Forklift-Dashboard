import { NextResponse } from 'next/server';
import { initializeFirebase } from '@/firebase';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';
import { generateSalaryPdfData } from '@/lib/salary-pdf-generator';
import {
  isTelegramAdmin,
  registerTelegramAdmin,
  processAdminNaturalLanguageQuery,
  getCompanyPaymentSummary,
  getFleetStatus,
  getTodayAttendanceSummary,
  getMonthlyBillingSummary,
} from '@/lib/telegram-assistant';

/**
 * @fileOverview Telegram Webhook Handler
 * Supports Admin business queries (Natural Language / Free-form) and Employee Salary Slips.
 */

const monthMap: Record<string, string> = {
  'jan': '01', 'january': '01',
  'feb': '02', 'february': '02',
  'mar': '03', 'march': '03',
  'apr': '04', 'april': '04',
  'may': '05', 'manual': '05',
  'jun': '06', 'june': '06',
  'jul': '07', 'july': '07',
  'aug': '08', 'august': '08',
  'sep': '09', 'september': '09',
  'oct': '10', 'october': '10',
  'nov': '11', 'november': '11',
  'dec': '12', 'december': '12'
};

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '8655161170:AAGGbO-jGx62oRs0a0SNEQ9YaYu9WrDazEQ';
  
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Bot token missing' }, { status: 500 });
  }

  try {
    const data = await req.json();
    const message = data.message || data.edited_message;

    if (message && message.text && message.chat) {
      const rawText = message.text.trim();
      const lowerText = rawText.toLowerCase();
      const chatId = message.chat.id.toString();
      const firstName = message.from?.first_name || 'User';
      
      const { firestore } = initializeFirebase();
      const isAdmin = await isTelegramAdmin(chatId);

      // ─── 1. ADMIN REGISTRATION / PASSCODE COMMAND (/2028 or /admin) ───
      const isSecretCode = lowerText === '/2028' || lowerText === '2028' || lowerText.includes('2028');
      const isAdminCommand = lowerText.startsWith('/admin') || lowerText.startsWith('admin') || lowerText.startsWith('/login');

      if (isSecretCode || isAdminCommand) {
        const parts = rawText.split(/\s+/);
        const secretOrEmail = isSecretCode ? '2028' : parts.find((p: string) => p.includes('2028') || p.includes('@'));

        if (secretOrEmail) {
          const success = await registerTelegramAdmin(chatId, secretOrEmail);
          if (success) {
            await sendTelegramMessage(
              token,
              chatId,
              `👑 *Admin Access Granted!*\n━━━━━━━━━━━━━━━━━━━━━\nWelcome Owner/Admin! You can now ask questions about *VE Dashboard* anytime in normal Hindi or English.\n\n*Try asking:*\n• _"Bisleri ka pending payment kitna hai?"_\n• _"Workshop me kitne forklifts hain?"_\n• _"Aaj attendance me kon absent hai?"_\n• _"Is mahine ka total billing batao"_\n━━━━━━━━━━━━━━━━━━━━━`
            );
            return NextResponse.json({ ok: true });
          } else {
            await sendTelegramMessage(token, chatId, `❌ *Invalid Passcode or Email.* Use \`/2028\` to unlock Admin access.`);
            return NextResponse.json({ ok: true });
          }
        } else {
          if (isAdmin) {
            await sendTelegramMessage(
              token,
              chatId,
              `👑 *Admin Mode Active!*\n━━━━━━━━━━━━━━━━━━━━━\nAsk me anything about your companies, fleet, billing or attendance.\n\n*Quick Commands:*\n• \`/fleet\` - Forklift overview\n• \`/attendance\` - Today's attendance\n• \`/revenue\` - Monthly billing summary\n• \`/pending <Company>\` - Outstanding bills`
            );
          } else {
            await sendTelegramMessage(
              token,
              chatId,
              `🔒 *Admin Verification Required*\n━━━━━━━━━━━━━━━━━━━━━\nTo activate Admin features, type:\n\`/2028\`\n\nYour Chat ID: \`${chatId}\``
            );
          }
          return NextResponse.json({ ok: true });
        }
      }

      // ─── 2. START / HELP COMMAND ─────────────────────────────────────────
      if (lowerText === '/start' || lowerText === 'id' || lowerText === '/id' || lowerText === '/help') {
        if (isAdmin) {
          await sendTelegramMessage(
            token,
            chatId,
            `👑 *Hello ${firstName}! (Admin)* 👋\n\nWelcome to your *VE Dashboard Assistant*.\n\n*What you can ask:*\n• *Company Details & Due Bills:* _"Bisleri pending balance"_\n• *Fleet Location:* _"Workshop forklifts"_\n• *Attendance:* _"Today attendance"_\n• *Revenue:* _"This month billing"_\n\n_Just send a message in normal Hindi or English!_`
          );
        } else {
          const responseText = `Hello ${firstName}! 👋\n\nWelcome to *VE Enterprises Dashboard Bot*.\n\nYour Unique Chat ID is:\n\`${chatId}\`\n\n*Technician Commands:*\n• \`/slip\` - Get latest salary summary.\n• \`/slips\` - List available months.\n• \`/slip Jan\` - Get PDF for January.\n\n*Admin?* Type \`/admin <Your Email>\` to unlock full dashboard access.`;
          await sendTelegramMessage(token, chatId, responseText);
        }
        return NextResponse.json({ ok: true });
      }

      // ─── 3. ADMIN QUICK SHORTCUTS ────────────────────────────────────────
      if (isAdmin) {
        if (lowerText === '/fleet' || lowerText === 'fleet') {
          const res = await getFleetStatus();
          await sendTelegramMessage(token, chatId, res);
          return NextResponse.json({ ok: true });
        }
        if (lowerText === '/attendance' || lowerText === 'attendance') {
          const res = await getTodayAttendanceSummary();
          await sendTelegramMessage(token, chatId, res);
          return NextResponse.json({ ok: true });
        }
        if (lowerText === '/revenue' || lowerText === 'revenue') {
          const res = await getMonthlyBillingSummary();
          await sendTelegramMessage(token, chatId, res);
          return NextResponse.json({ ok: true });
        }
        if (lowerText.startsWith('/pending') || lowerText.startsWith('/company')) {
          const companyQuery = rawText.replace(/^\/(pending|company)\s*/i, '').trim();
          if (companyQuery) {
            const res = await getCompanyPaymentSummary(companyQuery);
            await sendTelegramMessage(token, chatId, res);
          } else {
            await sendTelegramMessage(token, chatId, `⚠️ Please specify company name, e.g. \`/pending Bisleri\``);
          }
          return NextResponse.json({ ok: true });
        }
      }

      // ─── 4. TECHNICIAN SALARY SLIPS COMMANDS ─────────────────────────────
      const isSalaryRequest = lowerText.startsWith('/slip') || lowerText.startsWith('/slips') || (lowerText.includes('salary') && !lowerText.includes('total'));
      if (isSalaryRequest) {
        if (lowerText === '/slips' || lowerText === 'list' || lowerText === 'slips') {
          const empQuery = query(collection(firestore, 'employees'), where('telegramChatId', '==', chatId));
          const empSnap = await getDocs(empQuery);

          if (empSnap.empty) {
            await sendTelegramMessage(token, chatId, "❌ *Chat ID not linked.*\nPlease contact HR with your ID: `" + chatId + "` to link your account.");
          } else {
            const employeeId = empSnap.docs[0].id;
            const salaryQuery = query(
              collection(firestore, 'salaries'), 
              where('employeeId', '==', employeeId),
              orderBy('month', 'desc'),
              limit(12)
            );
            const salarySnap = await getDocs(salaryQuery);

            if (salarySnap.empty) {
              await sendTelegramMessage(token, chatId, "🔍 No salary records found for your account in our database.");
            } else {
              let list = `📄 *Available Salary Slips:*\n━━━━━━━━━━━━━━━━━━\n`;
              salarySnap.docs.forEach(d => {
                const s = d.data();
                const date = new Date(s.month + "-01");
                const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
                list += `• ${label} (Type \`/slip ${date.toLocaleString('en-US', { month: 'short' })}\`)\n`;
              });
              list += `━━━━━━━━━━━━━━━━━━\n_Reply with the month name to get the PDF._`;
              await sendTelegramMessage(token, chatId, list);
            }
          }
          return NextResponse.json({ ok: true });
        }

        // Send Salary Slip PDF
        const empQuery = query(collection(firestore, 'employees'), where('telegramChatId', '==', chatId));
        const empSnap = await getDocs(empQuery);

        if (empSnap.empty && !isAdmin) {
          await sendTelegramMessage(token, chatId, "❌ *Unauthorized Access.*\nYour Chat ID (`" + chatId + "`) is not linked to any technician profile.");
          return NextResponse.json({ ok: true });
        }

        if (!empSnap.empty) {
          const employee = empSnap.docs[0].data();
          const employeeId = empSnap.docs[0].id;

          let targetMonth = "";
          const parts = lowerText.split(/\s+/);
          const monthArg = parts.length > 1 ? parts[1] : "";

          if (monthMap[monthArg]) {
            targetMonth = monthMap[monthArg];
          } else if (/^\d{1,2}$/.test(monthArg)) {
            targetMonth = monthArg.padStart(2, '0');
          }

          let salaryQuery;
          if (targetMonth) {
            const currentYear = new Date().getFullYear();
            salaryQuery = query(
              collection(firestore, 'salaries'), 
              where('employeeId', '==', employeeId),
              where('month', '>=', `${currentYear - 1}-01`),
              orderBy('month', 'desc')
            );
          } else {
            salaryQuery = query(
              collection(firestore, 'salaries'), 
              where('employeeId', '==', employeeId),
              orderBy('month', 'desc'),
              limit(1)
            );
          }

          const salarySnap = await getDocs(salaryQuery);
          let salaryDoc = null;

          if (targetMonth) {
            salaryDoc = salarySnap.docs.find(d => d.data().month.endsWith("-" + targetMonth));
          } else {
            salaryDoc = salarySnap.docs[0];
          }

          if (!salaryDoc) {
            const errorMsg = targetMonth 
              ? `❌ Sorry, no slip found for the month code: ${targetMonth}.`
              : `❌ Sorry, no salary records found for your account.`;
            await sendTelegramMessage(token, chatId, `${errorMsg}\nType */slips* to see available records.`);
          } else {
            const salary = salaryDoc.data();
            const monthDate = new Date(salary.month + "-01");
            const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

            const summary = `📄 *Salary Summary: ${monthName}*\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `👤 *Name:* ${employee.fullName}\n` +
              `💰 *NET PAYABLE:* ₹${salary.netSalary.toLocaleString('en-IN')}\n` +
              `🏁 *Status:* ${salary.status === 'Paid' ? '✅ PAID' : '⏳ PENDING'}\n\n` +
              `_Generating your official PDF slip..._ ⏳`;

            await sendTelegramMessage(token, chatId, summary);

            const settingsId = salary.enterprise.toLowerCase();
            const settingsSnap = await getDoc(doc(firestore, 'companySettings', settingsId));
            const settings = settingsSnap.data();

            if (settings) {
              try {
                const pdfDoc = await generateSalaryPdfData(salary as any, employee as any, settings as any);
                const pdfBase64 = pdfDoc.output('datauristring');
                const fileName = `Salary_Slip_${salary.month}_${employee.fullName.replace(/\s+/g, '_')}.pdf`;
                await sendTelegramPDF(token, chatId, pdfBase64, fileName);
              } catch (pdfErr) {
                console.error("PDF Bot Error:", pdfErr);
                await sendTelegramMessage(token, chatId, "_Oops! Something went wrong while generating your PDF. Please contact the office._");
              }
            }
          }
          return NextResponse.json({ ok: true });
        }
      }

      // ─── 5. ADMIN NATURAL LANGUAGE QUERY (AI POWERED) ────────────────────
      if (isAdmin) {
        // Send a quick typing indicator or process response
        const answer = await processAdminNaturalLanguageQuery(rawText);
        await sendTelegramMessage(token, chatId, answer);
        return NextResponse.json({ ok: true });
      }

      // ─── 6. UNRECOGNIZED USER ────────────────────────────────────────────
      await sendTelegramMessage(
        token,
        chatId,
        `👋 Hello! Your Chat ID is \`${chatId}\`.\n\n• If you are a technician, ask HR to add this Chat ID to your profile.\n• If you are Admin, type \`/admin <Super Admin Email>\` to access business reports.`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ ok: true }); 
  }
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'Markdown',
      }),
    });
    const result = await res.json();
    
    // If Markdown parsing fails (e.g. unescaped symbols), retry in plain text so message is NEVER lost
    if (!result.ok && result.description?.includes('can\'t parse entities')) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.replace(/[*_`]/g, ''),
        }),
      });
    }
  } catch (err) {
    console.error('Failed to send Telegram text message:', err);
  }
}

async function sendTelegramPDF(token: string, chatId: string, base64Data: string, fileName: string) {
  try {
    const base64 = base64Data.split(',')[1] || base64Data;
    const buffer = Buffer.from(base64, 'base64');
    const formData = new FormData();
    formData.append('chat_id', chatId);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    formData.append('document', blob, fileName);

    await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });
  } catch (err) {
    console.error('Failed to send Telegram PDF:', err);
  }
}
