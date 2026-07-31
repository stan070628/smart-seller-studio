/**
 * 실물 픽스처 회귀 테스트 — 2026-07-26 컬럼비아 민소매 티셔츠 상세페이지 사고.
 *
 * 사고 당시 레이아웃은 (1) beat가 없어 서사 아크가 아니라 스펙 나열이었고,
 * (2) compare 섹션이 없었으며, (3) 원단 섹션의 progress_bar에 측정도 입력도
 * 되지 않은 수치(좌우 신축성 92·땀 흡수 88·건조 속도 85)가 그대로 들어갔다.
 *
 * 이 파일은 그 사고가 현재 구현(narrative.ts / progress-hygiene.ts /
 * layout-validator.ts)에서 실제로 잡히는지, 그리고 고친 레이아웃까지
 * 과잉 차단하지 않는지를 고정한다. 코드 변경은 없다 — 테스트만 추가한다.
 */
import { describe, it, expect } from 'vitest';
import { checkNarrative } from '@/lib/detail-page/narrative';
import { isGroundedProgressItem } from '@/lib/detail-page/progress-hygiene';
import { validateProLayout, sanitizeProLayout } from '@/lib/detail-page/layout-validator';

/**
 * 사고 당시 형태의 9섹션 레이아웃.
 * 순서: 히어로 → 원단 → 등판그래픽 → 컬러 → 사이즈 → 디테일 → 용도 → 세탁 → 제품정보
 * beat 필드 없음, compare 섹션 없음. 원단(인덱스 1)에 근거 없는 progress_bar 3항목.
 */
function incidentSections(): unknown[] {
  const titles = [
    '히어로', '원단', '등판그래픽', '컬러', '사이즈',
    '디테일', '용도', '세탁', '제품정보',
  ];
  return titles.map((title, i) => ({
    type: 'claude_layout',
    title,
    blocks:
      i === 1
        ? [
            { type: 'heading', text: title, size: 'xl' },
            {
              type: 'progress_bar',
              items: [
                { label: '좌우 신축성', value: 92, displayValue: '높음' },
                { label: '땀 흡수·확산', value: 88, displayValue: 'Omni-Wick' },
                { label: '건조 속도', value: 85, displayValue: '빠름' },
              ],
            },
          ]
        : [{ type: 'heading', text: title, size: 'xl' }],
    bgStyle: 'white',
  }));
}

/** 생성 경로(route.ts)와 동일한 옵션. 실제 입력에는 이 수치들이 없었다 — 사이즈 정보만 있었다. */
const GEN_OPTS = {
  statHygiene: true,
  narrative: true,
  provenanceSource: 'Columbia Omni-Wick 민소매 오버핏 M(95) L(100) XL(105) XXL(110)',
};

describe('민소매 실물 픽스처 — 2026-07-26 사고 레이아웃 회귀', () => {
  it('beat 누락이 섹션마다 narrative 위반(beat_missing)으로 검출된다', () => {
    const issues = checkNarrative(incidentSections() as any);
    const beatMissing = issues.filter((i) => i.rule === 'beat_missing');
    expect(beatMissing).toHaveLength(9);
  });

  it('compare 섹션 부재가 compare_missing으로 검출된다', () => {
    const issues = checkNarrative(incidentSections() as any);
    expect(issues.some((i) => i.rule === 'compare_missing')).toBe(true);
  });

  it('생성 경로 옵션으로 검증하면 isClean=false라 repair가 트리거된다', () => {
    const res = validateProLayout(incidentSections(), GEN_OPTS);
    expect(res.isClean).toBe(false);
    // narrative 위반이 error로 잡혀 있어야 repair 조건(isClean===false)이 narrative 때문임을 확인
    expect(
      res.violations.some((v) => v.code === 'narrative' && v.severity === 'error'),
    ).toBe(true);
  });

  it('근거 없는 progress_bar 3항목이 전부 제거되고 블록 자체가 사라진다', () => {
    const { sections } = sanitizeProLayout(incidentSections(), GEN_OPTS);
    const fabricSection = sections[1] as { blocks: Array<{ type: string }> };
    expect(fabricSection.blocks.some((b) => b.type === 'progress_bar')).toBe(false);
  });

  it('92·88·85이 sanitize 결과물 어디에도 남지 않는다 (핵심 단언)', () => {
    const { sections } = sanitizeProLayout(incidentSections(), GEN_OPTS);
    const json = JSON.stringify(sections);
    expect(json).not.toContain('92');
    expect(json).not.toContain('88');
    expect(json).not.toContain('85');
  });
});

describe('사고가 다른 표기로 재현되는 경우 — 퍼센트 특례 방어', () => {
  const source = GEN_OPTS.provenanceSource;

  it('퍼센트 표기(92%)는 소스에 92도 92%도 없으므로 막힌다', () => {
    expect(
      isGroundedProgressItem({ label: '좌우 신축성', value: 92, displayValue: '92%' }, source),
    ).toBe(false);
  });

  it(
    '숫자 95는 소스에 사이즈로 존재하지만(M(95)) "95%"라는 퍼센트 표기는 ' +
      '소스에 없으므로 막힌다 — 퍼센트 특례가 없으면 통과해버리는 케이스',
    () => {
      // 한국 의류 입력의 숫자 대역(사이즈 95/100/105/110)과 progress_bar가
      // 지어내는 퍼센트 대역이 겹치기 때문에 만든 방어다. 순수 숫자 대조만
      // 했다면 사이즈 95가 "신축성 95%"를 정당화해버렸을 것이다.
      expect(
        isGroundedProgressItem({ label: '좌우 신축성', value: 95, displayValue: '95%' }, source),
      ).toBe(false);
    },
  );

  it('통합 경로: 두 변형 모두 sanitizeProLayout에서 제거된다', () => {
    const secs = [
      {
        type: 'claude_layout',
        title: '원단',
        blocks: [
          {
            type: 'progress_bar',
            items: [
              { label: '좌우 신축성', value: 92, displayValue: '92%' },
              { label: '좌우 신축성2', value: 95, displayValue: '95%' },
            ],
          },
        ],
        bgStyle: 'white',
      },
    ];
    const { sections } = sanitizeProLayout(secs, GEN_OPTS);
    expect((sections[0] as any).blocks).toHaveLength(0);
  });
});

describe('provenanceSource가 빈 문자열인 경로 (productInfo.points 미입력 — 실사용 경로)', () => {
  it(
    '이것은 버그가 아니라 의도된 트레이드오프다: points가 비면 route.ts가 ' +
      "provenanceSource=''를 넘기고, 게이트는 `!== undefined`이므로 위생은 켜진 채 " +
      '정당한 실측치(180g/30초)까지 전부 근거 없음으로 제거된다',
    () => {
      const secs = [
        {
          type: 'claude_layout',
          title: '소재',
          blocks: [
            {
              type: 'progress_bar',
              items: [
                { label: '무게', value: 70, displayValue: '180g' },
                { label: '건조', value: 60, displayValue: '30초' },
              ],
            },
          ],
          bgStyle: 'white',
        },
      ];
      const { sections } = sanitizeProLayout(secs, { statHygiene: true, provenanceSource: '' });
      expect((sections[0] as any).blocks).toHaveLength(0);
    },
  );
});

/**
 * 사고 레이아웃을 서사에 맞게 고친 버전.
 * beat 배정 + compare 섹션(columns 2단) 추가 + 근거 있는 수치(무게 180g/건조 30초).
 * 막는 것만 테스트하면 과잉 차단을 못 잡으므로, 고친 레이아웃이 통과하는지도 고정한다.
 */
function fixedSections(): unknown[] {
  return [
    {
      type: 'claude_layout',
      title: '히어로',
      beat: 'hook',
      blocks: [{ type: 'heading', text: '히어로', size: 'xl' }],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '원단',
      beat: 'evidence',
      blocks: [
        { type: 'heading', text: '원단', size: 'xl' },
        {
          type: 'progress_bar',
          items: [
            { label: '무게', value: 70, displayValue: '180g' },
            { label: '건조', value: 60, displayValue: '30초' },
          ],
        },
      ],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '등판그래픽',
      beat: 'detail',
      blocks: [{ type: 'heading', text: '등판그래픽', size: 'xl' }],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '비교',
      beat: 'compare',
      blocks: [
        {
          type: 'columns',
          cols: [
            [{ type: 'subtext', text: '일반 나일론 소재' }],
            [{ type: 'subtext', text: '옴니윅 소재' }],
          ],
        },
      ],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '컬러',
      beat: 'option',
      blocks: [{ type: 'heading', text: '컬러', size: 'xl' }],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '사이즈',
      beat: 'option',
      blocks: [{ type: 'heading', text: '사이즈', size: 'xl' }],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '디테일',
      beat: 'detail',
      blocks: [{ type: 'heading', text: '디테일', size: 'xl' }],
      bgStyle: 'white',
    },
    {
      type: 'claude_layout',
      title: '세탁',
      beat: 'assure',
      blocks: [{ type: 'heading', text: '세탁', size: 'xl' }],
      bgStyle: 'white',
    },
  ];
}

const FIXED_OPTS = {
  statHygiene: true,
  narrative: true,
  provenanceSource:
    'Columbia Omni-Wick 민소매 오버핏 M(95) L(100) XL(105) XXL(110) 무게 180g 건조 30초',
};

describe('고쳐진 레이아웃 — 막는 것만이 아니라 통과도 확인 (과잉 차단 방지)', () => {
  it('beat 배정 + compare 섹션 + 근거 있는 수치를 갖추면 error 없이 통과한다', () => {
    const res = validateProLayout(fixedSections(), FIXED_OPTS);
    const errors = res.violations.filter((v) => v.severity === 'error');
    expect(errors).toEqual([]);
    expect(res.isClean).toBe(true);
  });

  it('sanitize를 거쳐도 근거 있는 수치(180g/30초)는 살아남는다', () => {
    const { sections } = sanitizeProLayout(fixedSections(), FIXED_OPTS);
    const fabric = sections[1] as { blocks: Array<{ type: string; items?: unknown[] }> };
    const progress = fabric.blocks.find((b) => b.type === 'progress_bar');
    expect(progress).toBeDefined();
    expect((progress as { items?: unknown[] }).items).toHaveLength(2);
  });
});
