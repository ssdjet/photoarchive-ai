'use client';

import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import type { SearchFilters } from '@photoarchive/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorState, Input, LoadingState, PageHeader, Pagination, PhotoGrid, Select } from '@/components/ui';

const styleOptions = [
  { value: '', label: 'Любой стиль' },
  { value: 'black-and-white', label: 'Чёрно-белые' },
  { value: 'portrait', label: 'Портреты / вертикальные' },
  { value: 'warm light', label: 'Тёплый свет' },
  { value: 'cool light', label: 'Холодный свет' },
  { value: 'high detail', label: 'Высокая детализация' }
];

export default function SearchPage() {
  const [draft, setDraft] = useState({
    q: '',
    from: '',
    to: '',
    location: '',
    faceClusterId: '',
    style: ''
  });
  const [applied, setApplied] = useState<SearchFilters>({ page: 1, pageSize: 24 });
  const clusters = useQuery({ queryKey: ['face-clusters'], queryFn: api.faceClusters });
  const search = useQuery({
    queryKey: ['search', applied],
    queryFn: () => api.search(applied)
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: SearchFilters = {
      page: 1,
      pageSize: applied.pageSize ?? 24
    };
    if (draft.q.trim()) next.q = draft.q.trim();
    if (draft.from) next.from = draft.from;
    if (draft.to) next.to = draft.to;
    if (draft.location.trim()) next.location = draft.location.trim();
    if (draft.faceClusterId) next.faceClusterId = draft.faceClusterId;
    if (draft.style) next.style = draft.style;
    setApplied(next);
  }

  function clearFilters() {
    setDraft({ q: '', from: '', to: '', location: '', faceClusterId: '', style: '' });
    setApplied({ page: 1, pageSize: applied.pageSize ?? 24 });
  }

  return (
    <div>
      <PageHeader
        title="Поиск"
        description="Семантический и метаданные-поиск по архиву с фильтрами даты, геолокации, лиц и стиля."
      />

      <Card className="mb-5">
        <form onSubmit={submit} className="grid gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Текстовый запрос</span>
            <Input
              value={draft.q}
              onChange={(event) => setDraft((value) => ({ ...value, q: event.target.value }))}
              placeholder="например: корпоратив, красные футболки, Сочи"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">С даты</span>
            <Input type="date" value={draft.from} onChange={(event) => setDraft((value) => ({ ...value, from: event.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">По дату</span>
            <Input type="date" value={draft.to} onChange={(event) => setDraft((value) => ({ ...value, to: event.target.value }))} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Локация</span>
            <Input value={draft.location} onChange={(event) => setDraft((value) => ({ ...value, location: event.target.value }))} placeholder="Сочи, Арбат, офис" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Лицо</span>
            <Select value={draft.faceClusterId} onChange={(event) => setDraft((value) => ({ ...value, faceClusterId: event.target.value }))}>
              <option value="">Все люди</option>
              {(clusters.data ?? []).map((cluster) => (
                <option key={cluster.id} value={cluster.id}>{cluster.name}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[color:var(--muted)]">Стиль</span>
            <Select value={draft.style} onChange={(event) => setDraft((value) => ({ ...value, style: event.target.value }))}>
              {styleOptions.map((style) => (
                <option key={style.value} value={style.value}>{style.label}</option>
              ))}
            </Select>
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit">
              <Search className="h-4 w-4" aria-hidden /> Найти
            </Button>
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Сброс
            </Button>
          </div>
        </form>
      </Card>

      {search.isPending ? (
        <LoadingState label="Ищу фотографии…" />
      ) : search.isError ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[color:var(--muted)]">
              Найдено: <span className="font-medium text-[color:var(--text)]">{search.data.total}</span> · {search.data.tookMs} мс · движок {search.data.engine}
            </p>
            <Badge tone={search.data.engine === 'metadata_fts' ? 'warning' : 'success'}>
              {search.data.engine === 'qdrant' ? 'Qdrant vector search' : search.data.engine === 'sqlite_vector' ? 'Local vector fallback' : 'Metadata search'}
            </Badge>
          </div>
          <PhotoGrid photos={search.data.items} />
          <Pagination
            page={search.data.page}
            pageSize={search.data.pageSize}
            total={search.data.total}
            onPageChange={(page) => setApplied((value) => ({ ...value, page }))}
          />
        </div>
      )}
    </div>
  );
}
