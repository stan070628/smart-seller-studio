'use client';

import { useEffect, useState } from 'react';

interface Row {
  skuCode: string;
  productName: string;
  channel: string;
  occupancyPct: number;
  isWinner: boolean;
  searchRank: number | null;
  snapshotAt: string;
  trend: 'up' | 'down' | 'flat';
}

export default function WinnerOccupancyTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/winners/list')
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRows(data.rows);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-sm text-gray-500">불러오는 중…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-gray-500">데이터 없음. 첫 cron 실행 후 표시됩니다.</div>;

  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50">
        <tr>
          <th className="p-2 text-left">SKU</th>
          <th className="p-2 text-left">상품명</th>
          <th className="p-2 text-left">채널</th>
          <th className="p-2 text-right">점유율</th>
          <th className="p-2 text-center">위너</th>
          <th className="p-2 text-center">추세</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.skuCode + r.channel} className="border-t">
            <td className="p-2 font-mono">{r.skuCode}</td>
            <td className="p-2">{r.productName}</td>
            <td className="p-2">{r.channel}</td>
            <td className="p-2 text-right font-semibold">{r.occupancyPct.toFixed(1)}%</td>
            <td className="p-2 text-center">{r.isWinner ? '✅' : '❌'}</td>
            <td className="p-2 text-center">{r.trend === 'up' ? '⬆️' : r.trend === 'down' ? '⬇️' : '➡️'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
