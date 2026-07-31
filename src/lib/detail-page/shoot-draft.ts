export interface ShootDraftSummary {
  id: string;
  productName: string | null;
  updatedAt: string;
  step: string | null;
  shotCount: number;
}

/** detail_page_drafts 행 → "촬영 진행중" 리스트 항목 요약. */
export function deriveShootDraftSummary(row: {
  id: string;
  product_name?: string | null;
  updated_at: string;
  shoot_session?: unknown;
}): ShootDraftSummary {
  const ss = (row.shoot_session ?? {}) as { step?: unknown; shotGuide?: unknown };
  const shotCount = Array.isArray(ss.shotGuide) ? ss.shotGuide.length : 0;
  const step = typeof ss.step === 'string' ? ss.step : null;
  return {
    id: row.id,
    productName: row.product_name ?? null,
    updatedAt: row.updated_at,
    step,
    shotCount,
  };
}
