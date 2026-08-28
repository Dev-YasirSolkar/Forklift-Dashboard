# Forklift Dashboard - Workshop Management System

A professional management dashboard for forklift workshops, built with Next.js and Firebase. This application manages fleet tracking, job cards, billing, payments, and employee assignments for Vithal and R.V Enterprises.

## 🛠 Technology Stack

- **Framework:** Next.js 15 (App Router)
- **Frontend:** React 18, Tailwind CSS
- **UI Components:** ShadCN UI (Radix UI)
- **Database & Auth:** Firebase (Firestore & Authentication)
- **Analytics:** Recharts
- **Documents:** `docx` (Word Invoice Generation), `xlsx` (Excel Data Import)

## 🚀 Deployment Guide

This project is optimized for **Firebase App Hosting** or **Vercel**. Normal shared hosting (cPanel) will not work because this project requires Node.js.

### Option 1: Firebase App Hosting (Recommended)
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Upgrade your project to the **Blaze Plan** (Pay-as-you-go).
3. Connect your GitHub repository to Firebase App Hosting.
4. Firebase will automatically detect the `apphosting.yaml` and deploy your Next.js app.

### Option 2: Vercel
1. Create a new project on [Vercel](https://vercel.com/).
2. Import your GitHub repository.
3. Add your Firebase environment variables if needed (though the project is configured to use the `firebase/config.ts`).
4. Click Deploy.

## 📦 Local Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run development server:
   ```bash
   npm run dev
   ```
3. Seed the database with sample data:
   ```bash
   npm run seed
   ```

## 📋 Key Features
- **Fleet Management:** Track forklift locations (Workshop, On-Site, Unconfirmed).
- **Job Cards:** Manage repair requests and technician assignments.
- **Billing System:** Generate professional GST invoices for multiple enterprises.
- **Payment Tracking:** Monitor pending balances and record partial payments.
- **Analytics:** Visual breakdown of fleet utilization and composition.
