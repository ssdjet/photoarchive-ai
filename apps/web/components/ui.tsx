'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import type { PhotoRecord } from '@photoarchive/shared';
import { thumbnailUrl } from '@/lib/api';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  className = '',
  variant = 'primary',
  loading = false,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-[color:var(--accent)] text-[#140b02] hover:bg-[color:var(--accent-strong)]',
    secondary: 'border border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-strong)]',
    danger: 'bg-[color:var(--danger)] text-white hover:bg-[#b91c1c]',
    ghost: 'text-[color:var(--muted)] hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]'
  };

  return (
    <button
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-55 ${styles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-2xl border border-[color:var(--border)] bg-[rgba(16,24,34,0.9)] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] ${className}`}>{children}</section>;
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-[color:var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-lg border border-[color:var(--border)] bg-[#0d141d] px-3 py-2 text-[color:var(--text)] placeholder:text-[color:var(--muted)] ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`min-h-11 w-full rounded-lg border border-[color:var(--border)] bg-[#0d141d] px-3 py-2 text-[color:var(--text)] ${props.className ?? ''}`}
    />
  );
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }) {
  const styles = {
    neutral: 'border-[color:var(--border)] text-[color:var(--muted)]',
    success: 'border-emerald-700/50 bg-emerald-950/40 text-emerald-200',
    warning: 'border-amber-700/50 bg-amber-950/40 text-amber-200',
    danger: 'border-red-700/50 bg-red-950/40 text-red-200',
    accent: 'border-[color:var(--accent)] bg-[rgba(217,119,6,0.12)] text-[color:var(--accent-strong)]'
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-[color:var(--border)] p-8 text-center">
      <CheckCircle2 className="mb-3 h-8 w-8 text-[color:var(--muted)]" aria-hidden />
      <h3 className="text-lg font-medium">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-[color:var(--muted)]">{description}</p> : null}
    </div>
  );
}

export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center rounded-2xl border border-[color:var(--border)] bg-[rgba(16,24,34,0.7)] p-8">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" aria-hidden />
      <span className="text-[color:var(--muted)]">{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-red-900/50 bg-red-950/25 p-8 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-red-300" aria-hidden />
      <h3 className="text-lg font-medium text-red-100">Ошибка</h3>
      <p className="mt-1 max-w-xl text-sm text-red-200/85">{message}</p>
      {onRetry ? (
        <Button className="mt-4" variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-[color:var(--muted)]">{label ?? 'Прогресс'}</span>
        <span className="font-medium">{percent}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-[#0d141d]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <div className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-300" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  children,
  onClose
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 cursor-pointer bg-black/65" onClick={onClose} aria-label="Закрыть модальное окно" />
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-lg rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <Button variant="ghost" className="px-2" onClick={onClose} aria-label="Закрыть">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = 'Подтвердить',
  onConfirm,
  onClose,
  loading = false
}: {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="text-[color:var(--muted)]">{message}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmText}
        </Button>
      </div>
    </Modal>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-[color:var(--muted)]">
        Страница {page} из {pages} · всего {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Назад
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Вперёд <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

export function PhotoGrid({ photos }: { photos: PhotoRecord[] }) {
  if (photos.length === 0) {
    return <EmptyState title="Фотографии не найдены" description="Измените запрос или запустите индексацию архива." />;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {photos.map((photo) => (
        <PhotoTile key={photo.id} photo={photo} />
      ))}
    </div>
  );
}

function PhotoTile({ photo }: { photo: PhotoRecord }) {
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.18 }} className="group">
      <Link href={`/photos/${photo.id}`} className="block overflow-hidden rounded-xl border border-[color:var(--border)] bg-[#0d141d] hover:border-[color:var(--accent)]">
        <div className="aspect-square w-full overflow-hidden bg-[#10151d]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumbnailUrl(photo.id)} alt={photo.fileName} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" />
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium">{photo.fileName}</p>
          <p className="mt-1 truncate text-xs text-[color:var(--muted)]">{photo.takenAt ? new Date(photo.takenAt).toLocaleString('ru-RU') : 'Дата неизвестна'}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {photo.tags.slice(0, 3).map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
