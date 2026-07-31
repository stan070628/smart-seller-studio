'use client';

/**
 * DiscoveryTab.tsx
 * 발굴 탭 — "오늘 뭘 찾아볼까?"에 답하는 화면.
 *
 * 매일 크론이 모은 트렌드 시드를 보여주고, 체크한 것만 파이프라인에 태운다.
 * 전량 자동 실행하지 않는 이유: 하루 10시드 × 후보 5개면 5개월에 7,500개가 되어
 * 리스트가 오염되고 쓰지도 않을 후보에 API 비용이 나간다.
 *
 * 이 화면은 크론이 조용히 죽는 것을 잡으려고 만들었다. 그러므로 이 화면 자신의
 * 실패도 조용히 넘어가서는 안 된다 — 조회 실패와 실행 실패는 반드시 화면에 남긴다.
 * "요청이 실패했다"와 "수집된 시드가 없다"는 다른 사실이므로 구분해서 표시한다.
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function DiscoveryTab() {
  const [seeds, setSeeds] = useState<Seed[]>([]);
  const [lastCollectedAt, setLastCollectedAt] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [manual, setManual] = useState('');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sourcing/seeds');
      if (!res.ok) throw new Error(`서버 응답 ${res.status}`);

      const body = await res.json();
      if (!body.success) throw new Error(body.error || '알 수 없는 오류');

      const fetched: Seed[] = body.data.seeds;
      setSeeds(fetched);
      setLastCollectedAt(body.data.lastCollectedAt);

      // 시드가 회전하면 사라진 id가 checked에 남아 "선택한 N개"가 실제 전송분보다
      // 많아진다. 새로 받은 목록과 교집합만 남긴다.
      const ids = new Set(fetched.map((s) => s.id));
      setChecked((prev) => new Set([...prev].filter((id) => ids.has(id))));
    } catch (err) {
      setError(errorText(err));
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

      if (!res.ok) {
        setMessage(
          res.status === 404
            ? '실행 실패: 분석 실행 API(/api/sourcing/agent/run)를 찾을 수 없습니다 (404). 배포 상태를 확인하세요.'
            : `실행 실패: 서버 응답 ${res.status}. 잠시 후 다시 시도하세요.`,
        );
        return;
      }

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
    } catch (err) {
      setMessage(`실행 실패: ${errorText(err)} — 네트워크 상태를 확인하고 다시 시도하세요.`);
    } finally {
      setRunning(false);
    }
  }

  // 조회가 실패했을 때는 수집 이력을 읽지 못한 것이므로 크론을 탓하지 않는다.
  const isStale =
    !error &&
    (!lastCollectedAt || Date.now() - new Date(lastCollectedAt).getTime() > STALE_MS);
  const selectedCount = checked.size + (manual.trim() ? 1 : 0);
  const canRun = !running && selectedCount > 0;

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: 0 }}>오늘의 트렌드 시드</h2>
        {isStale && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: C.warning }}>
            <AlertTriangle size={14} />
            {lastCollectedAt ? '수집이 24시간 넘게 없습니다' : '수집 이력이 없습니다'} — 크론을 확인하세요
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: C.textSub }}>
          {error ? '—' : lastCollectedAt ? new Date(lastCollectedAt).toLocaleString('ko-KR') : '수집 이력 없음'}
        </span>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="새로고침"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 6, border: 'none', background: 'transparent',
            color: C.textSub, borderRadius: 6,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>

      {error && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: C.warning }}>
          <AlertTriangle size={14} />
          시드 목록을 불러오지 못했습니다: {error} — 새로고침을 눌러 다시 시도하세요.
        </p>
      )}

      {seeds.length === 0 && !loading && !error && (
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canRun) void run();
          }}
          aria-label="직접 입력 키워드"
          placeholder="또는 직접 입력 (예: 넥워머)"
          style={{
            flex: 1, padding: '8px 10px',
            border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 14,
          }}
        />
        <button
          onClick={() => void run()}
          disabled={!canRun}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 6, fontSize: 14, fontWeight: 600,
            background: selectedCount > 0 ? C.accent : C.border,
            color: selectedCount > 0 ? '#fff' : C.textMuted,
            border: 'none',
            cursor: canRun ? 'pointer' : 'not-allowed',
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
