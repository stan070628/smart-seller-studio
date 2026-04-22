// src/types/bulkImport.ts

export type ImportItemStatus =
  | 'pending'      // 대기
  | 'processing'   // AI 처리 중
  | 'ready'        // 처리 완료, 등록 대기
  | 'failed';      // 실패

export interface BulkImportItem {
  id: string;           // crypto.randomUUID()
  itemNo: number;
  status: ImportItemStatus;
  title?: string;
  thumbnailUrl?: string;
  recommendedPriceNaver?: number;
  recommendedPriceCoupang?: number;
  errorMessage?: string;
}

export interface SellerDefaults {
  sellerName: string;
  sellerBrandName: string;
  csPhone: string;
  csHours: string;
  returnAddress: string;
}
