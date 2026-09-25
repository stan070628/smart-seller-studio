// src/lib/erp/sku/report.ts
import type { Draft, DraftIssue, DraftListing, IssueKind } from './draft';

const LABEL: Record<IssueKind, { title: string; decide: boolean; hint: string }> = {
  legacy_multiplier_mismatch: { title: '레거시 배수와 다름', decide: true, hint: 'setMultiplier로 맞는 배수를 정한다. 기준 단위(baseUnit)도 함께 적는다' },
  uneven_multiplier: { title: '수량이 나누어떨어지지 않음', decide: true, hint: '기준 단위를 정하고 setMultiplier로 배수를 준다' },
  legacy_spans_skus: {
    title: '옛 원가 행이 SKU 여러 개에 걸침',
    decide: true,
    hint: '대부분 조치 불필요 — 사이즈·색상이 다른 옵션을 옛 원가 행 하나로 관리했을 뿐이다. 기초 재고는 재고 이관 단계에서 실사로 잡는다. 같은 실물인데 SKU가 잘못 갈렸을 때만 병합한다(예: 1개입/2개입).',
  },
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
    case 'legacy_spans_skus':
      // 대부분은 조치가 필요 없는 정상 상황이라(사이즈·색상 옵션을 옛 원가 행 하나로 관리) detail에서
      // SKU 키를 추정해 「정답처럼 보이는」 예시를 만들지 않는다 — 자리표시자만 준다.
      return '{"mergeSkus": [["<SKU 키 1>", "<SKU 키 2>"]]}';
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

/** legacy_multiplier_mismatch의 detail("레거시 배수 N / 초안 배수 M")에서 레거시 배수만 뽑는다. */
const LEGACY_MULTIPLIER_RE = /레거시 배수 (\d+)/;

/**
 * 판단 필요 이슈 표의 「보정 예시」 열 — setMultiplier·excludeListings처럼 그 행 자체의 값으로
 * 뻔하게 채울 수 있는 종류만 만든다. 나머지는 '—'다 — 문맥 판단이 필요해 뻔한 정답이 없다.
 *
 * setMultiplier의 배수 값은 **현재 초안 배수를 그대로 넣지 않는다** — 그대로 붙여 넣으면 아무것도
 * 바뀌지 않아 "옛 매핑을 그대로 따르는" 선택이 되거나(legacy_multiplier_mismatch), 애초에 지금 값이
 * 틀렸다는 이슈 자체를 무의미하게 만든다(uneven_multiplier·channel_quantity_mismatch). 대신
 * legacy_multiplier_mismatch는 detail의 레거시 배수를(파싱 실패 시 자리표시자), 나머지 둘은 항상
 * 자리표시자 `"<정할 배수>"`를 넣어 사람이 직접 정하게 한다.
 */
function rowOverrideExample(kind: IssueKind, row: DraftIssue, d: Draft): string {
  const PLACEHOLDER = '"<정할 배수>"';
  switch (kind) {
    case 'legacy_multiplier_mismatch': {
      const link = d.links.find((l) => l.listingKey === row.ref);
      if (!link) return '—';
      const m = row.detail.match(LEGACY_MULTIPLIER_RE);
      const multiplier = m ? m[1] : PLACEHOLDER;
      return `\`{"setMultiplier": [{"listingKey": "${row.ref}", "skuKey": "${link.skuKey}", "multiplier": ${multiplier}}]}\``;
    }
    case 'channel_quantity_mismatch': {
      const link = d.links.find((l) => l.listingKey === row.ref);
      if (!link) return '—';
      return `\`{"setMultiplier": [{"listingKey": "${row.ref}", "skuKey": "${link.skuKey}", "multiplier": ${PLACEHOLDER}}]}\``;
    }
    case 'uneven_multiplier': {
      const link = d.links.find((l) => l.skuKey === row.ref);
      if (!link) return '—';
      return `\`{"setMultiplier": [{"listingKey": "${link.listingKey}", "skuKey": "${row.ref}", "multiplier": ${PLACEHOLDER}}]}\``;
    }
    case 'sync_link_unresolved':
      return `\`{"excludeListings": ["${row.ref}"]}\``;
    default:
      return '—';
  }
}

export function renderReport(d: Draft, opts: { date: string; notes: string[] }): string {
  const listingByKey = new Map(d.listings.map((l) => [l.key, l]));
  const out: string[] = [];
  out.push(`# SKU 마스터 점검 보고서 ${opts.date}`, '');
  out.push('> 이 보고서를 확인하고 정할 것을 `docs/erp/sku-overrides.json`에 적은 뒤 적재한다(계획 1-A Task 6~7).', '');
  out.push('> 쿠팡 승인완료(APPROVED) 상품 기준.', '');
  out.push('> 표 안의 키는 Obsidian 미리보기 화면에서 복사한다(원문에는 \\|가 섞인다).', '');
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
      out.push('| 대상 | 내용 | 보정 예시 |', '|---|---|---|');
      for (const r of rows) out.push(`| ${refCell(r.ref)} | ${esc(r.detail)} | ${rowOverrideExample(k, r, d)} |`);
    } else {
      out.push('| 대상 | 내용 |', '|---|---|');
      for (const r of rows) out.push(`| ${refCell(r.ref)} | ${esc(r.detail)} |`);
    }
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
      // Wing·RG 짝이 같은 SKU에 함께 연결돼 있고 배수도 같을 때만 한 줄로 묶는다 — 배수가 다르면
      // 한 줄로 뭉쳐 보여줄 수 없는 서로 다른 사실이므로 각자 자기 배수로 따로 보여준다.
      const pairLink = listing.pairKey ? skuLinks.find((x) => x.listingKey === listing.pairKey) : undefined;
      if (listing.pairKey && pairLink && !printed.has(listing.pairKey) && pairLink.multiplier === l.multiplier) {
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
