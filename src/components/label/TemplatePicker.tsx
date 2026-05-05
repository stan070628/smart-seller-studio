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

  useEffect(() => {
    getLabelTemplates().then(setTemplates);
  }, []);

  const handleLoad = () => {
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl) return;
    onLoad(tmpl.fields);
    if (tmpl.image_url) onImageLoad(tmpl.image_url);
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const tmpl = await saveLabelTemplate(saveName.trim(), currentImageUrl, currentFields);
      setTemplates((prev) => [tmpl, ...prev]);
      setSaveName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <select
          style={{ ...INPUT }}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">템플릿 선택...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button style={BTN} onClick={handleLoad} disabled={!selectedId}>불러오기</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          style={INPUT}
          placeholder="템플릿 이름 입력 후 저장"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button style={BTN} onClick={handleSave} disabled={saving || !saveName.trim()}>
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>
    </div>
  );
}
