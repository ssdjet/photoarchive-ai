'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Archive, Copy, FolderSearch, LayoutDashboard, Logs, ScanFace, Settings } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/search', label: 'Поиск', icon: FolderSearch },
  { href: '/duplicates', label: 'Дубликаты', icon: Copy },
  { href: '/faces', label: 'Лица', icon: ScanFace },
  { href: '/logs', label: 'Логи', icon: Logs },
  { href: '/settings', label: 'Настройки', icon: Settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-[rgba(10,15,20,0.92)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/dashboard" className="flex w-fit items-center gap-3 rounded-lg px-2 py-1 hover:bg-[color:var(--surface)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--accent)] text-[#140b02]">
              <Archive className="h-5 w-5" aria-hidden />
            </span>
            <span>
              <span className="block text-lg font-semibold tracking-tight">PhotoArchive AI</span>
              <span className="block text-xs text-[color:var(--muted)]">локальный умный архив</span>
            </span>
          </Link>

          <nav className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin" aria-label="Основная навигация">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm transition hover:bg-[color:var(--surface)] ${
                    active
                      ? 'border-[color:var(--accent)] bg-[rgba(217,119,6,0.12)] text-[color:var(--text)]'
                      : 'border-transparent text-[color:var(--muted)] hover:text-[color:var(--text)]'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
