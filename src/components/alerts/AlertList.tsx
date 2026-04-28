'use client';

import { useEffect, useState } from 'react';

interface Row {
  id: number;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  sku_code: string | null;
  message: string;
  read_at: string | null;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#FEE2E2', high: '#FFEDD5', medium: '#FEF3C7', low: '#D1FAE5',
};

export default function AlertList({ unreadOnly }: { unreadOnly?: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetch(`/api/alerts${unreadOnly ? '?unread=true' : ''}`);
    const data = await r.json();
    if (data.success) setRows(data.rows);
    setLoading(false);
  }

  useEffect(() => { load(); }, [unreadOnly]);

  async function markRead(ids: number[]) {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    load();
  }

  if (loading) return <div className="p-4 text-sm text-gray-500">불러오는 중…</div>;
  if (rows.length === 0) return <div className="p-4 text-sm text-gray-500">알림 없음</div>;

  return (
    <ul className="space-y-2">
      {rows.map((a) => (
        <li
          key={a.id}
          style={{ background: SEVERITY_COLORS[a.severity] }}
          className="rounded p-3 flex items-center justify-between"
        >
          <div className="flex-1">
            <div className="text-xs text-gray-500">{a.type} · {new Date(a.created_at).toLocaleString()}</div>
            <div className="font-medium">{a.message}</div>
          </div>
          {!a.read_at && (
            <button
              onClick={() => markRead([a.id])}
              className="rounded bg-white border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
            >
              읽음
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
