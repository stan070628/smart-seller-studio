// src/__tests__/lib/erp/sku/report.test.ts
import { describe, it, expect } from 'vitest';
import { renderReport } from '@/lib/erp/sku/report';
import type { Draft } from '@/lib/erp/sku/draft';

const draft: Draft = {
  skus: [
    { key: 'cp:100:', name: '다슈 왁스', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: ['pc-dasu'] },
    { key: 'cp:200:블랙', name: '콜맨 왜건', optionLabel: '블랙', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
  ],
  listings: [
    { key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '100', label: '다슈 왁스 · 1개', linkMode: 'single', pairKey: 'coupang_rg|21|' },
    { key: 'coupang_rg|21|', channel: 'coupang_rg', externalProductId: '21', externalOptionKey: '', altProductId: '100', label: '다슈 왁스 · 1개', linkMode: 'single', pairKey: 'coupang_wing|11|' },
    { key: 'coupang_wing|12|', channel: 'coupang_wing', externalProductId: '12', externalOptionKey: '', altProductId: '100', label: '다슈 왁스 · 2개', linkMode: 'single' },
    { key: 'naver|900|5001', channel: 'naver', externalProductId: '900', externalOptionKey: '5001', altProductId: null, label: '왜건 · 블랙', linkMode: 'single' },
  ],
  links: [
    { listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 },
    { listingKey: 'coupang_rg|21|', skuKey: 'cp:100:', multiplier: 1 },
    { listingKey: 'coupang_wing|12|', skuKey: 'cp:100:', multiplier: 2 },
    { listingKey: 'naver|900|5001', skuKey: 'cp:200:블랙', multiplier: 1 },
  ],
  issues: [
    { kind: 'legacy_multiplier_mismatch', ref: 'coupang_wing|12|', detail: '레거시 배수 3 / 초안 배수 2' },
    { kind: 'multi_vid_listing', ref: 'naver|901|', detail: '쿠팡 옵션 2개' },
  ],
};

describe('renderReport', () => {
  const md = renderReport(draft, { date: '2026-09-26', notes: ['네이버 판매 가져오기가 흰티만 잡는다'] });

  it('제목과 요약 수치를 싣는다', () => {
    expect(md).toContain('# SKU 마스터 점검 보고서 2026-09-26');
    expect(md).toMatch(/SKU \| 2/);
    expect(md).toMatch(/리스팅 \| 4/);
  });

  it('판단이 필요한 이슈를 정보성 이슈보다 먼저 싣고 종류별로 묶는다', () => {
    expect(md.indexOf('레거시 배수와 다름')).toBeLessThan(md.indexOf('같은 SKU의 수량 옵션 여러 개가 붙은 채널 리스팅'));
  });

  it('[재검토 2] 리스팅 키인 ref는 코드 스팬으로 감싼다', () => {
    expect(md).toContain('| `coupang_wing\\|12\\|` | 레거시 배수 3 / 초안 배수 2 |');
  });

  it('[재검토 2] SKU마다 연결된 리스팅을 overrides에 그대로 쓸 수 있는 키·라벨·배수로 보여준다', () => {
    expect(md).toContain('`cp:100:`');
    // Wing·RG 짝은 한 줄로 묶는다.
    expect(md).toContain('`coupang_wing\\|11\\|` + `coupang_rg\\|21\\|` 다슈 왁스 · 1개 ×1');
    // 짝이 없는 리스팅은 단독으로.
    expect(md).toContain('`coupang_wing\\|12\\|` 다슈 왁스 · 2개 ×2');
  });

  it('운영 메모를 싣는다', () => {
    expect(md).toContain('네이버 판매 가져오기가 흰티만 잡는다');
  });
});

describe('renderReport — linkMode 표시', () => {
  it('single이 아닌 리스팅은 배수 뒤에 linkMode를 덧붙인다', () => {
    const draftWithAnyOf: Draft = {
      skus: [
        { key: 'cp:100:', name: '다슈 왁스', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
      ],
      listings: [
        { key: 'naver|950|x', channel: 'naver', externalProductId: '950', externalOptionKey: 'x', altProductId: null, label: '다슈 · any_of', linkMode: 'any_of' },
      ],
      links: [{ listingKey: 'naver|950|x', skuKey: 'cp:100:', multiplier: 1 }],
      issues: [],
    };
    const md = renderReport(draftWithAnyOf, { date: '2026-09-26', notes: [] });
    expect(md).toContain('`naver\\|950\\|x` 다슈 · any_of ×1 [any_of]');
  });

  it('linkMode가 single이면 덧붙이지 않는다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).not.toContain('[single]');
  });
});

describe('renderReport — legacy_duplicate는 정보성(⚪)이다', () => {
  it('[재검토 4] 🔴가 아니라 ⚪로 표시하고 판단 필요 이슈 수에 넣지 않는다', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'legacy_duplicate', ref: 'pc-dup1,pc-dup2', detail: '이름과 seller_product_id가 같은 product_cost가 여러 개다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('⚪ 옛 원가 행 중복');
    expect(md).not.toContain('🔴 옛 원가 행 중복');
    expect(md).toMatch(/판단 필요 이슈 \| 0/);
    expect(md).toMatch(/정보성 이슈 \| 1/);
  });
});

describe('renderReport — overrides 예시', () => {
  it('[재검토 2] legacy_multiplier_mismatch에 setMultiplier 예시를 싣는다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).toContain('> overrides 예시: `{"setMultiplier": [{"listingKey": "coupang_wing|12|", "skuKey": "cp:100:", "multiplier": <배수>}]}`');
  });

  it('[재검토 2] uneven_multiplier에 setMultiplier 예시를 싣는다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:1:', name: 'p', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] }],
      listings: [{ key: 'coupang_wing|2|', channel: 'coupang_wing', externalProductId: '2', externalOptionKey: '', altProductId: '1', label: 'p · 3개', linkMode: 'single' }],
      links: [{ listingKey: 'coupang_wing|2|', skuKey: 'cp:1:', multiplier: 3 }],
      issues: [{ kind: 'uneven_multiplier', ref: 'cp:1:', detail: '수량 2/3 — 배수를 원래 수량으로 두었다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('> overrides 예시: `{"setMultiplier": [{"listingKey": "coupang_wing|2|", "skuKey": "cp:1:", "multiplier": <배수>}]}`');
  });

  it('[재검토 2] channel_quantity_mismatch에 setMultiplier 예시를 싣는다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:100:', name: 'p', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] }],
      listings: [{ key: 'toss|801|3개', channel: 'toss', externalProductId: '801', externalOptionKey: '3개', altProductId: null, label: '토스', linkMode: 'single' }],
      links: [{ listingKey: 'toss|801|3개', skuKey: 'cp:100:', multiplier: 3 }],
      issues: [{ kind: 'channel_quantity_mismatch', ref: 'toss|801|3개', detail: '토스 옵션 수량 3 / 쿠팡 수량 2' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('> overrides 예시: `{"setMultiplier": [{"listingKey": "toss|801|3개", "skuKey": "cp:100:", "multiplier": <배수>}]}`');
  });

  it('[재검토 2] sync_link_unresolved에 excludeListings 예시를 싣는다', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'sync_link_unresolved', ref: 'naver|902|', detail: '쿠팡 vid 99를 초안에서 찾지 못했다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('> overrides 예시: `{"excludeListings": ["naver|902|"]}`');
  });

  it('[재검토 I-3] legacy_spans_skus 예시는 자리표시자만 싣는다(실제 SKU 키를 추정하지 않는다)', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'legacy_spans_skus', ref: 'pc-wagon', detail: 'SKU cp:200:블랙, cp:200:레드에 걸친다 — 입고 lot을 옵션별로 나눌 수 없어 기초 재고는 실사로 잡는다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('> overrides 예시: `{"mergeSkus": [["<SKU 키 1>", "<SKU 키 2>"]]}`');
    expect(md).toContain('대부분 조치 불필요');
    expect(md).toContain('같은 실물인데 SKU가 잘못 갈렸을 때만 병합한다(예: 1개입/2개입).');
  });

  it('[재검토 2] suspect_merge에 splitListing 예시(Wing·RG 둘 다)를 싣는다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:601:블랙', name: 'x', optionLabel: '블랙', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] }],
      listings: [
        { key: 'coupang_wing|611|', channel: 'coupang_wing', externalProductId: '611', externalOptionKey: '', altProductId: '601', label: 'x · 블랙 1개', linkMode: 'single', pairKey: 'coupang_rg|621|' },
        { key: 'coupang_rg|621|', channel: 'coupang_rg', externalProductId: '621', externalOptionKey: '', altProductId: '601', label: 'x · 블랙 1개', linkMode: 'single', pairKey: 'coupang_wing|611|' },
      ],
      links: [
        { listingKey: 'coupang_wing|611|', skuKey: 'cp:601:블랙', multiplier: 1 },
        { listingKey: 'coupang_rg|621|', skuKey: 'cp:601:블랙', multiplier: 1 },
      ],
      issues: [{ kind: 'suspect_merge', ref: 'cp:601:블랙', detail: "itemName 잔여 [블랙, 네이비] · 수량 [1,2] — 서로 다른 실물일 수 있다" }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain(
      '> overrides 예시: `{"splitListing": [{"listingKey": "coupang_wing|611|", "toSkuKey": "<새 SKU 키>"}, {"listingKey": "coupang_rg|621|", "toSkuKey": "<새 SKU 키>"}]}`',
    );
  });

  it('사람 판단이 필요한 종류(sale_attribution_mismatch 등)에는 예시를 만들지 않는다', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'sale_attribution_mismatch', ref: 'coupang_wing|32|', detail: '판매 2행은 pc-dasu, 매핑은 pc-wagon' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).not.toContain('overrides 예시');
  });
});

describe('renderReport — I-2: 짝 묶음은 배수가 같을 때만', () => {
  it('Wing·RG 짝이 같은 SKU라도 배수가 다르면 한 줄로 묶지 않고 따로 보여준다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:100:', name: '다슈 왁스', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] }],
      listings: [
        { key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '100', label: '다슈 왁스 · 1개', linkMode: 'single', pairKey: 'coupang_rg|21|' },
        { key: 'coupang_rg|21|', channel: 'coupang_rg', externalProductId: '21', externalOptionKey: '', altProductId: '100', label: '다슈 왁스 · 1개', linkMode: 'single', pairKey: 'coupang_wing|11|' },
      ],
      links: [
        { listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 },
        { listingKey: 'coupang_rg|21|', skuKey: 'cp:100:', multiplier: 2 },
      ],
      issues: [],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).not.toContain('+');
    expect(md).toContain('`coupang_wing\\|11\\|` 다슈 왁스 · 1개 ×1');
    expect(md).toContain('`coupang_rg\\|21\\|` 다슈 왁스 · 1개 ×2');
  });
});

describe('renderReport — M-3: 판단 필요 이슈 표의 보정 예시 열', () => {
  it('[재검토] legacy_multiplier_mismatch는 초안 배수가 아니라 detail의 레거시 배수를 넣는다 — 그대로 붙이면 옛 매핑을 따르는 선택이 된다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).toContain('| `coupang_wing\\|12\\|` | 레거시 배수 3 / 초안 배수 2 | `{"setMultiplier": [{"listingKey": "coupang_wing|12|", "skuKey": "cp:100:", "multiplier": 3}]}` |');
  });

  it('[재검토] legacy_multiplier_mismatch의 detail에서 레거시 배수를 못 찾으면 자리표시자를 넣는다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:100:', name: 'p', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] }],
      listings: [{ key: 'coupang_wing|12|', channel: 'coupang_wing', externalProductId: '12', externalOptionKey: '', altProductId: '100', label: 'p', linkMode: 'single' }],
      links: [{ listingKey: 'coupang_wing|12|', skuKey: 'cp:100:', multiplier: 2 }],
      issues: [{ kind: 'legacy_multiplier_mismatch', ref: 'coupang_wing|12|', detail: '배수 정보를 파싱할 수 없다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('| `coupang_wing\\|12\\|` | 배수 정보를 파싱할 수 없다 | `{"setMultiplier": [{"listingKey": "coupang_wing|12|", "skuKey": "cp:100:", "multiplier": "<정할 배수>"}]}` |');
  });

  it('[재검토] uneven_multiplier·channel_quantity_mismatch는 현재 값이 아니라 자리표시자를 넣는다 — 같은 값이면 무의미하다', () => {
    const d: Draft = {
      skus: [
        { key: 'cp:1:', name: 'p', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
        { key: 'cp:100:', name: 'q', optionLabel: '', baseUnitLabel: null, status: 'active', legacyProductCostIds: [] },
      ],
      listings: [
        { key: 'coupang_wing|2|', channel: 'coupang_wing', externalProductId: '2', externalOptionKey: '', altProductId: '1', label: 'p · 3개', linkMode: 'single' },
        { key: 'toss|801|3개', channel: 'toss', externalProductId: '801', externalOptionKey: '3개', altProductId: null, label: '토스', linkMode: 'single' },
      ],
      links: [
        { listingKey: 'coupang_wing|2|', skuKey: 'cp:1:', multiplier: 3 },
        { listingKey: 'toss|801|3개', skuKey: 'cp:100:', multiplier: 3 },
      ],
      issues: [
        { kind: 'uneven_multiplier', ref: 'cp:1:', detail: '수량 2/3 — 배수를 원래 수량으로 두었다' },
        { kind: 'channel_quantity_mismatch', ref: 'toss|801|3개', detail: '토스 옵션 수량 3 / 쿠팡 수량 2' },
      ],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('| cp:1: | 수량 2/3 — 배수를 원래 수량으로 두었다 | `{"setMultiplier": [{"listingKey": "coupang_wing|2|", "skuKey": "cp:1:", "multiplier": "<정할 배수>"}]}` |');
    expect(md).toContain('| `toss\\|801\\|3개` | 토스 옵션 수량 3 / 쿠팡 수량 2 | `{"setMultiplier": [{"listingKey": "toss|801|3개", "skuKey": "cp:100:", "multiplier": "<정할 배수>"}]}` |');
  });

  it('excludeListings 대상 종류는 그 키를 넣는다', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'sync_link_unresolved', ref: 'naver|902|', detail: '쿠팡 vid 99를 초안에서 찾지 못했다' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('| `naver\\|902\\|` | 쿠팡 vid 99를 초안에서 찾지 못했다 | `{"excludeListings": ["naver|902|"]}` |');
  });

  it('예시가 없는 종류는 대상 열에 —를 넣는다', () => {
    const d: Draft = {
      skus: [],
      listings: [],
      links: [],
      issues: [{ kind: 'sale_attribution_mismatch', ref: 'coupang_wing|32|', detail: '판매 2행은 pc-dasu, 매핑은 pc-wagon' }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).toContain('| `coupang_wing\\|32\\|` | 판매 2행은 pc-dasu, 매핑은 pc-wagon | — |');
  });
});

describe('renderReport — M-2/M-4: 머리말', () => {
  it('쿠팡 승인완료(APPROVED) 상품 기준임을 밝힌다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).toContain('쿠팡 승인완료(APPROVED) 상품 기준');
  });

  it('표 안의 키는 Obsidian 미리보기에서 복사하라고 안내한다', () => {
    const md = renderReport(draft, { date: '2026-09-26', notes: [] });
    expect(md).toContain('표 안의 키는 Obsidian 미리보기 화면에서 복사한다(원문에는 \\|가 섞인다).');
  });
});

describe('renderReport — esc', () => {
  it('[재검토 3] 개행은 공백으로, 백틱은 작은따옴표로 바꾼다', () => {
    const d: Draft = {
      skus: [{ key: 'cp:1:', name: '이름\n줄바꿈', optionLabel: '옵션`백틱`', baseUnitLabel: '단위\n줄', status: 'active', legacyProductCostIds: [] }],
      listings: [],
      links: [],
      issues: [{ kind: 'quantity_invalid', ref: 'cp:1:', detail: "detail\n에도 적용된다 `code`" }],
    };
    const md = renderReport(d, { date: '2026-09-26', notes: [] });
    expect(md).not.toMatch(/이름\n줄바꿈/);
    expect(md).toContain('이름 줄바꿈');
    expect(md).toContain("옵션'백틱'");
    expect(md).toContain('단위 줄');
    expect(md).toContain("detail 에도 적용된다 'code'");
  });
});
