import type { ShotCard, ShotGuideInput } from '@/types/shot-guide';

type LooseSection = { title?: string; imageSlots?: Array<{ slotType?: string; promptHint?: string }> };

/** generatedSections에서 detail_closeup 슬롯만 추출. */
export function extractDetailCloseupShots(sections: LooseSection[]): ShotGuideInput[] {
  const out: ShotGuideInput[] = [];
  for (const s of sections ?? []) {
    for (const slot of s?.imageSlots ?? []) {
      if (slot?.slotType === 'detail_closeup') {
        out.push({ sectionTitle: s.title ?? '(제목 없음)', promptHint: slot.promptHint ?? '' });
      }
    }
  }
  return out;
}

/** ShotCard[] → 폰으로 보며 촬영할 텍스트 체크리스트. */
export function serializeShotChecklist(cards: ShotCard[]): string {
  if (!cards.length) return '촬영할 디테일 컷이 없습니다.';
  const lines: string[] = ['📸 상세페이지 촬영 가이드', ''];
  cards.forEach((c, i) => {
    lines.push(`## ${i + 1}. ${c.subject}  [${c.sectionTitle}]`);
    lines.push(`- [ ] 구도·각도: ${c.angle}`);
    lines.push(`- [ ] 프레이밍: ${c.framing}`);
    lines.push(`- [ ] 조명: ${c.lighting}`);
    lines.push(`- [ ] 배경: ${c.background}`);
    lines.push(`- 팁: ${c.tip}`);
    lines.push('');
  });
  return lines.join('\n');
}

/** Claude 응답 텍스트 → ShotCard[] (코드펜스 무관, 첫 '[' ~ 마지막 ']'). */
export function parseShotGuideResponse(text: string): ShotCard[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  let arr: unknown;
  try { arr = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map(x => ({
      sectionTitle: String(x.sectionTitle ?? ''),
      subject: String(x.subject ?? ''),
      angle: String(x.angle ?? ''),
      framing: String(x.framing ?? ''),
      lighting: String(x.lighting ?? ''),
      background: String(x.background ?? ''),
      tip: String(x.tip ?? ''),
    }));
}
