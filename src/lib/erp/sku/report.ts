// src/lib/erp/sku/report.ts
import type { Draft, IssueKind } from './draft';

const LABEL: Record<IssueKind, { title: string; decide: boolean; hint: string }> = {
  legacy_multiplier_mismatch: { title: '레거시 배수와 다름', decide: true, hint: 'setMultiplier로 맞는 배수를 정한다. 기준 단위(baseUnit)도 함께 적는다' },
  uneven_multiplier: { title: '수량이 나누어떨어지지 않음', decide: true, hint: '기준 단위를 정하고 setMultiplier로 배수를 준다' },
  legacy_spans_skus: { title: '옛 원가 행이 SKU 여러 개에 걸침', decide: true, hint: '입고 lot을 옵션별로 못 나눈다 — 1-B에서 기초 재고를 실사로 잡는다. 틀린 병합이면 mergeSkus로 합친다' },
  sale_attribution_mismatch: { title: '판매 귀속과 현재 매핑이 다름', decide: true, hint: '어느 쪽이 맞는지 확인한다(옵션 색상·사이즈 오매핑 의심)' },
  legacy_duplicate: { title: '옛 원가 행 중복', decide: true, hint: '빈 행이면 무시해도 된다. 이관은 SKU 기준이라 영향 없음' },
  sync_link_unresolved: { title: '품절 동기화 연결을 찾지 못함', decide: true, hint: '판매 종료 상품이면 excludeListings에 넣는다' },
  legacy_listing_unresolved: { title: '옛 매핑의 쿠팡 옵션이 현재 상품에 없음', decide: false, hint: '판매 종료·삭제 옵션. 과거 판매 대조용으로만 남는다' },
  multi_vid_listing: { title: '같은 SKU의 수량 옵션 여러 개가 붙은 채널 리스팅', decide: false, hint: '네이버 단일상품에 수량만 다른 쿠팡 옵션 여러 개. 최소 배수를 적용했다' },
  any_of_listing: { title: '여러 SKU 중 하나를 파는 채널 리스팅', decide: false, hint: '재고 전송은 연결 SKU 합계, 판매 SKU는 주문 옵션으로 가린다(1-C)' },
  channel_quantity_mismatch: { title: '채널 옵션 수량이 쿠팡과 다름', decide: true, hint: 'setMultiplier로 채널 배수를 정한다' },
  legacy_vid_multi_mapped: { title: '쿠팡 옵션 하나를 옛 원가 행 여러 개가 가리킴', decide: true, hint: '어느 행이 맞는지 확인(흰티 M/L 병합 의심 등)' },
  suspect_merge: { title: '서로 다른 실물이 한 SKU로 묶였을 수 있음', decide: true, hint: 'splitListing으로 떼어낸다' },
  quantity_invalid: { title: '수량 0', decide: true, hint: '옵션명을 확인한다' },
};

const esc = (s: string) => s.replace(/\|/g, '\\|');

export function renderReport(d: Draft, opts: { date: string; notes: string[] }): string {
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
    out.push('| 대상 | 내용 |', '|---|---|');
    for (const r of rows) out.push(`| ${esc(r.ref)} | ${esc(r.detail)} |`);
    out.push('');
  }

  out.push('## SKU 목록', '', '| SKU 키 | 이름 | 옵션 | 기준 단위 | 리스팅(×배수) | 옛 원가 행 |', '|---|---|---|---|---|---|');
  for (const s of [...d.skus].sort((a, b) => a.key.localeCompare(b.key))) {
    const ls = d.links
      .filter((l) => l.skuKey === s.key)
      .map((l) => {
        const listing = d.listings.find((x) => x.key === l.listingKey);
        const id = listing ? `${listing.channel} ${listing.externalProductId}${listing.externalOptionKey ? `/${listing.externalOptionKey}` : ''}` : l.listingKey;
        const modeSuffix = listing && listing.linkMode !== 'single' ? ` [${listing.linkMode}]` : '';
        return `${esc(id)} ×${l.multiplier}${modeSuffix}`;
      })
      .join('<br>');
    out.push(`| \`${s.key}\` | ${esc(s.name)} | ${esc(s.optionLabel) || '—'} | ${s.baseUnitLabel ?? '—'} | ${ls} | ${s.legacyProductCostIds.length} |`);
  }
  out.push('');

  if (opts.notes.length) {
    out.push('## 운영 영향 메모', '');
    for (const n of opts.notes) out.push(`- ${n}`);
    out.push('');
  }
  return out.join('\n');
}
