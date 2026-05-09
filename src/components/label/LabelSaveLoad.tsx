// src/components/label/LabelSaveLoad.tsx
'use client';

import { useState, useEffect } from 'react';
import {
  getLabelTemplates,
  saveLabelTemplate,
  deleteLabelTemplate,
  type LabelType,
  type LabelTemplate,
} from '@/lib/label/label-templates';

interface Props {
  labelType: LabelType;
  currentData: Record<string, unknown>;
  onLoad: (data: Record<string, unknown>) => void;
}

const INPUT: React.CSSProperties = {
  flex: 1, padding: '5px 8px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12,
  background: '#fff', color: '#111',
};

const BTN: React.CSSProperties = {
  padding: '5px 10px', borderRadius: 4,
  border: '1px solid #d1d5db', fontSize: 12,
  cursor: 'pointer', background: '#fff', color: '#111',
};

export default function LabelSaveLoad({ labelType, currentData, onLoad }: Props) {
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getLabelTemplates(labelType)
      .then(setTemplates)
      .catch(() => setMsg({ ok: false, text: '목록 로드 실패. 로그인을 확인해주세요.' }));
  }, [labelType]);

  const clearMsg = () => setMsg(null);

  const handleLoad = () => {
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl) return;
    // image_url은 구버전 quality 템플릿 하위 호환용으로 merged에 포함
    const merged: Record<string, unknown> = {
      imageUrl: tmpl.image_url || undefined,
      ...tmpl.fields,
    };
    onLoad(merged);
    setMsg({ ok: true, text: `"${tmpl.name}" 불러오기 완료` });
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    clearMsg();
    try {
      const tmpl = await saveLabelTemplate(saveName.trim(), labelType, currentData);
      setTemplates((prev) => [tmpl, ...prev]);
      setSaveName('');
      setMsg({ ok: true, text: '저장 완료!' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '저장 실패' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const tmpl = templates.find((t) => t.id === selectedId);
    if (!tmpl || !window.confirm(`"${tmpl.name}"을(를) 삭제할까요?`)) return;
    setDeleting(true);
    clearMsg();
    try {
      await deleteLabelTemplate(selectedId);
      setTemplates((prev) => prev.filter((t) => t.id !== selectedId));
      setSelectedId('');
      setMsg({ ok: true, text: '삭제 완료' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : '삭제 실패' });
    } finally {
      setDeleting(false);
    }
  };

  const canLoad = !!selectedId;
  const canDelete = !!selectedId && !deleting;
  const canSave = !saving && !!saveName.trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* 불러오기 + 삭제 행 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          style={{ ...INPUT }}
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); clearMsg(); }}
        >
          <option value="">
            {templates.length === 0 ? '저장된 템플릿 없음' : '템플릿 선택...'}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <button
          style={{ ...BTN, opacity: canLoad ? 1 : 0.4 }}
          onClick={handleLoad}
          disabled={!canLoad}
        >
          불러오기
        </button>
        <button
          style={{ ...BTN, color: '#dc2626', opacity: canDelete ? 1 : 0.4 }}
          onClick={handleDelete}
          disabled={!canDelete}
          title="선택한 템플릿 삭제"
        >
          삭제
        </button>
      </div>

      {/* 저장 행 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          style={INPUT}
          placeholder="이름 입력 후 저장"
          value={saveName}
          onChange={(e) => { setSaveName(e.target.value); clearMsg(); }}
          onKeyDown={(e) => e.key === 'Enter' && canSave && handleSave()}
        />
        <button
          style={{ ...BTN, opacity: canSave ? 1 : 0.4 }}
          onClick={handleSave}
          disabled={!canSave}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {msg && (
        <p style={{ fontSize: 11, margin: 0, color: msg.ok ? '#16a34a' : '#dc2626' }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
