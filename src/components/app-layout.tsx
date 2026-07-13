
'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, Settings, User, ReceiptText, Building, Banknote, StickyNote, WalletCards, CalendarCheck, Mail, FileSpreadsheet } from 'lucide-react';
import { useEffect } from 'react';

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ForkliftIcon } from './icons/forklift-icon';
import { useFirebase } from '@/firebase';
import { ThemeToggle } from './theme-toggle';
import { LayoutDashboard, Wrench, Warehouse } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VoiceAssistant } from './voice-assistant';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/forklifts', label: 'Forklifts', icon: ForkliftIcon },
  { href: '/reports', label: 'Job Cards', icon: Wrench },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/employees', label: 'Employees', icon: User },
  { href: '/companies', label: 'Companies', icon: Building },
  { href: '/inventory', label: 'Inventory', icon: Warehouse },
  { href: '/billing', label: 'Billing', icon: ReceiptText },
  { href: '/envelopes', label: 'Envelopes', icon: Mail },
  { href: '/challans', label: 'Challans', icon: FileSpreadsheet },
  { href: '/payments', label: 'Payments', icon: Banknote },
  { href: '/salary', label: 'Salary', icon: WalletCards },
  { href: '/notes', label: 'Notes', icon: StickyNote },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { auth, user, isUserLoading } = useFirebase();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const handleLogout = async () => {
    if (auth) {
      await auth.signOut();
      router.push('/login');
    }
  };
  
  if (isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <ForkliftIcon className="h-12 w-12 text-primary animate-pulse" />
          <p className="text-muted-foreground">Loading Workshop...</p>
        </div>
      </div>
    );
  }

  const userEmail = user.email || 'Not logged in';
  const userInitial = user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  return (
    <SidebarProvider>
      <Sidebar variant='inset' collapsible='icon'>
        <SidebarHeader className="p-0">
          <div className="flex h-14 items-center justify-between px-3">
            <Link href="/" className="flex items-center gap-2 font-semibold overflow-hidden">
              <ForkliftIcon className="h-6 w-6 shrink-0 text-primary" />
              <span className="truncate group-data-[collapsible=icon]:hidden">VE Dashboard</span>
            </Link>
            <SidebarTrigger className="hidden shrink-0 md:flex" />
          </div>
          <SidebarSeparator />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  asChild
                  isActive={pathname === item.href}
                  tooltip={{children: item.label, side: 'right', align: 'center'}}
                >
                  <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-0">
           <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className='group-data-[collapsible=icon]:justify-center flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2'>
                    <Avatar className="h-8 w-8">
                        {user && user.photoURL && <AvatarImage src={user.photoURL} alt={user.displayName || ''} />}
                        <AvatarFallback>{userInitial}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col items-start overflow-hidden group-data-[collapsible=icon]:hidden">
                        <span className="truncate font-medium">{user?.displayName || userEmail}</span>
                        <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                    </div>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{user?.displayName || userEmail}</p>
                  <p className="text-xs leading-none text-muted-foreground">
                    {user?.email}
                  </p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled><User className="mr-2 h-4 w-4"/>Profile</DropdownMenuItem>
              <DropdownMenuItem disabled><Settings className="mr-2 h-4 w-4"/>Settings</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}><LogOut className="mr-2 h-4 w-4"/>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className={cn(
          "sticky top-0 z-30 flex h-14 items-center gap-4 border-b bg-card/75 px-4 backdrop-blur-sm sm:px-6 lg:h-[60px] print:hidden"
        )}>
          <SidebarTrigger className="md:hidden" />
          <div className="w-full flex-1">
          </div>
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-auto p-3 sm:p-6 print:p-0">
          {children}
        </main>
        <VoiceAssistant />
      </SidebarInset>
    </SidebarProvider>
  );
}
