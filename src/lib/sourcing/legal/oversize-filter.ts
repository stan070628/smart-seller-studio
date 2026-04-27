/**
 * Layer: oversize
 *
 * 부피 큰 상품 RED 차단 (쿠팡 로켓그로스 보관료 폭탄 회피)
 * 채널 spec v2 §2.3 — 50cm 변 초과 의심 키워드 매칭
 *
 * 도매꾹 API에 dimension 필드가 없으므로 키워드 기반.
 */

import type { LegalIssue } from './types';

const OVERSIZE_KEYWORDS = [
  // 가구
  '소파', '쇼파', '매트리스', '침대프레임', '책장', '책상',
  '캐비넷', '캐비닛', '서랍장', '옷장', '신발장', '식탁',
  // 운동기구
  '러닝머신', '실내자전거', '벤치프레스', '안마의자',
  // 대형 가전
  '냉장고', '세탁기', '건조기', '에어컨', '식기세척기',
  // 명시적 사이즈
  '대형', '특대형', '초대형', 'XL사이즈', 'XXL사이즈',
  '대용량', // 일부 false positive 가능 — Task 5에서 모니터링
] as const;

export function checkOversize(title: string): LegalIssue | null {
  const lower = title.toLowerCase();
  for (const kw of OVERSIZE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) {
      return {
        layer: 'oversize',
        severity: 'RED',
        code: 'OVERSIZE_ITEM',
        message: `부피 큰 상품 의심: '${kw}' (그로스 보관료 폭탄 우려)`,
        detail: { matched: kw },
      };
    }
  }
  return null;
}
