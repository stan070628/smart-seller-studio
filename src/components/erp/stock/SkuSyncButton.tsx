// src/components/erp/stock/SkuSyncButton.tsx
'use client';

/**
 * 재고현황 「SKU 다시 맞추기」 — 원가관리에 쿠팡 상품번호가 있는데 SKU가 없는 상품을 SKU로 만든다(한 번에 20개).
 * 원가관리 추가 때 자동 추가가 실패한 상품을 채우는 곳이다. 지우거나 고치지 않으므로 확인 창을 띄우지 않는다.
 */
import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { E } from '@/lib/design-tokens';
import { toast } from '@/components/ui/toast';
import { btnStyle, disabledBtnStyle } from '@/components/orders/erp-ui';
import { formatSyncMissing } from '@/lib/erp/sku/sync-message';
import { postSkuSyncMissing } from './api';

export default function SkuSyncButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    const r = await postSkuSyncMissing();
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    const msg = formatSyncMissing(r.data);
    setLast(msg);
    if (r.data.failed > 0) toast.error(msg);
    else toast.success(msg);
    if (r.data.created > 0) onDone();
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run()}
        style={busy ? disabledBtnStyle : btnStyle}
        title="원가관리에 쿠팡 상품번호가 있는데 SKU가 없는 상품을 SKU로 만든다(한 번에 20개)"
      >
        <Package size={12} /> {busy ? 'SKU 맞추는 중…' : 'SKU 다시 맞추기'}
      </button>
      {last && <span role="status" style={{ fontSize: 11.5, color: E.inkSub }}>{last}</span>}
    </>
  );
}
