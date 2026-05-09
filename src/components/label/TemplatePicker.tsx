'use client';

import { useState, useEffect } from 'react';
import {
  getLabelTemplates,
  saveLabelTemplate,
  type LabelTemplate,
  type QualityFields,
} from '@/lib/label/label-templates';

interface Props {
  currentImageUrl: string;
  currentFields: QualityFields;
  onLoad: (fields: QualityFields) => void;
  onImageLoad: (imageUrl: string) => void;
}

const BTN: React.CSSProperties = {
  flex: 1,
  padding: '5px 10px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  fontSize: 12,
  cursor: 'pointer',
  background: '#fff',
  color: '#111',
};

const INPUT: React.CSSProperties = {
  flex: 1,
  padding: '5px 8px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  fontSize: 12,
  background: '#fff',
  color: '#111',
};

export default function TemplatePicker({ currentImageUrl, currentFields, onLoad, onImageLoad }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getLabelTemplates('quality')
      .then(setTemplates)
      .catch(() => setLoadError('템플릿 목록을 불러오지 못했습니다. 로그인 상태를 확인해주세요.'));
  }, []);

  const handleLoad = () => {
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl) return;
    onLoad(tmpl.fields as unknown as QualityFields);
    if (tmpl.image_url) onImageLoad(tmpl.image_url);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const tmpl = await saveLabelTemplate(saveName.trim(), 'quality', currentFields as unknown as Record<string, unknown>);
      setTemplates((prev) => [tmpl, ...prev]);
      setSaveName('');
      setSaveMsg({ ok: true, text: '저장 완료!' });
    } catch (err) {
      setSaveMsg({ ok: false, text: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSaving(false);
    }
  };

  const disabledStyle = (disabled: boolean): React.CSSProperties =>
    disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {};

  const canLoad = !!selectedId;
  const canSave = !saving && !!saveName.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {loadError && (
        <p style={{ fontSize: 11, color: '#dc2626', margin: 0 }}>{loadError}</p>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          style={{ ...INPUT }}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">{templates.length === 0 ? '저장된 템플릿 없음' : '템플릿 선택...'}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          style={{ ...BTN, ...disabledStyle(!canLoad) }}
          onClick={handleLoad}
          disabled={!canLoad}
        >
          불러오기
        </button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={INPUT}
          placeholder="템플릿 이름 입력 후 저장"
          value={saveName}
          onChange={(e) => { setSaveName(e.target.value); setSaveMsg(null); }}
        />
        <button
          style={{ ...BTN, ...disabledStyle(!canSave) }}
          onClick={handleSave}
          disabled={!canSave}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
      {saveMsg && (
        <p style={{ fontSize: 11, color: saveMsg.ok ? '#16a34a' : '#dc2626', margin: 0 }}>
          {saveMsg.text}
        </p>
      )}
    </div>
  );
}
