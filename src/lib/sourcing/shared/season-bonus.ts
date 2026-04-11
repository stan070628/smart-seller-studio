/**
 * season-bonus.ts
 * 상품명 + 현재 날짜 기반 시즌 가산점
 *
 * 최대 1개 시즌만 적용 (bonus가 가장 높은 시즌)
 * 음력 명절은 양력 근사값으로 처리 (±2주 오차 허용)
 */

// ─────────────────────────────────────────────────────────────────────────────
// 시즌 설정
// ─────────────────────────────────────────────────────────────────────────────

interface SolarSeason {
  type: 'solar';
  /** [월, 일] — 해당 날짜 기준으로 lead_days 이내면 활성 */
  monthDay: [number, number];
  /** 시즌 시작까지 남은 일수 임계값 */
  leadDays: number;
}

interface MonthSeason {
  type: 'months';
  /** 활성화할 월 목록 */
  months: number[];
}

interface SeasonConfig {
  keywords: string[];
  bonus: number;
  schedule: SolarSeason | MonthSeason;
}

const SEASONS: Record<string, SeasonConfig> = {
  // ── 양력 명절 ─────────────────────────────────────────────────────────────
  발렌타인: {
    keywords: ['발렌타인', '초콜릿', '커플'],
    bonus: 6,
    schedule: { type: 'solar', monthDay: [2, 14], leadDays: 21 },
  },
  화이트데이: {
    keywords: ['화이트데이', '사탕', '선물'],
    bonus: 6,
    schedule: { type: 'solar', monthDay: [3, 14], leadDays: 21 },
  },
  어버이날: {
    keywords: ['부모님', '선물', '카네이션'],
    bonus: 8,
    schedule: { type: 'solar', monthDay: [5, 8], leadDays: 21 },
  },
  빼빼로데이: {
    keywords: ['빼빼로', '과자선물'],
    bonus: 5,
    schedule: { type: 'solar', monthDay: [11, 11], leadDays: 14 },
  },
  크리스마스: {
    keywords: ['크리스마스', '트리', '산타', 'x-mas', 'xmas'],
    bonus: 10,
    schedule: { type: 'solar', monthDay: [12, 25], leadDays: 45 },
  },

  // ── 음력 명절 (양력 근사값 — 3년 이동 평균) ───────────────────────────────
  // 설날: 1월 말 ~ 2월 초, 추석: 9월 중순 ~ 10월 초
  설날: {
    keywords: ['설', '설날', '선물세트', '한과', '정월'],
    bonus: 8,
    schedule: { type: 'solar', monthDay: [2, 1], leadDays: 30 },
  },
  추석: {
    keywords: ['추석', '한가위', '선물세트', '송편'],
    bonus: 10,
    schedule: { type: 'solar', monthDay: [9, 17], leadDays: 30 },
  },

  // ── 글로벌 이벤트 ─────────────────────────────────────────────────────────
  블랙프라이데이: {
    keywords: ['블랙프라이데이', 'bf세일', '블프'],
    bonus: 7,
    schedule: { type: 'solar', monthDay: [11, 24], leadDays: 21 },
  },

  // ── 계절 (월 기반) ────────────────────────────────────────────────────────
  여름캠핑: {
    keywords: ['캠핑', '텐트', '쿨러', '타프', '그늘막'],
    bonus: 6,
    schedule: { type: 'months', months: [5, 6, 7] },
  },
  겨울캠핑: {
    keywords: ['난로', '방한', '히터', '핫팩', '동계'],
    bonus: 6,
    schedule: { type: 'months', months: [11, 12, 1] },
  },
  환절기: {
    keywords: ['가습기', '공기청정', '제습기'],
    bonus: 4,
    schedule: { type: 'months', months: [3, 4, 9, 10] },
  },
  여름레저: {
    keywords: ['수영', '낚시', '서핑', '물놀이', '수상스키'],
    bonus: 6,
    schedule: { type: 'months', months: [6, 7, 8] },
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 양력 기준으로 [목표 날짜 - leadDays, 목표 날짜] 범위 내인지 확인
 * 연도를 넘어가는 경우(크리스마스 → 1/24) 처리
 */
function isWithinSolarWindow(
  today: Date,
  [targetMonth, targetDay]: [number, number],
  leadDays: number,
): boolean {
  const year = today.getFullYear();
  let target = new Date(year, targetMonth - 1, targetDay);

  // 목표일이 이미 지났으면 내년 기준으로
  if (target < today) {
    target = new Date(year + 1, targetMonth - 1, targetDay);
  }

  const diffDays = Math.floor((target.getTime() - today.getTime()) / 86_400_000);
  return diffDays >= 0 && diffDays <= leadDays;
}

// ─────────────────────────────────────────────────────────────────────────────
// 반환 타입
// ─────────────────────────────────────────────────────────────────────────────

export interface SeasonBonusResult {
  /** 가산점 (최대 10, 1개 시즌만 적용) */
  bonus: number;
  /** 매칭된 시즌 이름 목록 */
  matchedSeasons: string[];
  /** 현재 시즌 활성 여부 */
  activeNow: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// 가산점 계산 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 상품명 + 오늘 날짜 기반 시즌 가산점 계산
 *
 * @param productName 상품명
 * @param today       기준 날짜 (기본값: 오늘)
 *
 * @example
 * getSeasonBonus('크리스마스 양말 선물세트', new Date('2026-12-01'))
 * // → { bonus: 10, matchedSeasons: ['크리스마스'], activeNow: true }
 *
 * getSeasonBonus('여름 캠핑 텐트', new Date('2026-06-15'))
 * // → { bonus: 6, matchedSeasons: ['여름캠핑'], activeNow: true }
 */
export function getSeasonBonus(
  productName: string,
  today: Date = new Date(),
): SeasonBonusResult {
  const name = (productName ?? '').toLowerCase();

  let bestBonus = 0;
  const matchedSeasons: string[] = [];

  for (const [seasonName, cfg] of Object.entries(SEASONS)) {
    // 키워드 매칭
    if (!cfg.keywords.some((kw) => name.includes(kw.toLowerCase()))) continue;

    // 활성화 여부 확인
    let active = false;
    if (cfg.schedule.type === 'months') {
      active = cfg.schedule.months.includes(today.getMonth() + 1);
    } else {
      active = isWithinSolarWindow(today, cfg.schedule.monthDay, cfg.schedule.leadDays);
    }

    if (active) {
      if (cfg.bonus > bestBonus) {
        bestBonus = cfg.bonus;
      }
      matchedSeasons.push(seasonName);
    }
  }

  return {
    bonus: bestBonus,
    matchedSeasons,
    activeNow: bestBonus > 0,
  };
}
