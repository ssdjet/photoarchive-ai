'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DatabaseBackup, Save } from 'lucide-react';
import type { ArchiveSettings } from '@photoarchive/shared';
import { api } from '@/lib/api';
import { Badge, Button, Card, ErrorState, Input, LoadingState, PageHeader, Select } from '@/components/ui';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const health = useQuery({ queryKey: ['health'], queryFn: api.health });
  const [draft, setDraft] = useState<ArchiveSettings | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (value: ArchiveSettings) => api.updateSettings(value),
    onSuccess: (value) => {
      setDraft(value);
      setNotice('Настройки сохранены. Изменения моделей могут потребовать перезапуска API.');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['health'] });
    },
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка сохранения настроек')
  });

  const backup = useMutation({
    mutationFn: api.backup,
    onSuccess: (result) => setNotice(`Резервная копия SQLite создана: ${result.path}`),
    onError: (error) => setNotice(error instanceof Error ? error.message : 'Ошибка создания копии')
  });

  if (settings.isPending || !draft) return <LoadingState label="Загружаю настройки…" />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;

  function update<K extends keyof ArchiveSettings>(key: K, value: ArchiveSettings[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  }

  return (
    <div>
      <PageHeader
        title="Настройки"
        description="Корни архива, локальные ONNX-модели, OCR, Qdrant/Redis и параметры индексации."
        actions={
          <Button variant="secondary" onClick={() => backup.mutate()} loading={backup.isPending}>
            <DatabaseBackup className="h-4 w-4" aria-hidden /> Создать backup SQLite
          </Button>
        }
      />

      {notice ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" className="px-2" onClick={() => setNotice(null)}>Закрыть</Button>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Папки</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Корень архива">
                <Input value={draft.archiveRoot} onChange={(event) => update('archiveRoot', event.target.value)} />
              </Field>
              <Field label="Карантин">
                <Input value={draft.quarantineFolder} onChange={(event) => update('quarantineFolder', event.target.value)} />
              </Field>
              <Field label="Миниатюры">
                <Input value={draft.thumbnailsFolder} onChange={(event) => update('thumbnailsFolder', event.target.value)} />
              </Field>
              <Field label="Размер батча">
                <Input type="number" min={1} max={512} value={draft.batchSize} onChange={(event) => update('batchSize', Number(event.target.value))} />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">AI и модели</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Провайдер">
                <Select value={draft.aiProvider} onChange={(event) => update('aiProvider', event.target.value as ArchiveSettings['aiProvider'])}>
                  <option value="auto">Auto</option>
                  <option value="onnx">ONNX</option>
                  <option value="fallback">Fallback</option>
                </Select>
              </Field>
              <Field label="DirectML">
                <Select value={draft.directml} onChange={(event) => update('directml', event.target.value as ArchiveSettings['directml'])}>
                  <option value="auto">Auto</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </Select>
              </Field>
              <Field label="CLIP image модель (.onnx)">
                <Input value={draft.clipModelPath ?? ''} onChange={(event) => update('clipModelPath', event.target.value || null)} placeholder="models/clip-visual.onnx" />
              </Field>
              <Field label="CLIP text модель (.onnx)">
                <Input value={draft.clipTextModelPath ?? ''} onChange={(event) => update('clipTextModelPath', event.target.value || null)} placeholder="models/clip-text.onnx" />
              </Field>
              <Field label="Tokenizer vocab (.json)">
                <Input value={draft.tokenizerPath ?? ''} onChange={(event) => update('tokenizerPath', event.target.value || null)} placeholder="models/tokenizer-vocab.json" />
              </Field>
              <Field label="Scene/object модель">
                <Input value={draft.sceneModelPath ?? ''} onChange={(event) => update('sceneModelPath', event.target.value || null)} placeholder="models/scene.onnx" />
              </Field>
              <Field label="Face detection модель">
                <Input value={draft.faceDetectionModelPath ?? ''} onChange={(event) => update('faceDetectionModelPath', event.target.value || null)} placeholder="models/face-detector.onnx" />
              </Field>
              <Field label="Face recognition модель">
                <Input value={draft.faceRecognitionModelPath ?? ''} onChange={(event) => update('faceRecognitionModelPath', event.target.value || null)} placeholder="models/face-recognizer.onnx" />
              </Field>
              <Field label="Порог near-duplicate">
                <Input type="number" min={0.5} max={1} step={0.01} value={draft.nearDuplicateThreshold} onChange={(event) => update('nearDuplicateThreshold', Number(event.target.value))} />
              </Field>
            </div>
          </Card>

          <Card>
            <h2 className="mb-4 text-lg font-semibold">OCR и расширения</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[#0d141d] p-3 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[color:var(--accent)]"
                  checked={draft.ocrEnabled}
                  onChange={(event) => update('ocrEnabled', event.target.checked)}
                />
                Включить OCR (опционально)
              </label>
              <Field label="Языки OCR">
                <Input value={draft.ocrLanguages} onChange={(event) => update('ocrLanguages', event.target.value)} placeholder="rus+eng" />
              </Field>
              <Field label="Image extensions">
                <Input value={draft.imageExtensions.join(', ')} onChange={(event) => update('imageExtensions', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
              </Field>
              <Field label="Video extensions">
                <Input value={draft.videoExtensions.join(', ')} onChange={(event) => update('videoExtensions', event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-4 text-lg font-semibold">Состояние</h2>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Провайдер</span><Badge>{health.data?.provider ?? '…'}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">DirectML</span><Badge tone={health.data?.directml ? 'success' : 'neutral'}>{health.data?.directml ? 'active' : 'unavailable'}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Vector store</span><Badge>{health.data?.vectorStore ?? '…'}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-[color:var(--muted)]">Queue</span><Badge>{health.data?.queue ?? '…'}</Badge></div>
            </div>
            <p className="mt-4 rounded-lg bg-[#0d141d] p-3 text-xs leading-5 text-[color:var(--muted)]">
              {health.data?.modelStatus ?? 'Статус модели недоступен до первого запуска API.'}
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Приватность</h2>
            <p className="text-sm leading-6 text-[color:var(--muted)]">
              Все фото, эмбеддинги, лица, SQLite и векторы хранятся локально. Приложение не отправляет изображения во внешние AI-сервисы; внешние сетевые вызовы не требуются для работы.
            </p>
            <Button className="mt-4 w-full" onClick={() => save.mutate(draft)} loading={save.isPending}>
              <Save className="h-4 w-4" aria-hidden /> Сохранить настройки
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[color:var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
