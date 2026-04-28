'use client';

import { useState } from 'react';

export default function InboundReturnForm() {
  const [skuCode, setSkuCode] = useState('');
  const [sellerName, setSellerName] = useState('');
  const [reason, setReason] = useState('packaging');
  const [returnCost, setReturnCost] = useState('');
  const [detail, setDetail] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/retro/inbound-returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        skuCode, sellerName, reason,
        returnCostKrw: returnCost ? Number(returnCost) : null,
        detail,
      }),
    });
    setDone(true);
    setTimeout(() => setDone(false), 3000);
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-3">
      <input className="w-full rounded border p-2 text-sm" placeholder="SKU 코드"
             value={skuCode} onChange={(e) => setSkuCode(e.target.value)} required />
      <input className="w-full rounded border p-2 text-sm" placeholder="셀러명 (1688)"
             value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
      <select className="w-full rounded border p-2 text-sm"
              value={reason} onChange={(e) => setReason(e.target.value)}>
        <option value="packaging">포장 (회송 1편)</option>
        <option value="size">사이즈 (회송 2편)</option>
        <option value="barcode">바코드 (회송 3편)</option>
        <option value="damage">손상</option>
        <option value="mismatch">사양 불일치</option>
        <option value="other">기타</option>
      </select>
      <input className="w-full rounded border p-2 text-sm" type="number"
             placeholder="회송 비용 (원)" value={returnCost}
             onChange={(e) => setReturnCost(e.target.value)} />
      <textarea className="w-full rounded border p-2 text-sm" rows={3}
                placeholder="상세 내용" value={detail}
                onChange={(e) => setDetail(e.target.value)} />
      <button type="submit" className="rounded bg-blue-600 px-4 py-2 text-sm text-white">
        회송 등록
      </button>
      {done && <span className="ml-2 text-sm text-green-700">✅ 등록됨</span>}
    </form>
  );
}
