import { judgeLecture, dailySalesFromCumulative, type LectureJudgement } from '@/lib/sourcing/lecture-formula';
import { judgeReal, sourcingFloorPrice, type RealJudgement } from '@/lib/sourcing-candidates/judge';
import { listingFlags, isExcluded, type FilterFlag } from '@/lib/sourcing-candidates/filters';
import type { ListingRow, OfferRow } from '@/lib/sourcing-candidates/types';

export interface OfferView extends OfferRow {
  cny: number | null;
  lecture: LectureJudgement | null;
  real: RealJudgement | null;
  daily: number | null;
}

export interface ListingView extends ListingRow {
  effective_price: number;
  floor: number;
  flags: FilterFlag[];
  excluded: boolean;
  offers: OfferView[];
  adopted: OfferView | null;
}

/** 채택 원가 = 사람이 넣은 값, 없으면 최소 주문 구간 단가 */
export function offerCny(o: Pick<OfferRow, 'cny_override' | 'tiers'>): number | null {
  if (o.cny_override !== null) return o.cny_override;
  const tiers = o.tiers ?? [];
  if (tiers.length === 0) return null;
  return [...tiers].sort((a, b) => a.min_qty - b.min_qty)[0].cny;
}

/**
 * 조회 응답 한 줄. 판정은 여기서 매번 계산한다 — 저장하면 상수가 바뀔 때 조용히 낡는다.
 */
export function buildListingView(l: ListingRow, offers: OfferRow[]): ListingView {
  const effective_price = l.price_override ?? l.price;
  const floor = sourcingFloorPrice(l.size);
  const flags = listingFlags({ ...l, price: effective_price }, floor);
  const views: OfferView[] = offers.map((o) => {
    const cny = offerCny(o);
    return {
      ...o,
      cny,
      lecture: cny === null ? null : judgeLecture(cny, effective_price),
      real: cny === null ? null : judgeReal(cny, effective_price, l.size, l.title),
      daily: o.sold_count === null ? null : dailySalesFromCumulative(o.sold_count),
    };
  });
  return {
    ...l,
    effective_price,
    floor,
    flags,
    excluded: isExcluded(flags, l.excluded_override),
    offers: views,
    adopted: views.find((o) => o.adopted) ?? null,
  };
}
