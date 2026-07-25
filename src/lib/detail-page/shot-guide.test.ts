import { describe, it, expect } from 'vitest';
import { extractDetailCloseupShots, serializeShotChecklist, parseShotGuideResponse } from './shot-guide';
import type { ShotCard } from '@/types/shot-guide';

describe('extractDetailCloseupShots', () => {
  it('detail_closeup 슬롯만 뽑고 섹션 제목/힌트를 매핑한다', () => {
    const sections = [
      { title: '디테일', imageSlots: [
        { slotType: 'detail_closeup', promptHint: '지퍼 접사' },
        { slotType: 'flux_lifestyle', promptHint: '침대 위 연출' },
      ]},
      { title: '옵션', imageSlots: [{ slotType: 'product_nukki', promptHint: '단독컷' }] },
      { title: '디테일2', imageSlots: [{ slotType: 'detail_closeup', promptHint: '원단 텍스처' }] },
    ];
    const out = extractDetailCloseupShots(sections);
    expect(out).toEqual([
      { sectionIndex: 0, slotIndex: 0, sectionTitle: '디테일', promptHint: '지퍼 접사' },
      { sectionIndex: 2, slotIndex: 0, sectionTitle: '디테일2', promptHint: '원단 텍스처' },
    ]);
  });
  it('슬롯/섹션이 비어도 안전하다', () => {
    expect(extractDetailCloseupShots([])).toEqual([]);
    expect(extractDetailCloseupShots([{ title: 'x' } as any])).toEqual([]);
  });
});

describe('serializeShotChecklist', () => {
  it('카드 필드를 텍스트 체크리스트로 만든다', () => {
    const cards: ShotCard[] = [{ sectionTitle: '디테일', subject: '지퍼', angle: '정면 45도',
      framing: '매크로', lighting: '창가 자연광', background: '무지 화이트', tip: '손떨림 주의' }];
    const txt = serializeShotChecklist(cards);
    expect(txt).toContain('지퍼');
    expect(txt).toContain('구도·각도: 정면 45도');
    expect(txt).toContain('배경: 무지 화이트');
  });
  it('빈 배열이면 안내 문구', () => {
    expect(serializeShotChecklist([])).toContain('촬영할');
  });
});

describe('parseShotGuideResponse', () => {
  it('코드펜스/잡텍스트가 섞여도 첫 JSON 배열을 파싱한다', () => {
    const text = '```json\n[{"sectionTitle":"디테일","subject":"지퍼","angle":"a","framing":"매크로","lighting":"l","background":"b","tip":"t"}]\n```';
    const cards = parseShotGuideResponse(text);
    expect(cards).toHaveLength(1);
    expect(cards[0].subject).toBe('지퍼');
    expect(cards[0].framing).toBe('매크로');
  });
  it('파싱 불가/비배열이면 빈 배열', () => {
    expect(parseShotGuideResponse('없음')).toEqual([]);
    expect(parseShotGuideResponse('{"a":1}')).toEqual([]);
  });
});

import { countUploaded } from './shot-guide';
describe('countUploaded', () => {
  it('업로드된 슬롯 수를 센다', () => {
    expect(countUploaded([{ sectionIndex:0, slotIndex:0, uploadedUrl:'u' }, { sectionIndex:1, slotIndex:0, uploadedUrl:null }])).toBe(1);
    expect(countUploaded([])).toBe(0);
  });
});
