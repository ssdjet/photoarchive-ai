'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Camera, Copy, FolderInput, MapPin, ScanFace, Tag, Trash2 } from 'lucide-react';
import { api, photoFileUrl, thumbnailUrl } from '@/lib/api';
import { Badge, Button, Card, ConfirmDialog, ErrorState, LoadingState, PageHeader } from '@/components/ui';

function formatBytes(value: number): string {
  if (value === 0) return '0 Б';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function PhotoPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const photoId = params.id;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [useThumbnail, setUseThumbnail] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const photo = useQuery({
    queryKey: ['photo', photoId],
    queryFn: () => api.photo(photoId),
    enabled: Boolean(photoId)
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['photo', photoId] });
    void queryClient.invalidateQueries({ queryKey: ['search'] });
    void queryClient.invalidateQueries({ queryKey: ['duplicates'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const runOperation = useMutation({
    mutationFn: async ({ operation, targetFolder }: { operation: 'delete' | 'copy' | 'move'; targetFolder?: string }) => {
      if (operation === 'delete') return api.deletePhotos([photoId], true);
      if (operation === 'copy') return api.copyPhotos([photoId], targetFolder!, false);
      return api.movePhotos([photoId], targetFolder!, false);
    },
    onSuccess: async (result, variables) => {
      setNotice(result.message);
      setConfirmDelete(false);
      invalidate();
      if (variables.operation === 'delete') router.push('/search');
    },
    onError: (error) => {
      setNotice(error instanceof Error ? error.message : 'Ошибка файловой операции');
      setConfirmDelete(false);
    }
  });

  function copyPhoto() {
    const targetFolder = window.prompt('Папка для копии внутри архива:', 'copies');
    if (targetFolder) runOperation.mutate({ operation: 'copy', targetFolder });
  }

  function movePhoto() {
    const targetFolder = window.prompt('Папка для перемещения внутри архива:', 'selected');
    if (targetFolder) runOperation.mutate({ operation: 'move', targetFolder });
  }

  if (photo.isPending) return <LoadingState label="Загружаю фото…" />;
  if (photo.isError) return <ErrorState error={photo.error} onRetry={() => void photo.refetch()} />;

  const data = photo.data;

  return (
    <div>
      <PageHeader
        title={data.fileName}
        description={data.relativePath}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={copyPhoto} loading={runOperation.isPending}>
              <Copy className="h-4 w-4" aria-hidden /> Копировать
            </Button>
            <Button variant="secondary" onClick={movePhoto} loading={runOperation.isPending}>
              <FolderInput className="h-4 w-4" aria-hidden /> Переместить
            </Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)} loading={runOperation.isPending}>
              <Trash2 className="h-4 w-4" aria-hidden /> Удалить
            </Button>
          </div>
        }
      />

      {notice ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" className="px-2" onClick={() => setNotice(null)}>Закрыть</Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card className="overflow-hidden p-3">
          <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-xl bg-[#0b1017]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={useThumbnail ? thumbnailUrl(data.id) : photoFileUrl(data.id)}
              onError={() => setUseThumbnail(true)}
              alt={data.fileName}
              className="max-h-[76dvh] w-full object-contain"
            />
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Метаданные</h2>
            <dl className="space-y-3 text-sm">
              <Meta icon={<CalendarDays className="h-4 w-4" aria-hidden />} label="Дата" value={data.takenAt ? new Date(data.takenAt).toLocaleString('ru-RU') : 'Неизвестна'} />
              <Meta icon={<Camera className="h-4 w-4" aria-hidden />} label="Камера" value={[data.cameraMake, data.cameraModel].filter(Boolean).join(' ') || 'Не указана'} />
              <Meta icon={<MapPin className="h-4 w-4" aria-hidden />} label="Локация" value={data.address ?? ([data.city, data.district, data.place].filter(Boolean).join(', ') || 'Не определена')} />
              <Meta icon={<ScanFace className="h-4 w-4" aria-hidden />} label="Лица" value={`${data.faces.length}`} />
              <Meta label="Размер" value={formatBytes(data.sizeBytes)} />
              <Meta label="SHA-256" value={<span className="break-all font-mono text-xs">{data.sha256}</span>} />
              <Meta label="Статус" value={<Badge tone={data.status === 'quarantine' ? 'danger' : data.status === 'duplicate' ? 'warning' : 'success'}>{data.status}</Badge>} />
            </dl>
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <Tag className="h-4 w-4 text-[color:var(--accent)]" aria-hidden />
              <h2 className="text-lg font-semibold">Теги и объекты</h2>
            </div>
            {data.tags.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">Теги не сгенерированы.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-[color:var(--accent)]" aria-hidden />
              <h2 className="text-lg font-semibold">Мини-карта</h2>
            </div>
            {typeof data.latitude === 'number' && typeof data.longitude === 'number' ? (
              <div className="rounded-xl border border-[color:var(--border)] bg-[#0d141d] p-4">
                <div className="grid h-36 place-items-center rounded-lg bg-[radial-gradient(circle_at_50%_50%,rgba(217,119,6,0.2),transparent_65%)] text-center">
                  <div>
                    <p className="text-lg font-semibold">{data.latitude.toFixed(5)}, {data.longitude.toFixed(5)}</p>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">Координаты EXIF хранятся локально; внешний геосервис не вызывается.</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-[color:var(--muted)]">GPS-координаты отсутствуют. Локация может быть определена из папок и визуальных признаков.</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить файл?"
        message={`Файл ${data.fileName} будет удалён из локального архива. Действие нельзя отменить.`}
        confirmText="Удалить"
        loading={runOperation.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => runOperation.mutate({ operation: 'delete' })}
      />
    </div>
  );
}

function Meta({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border)] pb-3 last:border-0 last:pb-0">
      <dt className="flex items-center gap-2 text-[color:var(--muted)]">{icon}{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
