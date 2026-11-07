'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cpu, Database, HardDrive, ImageIcon, Play, ScanFace, Tags } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorState, LoadingState, PageHeader, ProgressBar } from '@/components/ui';

function formatBytes(value: number): string {
  if (value === 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const stats = useQuery({ queryKey: ['stats'], queryFn: api.stats, refetchInterval: 2000 });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 10000 });
  const startIndexing = useMutation({
    mutationFn: () => api.startIndexing(undefined, true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      void queryClient.invalidateQueries({ queryKey: ['index-status'] });
    }
  });

  if (stats.isPending) return <LoadingState label="Загружаю дашборд…" />;
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />;

  const data = stats.data;
  const indexing = data.indexing;
  const progress = indexing && indexing.total > 0 ? (indexing.processed / indexing.total) * 100 : indexing?.state === 'running' ? 5 : 0;
  const warnings = [
    data.warnings.duplicates > 0 ? { label: 'Группы дубликатов', value: data.warnings.duplicates } : null,
    data.warnings.brokenFiles > 0 ? { label: 'Файлы в карантине', value: data.warnings.brokenFiles } : null,
    data.warnings.qdrantUnavailable ? { label: 'Qdrant недоступен', value: 'fallback' } : null,
    data.warnings.redisUnavailable ? { label: 'Redis недоступен', value: 'memory queue' } : null,
    data.warnings.aiFallback ? { label: 'AI-режим', value: 'fallback' } : null
  ].filter(Boolean) as { label: string; value: string | number }[];

  return (
    <div>
      <PageHeader
        title="Дашборд"
        description="Состояние локального архива, прогресс индексации и предупреждения."
        actions={
          <Button onClick={() => startIndexing.mutate()} loading={startIndexing.isPending}>
            <Play className="h-4 w-4" aria-hidden /> Запустить полную индексацию
          </Button>
        }
      />

      {startIndexing.isError ? (
        <div className="mb-4 rounded-xl border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-100">
          Не удалось запустить индексацию: {startIndexing.error instanceof Error ? startIndexing.error.message : 'ошибка'}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<ImageIcon className="h-5 w-5" aria-hidden />} label="Фотографии" value={data.photos} hint={`${data.indexedPhotos} проиндексировано`} />
        <StatCard icon={<ScanFace className="h-5 w-5" aria-hidden />} label="Лица" value={data.faces} hint={`${data.faceClusters} кластеров`} />
        <StatCard icon={<Tags className="h-5 w-5" aria-hidden />} label="Теги" value={data.tags} hint={`${data.locations} локаций`} />
        <StatCard icon={<HardDrive className="h-5 w-5" aria-hidden />} label="Размер архива" value={formatBytes(data.storageBytes)} hint="локальное хранилище" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Индексация</h2>
              <p className="text-sm text-[color:var(--muted)]">Фоновый обход архива, EXIF, миниатюры, векторы и дубликаты.</p>
            </div>
            <Badge tone={indexing?.state === 'running' || indexing?.state === 'queued' ? 'accent' : indexing?.state === 'failed' ? 'danger' : 'success'}>
              {indexing?.state ?? 'idle'}
            </Badge>
          </div>
          {indexing ? (
            <div className="space-y-4">
              <ProgressBar value={progress} label={`Обработано ${indexing.processed} из ${indexing.total}`} />
              <div className="grid gap-3 text-sm text-[color:var(--muted)] sm:grid-cols-4">
                <span>В очереди: {indexing.queued}</span>
                <span>Пропущено: {indexing.skipped}</span>
                <span>Ошибок: {indexing.failed}</span>
                <span>{indexing.finishedAt ? `Завершено: ${new Date(indexing.finishedAt).toLocaleString('ru-RU')}` : ''}</span>
              </div>
              {indexing.error ? <p className="rounded-lg border border-red-900/60 bg-red-950/30 p-3 text-sm text-red-100">{indexing.error}</p> : null}
            </div>
          ) : (
            <p className="text-[color:var(--muted)]">Индексация ещё не запускалась. Выберите корень архива в настройках и запустите полную индексацию.</p>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center gap-3">
            <Cpu className="h-5 w-5 text-[color:var(--accent)]" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold">AI-провайдер</h2>
              <p className="break-words text-sm text-[color:var(--muted)]">{health.data?.modelStatus ?? data.aiProvider}</p>
            </div>
          </div>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Режим</span><Badge>{data.aiProvider}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">DirectML</span><Badge tone={data.directml ? 'success' : 'neutral'}>{data.directml ? 'включён' : 'выключен/недоступен'}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Векторный поиск</span><Badge tone={data.vectorStoreKind === 'qdrant' && !data.warnings.qdrantUnavailable ? 'success' : 'neutral'}>{data.vectorStoreKind === 'qdrant' ? (data.warnings.qdrantUnavailable ? 'Qdrant (недоступен, fallback)' : 'Qdrant') : 'SQLite (local)'}</Badge></div>
            <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Очередь</span><Badge tone={data.queueKind === 'redis' && !data.warnings.redisUnavailable ? 'success' : 'neutral'}>{data.queueKind === 'redis' ? (data.warnings.redisUnavailable ? 'Redis (недоступен, fallback)' : 'Redis') : 'in-memory'}</Badge></div>
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="mb-4 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-[color:var(--accent)]" aria-hidden />
          <h2 className="text-lg font-semibold">Предупреждения</h2>
        </div>
        {warnings.length === 0 ? (
          <p className="text-[color:var(--muted)]">Критичных предупреждений нет.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {warnings.map((warning) => (
              <div key={warning.label} className="rounded-xl border border-[color:var(--border)] bg-[#0d141d] p-4">
                <Database className="mb-2 h-4 w-4 text-[color:var(--muted)]" aria-hidden />
                <p className="text-sm text-[color:var(--muted)]">{warning.label}</p>
                <p className="mt-1 text-lg font-semibold">{warning.value}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[rgba(217,119,6,0.12)] text-[color:var(--accent)]">{icon}</div>
      <p className="text-sm text-[color:var(--muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[color:var(--muted)]">{hint}</p> : null}
    </Card>
  );
}
