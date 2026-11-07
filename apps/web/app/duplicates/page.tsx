'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, FolderInput, ShieldCheck, SkipForward, Trash2 } from 'lucide-react';
import type { DuplicateGroup } from '@photoarchive/shared';
import { api, thumbnailUrl } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui';

function formatBytes(value: number): string {
  if (value === 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function DuplicatesPage() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<DuplicateGroup | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const groups = useQuery({ queryKey: ['duplicates'], queryFn: api.duplicates, refetchInterval: 5000 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
  };

  const setCanonical = useMutation({
    mutationFn: ({ groupId, photoId }: { groupId: string; photoId: string }) => api.setCanonical(groupId, photoId),
    onSuccess: () => {
      setNotice('Каноническая версия обновлена.');
      invalidate();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка выбора канонической версии')
  });

  const resolveGroup = useMutation({
    mutationFn: ({ group, action, targetFolder, confirmBulk }: { group: DuplicateGroup; action: 'mark' | 'delete' | 'move' | 'skip'; targetFolder?: string; confirmBulk?: boolean }) =>
      api.resolveDuplicate(group.id, action, targetFolder, confirmBulk),
    onSuccess: (result) => {
      setNotice(result.message);
      setPendingDelete(null);
      invalidate();
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : 'Ошибка обработки дубликатов');
      setPendingDelete(null);
    }
  });

  function moveGroup(group: DuplicateGroup) {
    const targetFolder = window.prompt('Укажите папку внутри архива для перемещения дубликатов:', 'duplicates-review');
    if (!targetFolder) return;
    const confirmBulk = group.photos.length > 10 && window.confirm(`Будет перемещено ${group.photos.length} файлов. Продолжить?`);
    if (group.photos.length > 10 && !confirmBulk) return;
    resolveGroup.mutate({ group, action: 'move', targetFolder, confirmBulk });
  }

  return (
    <div>
      <PageHeader
        title="Дубликаты"
        description="Группы точных и визуально похожих фото. Выберите каноническую версию перед удалением или перемещением копий."
      />

      {notice ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" className="px-2" onClick={() => setNotice(null)}>Закрыть</Button>
        </div>
      ) : null}

      {groups.isPending ? (
        <LoadingState label="Загружаю группы дубликатов…" />
      ) : groups.isError ? (
        <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />
      ) : groups.data.length === 0 ? (
        <EmptyState title="Дубликаты не найдены" description="После индексации точные копии и близкие изображения появятся здесь." />
      ) : (
        <div className="space-y-5">
          {groups.data.map((group) => (
            <DuplicateGroupCard
              key={group.id}
              group={group}
              busy={setCanonical.isPending || resolveGroup.isPending}
              onCanonical={(photoId) => setCanonical.mutate({ groupId: group.id, photoId })}
              onMark={() => resolveGroup.mutate({ group, action: 'mark' })}
              onSkip={() => resolveGroup.mutate({ group, action: 'skip' })}
              onDelete={() => setPendingDelete(group)}
              onMove={() => moveGroup(group)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить неканонические копии?"
        message={pendingDelete ? `Будут удалены ${Math.max(0, pendingDelete.photos.length - 1)} файл(ов), каноническая версия останется в архиве.` : ''}
        confirmText="Удалить копии"
        loading={resolveGroup.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && resolveGroup.mutate({ group: pendingDelete, action: 'delete', confirmBulk: true })}
      />
    </div>
  );
}

function DuplicateGroupCard({
  group,
  busy,
  onCanonical,
  onMark,
  onSkip,
  onDelete,
  onMove
}: {
  group: DuplicateGroup;
  busy: boolean;
  onCanonical: (photoId: string) => void;
  onMark: () => void;
  onSkip: () => void;
  onDelete: () => void;
  onMove: () => void;
}) {
  const canonical = group.photos.find((photo) => photo.isCanonical)?.id ?? group.photos[0]?.id;
  const [selected, setSelected] = useState(canonical);

  useEffect(() => {
    setSelected(canonical);
  }, [canonical]);

  return (
    <Card>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">Группа дубликатов</h2>
            <Badge tone={group.reason === 'exact_hash' ? 'danger' : 'warning'}>{group.reason === 'exact_hash' ? 'точная копия' : 'визуальное сходство'}</Badge>
          </div>
          <p className="mt-1 text-sm text-[color:var(--muted)]">Создана {new Date(group.createdAt).toLocaleString('ru-RU')} · {group.photos.length} файлов</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || selected === canonical} onClick={() => selected && onCanonical(selected)}>
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Сделать канонической
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onMark}>
            <ShieldCheck className="h-4 w-4" aria-hidden /> Пометить копии
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onMove}>
            <FolderInput className="h-4 w-4" aria-hidden /> Переместить копии
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onSkip}>
            <SkipForward className="h-4 w-4" aria-hidden /> Пропустить
          </Button>
          <Button variant="danger" disabled={busy} onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden /> Удалить копии
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {group.photos.map((photo) => (
          <label key={photo.id} className={`block cursor-pointer rounded-xl border p-3 transition ${selected === photo.id ? 'border-[color:var(--accent)] bg-[rgba(217,119,6,0.08)]' : 'border-[color:var(--border)] bg-[#0d141d] hover:border-[color:var(--muted)]'}`}>
            <input
              type="radio"
              name={`canonical-${group.id}`}
              className="sr-only"
              checked={selected === photo.id}
              onChange={() => setSelected(photo.id)}
            />
            <div className="mb-3 aspect-[4/3] overflow-hidden rounded-lg bg-[#10151d]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumbnailUrl(photo.id)} alt={photo.relativePath} className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{photo.relativePath}</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">{formatBytes(photo.sizeBytes)} · {photo.width ?? '?'}×{photo.height ?? '?'}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                {photo.isCanonical || selected === photo.id ? <Badge tone="accent">канон</Badge> : <Badge>копия</Badge>}
                <Badge tone={photo.similarity >= 0.99 ? 'danger' : 'warning'}>{Math.round(photo.similarity * 100)}%</Badge>
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 text-sm text-[color:var(--muted)]">
        <Copy className="h-4 w-4" aria-hidden />
        <span>Выбранная каноническая версия будет сохранена как основная.</span>
      </div>
    </Card>
  );
}
