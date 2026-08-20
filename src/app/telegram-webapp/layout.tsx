import type { Metadata } from 'next';
import Script from 'next/script';

export const metadata: Metadata = {
  title: 'Billing Statement & Ledger - Telegram WebApp',
  description: 'Live Interactive 13-Column Accounting Billing Table for Telegram Bot',
};

export default function TelegramWebAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      {children}
    </>
  );
}
