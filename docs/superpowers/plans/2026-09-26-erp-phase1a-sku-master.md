# ERP 1-A — 상품마스터 SKU와 채널 매핑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 실물 옵션 1개 = SKU 1개인 상품마스터(`erp.skus`)와, 채널 상품·옵션 → SKU × 배수 매핑(`erp.channel_listings` + `erp.listing_skus`)을 기존 데이터에서 초안으로 만들고, **사용자가 점검 보고서로 확인한 뒤** 적재한다.

**Architecture:** 기존 테이블(`product_costs`·`product_cost_channels`·`stock_sync_links`·`costco_item_map`)은 **건드리지 않고** `erp` 스키마에 새 테이블을 추가한다. 쿠팡 상품 상세의 옵션(item) — Wing `vendorItemId`와 `rocketGrowthItemData.vendorItemId`를 함께 가진 — 을 실물 옵션의 출발점으로 삼고, 수량만 다른 옵션(1개/2개, 6팩/12팩)은 하나의 SKU에 배수로 묶는다. 초안 생성은 순수 함수(TDD)로, 데이터 수집·적재는 스크립트로 분리한다. 기존 화면과 정산은 계속 옛 테이블을 쓴다.

**Tech Stack:** TypeScript · vitest 4 · `pg` · `tsx`(npx) · Supabase Postgres 17.6 · 쿠팡 Open API(집 IP 허용 목록 등록됨)

**Spec:** `docs/superpowers/specs/2026-09-25-erp-restructure-design.md` — 「데이터 구조」, 「1단계 1-1」 · 사전 조사: 이 계획 하단 「조사 사실」

---

## 사전 정보 (실행자는 반드시 읽는다)

- 작업 폴더: `~/dev/smart_seller_studio/.worktrees/erp-restructure` (브랜치 `feature/erp-restructure`). 모든 명령은 여기서.
- **기존 실패 테스트 13건**(ERP 무관)이 있다. 합격 기준 = 새 테스트 전부 통과 + 전체 실패 13 이하.
- DB: `.env.local`의 `SUPABASE_DB_URL`. 비밀값 출력 금지. 마이그레이션 적용은 `node scripts/apply-migration.mjs <번호>`(트랜잭션, 파일 안에 BEGIN/COMMIT 금지).
- 스크립트 실행: `npx --no-install tsx scripts/erp/<파일>.ts` — `@/` 경로 별칭이 동작한다. `.env.local`은 스크립트 첫 줄의 `loadEnvLocal()`이 읽는다(아래 Task 5).
- 쿠팡 API는 로컬에서 직접 호출된다(집 IP `1.238.58.172`가 허용 목록에 있음). 네이버 **상품 조회**도 로컬 가능(막히는 것은 이미지 업로드뿐).
- 🔴 **구매자 개인정보를 파일·로그에 쓰지 않는다.** 이 계획이 다루는 것은 상품·옵션·ID뿐이다.
- 🔴 **사용자 확인 게이트**(Task 6)에서 멈춘다. 적재(Task 7)는 사용자가 보고서를 확인한 뒤에만.

## 조사 사실 (2026-09-26 읽기 전용 조사)

| 사실 | 설계에 주는 영향 |
|---|---|
| `product_costs` 77행은 **단위가 섞여 있다** — 옵션 1개 행도, 옵션 N개 묶음 행(YALE 12·컬럼비아 8·잉글리쉬런더리 4 …)도 있다. `seller_product_id`는 UNIQUE 아님(7그룹 16행 공유) | SKU를 product_costs에서 만들지 않는다. 쿠팡 옵션(item)에서 만들고 `legacy_product_cost_ids`로 역참조만 남긴다 |
| `variants`는 배열이 아니라 객체 `{vendorItemId: 옵션명}` | 옵션명은 쿠팡 API에서 새로 읽는다 |
| `product_cost_channels.external_id`: `coupang_wing`=Wing vendorItemId(주석과 달리 sellerProductId 아님), `coupang_rg`=RG vendorItemId, `naver`=channelProductNo | 레거시 배수 대조에 쓴다 |
| 같은 옵션도 RG·Wing vendorItemId가 다르다. 쿠팡 상품 상세의 item 하나에 `vendorItemId`(Wing)와 `rocketGrowthItemData.vendorItemId`(RG)가 함께 있다 | item 1개 → 리스팅 2개(Wing·RG) → 같은 SKU |
| `stock_sync_links`: naver 116(originProductNo + optionCombination id, 단일상품은 option_key '') · toss 47(productId + valueName 경로). 쿠팡 쪽은 전부 Wing vid. 네이버 단일상품 하나에 쿠팡 옵션 여러 개가 붙는 **N:1**이 있다(컬럼비아 9) | `listing_skus`로 리스팅 1 ↔ SKU N |
| 수량 배수: pcc `unit_multiplier>1` 8행(다슈 2·3, 라비오라 2, 퓨어틴 초코 12팩=2, LABNOSH 7). **기준 단위가 상품마다 다르다**(퓨어틴 6팩, LABNOSH 낱포) | 초안이 계산한 배수와 레거시 배수가 다르면 이슈로 올리고 사용자가 정한다. SKU에 `base_unit_label`을 둔다 |
| `sale_records.quantity`에는 이미 배수가 곱해져 있다 | 1-B 이전 때 다시 곱하지 않는다(여기서는 참고만) |
| 판매 20행이 현재 매핑과 다른 product_cost로 귀속(극세사 옐로우 13행 ↔ pcc 블루 등), 흰티 M이 L에 병합 의심, 도미나스·아머올 중복 행, costco 품번 오매핑 의심 2건 | 초안 생성기가 이슈로 자동 추출해 보고서에 싣는다 |
| 네이버 판매 가져오기는 `product_costs.naver_channel_product_no`(2건)만 본다 → 흰티 외 네이버 판매가 기록되지 않을 가능성 | 보고서 「운영 영향」 절에 싣는다(해결은 1-C) |

## File Structure

| 파일 | 역할 |
|---|---|
| Create `supabase/migrations/109_erp_sku_master.sql` | `erp.skus` · `erp.sku_components` · `erp.purchase_units` · `erp.channel_listings` · `erp.listing_skus` |
| Create `src/lib/erp/sku/option-key.ts` | 옵션 표시(속성·itemName)에서 수량을 떼어 「실물 옵션 키」와 수량을 낸다 |
| Create `src/lib/erp/sku/draft.ts` | 수집 입력 → SKU·리스팅·연결·이슈 초안(순수 함수) + 사용자 보정(overrides) 적용 |
| Create `src/lib/erp/sku/report.ts` | 초안 → 사람이 읽는 점검 보고서(Markdown) |
| Create `scripts/erp/_env.ts` | `.env.local` 로더(스크립트 공용) |
| Create `scripts/erp/sku-collect.ts` | DB + 쿠팡 API → 입력 JSON → 초안·보고서 파일 생성 (읽기 전용) |
| Create `scripts/erp/sku-apply.ts` | 초안 + overrides → erp 테이블 적재(트랜잭션·멱등) + 적재 검증 |
| Output `docs/erp/sku-draft-2026-09-26.json`, `docs/erp/sku-review-2026-09-26.md`, `docs/erp/sku-overrides.json` | 초안·보고서·사용자 보정 |
| Tests `src/__tests__/lib/erp/sku/option-key.test.ts`, `draft.test.ts`, `report.test.ts` | |

---

### Task 1: SKU 마스터 스키마

**Files:**
- Create: `supabase/migrations/109_erp_sku_master.sql`

- [ ] **Step 1: 마이그레이션 작성**

```sql
-- 109_erp_sku_master.sql
-- ERP 1-A: 상품마스터. 실물 옵션 1개 = SKU 1개. 기존 product_costs 등은 건드리지 않는다(병행 추가).
-- 채널 리스팅(쿠팡 Wing·RG vendorItemId, 네이버 origin+옵션, 토스 상품+옵션)은 listing_skus로 SKU × 배수에 연결한다.

create table if not exists erp.skus (
  id                       bigserial primary key,
  key                      text        not null unique,          -- 예: 'cp:16202992314:블랙' (초안 생성기가 만든다)
  name                     text        not null,                 -- 상품명
  option_label             text        not null default '',      -- 수량을 뗀 옵션 표시(색상·사이즈)
  base_unit_label          text,                                 -- 배수 1이 뜻하는 단위(예: '6팩', '낱포 1개')
  kind                     text        not null default 'single' check (kind in ('single', 'set', 'component')),
  safety_stock             integer     not null default 0 check (safety_stock >= 0),
  barcode                  text,
  status                   text        not null default 'active' check (status in ('active', 'archived')),
  legacy_product_cost_ids  uuid[]      not null default '{}',    -- 옛 product_costs 역참조(원가·입고 이력 연결용)
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create table if not exists erp.sku_components (
  set_sku_id        bigint  not null references erp.skus(id) on delete cascade,
  component_sku_id  bigint  not null references erp.skus(id),
  quantity          integer not null check (quantity > 0),
  primary key (set_sku_id, component_sku_id),
  check (set_sku_id <> component_sku_id)
);

create table if not exists erp.purchase_units (
  id                    bigserial primary key,
  supplier              text    not null default 'costco',
  supplier_code         text    not null,                -- 코스트코 품번 등
  label                 text,
  sku_id                bigint  references erp.skus(id),
  pieces_per_purchase   integer not null default 1 check (pieces_per_purchase > 0),   -- 매입 1단위 안의 낱개 수
  pieces_per_sale_unit  integer not null default 1 check (pieces_per_sale_unit > 0),  -- SKU 배수 1이 소비하는 낱개 수
  unique (supplier, supplier_code)
);

create table if not exists erp.channel_listings (
  id                   bigserial primary key,
  channel              text    not null check (channel in ('coupang_wing', 'coupang_rg', 'naver', 'toss')),
  external_product_id  text    not null,               -- 쿠팡: vendorItemId · 네이버: originProductNo · 토스: productId
  external_option_key  text    not null default '',    -- 네이버: optionCombination id('' = 단일) · 토스: valueName 경로
  alt_product_id       text,                           -- 네이버 channelProductNo · 쿠팡 sellerProductId
  label                text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  unique (channel, external_product_id, external_option_key)
);

create table if not exists erp.listing_skus (
  listing_id  bigint  not null references erp.channel_listings(id) on delete cascade,
  sku_id      bigint  not null references erp.skus(id),
  multiplier  integer not null default 1 check (multiplier > 0),  -- 리스팅 1개 판매가 소비하는 SKU 기준 단위 수
  primary key (listing_id, sku_id)
);

create index if not exists listing_skus_sku_idx on erp.listing_skus (sku_id);

alter table erp.skus             enable row level security;
alter table erp.sku_components   enable row level security;
alter table erp.purchase_units   enable row level security;
alter table erp.channel_listings enable row level security;
alter table erp.listing_skus     enable row level security;
```

- [ ] **Step 2: 적용**

Run: `node scripts/apply-migration.mjs 109`
Expected: `✅ 109_erp_sku_master.sql`

- [ ] **Step 3: 확인**

```bash
DB=$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g")
psql "$DB" -Atc "select table_name from information_schema.tables where table_schema='erp' order by 1"
```
Expected: `channel_listings` `job_runs` `listing_skus` `purchase_units` `sku_components` `skus`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/109_erp_sku_master.sql
git commit -m "feat(erp): SKU 마스터·채널 리스팅 스키마"
```

---

### Task 2: 실물 옵션 키 추출

**Files:**
- Create: `src/lib/erp/sku/option-key.ts`
- Test: `src/__tests__/lib/erp/sku/option-key.test.ts`

규칙: 쿠팡 item의 속성(`attributes[]`)에 `수량`이 들어간 속성이 있으면 그 값이 수량이고 나머지 속성값이 실물 옵션이다. 속성이 없으면 `itemName`의 `N개`(뒤에 `입`이 붙지 않은 것)·`N팩` 토큰 중 **마지막 것**을 수량으로 뗀다(위치는 어디든). `2개입`·`750ml`·`45g`처럼 **내용물 표시는 옵션에 남긴다.** 수량이 없으면 1.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/option-key.test.ts
import { describe, it, expect } from 'vitest';
import { optionKeyOf } from '@/lib/erp/sku/option-key';

describe('optionKeyOf', () => {
  it('속성의 수량 값을 수량으로, 나머지를 옵션으로 본다', () => {
    expect(optionKeyOf({
      itemName: '블랙 1개',
      attributes: [
        { attributeTypeName: '색상', attributeValueName: '블랙' },
        { attributeTypeName: '수량', attributeValueName: '1개' },
      ],
    })).toEqual({ option: '블랙', quantity: 1 });
  });

  it('속성이 없으면 itemName 끝의 N개·N팩을 뗀다', () => {
    expect(optionKeyOf({ itemName: '2개' })).toEqual({ option: '', quantity: 2 });
    expect(optionKeyOf({ itemName: '12팩' })).toEqual({ option: '', quantity: 12 });
    expect(optionKeyOf({ itemName: '750ml 2개' })).toEqual({ option: '750ml', quantity: 2 });
  });

  it('N개입·용량·중량은 내용물 표시라 옵션에 남긴다', () => {
    expect(optionKeyOf({ itemName: '1개 2개입' })).toEqual({ option: '2개입', quantity: 1 });
    expect(optionKeyOf({ itemName: '45g 7팩' })).toEqual({ option: '45g', quantity: 7 });
  });

  it('수량을 뗀 뒤 남은 구분자를 걷어낸다', () => {
    expect(optionKeyOf({ itemName: '네이비 / L(100) / 1개' })).toEqual({ option: '네이비 / L(100)', quantity: 1 });
  });

  it('수량이 없으면 1이고 옵션은 공백을 정리한 itemName이다', () => {
    expect(optionKeyOf({ itemName: '  L(100)   네이비 ' })).toEqual({ option: 'L(100) 네이비', quantity: 1 });
    expect(optionKeyOf({ itemName: '' })).toEqual({ option: '', quantity: 1 });
  });

  it('여러 속성은 속성명 순서가 아니라 들어온 순서대로 / 로 잇는다', () => {
    expect(optionKeyOf({
      itemName: 'x',
      attributes: [
        { attributeTypeName: '사이즈', attributeValueName: 'L' },
        { attributeTypeName: '색상', attributeValueName: '네이비' },
        { attributeTypeName: '총 수량', attributeValueName: '3개' },
      ],
    })).toEqual({ option: 'L / 네이비', quantity: 3 });
  });

  it('수량 속성 값에 숫자가 없으면 1로 본다', () => {
    expect(optionKeyOf({
      itemName: 'x',
      attributes: [{ attributeTypeName: '수량', attributeValueName: '단품' }],
    })).toEqual({ option: '', quantity: 1 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku/option-key.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/sku/option-key"`

- [ ] **Step 3: 구현**

```ts
// src/lib/erp/sku/option-key.ts
/**
 * 쿠팡 옵션(item)에서 「실물 옵션」과 「수량」을 가른다.
 *
 * 다슈 1개/2개/3개, 퓨어틴 6팩/12팩처럼 수량만 다른 옵션은 재고가 같은 물건이라 SKU 하나로 묶고
 * 리스팅에 배수를 둔다. 반면 `2개입`·`750ml`·`45g`은 물건 자체의 내용이라 옵션에 남긴다.
 */
export interface ItemAttribute {
  attributeTypeName: string;
  attributeValueName: string;
}

export interface OptionKey {
  option: string;
  quantity: number;
}

const QTY_ATTR = /수량/;
// `N개`(뒤에 `입`이 없는 것)·`N팩` 토큰. 여러 개면 마지막 것이 수량이다 — `1개 2개입`은 1개가 수량, 2개입은 내용물
const QTY_TOKEN = /(^|\s)(\d+)\s*(개(?!입)|팩)(?=\s|$)/g;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
/** 수량을 떼고 남은 구분자(`/`·`,`·`·`)를 양끝에서 걷어낸다 — `네이비 / L / 1개` → `네이비 / L` */
const trimSep = (s: string) => tidy(s).replace(/^[\s/,·]+|[\s/,·]+$/g, '');
const firstInt = (s: string) => {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : 1;
};

export function optionKeyOf(item: { itemName: string; attributes?: ItemAttribute[] }): OptionKey {
  const attrs = item.attributes ?? [];
  const qtyAttr = attrs.find((a) => QTY_ATTR.test(a.attributeTypeName));
  if (qtyAttr) {
    const option = attrs
      .filter((a) => a !== qtyAttr)
      .map((a) => tidy(a.attributeValueName))
      .filter(Boolean)
      .join(' / ');
    return { option, quantity: firstInt(qtyAttr.attributeValueName) };
  }

  const name = tidy(item.itemName ?? '');
  const tokens = [...name.matchAll(QTY_TOKEN)];
  const last = tokens.at(-1);
  if (!last) return { option: name, quantity: 1 };
  const start = last.index! + last[1].length;
  const option = trimSep(name.slice(0, start) + name.slice(start + last[0].length - last[1].length));
  return { option, quantity: Number(last[2]) };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku/option-key.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/option-key.ts src/__tests__/lib/erp/sku/option-key.test.ts
git commit -m "feat(erp): 쿠팡 옵션에서 실물 옵션 키와 수량 추출"
```

---

### Task 3: SKU 초안 생성기

**Files:**
- Create: `src/lib/erp/sku/draft.ts`
- Test: `src/__tests__/lib/erp/sku/draft.test.ts`

규칙:
1. 쿠팡 상품(sellerProductId)마다 item을 `optionKeyOf`로 가른다. 같은 `option`끼리 SKU 하나. SKU 키 = `cp:{sellerProductId}:{option}`(option이 빈 문자열이면 `cp:{sellerProductId}:`).
2. 그룹 안 최소 수량이 기준 단위(배수 1). 각 item의 배수 = `quantity / 최소수량`. 나누어떨어지지 않으면 배수는 `quantity`로 두고 이슈 `uneven_multiplier`.
3. item의 Wing vid → `coupang_wing` 리스팅, RG vid → `coupang_rg` 리스팅. 둘 다 같은 SKU·같은 배수. `alt_product_id` = sellerProductId.
4. `stock_sync_links` 행마다 네이버·토스 리스팅(키: channel·productId·optionKey)을 만든다. 연결된 쿠팡 Wing vid가 가리키는 SKU·배수를 이어받는다. 한 리스팅에 vid가 여럿 붙어도 **가리키는 SKU가 하나면** 수량 옵션(1개/2개 등)이 여럿 묶인 것뿐이므로 최소 배수를 적용하고 이슈 `multi_vid_listing`(정보성). **가리키는 SKU가 둘 이상이면**(컬럼비아처럼 네이버 단일상품 하나가 서로 다른 실물 옵션을 함께 파는 경우) 이는 **번들(전부 소비)이 아니라 그중 하나를 파는 관계**이므로 리스팅의 `linkMode`를 `any_of`로 두고(그 외 리스팅은 `single`) 전부 연결한 뒤 이슈 `any_of_listing`(정보성). 쿠팡 vid를 하나도 못 찾으면 리스팅을 만들지 않고 이슈 `sync_link_unresolved`, 일부만 못 찾으면 리스팅은 만들고 같은 이슈의 detail에 `(일부)`를 붙여 남긴다.
5. 레거시 대조(이슈만 만들고 초안을 바꾸지 않는다):
   - `product_cost_channels`의 vid가 초안 리스팅과 배수가 다르면 `legacy_multiplier_mismatch`.
   - pcc의 vid가 초안에 없으면 `legacy_listing_unresolved`.
   - product_cost 하나가 SKU 여러 개에 걸치면 `legacy_spans_skus`(입고 lot을 옵션별로 나눌 수 없다 → 기초 재고는 실사·RG 실재고로).
   - 판매 귀속(vid → product_cost_id)이 pcc 매핑과 다르면 `sale_attribution_mismatch`.
   - 이름과 seller_product_id가 같은 product_cost가 2개 이상이면 `legacy_duplicate`.
6. SKU의 `legacyProductCostIds` = 그 SKU 리스팅의 vid를 pcc가 가리키는 product_cost 모음(+ `product_costs.vendor_item_id` 일치).
7. `applyOverrides(draft, overrides)`: 사용자 보정 적용 — `mergeSkus`(뒤 키들을 첫 키로 흡수), `setMultiplier`, `excludeListings`, `rename`, `baseUnit`, `archive`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// src/__tests__/lib/erp/sku/draft.test.ts
import { describe, it, expect } from 'vitest';
import { buildDraft, applyOverrides, type DraftInput } from '@/lib/erp/sku/draft';

const base: DraftInput = {
  coupangProducts: [
    {
      sellerProductId: 100,
      productName: '다슈 왁스',
      items: [
        { itemName: '1개', wingVid: 11, rgVid: 21 },
        { itemName: '2개', wingVid: 12, rgVid: 22 },
        { itemName: '3개', wingVid: 13, rgVid: null },
      ],
    },
    {
      sellerProductId: 200,
      productName: '콜맨 왜건',
      items: [
        { itemName: '블랙', wingVid: 31, rgVid: null },
        { itemName: '레드', wingVid: 32, rgVid: null },
      ],
    },
  ],
  syncLinks: [
    { coupangVid: 31, channel: 'naver', productId: 900, optionKey: '5001', label: '왜건 · 블랙' },
    { coupangVid: 31, channel: 'toss', productId: 800, optionKey: '블랙 / 1개', label: '왜건 · 블랙 / 1개' },
    { coupangVid: 11, channel: 'naver', productId: 901, optionKey: '', label: '다슈 단일' },
    { coupangVid: 12, channel: 'naver', productId: 901, optionKey: '', label: '다슈 단일' },
    { coupangVid: 99, channel: 'naver', productId: 902, optionKey: '', label: '모르는 상품' },
  ],
  legacyChannels: [
    { productCostId: 'pc-dasu', channelType: 'coupang_wing', externalId: 12, unitMultiplier: 2 },
    { productCostId: 'pc-dasu', channelType: 'coupang_wing', externalId: 13, unitMultiplier: 2 },
    { productCostId: 'pc-wagon', channelType: 'coupang_wing', externalId: 31, unitMultiplier: 1 },
    { productCostId: 'pc-wagon', channelType: 'coupang_wing', externalId: 32, unitMultiplier: 1 },
    { productCostId: 'pc-ghost', channelType: 'coupang_rg', externalId: 777, unitMultiplier: 1 },
  ],
  legacyProductCosts: [
    { id: 'pc-dasu', productName: '다슈', sellerProductId: 100, vendorItemId: null },
    { id: 'pc-wagon', productName: '왜건', sellerProductId: 200, vendorItemId: null },
    { id: 'pc-dup1', productName: '도미나스', sellerProductId: 300, vendorItemId: null },
    { id: 'pc-dup2', productName: '도미나스', sellerProductId: 300, vendorItemId: null },
  ],
  saleAttributions: [
    { vid: 31, productCostId: 'pc-wagon', rows: 5 },
    { vid: 32, productCostId: 'pc-dasu', rows: 2 },
  ],
};

describe('buildDraft', () => {
  const d = buildDraft(base);
  const sku = (k: string) => d.skus.find((s) => s.key === k)!;
  const link = (channel: string, pid: string, opt = '') =>
    d.links.filter((l) => l.listingKey === `${channel}|${pid}|${opt}`);

  it('수량만 다른 옵션을 SKU 하나로 묶고 최소 수량을 배수 1로 둔다', () => {
    expect(sku('cp:100:')).toMatchObject({ name: '다슈 왁스', optionLabel: '' });
    expect(link('coupang_wing', '11')).toEqual([{ listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 }]);
    expect(link('coupang_wing', '12')[0].multiplier).toBe(2);
    expect(link('coupang_wing', '13')[0].multiplier).toBe(3);
  });

  it('Wing과 RG 리스팅이 같은 SKU·배수를 가진다', () => {
    expect(link('coupang_rg', '22')).toEqual([{ listingKey: 'coupang_rg|22|', skuKey: 'cp:100:', multiplier: 2 }]);
    const rg = d.listings.find((l) => l.key === 'coupang_rg|22|')!;
    expect(rg).toMatchObject({ channel: 'coupang_rg', externalProductId: '22', externalOptionKey: '', altProductId: '100' });
  });

  it('색상 옵션은 SKU가 따로다', () => {
    expect(d.skus.map((s) => s.key)).toEqual(expect.arrayContaining(['cp:200:블랙', 'cp:200:레드']));
  });

  it('네이버·토스 리스팅이 쿠팡 SKU와 배수를 이어받는다', () => {
    expect(link('naver', '900', '5001')).toEqual([{ listingKey: 'naver|900|5001', skuKey: 'cp:200:블랙', multiplier: 1 }]);
    expect(link('toss', '800', '블랙 / 1개')[0].skuKey).toBe('cp:200:블랙');
  });

  it('N:1 리스팅은 이어받은 연결을 합치고 정보성 이슈를 남긴다', () => {
    const l = link('naver', '901');
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ skuKey: 'cp:100:', multiplier: 1 });
    expect(d.issues).toContainEqual(expect.objectContaining({ kind: 'multi_vid_listing', ref: 'naver|901|' }));
  });

  it('레거시 대조 이슈를 만든다', () => {
    const kinds = (k: string) => d.issues.filter((i) => i.kind === k).map((i) => i.ref);
    expect(kinds('sync_link_unresolved')).toEqual(['naver|902|']);
    expect(kinds('legacy_multiplier_mismatch')).toEqual(['coupang_wing|13|']);
    expect(kinds('legacy_listing_unresolved')).toEqual(['coupang_rg|777|']);
    expect(kinds('legacy_spans_skus')).toEqual(['pc-wagon']);
    expect(kinds('sale_attribution_mismatch')).toEqual(['coupang_wing|32|']);
    expect(kinds('legacy_duplicate')).toEqual(['pc-dup1,pc-dup2']);
  });

  it('SKU에 레거시 product_cost를 역참조로 단다', () => {
    expect(sku('cp:100:').legacyProductCostIds).toEqual(['pc-dasu']);
    expect(sku('cp:200:블랙').legacyProductCostIds).toEqual(['pc-wagon']);
  });

  it('나누어떨어지지 않는 수량은 원래 수량을 배수로 두고 이슈를 남긴다', () => {
    const d2 = buildDraft({
      ...base,
      coupangProducts: [{ sellerProductId: 1, productName: 'p', items: [
        { itemName: '2개', wingVid: 1, rgVid: null }, { itemName: '3개', wingVid: 2, rgVid: null },
      ] }],
      syncLinks: [], legacyChannels: [], legacyProductCosts: [], saleAttributions: [],
    });
    expect(d2.links.find((l) => l.listingKey === 'coupang_wing|2|')!.multiplier).toBe(3);
    expect(d2.issues).toContainEqual(expect.objectContaining({ kind: 'uneven_multiplier', ref: 'cp:1:' }));
  });
});

describe('applyOverrides', () => {
  it('SKU 병합·배수 지정·리스팅 제외·이름·기준 단위·보관을 적용한다', () => {
    const d = applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:200:레드']],
      setMultiplier: [{ listingKey: 'coupang_wing|13|', skuKey: 'cp:100:', multiplier: 2 }],
      excludeListings: ['naver|902|'],
      rename: { 'cp:100:': '다슈 울트라 홀딩 왁스' },
      baseUnit: { 'cp:100:': '1개' },
      archive: [],
    });
    expect(d.skus.find((s) => s.key === 'cp:200:레드')).toBeUndefined();
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|32|')!.skuKey).toBe('cp:200:블랙');
    expect(d.links.find((l) => l.listingKey === 'coupang_wing|13|')!.multiplier).toBe(2);
    expect(d.listings.find((l) => l.key === 'naver|902|')).toBeUndefined();
    expect(d.skus.find((s) => s.key === 'cp:100:')).toMatchObject({ name: '다슈 울트라 홀딩 왁스', baseUnitLabel: '1개' });
  });

  it('없는 키를 가리키면 오류를 던진다', () => {
    expect(() => applyOverrides(buildDraft(base), {
      mergeSkus: [['cp:200:블랙', 'cp:없음']], setMultiplier: [], excludeListings: [], rename: {}, baseUnit: {}, archive: [],
    })).toThrow('cp:없음');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku/draft.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/erp/sku/draft"`

- [ ] **Step 3: 구현**

```ts
// src/lib/erp/sku/draft.ts
/**
 * 기존 데이터 → SKU 마스터 초안. 순수 함수라 DB·API 없이 시험한다.
 *
 * 초안은 「제안」이다. 레거시와 어긋나는 곳은 고치지 않고 issues로 올려
 * 사용자가 점검 보고서에서 정한 뒤(overrides) 적재한다.
 */
import { optionKeyOf, type ItemAttribute } from './option-key';

export type ListingChannel = 'coupang_wing' | 'coupang_rg' | 'naver' | 'toss';

export interface DraftInput {
  coupangProducts: {
    sellerProductId: number;
    productName: string;
    items: { itemName: string; attributes?: ItemAttribute[]; wingVid: number | null; rgVid: number | null }[];
  }[];
  syncLinks: { coupangVid: number; channel: 'naver' | 'toss'; productId: number; optionKey: string; label: string | null }[];
  legacyChannels: { productCostId: string; channelType: 'coupang_rg' | 'coupang_wing' | 'naver'; externalId: number; unitMultiplier: number }[];
  legacyProductCosts: { id: string; productName: string; sellerProductId: number; vendorItemId: number | null }[];
  saleAttributions: { vid: number; productCostId: string; rows: number }[];
}

export interface DraftSku {
  key: string;
  name: string;
  optionLabel: string;
  baseUnitLabel: string | null;
  status: 'active' | 'archived';
  legacyProductCostIds: string[];
}

export interface DraftListing {
  key: string; // `${channel}|${externalProductId}|${externalOptionKey}`
  channel: ListingChannel;
  externalProductId: string;
  externalOptionKey: string;
  altProductId: string | null;
  label: string | null;
}

export interface DraftLink {
  listingKey: string;
  skuKey: string;
  multiplier: number;
}

export type IssueKind =
  | 'uneven_multiplier'
  | 'multi_vid_listing'
  | 'sync_link_unresolved'
  | 'legacy_multiplier_mismatch'
  | 'legacy_listing_unresolved'
  | 'legacy_spans_skus'
  | 'sale_attribution_mismatch'
  | 'legacy_duplicate';

export interface DraftIssue {
  kind: IssueKind;
  ref: string;
  detail: string;
}

export interface Draft {
  skus: DraftSku[];
  listings: DraftListing[];
  links: DraftLink[];
  issues: DraftIssue[];
}

export interface Overrides {
  mergeSkus: string[][];
  setMultiplier: { listingKey: string; skuKey: string; multiplier: number }[];
  excludeListings: string[];
  rename: Record<string, string>;
  baseUnit: Record<string, string>;
  archive: string[];
}

export const listingKey = (channel: ListingChannel, productId: string | number, optionKey = '') =>
  `${channel}|${productId}|${optionKey}`;

export function buildDraft(input: DraftInput): Draft {
  const skus = new Map<string, DraftSku>();
  const listings = new Map<string, DraftListing>();
  const links = new Map<string, DraftLink>(); // key: listingKey + '→' + skuKey
  const issues: DraftIssue[] = [];
  const vidLink = new Map<number, { skuKey: string; multiplier: number }>();

  const addLink = (l: DraftLink) => links.set(`${l.listingKey}→${l.skuKey}`, l);

  // 1~3. 쿠팡 상품 → SKU · Wing/RG 리스팅
  for (const p of input.coupangProducts) {
    const groups = new Map<string, { item: DraftInput['coupangProducts'][number]['items'][number]; quantity: number }[]>();
    for (const item of p.items) {
      const { option, quantity } = optionKeyOf(item);
      const g = groups.get(option) ?? [];
      g.push({ item, quantity });
      groups.set(option, g);
    }
    for (const [option, members] of groups) {
      const skuKey = `cp:${p.sellerProductId}:${option}`;
      skus.set(skuKey, { key: skuKey, name: p.productName, optionLabel: option, baseUnitLabel: null, status: 'active', legacyProductCostIds: [] });
      const minQty = Math.min(...members.map((m) => m.quantity));
      const uneven = members.some((m) => m.quantity % minQty !== 0);
      if (uneven) issues.push({ kind: 'uneven_multiplier', ref: skuKey, detail: `수량 ${members.map((m) => m.quantity).join('/')} — 배수를 원래 수량으로 두었다` });
      for (const { item, quantity } of members) {
        const multiplier = uneven ? quantity : quantity / minQty;
        for (const [channel, vid] of [['coupang_wing', item.wingVid], ['coupang_rg', item.rgVid]] as const) {
          if (!vid) continue;
          const key = listingKey(channel, vid);
          listings.set(key, { key, channel, externalProductId: String(vid), externalOptionKey: '', altProductId: String(p.sellerProductId), label: `${p.productName} · ${item.itemName}`.trim() });
          addLink({ listingKey: key, skuKey, multiplier });
          vidLink.set(vid, { skuKey, multiplier });
        }
      }
    }
  }

  // 4. 네이버·토스 리스팅 (stock_sync_links)
  const syncGroups = new Map<string, DraftInput['syncLinks']>();
  for (const s of input.syncLinks) {
    const key = listingKey(s.channel, s.productId, s.optionKey);
    const g = syncGroups.get(key) ?? [];
    g.push(s);
    syncGroups.set(key, g);
  }
  for (const [key, rows] of syncGroups) {
    const resolved = rows.map((r) => vidLink.get(r.coupangVid)).filter((x): x is { skuKey: string; multiplier: number } => !!x);
    if (resolved.length === 0) {
      issues.push({ kind: 'sync_link_unresolved', ref: key, detail: `쿠팡 vid ${rows.map((r) => r.coupangVid).join(',')}를 초안에서 찾지 못했다` });
      continue;
    }
    const first = rows[0];
    listings.set(key, { key, channel: first.channel, externalProductId: String(first.productId), externalOptionKey: first.optionKey, altProductId: null, label: first.label });
    if (rows.length > 1) issues.push({ kind: 'multi_vid_listing', ref: key, detail: `쿠팡 옵션 ${rows.length}개가 이 리스팅 하나에 붙어 있다` });
    for (const r of resolved) {
      // 같은 SKU에 여러 vid(예: 1개·2개 옵션)가 붙으면 가장 작은 배수를 쓴다 — 채널 옵션 1개는 1단위로 판다
      const k = `${key}→${r.skuKey}`;
      const prev = links.get(k);
      if (!prev || r.multiplier < prev.multiplier) addLink({ listingKey: key, skuKey: r.skuKey, multiplier: r.multiplier });
    }
  }

  // 5~6. 레거시 대조
  const skuLegacy = new Map<string, Set<string>>();
  const pcSkus = new Map<string, Set<string>>();
  const note = (pc: string, skuKey: string) => {
    (skuLegacy.get(skuKey) ?? skuLegacy.set(skuKey, new Set()).get(skuKey)!).add(pc);
    (pcSkus.get(pc) ?? pcSkus.set(pc, new Set()).get(pc)!).add(skuKey);
  };
  const pcByVid = new Map<number, string>();
  for (const c of input.legacyChannels) {
    if (c.channelType === 'naver') continue;
    pcByVid.set(c.externalId, c.productCostId);
    const key = listingKey(c.channelType, c.externalId);
    const found = vidLink.get(c.externalId);
    if (!found) {
      issues.push({ kind: 'legacy_listing_unresolved', ref: key, detail: `product_cost ${c.productCostId}의 매핑이 현재 쿠팡 상품에 없다` });
      continue;
    }
    note(c.productCostId, found.skuKey);
    if (found.multiplier !== c.unitMultiplier) {
      issues.push({ kind: 'legacy_multiplier_mismatch', ref: key, detail: `레거시 배수 ${c.unitMultiplier} / 초안 배수 ${found.multiplier}` });
    }
  }
  for (const pc of input.legacyProductCosts) {
    if (pc.vendorItemId && vidLink.has(pc.vendorItemId)) note(pc.id, vidLink.get(pc.vendorItemId)!.skuKey);
  }
  for (const [pc, set] of pcSkus) {
    if (set.size > 1) issues.push({ kind: 'legacy_spans_skus', ref: pc, detail: `SKU ${[...set].join(', ')}에 걸친다 — 입고 lot을 옵션별로 나눌 수 없어 기초 재고는 실사로 잡는다` });
  }
  for (const s of input.saleAttributions) {
    const mapped = pcByVid.get(s.vid);
    if (mapped && mapped !== s.productCostId) {
      const channel = vidLink.has(s.vid) && [...listings.values()].some((l) => l.key === listingKey('coupang_rg', s.vid)) ? 'coupang_rg' : 'coupang_wing';
      issues.push({ kind: 'sale_attribution_mismatch', ref: listingKey(channel, s.vid), detail: `판매 ${s.rows}행은 ${s.productCostId}, 매핑은 ${mapped}` });
    }
  }
  const dupGroups = new Map<string, string[]>();
  for (const pc of input.legacyProductCosts) {
    const k = `${pc.productName}|${pc.sellerProductId}`;
    dupGroups.set(k, [...(dupGroups.get(k) ?? []), pc.id]);
  }
  for (const ids of dupGroups.values()) {
    if (ids.length > 1) issues.push({ kind: 'legacy_duplicate', ref: ids.join(','), detail: '이름과 seller_product_id가 같은 product_cost가 여러 개다' });
  }
  for (const [skuKey, set] of skuLegacy) {
    const s = skus.get(skuKey);
    if (s) s.legacyProductCostIds = [...set].sort();
  }

  return { skus: [...skus.values()], listings: [...listings.values()], links: [...links.values()], issues };
}

export function applyOverrides(draft: Draft, o: Overrides): Draft {
  const skus = new Map(draft.skus.map((s) => [s.key, { ...s, legacyProductCostIds: [...s.legacyProductCostIds] }]));
  let links = draft.links.map((l) => ({ ...l }));
  let listings = draft.listings.map((l) => ({ ...l }));
  const must = (k: string) => {
    if (!skus.has(k)) throw new Error(`overrides가 없는 SKU를 가리킨다: ${k}`);
  };

  for (const [keep, ...absorb] of o.mergeSkus) {
    must(keep);
    for (const a of absorb) {
      must(a);
      const target = skus.get(keep)!;
      target.legacyProductCostIds = [...new Set([...target.legacyProductCostIds, ...skus.get(a)!.legacyProductCostIds])].sort();
      skus.delete(a);
      links = links.map((l) => (l.skuKey === a ? { ...l, skuKey: keep } : l));
    }
  }
  const dedup = new Map<string, (typeof links)[number]>();
  for (const l of links) {
    const k = `${l.listingKey}→${l.skuKey}`;
    const prev = dedup.get(k);
    if (!prev || l.multiplier < prev.multiplier) dedup.set(k, l);
  }
  links = [...dedup.values()];

  for (const m of o.setMultiplier) {
    must(m.skuKey);
    const hit = links.find((l) => l.listingKey === m.listingKey && l.skuKey === m.skuKey);
    if (!hit) throw new Error(`overrides가 없는 연결을 가리킨다: ${m.listingKey}→${m.skuKey}`);
    hit.multiplier = m.multiplier;
  }
  const excluded = new Set(o.excludeListings);
  listings = listings.filter((l) => !excluded.has(l.key));
  links = links.filter((l) => !excluded.has(l.listingKey));
  for (const [k, name] of Object.entries(o.rename)) { must(k); skus.get(k)!.name = name; }
  for (const [k, unit] of Object.entries(o.baseUnit)) { must(k); skus.get(k)!.baseUnitLabel = unit; }
  for (const k of o.archive) { must(k); skus.get(k)!.status = 'archived'; }

  return { skus: [...skus.values()], listings, links, issues: draft.issues };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku`
Expected: PASS (option-key 7 + draft 10)

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/draft.ts src/__tests__/lib/erp/sku/draft.test.ts
git commit -m "feat(erp): 기존 데이터에서 SKU·리스팅 초안과 대조 이슈 생성"
```

---

### Task 4: 점검 보고서 렌더러

**Files:**
- Create: `src/lib/erp/sku/report.ts`
- Test: `src/__tests__/lib/erp/sku/report.test.ts`

보고서는 사용자가 **읽고 정하는** 문서다. 순서: 요약 수치 → 사용자가 정할 것(이슈를 종류별 표로, 각 행에 overrides 예시) → SKU 목록 표(SKU 키·이름·옵션·연결된 리스팅과 배수) → 운영 영향 메모.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
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
    { key: 'coupang_wing|11|', channel: 'coupang_wing', externalProductId: '11', externalOptionKey: '', altProductId: '100', label: '다슈 · 1개' },
    { key: 'coupang_wing|12|', channel: 'coupang_wing', externalProductId: '12', externalOptionKey: '', altProductId: '100', label: '다슈 · 2개' },
    { key: 'naver|900|5001', channel: 'naver', externalProductId: '900', externalOptionKey: '5001', altProductId: null, label: '왜건 · 블랙' },
  ],
  links: [
    { listingKey: 'coupang_wing|11|', skuKey: 'cp:100:', multiplier: 1 },
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
    expect(md).toMatch(/리스팅 \| 3/);
  });

  it('판단이 필요한 이슈를 정보성 이슈보다 먼저 싣고 종류별로 묶는다', () => {
    expect(md.indexOf('레거시 배수와 다름')).toBeLessThan(md.indexOf('여러 쿠팡 옵션이 붙은 채널 리스팅'));
    expect(md).toContain('| coupang_wing\\|12\\| | 레거시 배수 3 / 초안 배수 2 |');
  });

  it('SKU마다 연결된 리스팅과 배수를 보여준다', () => {
    expect(md).toContain('`cp:100:`');
    expect(md).toMatch(/coupang_wing 11 ×1.*coupang_wing 12 ×2/s);
  });

  it('운영 메모를 싣는다', () => {
    expect(md).toContain('네이버 판매 가져오기가 흰티만 잡는다');
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku/report.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
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
        return `${esc(id)} ×${l.multiplier}`;
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
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/__tests__/lib/erp/sku`
Expected: PASS (7 + 10 + 4)

- [ ] **Step 5: Commit**

```bash
git add src/lib/erp/sku/report.ts src/__tests__/lib/erp/sku/report.test.ts
git commit -m "feat(erp): SKU 점검 보고서 렌더러"
```

---

### Task 5: 수집 스크립트 — 초안·보고서 생성 (읽기 전용)

**Files:**
- Create: `scripts/erp/_env.ts`
- Create: `scripts/erp/sku-collect.ts`

- [ ] **Step 1: env 로더**

```ts
// scripts/erp/_env.ts
// 스크립트 공용 .env.local 로더. 값이 이미 있으면 덮어쓰지 않는다.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnvLocal(): void {
  const file = path.join(__dirname, '..', '..', '.env.local');
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
```

- [ ] **Step 2: 수집 스크립트**

```ts
// scripts/erp/sku-collect.ts
// 사용법: npx --no-install tsx scripts/erp/sku-collect.ts
// DB(읽기 전용 세션)와 쿠팡 API에서 입력을 모아 SKU 초안(JSON)과 점검 보고서(MD)를 docs/erp/에 쓴다.
// 구매자 정보는 읽지 않는다 — sale_records에서는 vid·product_cost_id·건수만 모은다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { buildDraft, type DraftInput } from '@/lib/erp/sku/draft';
import { renderReport } from '@/lib/erp/sku/report';
import { getCoupangClient } from '@/lib/listing/coupang-client';

loadEnvLocal();
const DATE = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.join(__dirname, '..', '..', 'docs', 'erp');

async function collectDb(): Promise<Omit<DraftInput, 'coupangProducts'> & { sellerProductIds: number[] }> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('set default_transaction_read_only = on');
    const pcs = (await c.query(`select id, product_name, seller_product_id, vendor_item_id from product_costs`)).rows;
    const pcc = (await c.query(`select product_cost_id, channel_type, external_id, unit_multiplier from product_cost_channels`)).rows;
    const ssl = (await c.query(`select coupang_vendor_item_id, channel, product_id, option_key, label from stock_sync_links`)).rows;
    const sales = (await c.query(`
      select nullif(regexp_replace(coupang_order_item_id, '^.*-', ''), '')::bigint as vid, product_cost_id, count(*)::int as rows
        from sale_records
       where voided_at is null and channel in ('coupang', 'rocket_growth') and coupang_order_item_id ~ '-[0-9]+$'
       group by 1, 2`)).rows;
    return {
      legacyProductCosts: pcs.map((r) => ({ id: r.id, productName: r.product_name, sellerProductId: Number(r.seller_product_id), vendorItemId: r.vendor_item_id ? Number(r.vendor_item_id) : null })),
      legacyChannels: pcc.map((r) => ({ productCostId: r.product_cost_id, channelType: r.channel_type, externalId: Number(r.external_id), unitMultiplier: r.unit_multiplier })),
      syncLinks: ssl.map((r) => ({ coupangVid: Number(r.coupang_vendor_item_id), channel: r.channel, productId: Number(r.product_id), optionKey: r.option_key, label: r.label })),
      saleAttributions: sales.filter((r) => r.vid).map((r) => ({ vid: Number(r.vid), productCostId: r.product_cost_id, rows: r.rows })),
      sellerProductIds: [...new Set(pcs.map((r) => Number(r.seller_product_id)).filter((n) => n > 0))],
    };
  } finally {
    await c.end();
  }
}

async function collectCoupang(extraIds: number[]): Promise<DraftInput['coupangProducts']> {
  const cp = getCoupangClient();
  const ids = new Set(extraIds);
  for (const bt of [undefined, 'rocketGrowth']) {
    let token = '';
    do {
      const page = await cp.getSellerProducts('APPROVED', 50, token, bt);
      for (const p of page.items) ids.add(Number((p as { sellerProductId: number }).sellerProductId));
      token = page.nextToken ?? '';
    } while (token);
  }
  const out: DraftInput['coupangProducts'] = [];
  for (const id of ids) {
    try {
      const d = (await cp.getProductDetail(id)) as { sellerProductId: number; sellerProductName: string; items?: Record<string, unknown>[] };
      out.push({
        sellerProductId: Number(d.sellerProductId),
        productName: d.sellerProductName,
        items: (d.items ?? []).map((it) => ({
          itemName: String(it.itemName ?? ''),
          attributes: Array.isArray(it.attributes) ? (it.attributes as { attributeTypeName: string; attributeValueName: string }[]) : [],
          wingVid: it.vendorItemId ? Number(it.vendorItemId) : null,
          rgVid: (it.rocketGrowthItemData as { vendorItemId?: number } | undefined)?.vendorItemId ? Number((it.rocketGrowthItemData as { vendorItemId: number }).vendorItemId) : null,
        })),
      });
    } catch (e) {
      console.error(`⚠️ 쿠팡 상품 ${id} 조회 실패: ${(e as Error).message}`);
    }
  }
  return out;
}

(async () => {
  const db = await collectDb();
  const coupangProducts = await collectCoupang(db.sellerProductIds);
  const { sellerProductIds: _unused, ...rest } = db;
  const input: DraftInput = { ...rest, coupangProducts };
  const draft = buildDraft(input);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `sku-draft-${DATE}.json`), JSON.stringify({ input, draft }, null, 2));
  const notes = [
    '네이버 판매 가져오기(naver-bulk-import)는 product_costs.naver_channel_product_no(2건: 흰티 L·XL)만 본다 — 품절 동기화에 연결된 네이버 상품 51개 중 나머지 판매는 기록되지 않았을 가능성이 크다. 1-C(주문 수집)에서 channel_listings로 해결한다.',
    'costco_item_map 오매핑 의심: 693742 「프로틴커피쉐이크」→퓨어틴 초코, 888450 「PUMA주니어팬티5P」(ask)→극세사 타월. purchase_units 적재 전 확인이 필요하다.',
  ];
  fs.writeFileSync(path.join(OUT, `sku-review-${DATE}.md`), renderReport(draft, { date: DATE, notes }));
  console.log(`SKU ${draft.skus.length} · 리스팅 ${draft.listings.length} · 연결 ${draft.links.length} · 이슈 ${draft.issues.length}`);
  console.log(`→ docs/erp/sku-draft-${DATE}.json, docs/erp/sku-review-${DATE}.md`);
})();
```

- [ ] **Step 3: 실행**

Run: `npx --no-install tsx scripts/erp/sku-collect.ts`
Expected: `SKU n · 리스팅 m · 연결 k · 이슈 j` 한 줄과 파일 두 개. 쿠팡 조회 실패 경고가 있으면 그 sellerProductId를 보고한다(판매 종료 상품이면 정상).

- [ ] **Step 4: 산출물 점검** — 다음을 확인하고 보고한다:
  - `grep -c '"kind"' docs/erp/sku-draft-*.json` 이슈 수가 보고서 요약과 같다
  - 조사 사실의 알려진 사례가 보고서에 있다: 다슈(배수 1·2·3 한 SKU), 퓨어틴 초코(6팩/12팩), 콜맨 블랙·레드(각각 SKU), 극세사 옐로우 판매 귀속 불일치, 컬럼비아 네이버 N:1
  - 구매자 정보가 없는지: `grep -nE '010-?[0-9]{4}|@[a-z]+\\.' docs/erp/sku-*.* | head` → 출력 없음

- [ ] **Step 5: Commit**

```bash
git add scripts/erp/_env.ts scripts/erp/sku-collect.ts docs/erp/sku-draft-*.json docs/erp/sku-review-*.md
git commit -m "chore(erp): SKU 초안·점검 보고서 생성 스크립트와 첫 산출물"
```

---

### Task 6: 🔴 사용자 점검 게이트

- [ ] **Step 1: 보고서를 사용자에게 보여준다** — `docs/erp/sku-review-<날짜>.md`의 「정할 것」 절을 요약하고, 🔴 항목마다 제안을 붙인다(예: 「퓨어틴 초코 12팩 배수: 레거시 2 = 기준 6팩 → setMultiplier 2, baseUnit '6팩'」).

- [ ] **Step 2: 사용자 결정을 overrides 파일로 적는다** — 결정이 나오는 즉시 파일에 적는다(채팅에만 두지 않는다).

```json
{
  "mergeSkus": [],
  "setMultiplier": [],
  "excludeListings": [],
  "rename": {},
  "baseUnit": {},
  "archive": []
}
```
파일: `docs/erp/sku-overrides.json`. 각 항목 형식은 `src/lib/erp/sku/draft.ts`의 `Overrides` 타입을 따른다.

- [ ] **Step 3: 보정 검증** — `applyOverrides`가 오류 없이 도는지 확인:

```bash
npx --no-install tsx -e "
import fs from 'node:fs';
import { applyOverrides } from './src/lib/erp/sku/draft';
const f = fs.readdirSync('docs/erp').filter(n => n.startsWith('sku-draft-')).sort().pop()!;
const { draft } = JSON.parse(fs.readFileSync('docs/erp/' + f, 'utf-8'));
const d = applyOverrides(draft, JSON.parse(fs.readFileSync('docs/erp/sku-overrides.json', 'utf-8')));
console.log('SKU', d.skus.length, '리스팅', d.listings.length, '연결', d.links.length);
"
```

- [ ] **Step 4: Commit**

```bash
git add docs/erp/sku-overrides.json
git commit -m "chore(erp): SKU 점검 결과 사용자 보정"
```

---

### Task 7: 적재와 검증

**Files:**
- Create: `scripts/erp/sku-apply.ts`

- [ ] **Step 1: 적재 스크립트**

```ts
// scripts/erp/sku-apply.ts
// 사용법: npx --no-install tsx scripts/erp/sku-apply.ts [--apply]
// 최신 초안 + docs/erp/sku-overrides.json → erp.skus / channel_listings / listing_skus 적재.
// --apply 없으면 적재할 수만 출력한다. 트랜잭션 하나로, 키 기준 upsert라 다시 돌려도 안전하다.
// 초안에서 빠진 연결은 지운다(listing_skus는 초안이 원장이다). skus·channel_listings는 지우지 않고 보관(archived / active=false)한다.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnvLocal } from './_env';
import { applyOverrides, type Draft } from '@/lib/erp/sku/draft';

loadEnvLocal();
const DIR = path.join(__dirname, '..', '..', 'docs', 'erp');
const APPLY = process.argv.includes('--apply');

(async () => {
  const draftFile = fs.readdirSync(DIR).filter((n) => n.startsWith('sku-draft-')).sort().pop();
  if (!draftFile) throw new Error('docs/erp/sku-draft-*.json이 없다 — sku-collect.ts를 먼저 돌린다');
  const { draft } = JSON.parse(fs.readFileSync(path.join(DIR, draftFile), 'utf-8')) as { draft: Draft };
  const overrides = JSON.parse(fs.readFileSync(path.join(DIR, 'sku-overrides.json'), 'utf-8'));
  const d = applyOverrides(draft, overrides);
  console.log(`${draftFile} + overrides → SKU ${d.skus.length} · 리스팅 ${d.listings.length} · 연결 ${d.links.length}`);
  if (!APPLY) { console.log('(점검만 — 적재하려면 --apply)'); return; }

  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  try {
    await c.query('begin');
    const skuId = new Map<string, number>();
    for (const s of d.skus) {
      const { rows } = await c.query(
        `insert into erp.skus (key, name, option_label, base_unit_label, status, legacy_product_cost_ids)
         values ($1, $2, $3, $4, $5, $6::uuid[])
         on conflict (key) do update set name = excluded.name, option_label = excluded.option_label,
           base_unit_label = excluded.base_unit_label, status = excluded.status,
           legacy_product_cost_ids = excluded.legacy_product_cost_ids, updated_at = now()
         returning id`,
        [s.key, s.name, s.optionLabel, s.baseUnitLabel, s.status, s.legacyProductCostIds],
      );
      skuId.set(s.key, Number(rows[0].id));
    }
    await c.query(`update erp.skus set status = 'archived', updated_at = now() where not (key = any($1))`, [d.skus.map((s) => s.key)]);

    const listingId = new Map<string, number>();
    for (const l of d.listings) {
      const { rows } = await c.query(
        `insert into erp.channel_listings (channel, external_product_id, external_option_key, alt_product_id, label, link_mode, active)
         values ($1, $2, $3, $4, $5, $6, true)
         on conflict (channel, external_product_id, external_option_key) do update
           set alt_product_id = excluded.alt_product_id, label = excluded.label, link_mode = excluded.link_mode, active = true
         returning id`,
        [l.channel, l.externalProductId, l.externalOptionKey, l.altProductId, l.label, l.linkMode],
      );
      listingId.set(l.key, Number(rows[0].id));
    }
    await c.query(`update erp.channel_listings set active = false where not (id = any($1))`, [[...listingId.values()]]);

    await c.query('delete from erp.listing_skus');
    for (const k of d.links) {
      const lid = listingId.get(k.listingKey);
      const sid = skuId.get(k.skuKey);
      if (!lid || !sid) throw new Error(`연결 대상 누락: ${k.listingKey} → ${k.skuKey}`);
      await c.query('insert into erp.listing_skus (listing_id, sku_id, multiplier) values ($1, $2, $3)', [lid, sid, k.multiplier]);
    }
    await c.query('commit');
    console.log('✅ 적재 완료');
  } catch (e) {
    await c.query('rollback').catch(() => {});
    console.error(`❌ 롤백: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
```

- [ ] **Step 2: 점검 실행** — `npx --no-install tsx scripts/erp/sku-apply.ts` → 수치 한 줄과 「점검만」.

- [ ] **Step 3: 🔴 사용자 확인 후 적재** — `npx --no-install tsx scripts/erp/sku-apply.ts --apply` → `✅ 적재 완료`.

- [ ] **Step 4: 적재 검증 (1-1 완료 기준)**

```bash
DB=$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g")
psql "$DB" -c "
select 'active skus' k, count(*) from erp.skus where status='active'
union all select 'active listings', count(*) from erp.channel_listings where active
union all select 'links', count(*) from erp.listing_skus
union all select 'listing without sku', count(*) from erp.channel_listings l where active and not exists (select 1 from erp.listing_skus x where x.listing_id=l.id)
union all select 'sync link unmapped', count(*) from stock_sync_links s where not exists (select 1 from erp.channel_listings l join erp.listing_skus x on x.listing_id=l.id where l.channel=s.channel and l.external_product_id=s.product_id::text and l.external_option_key=s.option_key)
union all select 'recent sale vid unmapped (90d)', count(distinct regexp_replace(coupang_order_item_id,'^.*-','')) from sale_records r where voided_at is null and sold_at > now()-interval '90 days' and coupang_order_item_id ~ '-[0-9]+\$' and not exists (select 1 from erp.channel_listings l where l.channel in ('coupang_wing','coupang_rg') and l.external_product_id = regexp_replace(r.coupang_order_item_id,'^.*-',''));"
```
Expected: `listing without sku` = 0. `sync link unmapped`·`recent sale vid unmapped`는 **excludeListings로 사용자가 제외한 것뿐**이어야 한다 — 숫자를 보고서의 제외 목록과 대조해 보고한다.

- [ ] **Step 5: Commit**

```bash
git add scripts/erp/sku-apply.ts
git commit -m "feat(erp): SKU 마스터 적재 스크립트(트랜잭션·멱등)"
```

---

### Task 8: 1-A 마무리

- [ ] **Step 1:** 전체 테스트 `npx vitest run 2>&1 | tail -3` → 실패 13 이하. `npx tsc --noEmit` → 오류 0.
- [ ] **Step 2:** superpowers:requesting-code-review로 1-A 전체 리뷰.
- [ ] **Step 3:** 🔴 사용자 승인 후 PR·병합(운영 코드 변경은 없고 스키마·스크립트·문서뿐이다).
- [ ] **Step 4:** 결과를 사용자에게 보고하고 위키 반영은 메인 세션이 한다. 다음: **1-B 재고 원장**(기초 재고 = RG 실재고 + 자체보관 실사).

## 이 계획에서 하지 않는 것 (다음 하위 계획)

| 항목 | 계획 |
|---|---|
| `purchase_units` 적재(코스트코 품번) | 1-B — 입고 전표와 함께. 오매핑 의심 2건 확인 후 |
| `sku_components`(세트) | 세트 상품이 생길 때. 테이블만 만든다 |
| 옛 테이블 교체·화면 전환 | 2~3단계 |
| 네이버 channelProductNo ↔ originProductNo 채우기 | 1-C 주문 수집 때 API로 |

---

## 사용자 점검 결정 (2026-09-26, Task 6)

| # | 항목 | 결정 | 반영 위치 |
|---|---|---|---|
| 1 | LABNOSH 45g | 코스트코 14개입을 사서 7개씩 소분 판매 → 기준 단위 7개입 1팩(7개 ×1, 14개 ×2) | overrides `baseUnit` · 1-B `purchase_units`(14 → 2팩) |
| 2 | 라비오라 1개입/2개입 | 2개입을 사서 1개씩 소분 판매 → 두 SKU 병합, 2개입 리스팅(Wing·RG) ×2 | overrides `mergeSkus`·`setMultiplier` |
| 3 | 판매 귀속 불일치 3건(극세사·흰티) | **쿠팡 옵션 ID 기준**이 맞다 | 1-B 과거 판매 이관 시 vid → SKU로 귀속 |
| 4 | 흰티 M이 L에 병합 의심 | 병합이 맞는 것 같다 → 초안은 이미 M·L 분리 | 1-B 기초 재고를 실사로 |
| 5 | 나이키 오타니 3옵션(리스팅 없음) | **네이버에서 판매 중** → 보관하지 않음 | 1-C에서 네이버 상품 직접 조회로 리스팅 연결(쿠팡 vid가 없어 품절 동기화 연결로는 못 찾는다) |
