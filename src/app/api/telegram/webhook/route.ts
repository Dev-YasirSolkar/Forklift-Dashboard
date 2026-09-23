import { NextResponse } from 'next/server';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';
import { initializeFirebase } from '@/firebase';
import { generateSalaryPdfData } from '@/lib/salary-pdf-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * @fileOverview Telegram Webhook Handler
 * Dedicated ONLY for Employee / Staff Salary & Payment Slips requests.
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

async function getTelegramToken(): Promise<string | null> {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;

  try {
    const { firestore } = initializeFirebase();
    const snap = await getDoc(doc(firestore, 'companySettings', 'telegram'));
    if (snap.exists() && snap.data()?.botToken) {
      return snap.data().botToken;
    }
  } catch (err) {
    console.error('Failed to get Telegram Bot Token:', err);
  }

  return null;
}

export async function POST(req: Request) {
  const token = await getTelegramToken();
  
  if (!token) {
    console.error('Telegram Bot Token is not configured.');
    return NextResponse.json({ ok: false, error: 'Bot token missing' }, { status: 500 });
  }

  try {
    const data = await req.json();

    if (data.message && data.message.text) {
      const chatId = data.message.chat.id.toString();
      const rawText = data.message.text.trim();
      const lowerText = rawText.toLowerCase();
      const firstName = data.message.from?.first_name || 'Staff';

      const { firestore } = initializeFirebase();

      // ─── 1. START / HELP COMMAND ─────────────────────────────────────────
      if (lowerText === '/start' || lowerText === '/help' || lowerText === 'hi' || lowerText === 'hello') {
        const welcomeMsg = 
          `✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n` +
          `🚜 *FORKLIFT DASHBOARD PORTAL* 🚜\n` +
          `🏭 *Vithal & R.V Enterprises*\n` +
          `✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n\n` +
          `Namaste *${firstName}*! 👋 Aapka swagat hai hamare Salary Slip Service Portal par.\n\n` +
          `🔑 *Aapka Registered Chat ID:*\n\`${chatId}\`\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `👷 *STAFF SALARY SLIP COMMANDS:*\n` +
          `• 📄 \`/slip\` ➔ Latest salary summary & PDF\n` +
          `• 📑 \`/slips\` ➔ Available salary slips list\n` +
          `• 📥 \`/slip Jan\` ➔ Specific month ki PDF slip\n\n` +
          `━━━━━━━━━━━━━━━━━━━━━━\n` +
          `_Note: Agar aapka account link nahi hai, toh apna Chat ID HR ko bhein._`;

        await sendTelegramMessage(token, chatId, welcomeMsg);
        return NextResponse.json({ ok: true });
      }

      // ─── 2. LIST ALL SLIPS COMMAND (/slips) ──────────────────────────────
      if (lowerText === '/slips' || lowerText === 'slips' || lowerText === 'list') {
        const empQuery = query(collection(firestore, 'employees'), where('telegramChatId', '==', chatId));
        const empSnap = await getDocs(empQuery);

        if (empSnap.empty) {
          await sendTelegramMessage(token, chatId, `❌ *Chat ID not linked.*\nPlease contact HR with your ID: \`${chatId}\` to link your profile.`);
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
            await sendTelegramMessage(token, chatId, "🔍 No salary records found for your account in database.");
          } else {
            let list = `📄 *Available Salary Slips:*\n━━━━━━━━━━━━━━━━━━\n`;
            salarySnap.docs.forEach(d => {
              const s = d.data();
              const date = new Date(s.month + "-01");
              const label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
              list += `• ${label} (Type \`/slip ${date.toLocaleString('en-US', { month: 'short' })}\`)\n`;
            });
            list += `━━━━━━━━━━━━━━━━━━\n_Reply with month name (e.g. /slip Aug) to get PDF._`;
            await sendTelegramMessage(token, chatId, list);
          }
        }
        return NextResponse.json({ ok: true });
      }

      // ─── 3. FETCH SPECIFIC MONTH SALARY SLIP PDF (/slip or month name) ─────
      const empQuery = query(collection(firestore, 'employees'), where('telegramChatId', '==', chatId));
      const empSnap = await getDocs(empQuery);

      if (empSnap.empty) {
        await sendTelegramMessage(token, chatId, `❌ *Unauthorized Access.*\nYour Chat ID (\`${chatId}\`) is not linked to any employee profile.\n\nPlease share your Chat ID with HR.`);
        return NextResponse.json({ ok: true });
      }

      const employee = empSnap.docs[0].data();
      const employeeId = empSnap.docs[0].id;

      let targetMonth = "";
      const parts = lowerText.split(/\s+/);
      const monthArg = parts.length > 1 ? parts[1] : parts[0];

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
          ? `❌ Sorry, no salary slip found for month code: ${targetMonth}.`
          : `❌ Sorry, no salary records found for your profile.`;
        await sendTelegramMessage(token, chatId, `${errorMsg}\nType */slips* to see available records.`);
      } else {
        const salary = salaryDoc.data();
        const monthDate = new Date(salary.month + "-01");
        const monthName = monthDate.toLocaleString('en-US', { month: 'long', year: 'numeric' });

        const summary = 
          `📄 *Salary Summary: ${monthName}*\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `👤 *Name:* ${employee.fullName || employee.name || 'Staff'}\n` +
          `💰 *NET PAYABLE:* ₹${Number(salary.netSalary || 0).toLocaleString('en-IN')}\n` +
          `🏁 *Status:* ${salary.status === 'Paid' ? '✅ PAID' : '⏳ PENDING'}\n\n` +
          `_Generating official PDF slip..._ ⏳`;

        await sendTelegramMessage(token, chatId, summary);

        const settingsId = (salary.enterprise || 'vithal').toLowerCase();
        const settingsSnap = await getDoc(doc(firestore, 'companySettings', settingsId));
        const settings = settingsSnap.data();

        if (settings) {
          try {
            const pdfDoc = await generateSalaryPdfData(salary as any, employee as any, settings as any);
            const pdfBase64 = pdfDoc.output('datauristring');
            const fileName = `Salary_Slip_${salary.month}_${(employee.fullName || employee.name || 'Staff').replace(/\s+/g, '_')}.pdf`;
            await sendTelegramPDF(token, chatId, pdfBase64, fileName);
          } catch (pdfErr) {
            console.error("PDF Bot Error:", pdfErr);
            await sendTelegramMessage(token, chatId, "_Oops! Something went wrong while generating your PDF slip. Please contact HR._");
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ ok: true }); 
  }
}

// ─── HELPER FUNCTIONS FOR TELEGRAM API ──────────────────────────────────────

function splitMessageText(text: string, maxLength: number = 3800): string[] {
  if (text.length <= maxLength) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let currentChunk = '';

  for (const line of lines) {
    if ((currentChunk + '\n' + line).length > maxLength) {
      chunks.push(currentChunk.trim());
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function sendTelegramMessage(token: string, chatId: string, text: string) {
  try {
    const chunks = splitMessageText(text, 3800);
    for (const chunk of chunks) {
      const payload = {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      };
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!result.ok) {
        delete (payload as any).parse_mode;
        payload.text = chunk.replace(/[*_`]/g, '');
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
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
