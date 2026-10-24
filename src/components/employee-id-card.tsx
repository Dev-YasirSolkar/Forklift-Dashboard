'use client';

import React, { forwardRef } from 'react';
import type { Employee } from '@/lib/data';
import { Phone, Droplets, MapPin, Calendar, Shield, Heart, Building2 } from 'lucide-react';

interface EmployeeIdCardProps {
  employee: Employee;
}

const EmployeeIdCard = forwardRef<HTMLDivElement, EmployeeIdCardProps>(
  ({ employee }, ref) => {
    const initials = employee.fullName
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const formatDate = (dateStr?: string) => {
      if (!dateStr) return '—';
      try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });
      } catch {
        return dateStr;
      }
    };

    const maskAadhaar = (aadhaar?: string) => {
      if (!aadhaar) return '—';
      const digits = aadhaar.replace(/\s/g, '');
      if (digits.length < 8) return aadhaar;
      return 'XXXX XXXX ' + digits.slice(-4);
    };

    return (
      <div
        ref={ref}
        className="w-[420px] rounded-2xl overflow-hidden shadow-2xl border border-border/40 bg-card text-card-foreground"
        style={{ fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
      >
        {/* ─── CARD HEADER — Company Brand Stripe ─── */}
        <div className="relative bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 px-5 pt-4 pb-14">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-black text-sm tracking-wider uppercase">
                Vithal Enterprises
              </h3>
              <p className="text-indigo-200 text-[9px] font-medium tracking-wide">
                FORKLIFT HIRE • SERVICE • SOLUTIONS
              </p>
            </div>
            <div className="bg-white/20 backdrop-blur-sm px-2.5 py-1 rounded-full">
              <span className="text-white text-[10px] font-bold tracking-wider">
                EMPLOYEE ID
              </span>
            </div>
          </div>
        </div>

        {/* ─── AVATAR + NAME OVERLAP ─── */}
        <div className="relative px-5 -mt-10 pb-3">
          <div className="flex items-end gap-4">
            {/* Avatar */}
            <div className="relative shrink-0">
              {employee.photoUrl ? (
                <img
                  src={employee.photoUrl}
                  alt={employee.fullName}
                  className="h-20 w-20 rounded-xl object-cover border-4 border-card shadow-lg"
                />
              ) : (
                <div className="h-20 w-20 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 border-4 border-card shadow-lg flex items-center justify-center">
                  <span className="text-white text-2xl font-black">{initials}</span>
                </div>
              )}
              {employee.bloodGroup && (
                <span className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded-md shadow-sm border-2 border-card">
                  {employee.bloodGroup}
                </span>
              )}
            </div>

            {/* Name + Designation */}
            <div className="min-w-0 pb-1">
              <h2 className="text-base font-black tracking-tight truncate leading-tight">
                {employee.fullName}
              </h2>
              <p className="text-xs text-muted-foreground font-semibold truncate">
                {employee.specialization || 'Employee'}
              </p>
              {employee.empCode && (
                <span className="inline-block mt-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold px-2 py-0.5 rounded-md">
                  ID: {employee.empCode}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ─── CARD BODY — Info Grid ─── */}
        <div className="px-5 pb-4 space-y-2.5">
          {/* Row 1: Mobile + DOB */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={<Phone className="h-3 w-3" />} label="Mobile" value={employee.contactNumber || '—'} />
            <InfoRow icon={<Calendar className="h-3 w-3" />} label="DOB" value={formatDate(employee.dateOfBirth)} />
          </div>

          {/* Row 2: Blood Group + DOJ */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={<Droplets className="h-3 w-3" />} label="Blood Group" value={employee.bloodGroup || '—'} />
            <InfoRow icon={<Calendar className="h-3 w-3" />} label="Date of Joining" value={formatDate(employee.doj)} />
          </div>

          {/* Row 3: Aadhaar + PAN */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={<Shield className="h-3 w-3" />} label="Aadhaar" value={maskAadhaar(employee.aadhaarNumber)} mono />
            <InfoRow icon={<Shield className="h-3 w-3" />} label="PAN" value={employee.panNumber || '—'} mono />
          </div>

          {/* Row 4: Current Site */}
          <div className="grid grid-cols-2 gap-3">
            <InfoRow icon={<Building2 className="h-3 w-3" />} label="Current Site" value={employee.currentSiteName || employee.workLocation || '—'} />
            <InfoRow icon={<MapPin className="h-3 w-3" />} label="Address" value={employee.currentAddress || employee.permanentAddress || '—'} truncate />
          </div>

          {/* Emergency Contact */}
          {employee.emergencyContactName && (
            <div className="bg-red-50 dark:bg-red-900/10 rounded-lg px-3 py-2 border border-red-200/50 dark:border-red-800/30">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Heart className="h-3 w-3 text-red-500" />
                <span className="text-[9px] font-bold uppercase text-red-600 dark:text-red-400 tracking-wider">Emergency Contact</span>
              </div>
              <p className="text-xs font-bold leading-tight">
                {employee.emergencyContactName}
                {employee.emergencyContactRelationship && (
                  <span className="text-muted-foreground font-normal"> ({employee.emergencyContactRelationship})</span>
                )}
              </p>
              {employee.emergencyContactNumber && (
                <p className="text-[11px] text-muted-foreground font-medium">{employee.emergencyContactNumber}</p>
              )}
            </div>
          )}
        </div>

        {/* ─── CARD FOOTER ─── */}
        <div className="bg-muted/40 border-t px-5 py-2.5 flex items-center justify-between">
          <p className="text-[9px] text-muted-foreground font-medium">
            This card is property of Vithal Enterprises. If found, please return.
          </p>
          <div className="text-[10px] text-muted-foreground font-bold">
            {employee.availability ? '🟢 Active' : '🔴 Inactive'}
          </div>
        </div>
      </div>
    );
  }
);

EmployeeIdCard.displayName = 'EmployeeIdCard';

export { EmployeeIdCard };

/* ───── Helper Component ───── */
function InfoRow({
  icon,
  label,
  value,
  mono,
  truncate: shouldTruncate,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 mb-0.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[9px] font-bold uppercase text-muted-foreground tracking-wider">{label}</span>
      </div>
      <p className={`text-xs font-semibold leading-tight ${mono ? 'font-mono' : ''} ${shouldTruncate ? 'truncate' : ''}`}>
        {value}
      </p>
    </div>
  );
}
