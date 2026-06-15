'use client';

import React, { useState } from 'react';
import { C } from '@/lib/design-tokens';
import { MOOD_PRESETS, getMoodPreset } from '@/lib/detail-page/mood-presets';
import { PALETTES } from '@/lib/detail-page/palette-config';
import type { MoodPreset } from '@/types/detail-page';

const BRAND_PURPLE = '#7c3aed';

interface Props {
  /** AI 추천 무드 id 목록 (suggest-mood 결과) */
  suggestedMoodIds: string[];
  /** 현재 선택된 무드 id */
  selectedMoodId: string | null;
  /** 추천 로딩 중 여부 */
  isSuggesting: boolean;
  /** 무드 선택 콜백 */
  onSelectMood: (id: string) => void;
}

function MoodTile({
  preset,
  selected,
  onClick,
}: {
  preset: MoodPreset;
  selected: boolean;
  onClick: () => void;
}) {
  const pal = PALETTES[preset.palette];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '8px 10px',
        borderRadius: 8,
        border: selected ? `1.5px solid ${BRAND_PURPLE}` : `1px solid ${C.border}`,
        background: selected ? '#f5f3ff' : '#fff',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span style={{ fontSize: 18 }}>{preset.emoji}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.text }}>
          {preset.label}
        </span>
        <span style={{ display: 'block', fontSize: 10, color: C.textSub, marginTop: 1 }}>
          {preset.keywords.join(' · ')}
        </span>
      </span>
      {/* 팔레트 칩 */}
      <span style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        {[pal.bg, pal.accent, pal.text].map((c, i) => (
          <span
            key={i}
            style={{ width: 10, height: 10, borderRadius: 2, background: c, border: '1px solid #00000010' }}
          />
        ))}
      </span>
    </button>
  );
}

export default function CreativeBriefPanel({
  suggestedMoodIds,
  selectedMoodId,
  isSuggesting,
  onSelectMood,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const suggested = suggestedMoodIds
    .map((id) => getMoodPreset(id))
    .filter((p): p is MoodPreset => p !== null);

  // 더보기에서는 추천에 없는 나머지만 노출 (중복 방지)
  const rest = MOOD_PRESETS.filter((p) => !suggestedMoodIds.includes(p.id));

  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: C.text, display: 'block', marginBottom: 6 }}>
        🎨 무드 브리프{' '}
        <span style={{ fontSize: 11, color: C.textSub, fontWeight: 400 }}>
          (씬 이미지 + 페이지 톤 통일)
        </span>
      </label>

      {isSuggesting && (
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>AI가 어울리는 무드를 찾는 중...</div>
      )}

      {!isSuggesting && suggested.length === 0 && (
        <div style={{ fontSize: 12, color: C.textSub, marginBottom: 8 }}>
          이미지를 올리면 어울리는 무드를 추천해드려요.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {suggested.map((p) => (
          <MoodTile
            key={p.id}
            preset={p}
            selected={selectedMoodId === p.id}
            onClick={() => onSelectMood(p.id)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setShowAll((v) => !v)}
        style={{
          marginTop: 8,
          fontSize: 12,
          color: BRAND_PURPLE,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {showAll ? '접기 ▲' : '프리셋 더보기 ▼'}
      </button>

      {showAll && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {rest.map((p) => (
            <MoodTile
              key={p.id}
              preset={p}
              selected={selectedMoodId === p.id}
              onClick={() => onSelectMood(p.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
