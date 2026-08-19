'use server';

/**
 * @fileOverview Telegram Bot Server Actions
 * Handles sending documents and managing bot webhooks.
 */

export async function sendTelegramDocument(chatId: string, base64Data: string, fileName: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN || '8655161170:AAGGbO-jGx62oRs0a0SNEQ9YaYu9WrDazEQ';
  if (!token) {
    throw new Error('Telegram Bot Token is not configured.');
  }

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
  const token = process.env.TELEGRAM_BOT_TOKEN || '8655161170:AAGGbO-jGx62oRs0a0SNEQ9YaYu9WrDazEQ';
  if (!token) throw new Error('Bot token missing in environment variables.');

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
