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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, RefreshCw, AlertTriangle } from 'lucide-react';
import { C } from '@/lib/design-tokens';

interface Seed {
  id: number;
  keyword: string;
  source: string;
  reason: string | null;
  created_at: string;
}

interface RunResult {
  domeggook_product_name: string | null;
  domeggook_price: number | null;
  domeggook_url: string | null;
  naver_price: number | null;
  /** Task 7에서 저장하기 시작한 값. 그 이전 행은 null이다 */
  unit_deli_fee: number | null;
}

interface Run {
  requestId: number;
  keyword: string;
  status: 'pending' | 'done' | 'error';
  errorMessage: string | null;
  results: RunResult[];
}

const STALE_MS = 24 * 60 * 60 * 1000;

/** 폴링 간격 */
const POLL_MS = 3000;
/** 마지막으로 상태가 바뀐 뒤 이만큼 변화가 없으면 폴링을 접는다.
 *  실행 시작 기준이 아니다 — 키워드 10개면 정상 실행도 3분 반이 걸린다 */
const STALL_MS = 3 * 60 * 1000;

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

  const [runs, setRuns] = useState<Run[]>([]);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  // 폴링 대상 requestId는 실행 시점에 확정되고 폴링 중 변하지 않는다.
  // 이 값을 state로 두면 폴링 훅이 runs에 의존하게 되는데, 훅은 매 틱마다
  // setRuns를 호출하므로 의존성이 갱신되며 훅이 재실행되고 타이머가 새로 걸린다
  // — 3초 간격이 무너지고 API를 계속 두드린다. ref에 담아 훅의 의존성에서 뺀다.
  const pollIdsRef = useRef<number[]>([]);

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

  // 실행 진행 상황 폴링.
  // 의존성이 polling 하나뿐인 것은 의도적이다 — 조회 대상 id는 pollIdsRef에 있고,
  // 결과 병합은 setRuns의 함수형 갱신으로 하므로 훅이 runs를 읽을 필요가 없다.
  // 폴링이 멈추는 경로는 넷이며 어느 쪽도 조용히 끝나지 않는다:
  // (1) 전부 done/error → 결과 표시, (2) 정체 3분 → 안내 + 다시 확인 버튼,
  // (3) 조회 실패 → 사유 표시 + 다시 확인 버튼, (4) 언마운트 → 타이머 정리.
  useEffect(() => {
    const ids = pollIdsRef.current;
    if (!polling || ids.length === 0) return;

    const query = ids.join(',');
    let lastChange = Date.now();
    let lastSnapshot = '';
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/sourcing/agent/run/status?ids=${query}`);
        if (!res.ok) throw new Error(`서버 응답 ${res.status}`);

        const body = await res.json();
        if (!body.success) throw new Error(body.error ?? '조회 실패');

        // 이미 정리된 훅이라면 낡은 응답으로 상태를 되돌리지 않는다.
        if (stopped) return;

        const fetched: Run[] = body.data.runs;
        const byId = new Map(fetched.map((r) => [r.requestId, r]));

        // 상태 API는 id 순서를 보장하지 않는다(WHERE id = ANY). 응답을 그대로
        // 갈아끼우면 폴링할 때마다 키워드 블록 순서가 뒤바뀐다. 사용자가 고른
        // 순서를 유지하도록 requestId로 짝지어 덮어쓴다.
        const snapshot = JSON.stringify(ids.map((id) => byId.get(id) ?? null));
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          lastChange = Date.now();
          setRuns((prev) => prev.map((p) => byId.get(p.requestId) ?? p));
        }

        const finished = ids.every((id) => {
          const r = byId.get(id);
          return r?.status === 'done' || r?.status === 'error';
        });
        if (finished) {
          setPolling(false);
          return;
        }

        if (Date.now() - lastChange > STALL_MS) {
          setPolling(false);
          setPollError('3분간 진행이 없습니다. 아직 실행 중일 수 있으니 다시 확인해 보세요.');
          return;
        }
      } catch (err) {
        if (stopped) return;
        setPolling(false);
        setPollError(`진행 상황을 불러오지 못했습니다: ${errorText(err)}`);
        return;
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };

    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [polling]);

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
        // 실행 라우트가 requestId를 미리 만들어 주므로 결과를 기다리지 않고
        // 키워드 블록을 먼저 세운다. 화면에 "무엇을 돌리는 중인지"가 바로 보인다.
        const started: Run[] = body.data.runs.map(
          (r: { requestId: number; keyword: string }) => ({
            requestId: r.requestId,
            keyword: r.keyword,
            status: 'pending' as const,
            errorMessage: null,
            results: [],
          }),
        );
        pollIdsRef.current = started.map((r) => r.requestId);
        setRuns(started);
        setPollError(null);
        setPolling(true);
        setChecked(new Set());
        setManual('');
      }
    } catch (err) {
      setMessage(`실행 실패: ${errorText(err)} — 네트워크 상태를 확인하고 다시 시도하세요.`);
    } finally {
      setRunning(false);
    }
  }

  // 폴링을 접었더라도 실행 자체는 서버에서 계속 돌고 있을 수 있다.
  // requestId는 pollIdsRef에 남아 있으므로 재실행 없이 조회만 다시 건다.
  function retryPolling() {
    if (pollIdsRef.current.length === 0) return;
    setPollError(null);
    setPolling(true);
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
            // 비활성 상태가 이 탭의 첫 화면이라 레이블이 읽혀야 한다.
            // textMuted(#a1a1aa)는 border 배경 위에서 대비 2.0:1, textSub(#71717a)는 3.9:1.
            color: selectedCount > 0 ? '#fff' : C.textSub,
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

      {runs.length > 0 && (
        <section style={{ marginTop: 20 }}>
          {polling && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
              background: C.tableHeader, border: `1px solid ${C.border}`, borderRadius: 6,
              fontSize: 13, marginBottom: 12,
            }}>
              <Loader2 size={14} className="animate-spin" />
              <span>
                분석 중{' '}
                <b>{runs.filter((r) => r.status !== 'pending').length} / {runs.length}</b> 완료
              </span>
            </div>
          )}

          {/* 폴링이 멈춘 이유는 반드시 화면에 남긴다. 크론이 조용히 죽은 것을
              잡으려고 만든 화면이므로 이 화면의 침묵도 허용하지 않는다. */}
          {pollError && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px',
              border: `1px solid ${C.border}`, borderRadius: 6,
              fontSize: 13, color: C.warning, marginBottom: 12,
            }}>
              <AlertTriangle size={14} />
              <span>{pollError}</span>
              <button
                onClick={retryPolling}
                style={{
                  marginLeft: 'auto', padding: '4px 10px', borderRadius: 6, fontSize: 12,
                  fontWeight: 600, background: 'transparent', color: C.text,
                  border: `1px solid ${C.border}`, cursor: 'pointer',
                }}
              >
                다시 확인
              </button>
            </div>
          )}

          <p style={{ fontSize: 12.5, color: C.textSub, marginBottom: 12 }}>
            모든 손익분기가는 <b>10개 사입 · 극소형</b> 기준입니다. 담은 뒤 소싱리스트에서 조정할 수 있습니다.
          </p>

          {runs.map((r) => (
            <article
              key={r.requestId}
              style={{
                border: `1px solid ${C.border}`, borderRadius: 8,
                marginBottom: 12, overflow: 'hidden',
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '10px 13px',
                background: C.tableHeader, borderBottom: `1px solid ${C.border}`, fontSize: 13.5,
              }}>
                <span style={{ fontWeight: 700 }}>{r.keyword}</span>
                {r.status === 'done' && (
                  <span style={{ color: C.textSub }}>후보 {r.results.length}개</span>
                )}
                {/* 폴링을 접은 뒤에도 스피너가 돌면 "아직 일하는 중"으로 읽힌다.
                    멈췄으면 멈췄다고 쓴다. */}
                {r.status === 'pending' && (
                  polling
                    ? <Loader2 size={13} className="animate-spin" />
                    : <span style={{ color: C.textSub }}>확인 중단됨</span>
                )}
                {r.status === 'error' && (
                  <span style={{ color: C.warning }}>실패 — {r.errorMessage ?? '알 수 없는 오류'}</span>
                )}
              </div>
              {r.results.map((c, i) => (
                <CandidateRow key={i} c={c} />
              ))}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * ⚠️ 임시 구현 — 완성된 코드가 아니다.
 * 가격 입력·손익분기 판정·담기 버튼·쿠팡 검색 링크는 Task 9에서 이 컴포넌트를
 * 통째로 교체하며 붙인다. 지금은 폴링이 가져온 후보가 화면에 닿는지만 확인한다.
 */
function CandidateRow({ c }: { c: RunResult }) {
  return (
    <div style={{ padding: '9px 13px', fontSize: 13, borderTop: `1px solid ${C.border}` }}>
      {c.domeggook_product_name ?? '—'}
    </div>
  );
}
