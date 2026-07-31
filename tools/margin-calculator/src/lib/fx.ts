/**
 * 실시간 환율(CNY→KRW) 조회.
 *
 * 이 앱은 백엔드가 없는 순수 정적 단일 파일이므로, 브라우저에서 공개 FX API를
 * 직접 호출한다. API 키가 필요 없고 CORS를 허용하는 소스를 순차 시도한다.
 *   1) frankfurter (ECB 일일 기준환율)
 *   2) open.er-api.com (폴백)
 * 둘 다 실패하면 throw → 호출부에서 잡아 수동 입력 값으로 폴백한다.
 *
 * 주의: 장중 실시간 틱이 아니라 "오늘의 기준환율"(중간환율)이다.
 * 실제 사입 지불환율은 이보다 높으므로 호출부에서 버퍼(%)를 더해 쓴다.
 */

export interface FxResult {
  /** CNY 1위안당 KRW (시장 중간환율) */
  rate: number;
  /** 환율 기준일 또는 갱신 시각 (표시용) */
  date: string;
  /** 데이터 출처 이름 */
  source: string;
}

interface FxSource {
  name: string;
  url: string;
  parse: (json: any) => { rate: number; date: string };
}

const SOURCES: FxSource[] = [
  {
    name: 'frankfurter',
    url: 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=KRW',
    parse: (j) => ({ rate: Number(j?.rates?.KRW), date: String(j?.date ?? '') }),
  },
  {
    name: 'er-api',
    url: 'https://open.er-api.com/v6/latest/CNY',
    parse: (j) => ({
      rate: Number(j?.rates?.KRW),
      date: String(j?.time_last_update_utc ?? '').slice(0, 16),
    }),
  },
];

export async function fetchCnyKrw(): Promise<FxResult> {
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url);
      if (!res.ok) continue;
      const json = await res.json();
      const { rate, date } = s.parse(json);
      if (Number.isFinite(rate) && rate > 0) {
        return { rate, date, source: s.name };
      }
    } catch {
      // 다음 소스로
    }
  }
  throw new Error('환율 조회 실패');
}
