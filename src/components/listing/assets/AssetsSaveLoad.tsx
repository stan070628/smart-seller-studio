'use client';

import React, { useState, useEffect } from 'react';
import {
  getAssetsDrafts,
  saveAssetsDraft,
  deleteAssetsDraft,
  type AssetsDraftMeta,
} from '@/lib/listing/assets-drafts';
import { C } from '@/lib/design-tokens';

interface Props {
  currentDraftData: Record<string, unknown>;
  onLoad: (data: Record<string, unknown>) => void;
}

const INPUT: React.CSSProperties = {
  flex: 1,
  padding: '5px 8px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  fontSize: 12,
  background: '#fff',
  color: C.text,
};

const BTN: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 4,
  border: `1px solid ${C.border}`,
  fontSize: 12,
  cursor: 'pointer',
  background: '#fff',
  color: C.text,
  whiteSpace: 'nowrap' as const,
};

export default function AssetsSaveLoad({ currentDraftData, onLoad }: Props) {
  const [drafts, setDrafts] = useState<AssetsDraftMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    getAssetsDrafts()
      .then(setDrafts)
      .catch(() => setMsg({ ok: false, text: '목록 로드 실패. 로그인을 확인해주세요.' }));
  }, []);

  const clearMsg = () => setMsg(null);

  const handleLoad = () => {
    const draft = drafts.find((d) => d.id === selectedId);
    if (!draft) return;
    onLoad(draft.draftData);
    setMsg({ ok: true, text: `"${draft.name}" 불러오기 완료` });
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    clearMsg();
    try {
      const saved = await saveAssetsDraft(saveName.trim(), currentDraftData);
      setDrafts((prev) => [saved, ...prev]);
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
    const draft = drafts.find((d) => d.id === selectedId);
    if (!draft || !window.confirm(`"${draft.name}"을(를) 삭제할까요?`)) return;
    setDeleting(true);
    clearMsg();
    try {
      await deleteAssetsDraft(selectedId);
      setDrafts((prev) => prev.filter((d) => d.id !== selectedId));
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
      <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>임시저장</div>

      {/* 불러오기 + 삭제 행 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <select
          style={INPUT}
          value={selectedId}
          onChange={(e) => { setSelectedId(e.target.value); clearMsg(); }}
        >
          <option value="">
            {drafts.length === 0 ? '저장된 항목 없음' : '불러올 항목 선택...'}
          </option>
          {drafts.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
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
          title="선택한 항목 삭제"
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
