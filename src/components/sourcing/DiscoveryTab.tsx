'use client';

/**
 * DiscoveryTab.tsx
 * 발굴 탭 — "오늘 뭘 찾아볼까?"에 답하는 화면.
 *
 * 매일 크론이 모은 트렌드 시드를 보여주고, 체크한 것만 파이프라인에 태운다.
 * 전량 자동 실행하지 않는 이유: 하루 10시드 × 후보 5개면 5개월에 7,500개가 되어
 * 리스트가 오염되고 쓰지도 않을 후보에 API 비용이 나간다.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, RefreshCw, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface Seed {
  id: number;
  keyword: string;
  source: string;
  reason: string | null;
  created_at: string;
}

const STALE_MS = 24 * 60 * 60 * 1000;

export default function DiscoveryTab() {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [lastCollectedAt, setLastCollectedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sourcing/seeds');
      const body = await res.json();
      if (body.success) {
        setSeeds(body.data.seeds);
        setLastCollectedAt(body.data.lastCollectedAt);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function run() {
    const picked = seeds.filter((s) => checked.has(s.id)).map((s) => s.keyword);
    const extra = manual.trim();
    const keywords = extra ? [...picked, extra] : picked;
    if (keywords.length === 0) return;

    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sourcing/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords }),
      });
      const body = await res.json();
      setMessage(
        body.success
          ? `${body.data.accepted}개 분석을 시작했습니다. 결과는 잠시 후 아래 목록과 소싱리스트에 반영됩니다.`
          : `실행 실패: ${body.error}`,
      );
      if (body.success) {
        setChecked(new Set());
        setManual('');
      }
    } finally {
      setRunning(false);
    }
  }

  const isStale =
    !lastCollectedAt || Date.now() - new Date(lastCollectedAt).getTime() > STALE_MS;
  const selectedCount = checked.size + (manual.trim() ? 1 : 0);

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>오늘의 트렌드 시드</h2>
        {isStale && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.warning }}>
            <AlertTriangle size={14} />
            수집이 24시간 넘게 없습니다 — 크론을 확인하세요
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textSub }}>
          {lastCollectedAt ? new Date(lastCollectedAt).toLocaleString('ko-KR') : '수집 이력 없음'}
        </span>
        <button onClick={() => void load()} disabled={loading} aria-label="새로고침">
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {seeds.length === 0 && !loading && (
        <p style={{ color: C.textSub, fontSize: 14 }}>
          수집된 시드가 없습니다. 아래에 키워드를 직접 입력해 분석할 수 있습니다.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {seeds.map((s) => (
          <li
            key={s.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 8px', borderBottom: `1px solid ${C.border}`,
            }}
          >
            <input
              type="checkbox"
              checked={checked.has(s.id)}
              onChange={() => toggle(s.id)}
              aria-label={`${s.keyword} 선택`}
            />
            <span style={{ fontWeight: 600, color: C.text, minWidth: 140 }}>{s.keyword}</span>
            <span style={{ fontSize: 12, color: C.textSub, minWidth: 80 }}>{s.source}</span>
            <span style={{ fontSize: 12, color: C.textSub }}>{s.reason}</span>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="또는 직접 입력 (예: 넥워머)"
          style={{
            flex: 1, padding: '8px 10px',
            border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14,
          }}
        />
        <button
          onClick={() => void run()}
          disabled={running || selectedCount === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600,
            background: selectedCount > 0 ? C.accent : C.border,
            color: '#fff', border: 'none',
            cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          {running ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
          선택한 {selectedCount}개 분석
        </button>
      </div>

      {message && (
        <p style={{ marginTop: 12, fontSize: 13, color: C.textSub }}>{message}</p>
      )}
    </div>
  );
}
