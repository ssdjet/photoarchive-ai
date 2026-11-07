'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ScanFace, Scissors, Save } from 'lucide-react';
import { api, thumbnailUrl } from '@/lib/api';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader } from '@/components/ui';

export default function FacesPage() {
  const queryClient = useQueryClient();
  const clusters = useQuery({ queryKey: ['face-clusters'], queryFn: api.faceClusters, refetchInterval: 5000 });
  const [selectedClusterId, setSelectedClusterId] = useState<string>('');
  const [nameDraft, setNameDraft] = useState('');
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [splitSelection, setSplitSelection] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedCluster = useMemo(
    () => clusters.data?.find((cluster) => cluster.id === selectedClusterId),
    [clusters.data, selectedClusterId]
  );
  const photos = useQuery({
    queryKey: ['cluster-photos', selectedClusterId],
    queryFn: () => api.clusterPhotos(selectedClusterId),
    enabled: Boolean(selectedClusterId)
  });

  useEffect(() => {
    if (!clusters.data || clusters.data.length === 0) return;
    if (!selectedClusterId || !clusters.data.some((cluster) => cluster.id === selectedClusterId)) {
      setSelectedClusterId(clusters.data[0].id);
    }
  }, [clusters.data, selectedClusterId]);

  useEffect(() => {
    setNameDraft(selectedCluster?.name ?? '');
    setSplitSelection([]);
  }, [selectedCluster?.id, selectedCluster?.name]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['face-clusters'] });
    void queryClient.invalidateQueries({ queryKey: ['cluster-photos'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const rename = useMutation({
    mutationFn: () => api.renameCluster(selectedClusterId, nameDraft),
    onSuccess: () => {
      setNotice('Имя кластера обновлено.');
      invalidate();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка переименования')
  });

  const merge = useMutation({
    mutationFn: () => api.mergeClusters(mergeSelection),
    onSuccess: () => {
      setNotice('Кластеры объединены.');
      setMergeSelection([]);
      setSelectedClusterId('');
      invalidate();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка объединения')
  });

  const split = useMutation({
    mutationFn: () => api.splitCluster(selectedClusterId, splitSelection),
    onSuccess: () => {
      setNotice('Выбранные фото вынесены в новый кластер.');
      setSplitSelection([]);
      invalidate();
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка разделения')
  });

  if (clusters.isPending) return <LoadingState label="Загружаю кластеры лиц…" />;
  if (clusters.isError) return <ErrorState error={clusters.error} onRetry={() => void clusters.refetch()} />;

  return (
    <div>
      <PageHeader
        title="Кластеры лиц"
        description="Просмотр фото по человеку, переименование, объединение и разделение кластеров."
        actions={
          <Button
            variant="secondary"
            disabled={mergeSelection.length < 2 || merge.isPending}
            onClick={() => merge.mutate()}
          >
            <GitMerge className="h-4 w-4" aria-hidden /> Объединить выбранные ({mergeSelection.length})
          </Button>
        }
      />

      {notice ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" className="px-2" onClick={() => setNotice(null)}>Закрыть</Button>
        </div>
      ) : null}

      {clusters.data.length === 0 ? (
        <EmptyState title="Лица пока не найдены" description="После настройки face-detection/recognition ONNX-моделей и индексации люди появятся здесь." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Card className="h-fit p-3">
            <div className="mb-3 flex items-center gap-2 px-2 pt-1">
              <ScanFace className="h-4 w-4 text-[color:var(--accent)]" aria-hidden />
              <h2 className="font-semibold">Люди</h2>
            </div>
            <div className="space-y-2">
              {clusters.data.map((cluster) => (
                <div key={cluster.id} className={`flex items-center gap-3 rounded-xl border p-3 transition ${selectedClusterId === cluster.id ? 'border-[color:var(--accent)] bg-[rgba(217,119,6,0.08)]' : 'border-[color:var(--border)] bg-[#0d141d] hover:border-[color:var(--muted)]'}`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[color:var(--accent)]"
                    checked={mergeSelection.includes(cluster.id)}
                    onChange={(event) => {
                      setMergeSelection((value) => event.target.checked ? [...value, cluster.id] : value.filter((id) => id !== cluster.id));
                    }}
                    aria-label={`Выбрать кластер ${cluster.name} для объединения`}
                  />
                  <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg text-left" onClick={() => setSelectedClusterId(cluster.id)}>
                    <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#10151d]">
                      {cluster.coverPhotoId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbnailUrl(cluster.coverPhotoId)} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{cluster.name}</p>
                      <p className="text-xs text-[color:var(--muted)]">{cluster.photoCount} фото · {cluster.faceCount} лиц</p>
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-5">
            {selectedCluster ? (
              <Card>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="flex-1">
                    <h2 className="text-lg font-semibold">Редактирование человека</h2>
                    <p className="text-sm text-[color:var(--muted)]">Название используется в поиске и фильтрах.</p>
                    <Input
                      className="mt-3"
                      value={nameDraft}
                      onChange={(event) => setNameDraft(event.target.value)}
                      placeholder="Имя человека"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={!nameDraft.trim() || rename.isPending} onClick={() => rename.mutate()}>
                      <Save className="h-4 w-4" aria-hidden /> Сохранить имя
                    </Button>
                    <Button variant="secondary" disabled={splitSelection.length === 0 || split.isPending} onClick={() => split.mutate()}>
                      <Scissors className="h-4 w-4" aria-hidden /> Вынести в новый кластер ({splitSelection.length})
                    </Button>
                  </div>
                </div>
              </Card>
            ) : null}

            {photos.isPending ? (
              <LoadingState label="Загружаю фото кластера…" />
            ) : photos.isError ? (
              <ErrorState error={photos.error} onRetry={() => void photos.refetch()} />
            ) : photos.data.length === 0 ? (
              <EmptyState title="В кластере нет фото" description="Выберите другой кластер или обновите индексацию." />
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
                {photos.data.map((photo) => (
                  <label key={photo.id} className={`block cursor-pointer rounded-xl border p-2 transition ${splitSelection.includes(photo.id) ? 'border-[color:var(--accent)] bg-[rgba(217,119,6,0.08)]' : 'border-[color:var(--border)] bg-[#0d141d]'}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={splitSelection.includes(photo.id)}
                      onChange={(event) => {
                        setSplitSelection((value) => event.target.checked ? [...value, photo.id] : value.filter((id) => id !== photo.id));
                      }}
                    />
                    <div className="aspect-square overflow-hidden rounded-lg bg-[#10151d]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbnailUrl(photo.id)} alt={photo.fileName} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs">{photo.fileName}</p>
                      {splitSelection.includes(photo.id) ? <Badge tone="accent">split</Badge> : null}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
