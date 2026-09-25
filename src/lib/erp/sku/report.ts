// src/lib/erp/sku/report.ts
import type { Draft, DraftIssue, DraftListing, IssueKind } from './draft';

const LABEL: Record<IssueKind, { title: string; decide: boolean; hint: string }> = {
  legacy_multiplier_mismatch: { title: '레거시 배수와 다름', decide: true, hint: 'setMultiplier로 맞는 배수를 정한다. 기준 단위(baseUnit)도 함께 적는다' },
  uneven_multiplier: { title: '수량이 나누어떨어지지 않음', decide: true, hint: '기준 단위를 정하고 setMultiplier로 배수를 준다' },
  legacy_spans_skus: { title: '옛 원가 행이 SKU 여러 개에 걸침', decide: true, hint: '입고 lot을 옵션별로 못 나눈다 — 재고 이관 단계에서 기초 재고를 실사로 잡는다. 틀린 병합이면 mergeSkus로 합친다' },
  sale_attribution_mismatch: { title: '판매 귀속과 현재 매핑이 다름', decide: true, hint: '어느 쪽이 맞는지 확인한다(옵션 색상·사이즈 오매핑 의심)' },
  legacy_duplicate: { title: '옛 원가 행 중복', decide: false, hint: '빈 행이면 무시해도 된다. 이관은 SKU 기준이라 영향 없음' },
  sync_link_unresolved: { title: '품절 동기화 연결을 찾지 못함', decide: true, hint: '판매 종료 상품이면 excludeListings에 넣는다' },
  legacy_listing_unresolved: { title: '옛 매핑의 쿠팡 옵션이 현재 상품에 없음', decide: false, hint: '판매 종료·삭제 옵션. 과거 판매 대조용으로만 남는다' },
  multi_vid_listing: { title: '같은 SKU의 수량 옵션 여러 개가 붙은 채널 리스팅', decide: false, hint: '네이버 단일상품에 수량만 다른 쿠팡 옵션 여러 개. 최소 배수를 적용했다' },
  any_of_listing: {
    title: '여러 SKU 중 하나를 파는 채널 리스팅',
    decide: false,
    hint: '재고 전송은 연결된 SKU별로 (가용 재고 ÷ 배수)를 내림해 합한 값, 판매 SKU는 주문 옵션으로 가리고 옵션이 없으면(네이버 단일상품) 수동 귀속 대기열로 보낸다(주문 수집 단계)',
  },
  channel_quantity_mismatch: { title: '채널 옵션 수량이 쿠팡과 다름', decide: true, hint: 'setMultiplier로 채널 배수를 정한다. 토스 옵션명에 수량이 없으면 쿠팡 단위를 그대로 판다고 보고 무시해도 된다' },
  legacy_vid_multi_mapped: { title: '쿠팡 옵션 하나를 옛 원가 행 여러 개가 가리킴', decide: true, hint: '어느 행이 맞는지 확인(흰티 M/L 병합 의심 등)' },
  suspect_merge: { title: '서로 다른 실물이 한 SKU로 묶였을 수 있음', decide: true, hint: '같은 쿠팡 옵션의 Wing·RG 리스팅을 함께 splitListing으로 떼어낸다' },
  quantity_invalid: { title: '수량 0', decide: true, hint: '옵션명을 확인한다' },
};

/**
 * 표 셀 안에서 안전하게 쓰도록 다듬는다. `|`는 표 열을 깨고 개행은 셀을 깨므로 공백으로,
 * 백틱은 코드 스팬과 충돌하니 작은따옴표로 바꾼다. 코드 스팬(백틱) 안에 넣는 값에도 그대로
 * 적용한다 — 마크다운으로 렌더링되면 `\|`는 다시 `|`로 보이므로 overrides에 그대로 붙여 넣을 수
 * 있는 원래 값처럼 보인다.
 */
const esc = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");

const LISTING_KEY_RE = /^(coupang_wing|coupang_rg|naver|toss)\|/;
/** 이슈 표의 대상(ref)이 리스팅 키 형태면 코드 스팬으로 감싼다 — overrides에 그대로 쓸 수 있게. */
const refCell = (ref: string) => (LISTING_KEY_RE.test(ref) ? `\`${esc(ref)}\`` : esc(ref));

/**
 * 판단이 필요한 이슈 종류 중 overrides 형태가 뻔한 것만 그대로 붙여 넣을 수 있는 한 줄 예시를 만든다.
 * 사람 판단이 필요한 종류(sale_attribution_mismatch·legacy_vid_multi_mapped·quantity_invalid)는
 * 만들지 않는다 — 뻔한 정답이 없다.
 * 표에 넣지 않는 순수 JSON 문자열이므로 esc를 적용하지 않는다 — 그대로 복사해 쓸 수 있어야 한다.
 */
function overrideExample(kind: IssueKind, row: DraftIssue, d: Draft, listingByKey: Map<string, DraftListing>): string | undefined {
  const skuOfListing = (listingKey: string) => d.links.find((l) => l.listingKey === listingKey)?.skuKey;
  switch (kind) {
    case 'legacy_multiplier_mismatch':
    case 'channel_quantity_mismatch': {
      const skuKey = skuOfListing(row.ref) ?? '<SKU 키>';
      return `{"setMultiplier": [{"listingKey": "${row.ref}", "skuKey": "${skuKey}", "multiplier": <배수>}]}`;
    }
    case 'uneven_multiplier': {
      const listingKeyForSku = d.links.find((l) => l.skuKey === row.ref)?.listingKey ?? '<리스팅 키>';
      return `{"setMultiplier": [{"listingKey": "${listingKeyForSku}", "skuKey": "${row.ref}", "multiplier": <배수>}]}`;
    }
    case 'sync_link_unresolved':
      return `{"excludeListings": ["${row.ref}"]}`;
    case 'legacy_spans_skus': {
      const m = row.detail.match(/^SKU (.+?)에 걸친다/);
      const keys = (m?.[1] ?? '').split(', ').filter(Boolean);
      return `{"mergeSkus": [["${keys[0] ?? '<SKU 키 1>'}", "${keys[1] ?? '<SKU 키 2>'}"]]}`;
    }
    case 'suspect_merge': {
      const wingListingKey = d.links.find((l) => l.skuKey === row.ref && listingByKey.get(l.listingKey)?.channel === 'coupang_wing')?.listingKey;
      const wing = wingListingKey ? listingByKey.get(wingListingKey) : undefined;
      const rg = wing?.pairKey ? listingByKey.get(wing.pairKey) : undefined;
      const entries = [wing, rg]
        .filter((x): x is DraftListing => !!x)
        .map((l) => `{"listingKey": "${l.key}", "toSkuKey": "<새 SKU 키>"}`);
      return entries.length ? `{"splitListing": [${entries.join(', ')}]}` : undefined;
    }
    default:
      return undefined;
  }
}

export function renderReport(d: Draft, opts: { date: string; notes: string[] }): string {
  const listingByKey = new Map(d.listings.map((l) => [l.key, l]));
  const out: string[] = [];
  out.push(`# SKU 마스터 점검 보고서 ${opts.date}`, '');
  out.push('> 이 보고서를 확인하고 정할 것을 `docs/erp/sku-overrides.json`에 적은 뒤 적재한다(계획 1-A Task 6~7).', '');
  out.push('| 항목 | 수 |', '|---|---:|');
  out.push(`| SKU | ${d.skus.length} |`, `| 리스팅 | ${d.listings.length} |`, `| 연결 | ${d.links.length} |`);
  out.push(`| 판단 필요 이슈 | ${d.issues.filter((i) => LABEL[i.kind].decide).length} |`, `| 정보성 이슈 | ${d.issues.filter((i) => !LABEL[i.kind].decide).length} |`, '');

  const kinds = (Object.keys(LABEL) as IssueKind[]).sort((a, b) => Number(LABEL[b].decide) - Number(LABEL[a].decide));
  out.push('## 정할 것', '');
  for (const k of kinds) {
    const rows = d.issues.filter((i) => i.kind === k);
    if (!rows.length) continue;
    out.push(`### ${LABEL[k].decide ? '🔴' : '⚪'} ${LABEL[k].title} (${rows.length})`, '', `> ${LABEL[k].hint}`, '');
    if (LABEL[k].decide) {
      const example = overrideExample(k, rows[0], d, listingByKey);
      if (example) out.push(`> overrides 예시: \`${example}\``, '');
    }
    out.push('| 대상 | 내용 |', '|---|---|');
    for (const r of rows) out.push(`| ${refCell(r.ref)} | ${esc(r.detail)} |`);
    out.push('');
  }

  out.push('## SKU 목록', '', '| SKU 키 | 이름 | 옵션 | 기준 단위 | 리스팅(×배수) | 옛 원가 행 |', '|---|---|---|---|---|---|');
  for (const s of [...d.skus].sort((a, b) => a.key.localeCompare(b.key))) {
    const skuLinks = d.links.filter((l) => l.skuKey === s.key);
    const printed = new Set<string>();
    const cells: string[] = [];
    for (const l of skuLinks) {
      if (printed.has(l.listingKey)) continue;
      printed.add(l.listingKey);
      const listing = listingByKey.get(l.listingKey);
      if (!listing) {
        cells.push(`\`${esc(l.listingKey)}\` ×${l.multiplier}`);
        continue;
      }
      let keyPart = `\`${esc(listing.key)}\``;
      // Wing·RG 짝이 같은 SKU에 함께 연결돼 있으면 한 줄로 묶는다 — overrides의 splitListing이
      // 「두 리스팅을 같은 SKU로」 요구하는 단위와 표시 단위를 맞춘다.
      if (listing.pairKey && !printed.has(listing.pairKey) && skuLinks.some((x) => x.listingKey === listing.pairKey)) {
        printed.add(listing.pairKey);
        keyPart += ` + \`${esc(listing.pairKey)}\``;
      }
      const modeSuffix = listing.linkMode !== 'single' ? ` [${listing.linkMode}]` : '';
      cells.push(`${keyPart} ${esc(listing.label ?? '')} ×${l.multiplier}${modeSuffix}`);
    }
    out.push(`| \`${esc(s.key)}\` | ${esc(s.name)} | ${esc(s.optionLabel) || '—'} | ${s.baseUnitLabel ? esc(s.baseUnitLabel) : '—'} | ${cells.join('<br>')} | ${s.legacyProductCostIds.length} |`);
  }
  out.push('');

  if (opts.notes.length) {
    out.push('## 운영 영향 메모', '');
    for (const n of opts.notes) out.push(`- ${n}`);
    out.push('');
  }
  return out.join('\n');
}
