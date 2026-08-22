'use server';

import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { firebaseConfig } from '@/firebase/config';

/**
 * @fileOverview Telegram Bot Server Actions
 * Handles sending documents and managing bot webhooks securely.
 */

async function getTelegramToken(): Promise<string> {
  if (process.env.TELEGRAM_BOT_TOKEN) {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  try {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    const db = getFirestore(app);
    const snap = await getDoc(doc(db, 'companySettings', 'telegram'));
    if (snap.exists() && snap.data()?.botToken) {
      return snap.data().botToken;
    }
  } catch (err) {
    console.error('Failed to read Telegram Bot Token from Firestore:', err);
  }

  throw new Error('Telegram Bot Token is not configured. Please set TELEGRAM_BOT_TOKEN in environment variables.');
}

export async function sendTelegramDocument(chatId: string, base64Data: string, fileName: string) {
  const token = await getTelegramToken();

  try {
    const base64 = base64Data.split(',')[1] || base64Data;
    const buffer = Buffer.from(base64, 'base64');

    const formData = new FormData();
    formData.append('chat_id', chatId);
    
    // We create a File object for the document
    const blob = new Blob([buffer], { type: 'application/pdf' });
    formData.append('document', blob, fileName);

    const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
      method: 'POST',
      body: formData,
    });

    const result = await response.json();
    if (!result.ok) {
      console.error('Telegram API Error:', result);
      throw new Error(result.description || 'Failed to send document.');
    }

    return { success: true };
  } catch (error: any) {
    console.error('Telegram Send Error:', error);
    throw new Error(error.message || 'Failed to send document.');
  }
}

/**
 * Connects the Telegram Bot to our server using Webhooks.
 */
export async function setupTelegramWebhook(baseUrl: string) {
  const token = await getTelegramToken();

  // Clean the baseUrl (remove trailing slash)
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const webhookUrl = `${cleanBaseUrl}/api/telegram/webhook`;
  
  try {
    // Set the webhook and drop any pending updates to clear the queue
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}&drop_pending_updates=true`);
    const result = await response.json();
    
    if (!result.ok) {
      console.error('SetWebhook Error:', result);
      throw new Error(result.description || 'Failed to set webhook.');
    }
    
    return { success: true, description: result.description };
  } catch (error: any) {
    console.error('Webhook Setup Error:', error);
    throw new Error(error.message || 'Failed to set webhook.');
  }
}
