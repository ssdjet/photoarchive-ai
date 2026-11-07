'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { LogRecord } from '@photoarchive/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, Select } from '@/components/ui';

const levels: { value: '' | LogRecord['level']; label: string }[] = [
  { value: '', label: 'Все уровни' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warning' },
  { value: 'error', label: 'Error' }
];

export default function LogsPage() {
  const [level, setLevel] = useState<'' | LogRecord['level']>('');
  const logs = useQuery({
    queryKey: ['logs', level],
    queryFn: () => api.logs(level || undefined, 300),
    refetchInterval: 3000
  });

  return (
    <div>
      <PageHeader
        title="Логи и ошибки"
        description="Журнал индексации, AI-провайдера, файловых операций и карантина."
        actions={
          <div className="flex gap-2">
            <Select className="w-44" value={level} onChange={(event) => setLevel(event.target.value as '' | LogRecord['level'])}>
              {levels.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => void logs.refetch()}>Обновить</Button>
          </div>
        }
      />

      {logs.isPending ? (
        <LoadingState label="Загружаю логи…" />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : logs.data.length === 0 ? (
        <Card>
          <p className="text-[color:var(--muted)]">Логов пока нет.</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {logs.data.map((log) => (
            <Card key={log.id} className="p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : log.level === 'info' ? 'success' : 'neutral'}>{log.level}</Badge>
                    <Badge>{log.scope}</Badge>
                    <span className="text-xs text-[color:var(--muted)]">{new Date(log.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                  <p className="mt-2 break-words text-sm">{log.message}</p>
                </div>
                {log.photoId ? <span className="text-xs text-[color:var(--muted)]">photo: {log.photoId}</span> : null}
              </div>
              {log.context ? (
                <pre className="mt-3 overflow-x-auto rounded-lg bg-[#0b1017] p-3 text-xs text-[color:var(--muted)] scrollbar-thin">{JSON.stringify(log.context, null, 2)}</pre>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
