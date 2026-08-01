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
import {
  breakEvenPrice,
  marginOf,
  buildSearchQueries,
  MIN_SELL_PRICE_KRW,
  DEFAULT_ORDER_QTY,
} from '@/lib/sourcing/coupang-price';

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
              {/* key를 인덱스로 두면 폴링이 결과를 다시 받아올 때 입력 중인 값이
                  다른 후보로 옮겨 붙을 수 있다. 후보를 고유하게 가리키는 URL을 쓴다. */}
              {r.results.map((c, i) => (
                <CandidateRow
                  key={c.domeggook_url ?? `${r.requestId}-${i}`}
                  c={c}
                  divider={i > 0}
                />
              ))}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

/** 쿠팡 실판가 상한 — 쇼트리스트 PATCH의 MAX_COUPANG_PRICE와 같다. 자릿수 오타를 여기서 먼저 잡는다 */
const MAX_COUPANG_PRICE = 10_000_000;

/**
 * 도매꾹 상품 URL에서 상품번호를 뽑는다.
 *
 * 도매꾹 목록 API(getItemList)가 주는 url은 `http://domeggook.com/64494164` 꼴이다
 * (DB의 기존 행 전부가 이 형태다 — 쿼리스트링도 끝 슬래시도 없다). 그래도 형태가
 * 바뀌었을 때 NaN이나 0을 서버로 보내지 않도록 쿼리·해시·끝 슬래시를 털고
 * 마지막 숫자 경로만 취한다. 못 읽으면 null을 돌려주고 호출부가 담기를 막는다.
 */
function parseItemNo(url: string | null): number | null {
  if (!url) return null;
  const m = url.split(/[?#]/)[0].replace(/\/+$/, '').match(/(\d+)$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Enter로 다음 후보의 가격 칸으로 이동한다. 마지막 칸에서는 움직이지 않는다 */
function focusNextPriceInput(current: HTMLInputElement) {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('[data-price-input]'));
  const next = all[all.indexOf(current) + 1];
  next?.focus();
}

/**
 * 후보 한 줄 — 이 화면이 실제로 판정을 내리는 자리.
 *
 * 판정은 브라우저에서 breakEvenPrice·marginOf를 그대로 불러 즉시 계산한다.
 * 이 값은 "타이핑하는 동안 보이는 피드백"이지 저장되는 값이 아니다 —
 * 담을 때는 서버가 verifyOne으로 같은 산식을 다시 돌려 판정을 확정한다.
 */
function CandidateRow({ c, divider }: { c: RunResult; divider: boolean }) {
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 담기 성공 여부와 실판가 저장 성공 여부는 별개다. POST가 되고 PATCH가 깨지면
  // 상품은 소싱리스트에 들어갔지만 실판가는 비어 있다 — 그 상태를 "담김"으로만
  // 표시하면 화면이 거짓말을 한다. 두 사실을 따로 들고 따로 보여준다.
  const [saved, setSaved] = useState<{ existed: boolean } | null>(null);
  const [savedPrice, setSavedPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  const domePrice = c.domeggook_price ?? 0;
  // 배송비를 빼면 손익분기가 실제보다 낮게 나와 통과하면 안 될 후보가 통과한다.
  // Task 7 이전에 쌓인 행은 null이므로 그때는 배송비 미반영임을 화면에 알린다.
  const deli = c.unit_deli_fee;
  const effectiveCost = domePrice + (deli ?? 0);
  const be = breakEvenPrice(effectiveCost, 'xsmall');

  const digits = price.replace(/[^0-9]/g, '');
  const p = digits ? Number.parseInt(digits, 10) : 0;
  const priceValid = p > 0 && p <= MAX_COUPANG_PRICE;

  let verdict: { label: string; why: string; color: string };
  if (!digits) {
    verdict = { label: '판정 불가', why: '실판가 미입력', color: C.warning };
  } else if (!priceValid) {
    verdict = {
      label: '판정 불가',
      why: `실판가는 1~${MAX_COUPANG_PRICE.toLocaleString()}원 사이여야 합니다`,
      color: C.warning,
    };
  } else if (p < MIN_SELL_PRICE_KRW) {
    // 미달은 후보 대부분이 지나가는 정상 결과다. 경고색을 쓰면 20개를 훑는 동안
    // 화면이 온통 빨개져서 정작 봐야 할 '통과'가 묻힌다.
    verdict = { label: '미달', why: '1만원 하한 미만', color: C.textSub };
  } else if (p >= be) {
    const m = marginOf(p, effectiveCost, 'xsmall');
    verdict = {
      label: '통과',
      why: `개당 ${m.toLocaleString()}원 · ${((m / p) * 100).toFixed(1)}%`,
      color: C.success,
    };
  } else {
    verdict = { label: '미달', why: `손익분기 ${(be - p).toLocaleString()}원 부족`, color: C.textSub };
  }

  const itemNo = parseItemNo(c.domeggook_url);
  // 도매꾹 원제는 판매자명·수식어가 붙어 있어("… 가방세트 해피포레") 쿠팡에서
  // 그대로 검색하면 결과가 0건이다. 앞 4단어로 잘라 만든 검색어를 쓴다.
  const searchQuery = buildSearchQueries(c.domeggook_product_name ?? '')[0] ?? '';

  /** 실판가만 저장한다. 실패 사유를 문자열로 돌려주고 예외로 올리지 않는다 */
  async function savePrice(no: number, value: number): Promise<string | null> {
    try {
      const res = await fetch(`/api/sourcing/shortlist/${no}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coupangP25: value }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        return b.error ?? `서버 응답 ${res.status}`;
      }
      return null;
    } catch (e) {
      return errorText(e);
    }
  }

  async function take() {
    if (itemNo === null) {
      setErr('상품 URL에서 상품번호를 읽지 못했습니다. 소싱리스트 탭에서 URL로 직접 추가하세요.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      // 이 라우트는 itemNo/title 필드를 보지 않는다. 상품번호 또는 도매꾹 URL을
      // input 하나로 받아 스스로 해석하고, 제목도 도매꾹에서 다시 받아 쓴다.
      // 목록 API의 URL 형식(domeggook.com/64494164)은 서버의 URL 파서가 모르는
      // 형태라 숫자 상품번호를 넘긴다.
      const res = await fetch('/api/sourcing/shortlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: String(itemNo), orderQty: DEFAULT_ORDER_QTY }),
      });

      // 409는 실패가 아니다 — 이미 담겨 있다는 뜻이므로 실판가만 마저 채운다.
      let existed = false;
      if (!res.ok) {
        if (res.status === 409) {
          existed = true;
        } else {
          const b = await res.json().catch(() => ({}));
          throw new Error(b.error ?? `서버 응답 ${res.status}`);
        }
      }

      const failure = priceValid ? await savePrice(itemNo, p) : null;
      setPriceError(failure);
      setSavedPrice(priceValid && !failure ? p : null);
      setSaved({ existed });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '담지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  /** 담긴 뒤에 실판가만 다시(또는 새로) 저장한다 */
  async function retryPrice() {
    if (itemNo === null || !priceValid) return;
    setBusy(true);
    const failure = await savePrice(itemNo, p);
    setPriceError(failure);
    if (!failure) setSavedPrice(p);
    setBusy(false);
  }

  return (
    <div style={{
      padding: 13,
      // 헤더가 이미 아래쪽 선을 그으므로 첫 행은 선을 긋지 않는다(1px 겹침 방지).
      borderTop: divider ? `1px solid ${C.border}` : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: C.text }}>{c.domeggook_product_name ?? '—'}</span>
        {c.domeggook_url && (
          <a href={c.domeggook_url} target="_blank" rel="noreferrer"
             style={{ fontSize: 12, color: C.textSub }}>도매꾹 ↗</a>
        )}
        {searchQuery && (
          <a href={`https://www.coupang.com/np/search?q=${encodeURIComponent(searchQuery)}`}
             target="_blank" rel="noreferrer"
             title={`쿠팡에서 "${searchQuery}" 검색`}
             style={{ fontSize: 12, color: C.accent }}>쿠팡에서 검색 ↗</a>
        )}
      </div>

      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', margin: '9px 0 11px', fontSize: 13 }}>
        <span style={{ color: C.textSub }}>도매가 <b style={{ color: C.text }}>{domePrice.toLocaleString()}원</b></span>
        <span style={{ color: C.textSub }}>
          개당 배송비 <b style={{ color: C.text }}>{deli == null ? '모름' : `${deli.toLocaleString()}원`}</b>
        </span>
        <span style={{ color: C.textSub }}>실효원가 <b style={{ color: C.text }}>{effectiveCost.toLocaleString()}원</b></span>
        <span style={{ color: C.accent }}>손익분기 <b>{be.toLocaleString()}원</b></span>
        {/* 배송비를 0으로 치고 계산한 손익분기는 실제보다 낮다 — 조용히 넘기면
            통과하면 안 될 후보가 통과한 것으로 읽힌다. */}
        {deli == null && (
          <span style={{ color: C.warning, fontSize: 12 }}>배송비 미반영 — 실제 손익분기는 더 높다</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12.5, color: C.textSub }}>쿠팡 실판가</label>
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') focusNextPriceInput(e.currentTarget); }}
          inputMode="numeric"
          aria-label={`${c.domeggook_product_name ?? '후보'} 쿠팡 실판가`}
          data-price-input
          style={{
            width: 118, padding: '7px 9px', textAlign: 'right', fontWeight: 600,
            border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13,
          }}
        />
        <span style={{ fontSize: 12.5, fontWeight: 650, color: verdict.color }}>
          {verdict.label} <span style={{ fontWeight: 500, opacity: 0.85 }}>— {verdict.why}</span>
        </span>

        {saved ? (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 9 }}>
            <span style={{ color: C.success, fontWeight: 650, fontSize: 12.5 }}>
              {saved.existed ? '✓ 이미 담겨 있음' : '✓ 담김'}
              {savedPrice !== null && (
                <span style={{ fontWeight: 500, opacity: 0.85 }}> · 실판가 {savedPrice.toLocaleString()}원</span>
              )}
            </span>
            {priceValid && p !== savedPrice && (
              <button onClick={() => void retryPrice()} disabled={busy}
                      style={{
                        padding: '5px 11px', fontSize: 12,
                        border: `1px solid ${C.border}`, borderRadius: 6,
                        background: 'transparent', color: C.text,
                        cursor: busy ? 'default' : 'pointer',
                      }}>
                {busy ? '저장 중…' : '실판가 저장'}
              </button>
            )}
          </span>
        ) : (
          <button onClick={() => void take()} disabled={busy}
                  style={{
                    marginLeft: 'auto', padding: '7px 13px', fontSize: 13,
                    border: `1px solid ${C.border}`, borderRadius: 6,
                    background: 'transparent', color: C.text,
                    cursor: busy ? 'default' : 'pointer',
                  }}>
            {busy ? '담는 중…' : '소싱리스트에 담기'}
          </button>
        )}
      </div>

      {/* 담기는 됐는데 실판가만 못 넣은 상태. 두 호출이 한 트랜잭션이 아니라서
          생기며, 되돌릴 필요는 없다 — 무엇이 빠졌는지와 어디서 채우는지만 말한다. */}
      {priceError && (
        <p style={{ marginTop: 8, fontSize: 12.5, color: C.warning }}>
          실판가를 저장하지 못했습니다: {priceError} — 위 버튼으로 다시 시도하거나 소싱리스트 탭에서 입력하세요.
        </p>
      )}
      {err && <p style={{ marginTop: 8, fontSize: 12.5, color: C.warning }}>{err}</p>}
    </div>
  );
}
