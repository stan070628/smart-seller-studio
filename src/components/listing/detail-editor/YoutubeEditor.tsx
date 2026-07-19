'use client';

import { useState } from 'react';
import type { DetailSection, YoutubeContent } from '@/types/detail-page';
import { parseYoutubeUrl } from '@/lib/detail-page/youtube';

interface Props {
  section: DetailSection;
  onUpdate: (updates: Partial<YoutubeContent>) => void;
}

export default function YoutubeEditor({ section, onUpdate }: Props) {
  const content = section.content as YoutubeContent;
  const [urlInput, setUrlInput] = useState(content.url);
  const [parseError, setParseError] = useState<string | null>(null);

  function applyUrl(value: string) {
    setUrlInput(value);
    if (!value.trim()) {
      setParseError(null);
      onUpdate({ url: '', videoId: '' });
      return;
    }
    const parsed = parseYoutubeUrl(value);
    if (!parsed) {
      setParseError('유튜브 URL을 확인해주세요.');
      onUpdate({ url: value, videoId: '' });
      return;
    }
    setParseError(null);
    onUpdate({ url: value, videoId: parsed.videoId, aspect: parsed.aspect });
  }

  const label = { fontSize: 12, fontWeight: 700, color: '#555', display: 'block', marginBottom: 6 } as const;
  const input = { width: '100%', padding: '9px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, color: '#111', boxSizing: 'border-box' as const };

  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={label}>유튜브 URL</label>
        <input style={input} value={urlInput} onChange={(e) => applyUrl(e.target.value)} placeholder="https://youtu.be/... 또는 youtube.com/shorts/..." />
        {parseError && <p style={{ color: '#e11d48', fontSize: 11, margin: '6px 0 0' }}>{parseError}</p>}
      </div>

      <div>
        <label style={label}>비율</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['horizontal', 'vertical'] as const).map((a) => (
            <button key={a} type="button" onClick={() => onUpdate({ aspect: a })}
              style={{ flex: 1, padding: '8px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: content.aspect === a ? '1px solid #6366f1' : '1px solid #ddd',
                background: content.aspect === a ? '#6366f1' : '#fff', color: content.aspect === a ? '#fff' : '#555' }}>
              {a === 'horizontal' ? '가로 (일반)' : '세로 (Shorts)'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={label}>캡션 (선택)</label>
        <input style={input} value={content.caption ?? ''} onChange={(e) => onUpdate({ caption: e.target.value })} placeholder="예: 동영상제공:유투버varoachi" />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#555' }}>
        <input type="checkbox" checked={content.enabled} onChange={(e) => onUpdate({ enabled: e.target.checked })} />
        상세페이지에 표시
      </label>
    </div>
  );
}
