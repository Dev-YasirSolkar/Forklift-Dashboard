import { NextResponse } from 'next/server';
import { collection, query, where, getDocs, limit, orderBy, doc, getDoc } from 'firebase/firestore';
import { generateSalaryPdfData } from '@/lib/salary-pdf-generator';
import {
  isTelegramAdmin,
  registerTelegramAdmin,
  processAdminNaturalLanguageQuery,
  getCompanyDetailByIntent,
  getFleetStatus,
  getTodayAttendanceSummary,
  getMonthlyBillingSummary,
  getMonthlyPendingBills,
  getTopPendingBalances,
  getAuthenticatedFirestore,
  renderFirmSelectionMenu,
  getUserActiveFirm,
  setUserActiveFirm,
  renderFirmRadioButtons,
  transcribeTelegramVoiceAudio,
  EnterpriseType,
  AssistantResponse,
} from '@/lib/telegram-assistant';
import { sendTelegramMessage, sendTelegramPDF, answerTelegramCallback, clearTelegramMessageButtons, dispatchAssistantResponse } from '@/lib/telegram-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * @fileOverview Telegram Webhook Handler
 * Supports Admin business queries (Natural Language, Voice Notes, Mobile Bullet Points, Inline Radio Buttons) and Employee Salary Slips.
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
    console.log('[Telegram Webhook Payload]:', JSON.stringify(data));

    // ─── A. HANDLE INLINE BUTTON CALLBACK QUERIES ─────────────────────────
    if (data.callback_query) {
      const cb = data.callback_query;
      const callbackId = cb.id;
      const chatId = cb.message?.chat?.id?.toString() || cb.from?.id?.toString();
      const cbData = String(cb.data || '');
      const messageId = cb.message?.message_id;

      if (chatId) {
        if (messageId) {
          await clearTelegramMessageButtons(token, chatId, messageId);
        }

        if (cbData.startsWith('firm:')) {
          const selectedFirm = cbData.split(':')[1] as EnterpriseType;
          await sendTelegramMessage(token, chatId, `👉 *Selected Firm:* \`${selectedFirm === 'Both' ? 'Both Firms (Vithal + RV)' : selectedFirm}\``);
          const res = await setUserActiveFirm(chatId, selectedFirm);
          await answerTelegramCallback(token, callbackId, `Firm set to ${selectedFirm}!`);
          await dispatchAssistantResponse(token, chatId, res);
          return NextResponse.json({ ok: true });
        }

        if (cbData.startsWith('page:')) {
          const parts = cbData.split(':');
          const pageType = parts[1];
          const compName = parts[2];
          const pageNum = parseInt(parts[3] || '1', 10);
          const activeFirm = await getUserActiveFirm(chatId);

          const intent = pageType === 'pendlist' ? 'pending_list' : 'bills';
          const label = pageType === 'pendlist' ? `📋 Pending Bills (Page ${pageNum})` : `📄 All Invoices (Page ${pageNum})`;
          await sendTelegramMessage(token, chatId, `👉 *Navigated:* \`${label} - ${compName}\``);
          const res = await getCompanyDetailByIntent(compName, intent, activeFirm, null, pageNum);
          await answerTelegramCallback(token, callbackId, `Page ${pageNum}`);
          await dispatchAssistantResponse(token, chatId, res);
          return NextResponse.json({ ok: true });
        }

        if (
          cbData.startsWith('comp_select:') || 
          cbData.startsWith('comp_pend:') || 
          cbData.startsWith('comp_pendlist:') || 
          cbData.startsWith('comp_bills:') || 
          cbData.startsWith('comp_fork:')
        ) {
          const [prefix, ...compParts] = cbData.split(':');
          const compName = compParts.join(':');
          const activeFirm = await getUserActiveFirm(chatId);

          let intent: 'all' | 'pending' | 'pending_list' | 'bills' | 'forklifts' = 'all';
          let actionLabel = '🏢 Company Summary';
          if (prefix === 'comp_pend') { intent = 'pending'; actionLabel = '⚠️ Outstanding Balance'; }
          if (prefix === 'comp_pendlist') { intent = 'pending_list'; actionLabel = '📋 Pending Bills List'; }
          if (prefix === 'comp_bills') { intent = 'bills'; actionLabel = '📄 All Invoices Breakdown'; }
          if (prefix === 'comp_fork') { intent = 'forklifts'; actionLabel = '🚜 Site Forklifts'; }

          await sendTelegramMessage(token, chatId, `👉 *Selected:* \`${actionLabel} - ${compName}\``);
          const res = await getCompanyDetailByIntent(compName, intent, activeFirm);
          await answerTelegramCallback(token, callbackId);
          await dispatchAssistantResponse(token, chatId, res);
          return NextResponse.json({ ok: true });
        }

        if (cbData.startsWith('quick:')) {
          const action = cbData.replace('quick:', '');
          const activeFirm = await getUserActiveFirm(chatId);

          if (action === 'attendance') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`📅 Today's Attendance\``);
            const res = await getTodayAttendanceSummary('all');
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'absent') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`🔴 Absent Staff List\``);
            const res = await getTodayAttendanceSummary('absent');
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'fleet') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`🚜 Total Fleet Overview\``);
            const res = await getFleetStatus('All', activeFirm);
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'workshop') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`🏭 Workshop Idle Forklifts\``);
            const res = await getFleetStatus('Workshop', activeFirm);
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'onsite') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`📍 On-Site Deployed Units\``);
            const res = await getFleetStatus('On-Site', activeFirm);
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'month_billing') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`📊 Current Month Billing\``);
            const res = await getMonthlyBillingSummary(activeFirm, null, 'summary');
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'month_pending') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`⚠️ Month Pending Invoices\``);
            const res = await getMonthlyPendingBills(activeFirm, null, 'detailed');
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
          if (action === 'top_debtors') {
            await sendTelegramMessage(token, chatId, `👉 *Selected:* \`⚠️ Top Pending Balances\``);
            const res = await getTopPendingBalances(activeFirm, 10);
            await answerTelegramCallback(token, callbackId);
            await dispatchAssistantResponse(token, chatId, res);
            return NextResponse.json({ ok: true });
          }
        }

        if (cbData === 'menu:firm') {
          await sendTelegramMessage(token, chatId, `👉 *Selected:* \`🔄 Change Active Firm Scope\``);
          const res = await renderFirmSelectionMenu(chatId);
          await answerTelegramCallback(token, callbackId);
          await dispatchAssistantResponse(token, chatId, res);
          return NextResponse.json({ ok: true });
        }
      }

      await answerTelegramCallback(token, callbackId);
      return NextResponse.json({ ok: true });
    }

    // ─── B. HANDLE STANDARD CHAT MESSAGES & VOICE AUDIO ───────────────────
    const message = data.message || data.edited_message;

    if (message && message.chat) {
      let rawText = (message.text || message.caption || '').trim();
      const chatId = message.chat.id.toString();
      const firstName = message.from?.first_name || 'User';

      // 🎤 HANDLE TELEGRAM VOICE NOTES & AUDIO MESSAGES DIRECTLY
      if (!rawText && (message.voice || message.audio)) {
        const fileId = message.voice?.file_id || message.audio?.file_id;
        if (fileId) {
          await sendTelegramMessage(token, chatId, `🎙️ *Voice message sun rahe hain...* ⏳`);
          const result = await transcribeTelegramVoiceAudio(token, fileId);
          if (result.success && result.text) {
            rawText = result.text.trim();
            await sendTelegramMessage(token, chatId, `🗣️ *Aapne poocha:* _"${rawText}"_`);
          } else {
            await sendTelegramMessage(token, chatId, result.error || `⚠️ *Voice message recognize nahi ho saka.* Kripya dobara clear aawaz me bole ya text me likhein.`);
            return NextResponse.json({ ok: true });
          }
        }
      }

      if (!rawText) {
        return NextResponse.json({ ok: true });
      }

      const lowerText = rawText.toLowerCase();

      // ─── 1. DIRECT PASSCODE / ADMIN UNLOCK (/2028 or 2028) ───────────────
      const isSecretCode = lowerText === '/2028' || lowerText === '2028' || lowerText.includes('2028');
      const isAdminCommand = lowerText.startsWith('/admin') || lowerText.startsWith('admin') || lowerText.startsWith('/login');

      if (isSecretCode || isAdminCommand) {
        const parts = rawText.split(/\s+/);
        const secretOrEmail = isSecretCode ? '2028' : (parts.find((p: string) => p.includes('2028') || p.includes('@')) || '2028');

        const success = await registerTelegramAdmin(chatId, secretOrEmail);
        if (success) {
          await sendTelegramMessage(
            token,
            chatId,
            `✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n👑 *ADMIN ACCESS ACTIVATED!* 👑\n🏭 *Vithal & R.V Enterprises*\n✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n\nNamaste *${firstName}*! 🙏 Aapka Admin session **permanently active** ho gaya hai.`
          );
          
          // Send Interactive Firm Radio Selection
          const firmMenu = await renderFirmSelectionMenu(chatId);
          await sendTelegramMessage(token, chatId, firmMenu.text, firmMenu.buttons);
        } else {
          await sendTelegramMessage(token, chatId, `🔒 To unlock Admin access, simply type:\n👉 \`/2028\``);
        }
        return NextResponse.json({ ok: true });
      }

      // Check admin status safely (Permanent Lifetime Persistence)
      let isAdmin = false;
      try {
        isAdmin = await isTelegramAdmin(chatId);
      } catch (err) {
        console.error('Error checking admin status:', err);
      }

      // ─── 2. START / HELP COMMAND ─────────────────────────────────────────
      if (lowerText === '/start' || lowerText === 'id' || lowerText === '/id' || lowerText === '/help') {
        if (isAdmin) {
          const activeFirm = await getUserActiveFirm(chatId);
          await sendTelegramMessage(
            token,
            chatId,
            `✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n👑 *NAMASTE ${firstName.toUpperCase()}! (ADMIN)* 👑\n🏢 Active Firm: *${activeFirm === 'Both' ? 'Both Firms (Vithal + RV)' : activeFirm}*\n✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n\nAapka Admin session active hai. Aap ye queries puch sakte hain:\n\n📊 *Quick Shortcuts:*\n• 🏢 _"Bisleri pending"_\n• ⚠️ _"Top pending"_\n• 🚜 _"Workshop"_\n• 📅 _"Today attendance"_\n• 💰 _"Revenue"_\n\n👇 *Select Active Firm below:*`,
            renderFirmRadioButtons(activeFirm)
          );
        } else {
          const welcomeMsg = `✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n🚜 *WELCOME TO VE DASHBOARD BOT* 🚜\n🏭 *Vithal & R.V Enterprises*\n✨ ━━━━━━━━━━━━━━━━━━━━━━ ✨\n\nNamaste *${firstName}*! 👋 Aapka swagat hai hamare automated service portal par.\n\n🔑 *Aapka Unique Chat ID:*\n\`${chatId}\`\n\n━━━━━━━━━━━━━━━━━━━━━━\n👑 *ADMIN / OWNER ACCESS:*\nAgar aap Owner/Admin hain, toh dashboard access unlock karne ke liye ye code bhejein:\n👉 \`/2028\`\n\n━━━━━━━━━━━━━━━━━━━━━━\n👷 *TECHNICIAN / STAFF COMMANDS:*\n• 📄 \`/slip\` ➔ Latest salary summary\n• 📑 \`/slips\` ➔ All available salary slips\n• 📥 \`/slip Jan\` ➔ Specific month ki PDF slip\n\n━━━━━━━━━━━━━━━━━━━━━━\n_Type \`/help\` anytime for assistance._`;
          await sendTelegramMessage(token, chatId, welcomeMsg);
        }
        return NextResponse.json({ ok: true });
      }

      // ─── 3. TECHNICIAN SALARY SLIPS COMMANDS ─────────────────────────────
      const isSalaryRequest = lowerText.startsWith('/slip') || lowerText.startsWith('/slips') || (lowerText.includes('salary') && !lowerText.includes('total'));
      if (isSalaryRequest) {
        try {
          const firestore = await getAuthenticatedFirestore();
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
        } catch (dbErr) {
          console.error("Salary Query DB Error:", dbErr);
        }
      }

      // ─── 4. ADMIN NATURAL LANGUAGE QUERY ─────────────────────────────────
      if (isAdmin) {
        const response = await processAdminNaturalLanguageQuery(rawText, chatId);
        await dispatchAssistantResponse(token, chatId, response);
        return NextResponse.json({ ok: true });
      }

      // ─── 5. UNRECOGNIZED USER ────────────────────────────────────────────
      await sendTelegramMessage(
        token,
        chatId,
        `👋 Hello! Your Chat ID is \`${chatId}\`.\n\n• If you are a technician, ask HR to add this Chat ID to your profile.\n• If you are Admin, type \`/2028\` to access business reports.`
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook processing failed:', error);
    return NextResponse.json({ ok: true }); 
  }
}

/**
 * Dispatches single or multi-message Assistant responses to Telegram.
 */
async function dispatchAssistantResponse(
  token: string, 
  chatId: string, 
  res: AssistantResponse
) {
  if (res.messages && res.messages.length > 0) {
    for (let i = 0; i < res.messages.length; i++) {
      const msg = res.messages[i];
      await sendTelegramMessage(token, chatId, msg.text, msg.buttons);
    }
  } else {
    await sendTelegramMessage(token, chatId, res.text, res.buttons);
  }
}

/**
 * Splits long text into chunks of at most maxChars while respecting paragraph breaks.
 */
function splitMessageText(text: string, maxChars: number = 3800): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = '';

  for (const para of paragraphs) {
    if ((currentChunk + '\n\n' + para).length > maxChars) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = para;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n\n' + para : para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function sendTelegramMessage(
  token: string, 
  chatId: string, 
  text: string, 
  buttons?: Array<Array<{ text: string; callback_data?: string; web_app?: { url: string }; url?: string }>>
) {
  try {
    const chunks = splitMessageText(text, 3800);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;

      const payload: any = {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      };

      // Attach inline buttons only to the last message chunk
      if (isLast && buttons && buttons.length > 0) {
        payload.reply_markup = { inline_keyboard: buttons };
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      
      // Fallback: If Markdown parsing fails, retry plain text
      if (!result.ok) {
        payload.text = chunk.replace(/[*_`]/g, '');
        delete payload.parse_mode;
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

async function editTelegramMessage(
  token: string, 
  chatId: string, 
  messageId: number, 
  text: string, 
  buttons?: Array<Array<{ text: string; callback_data: string }>>
) {
  try {
    const payload: any = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: 'Markdown',
    };

    if (buttons && buttons.length > 0) {
      payload.reply_markup = { inline_keyboard: buttons };
    }

    await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Failed to edit Telegram message:', err);
  }
}

async function clearTelegramMessageButtons(token: string, chatId: string, messageId: number) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] },
      }),
    });
  } catch (err) {
    console.error('Failed to clear Telegram message buttons:', err);
  }
}

async function answerTelegramCallback(token: string, callbackId: string, text?: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackId,
        text: text || '',
      }),
    });
  } catch (err) {
    console.error('Failed to answer Telegram callback query:', err);
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
