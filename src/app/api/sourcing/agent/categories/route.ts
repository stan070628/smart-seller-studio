import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAllCategories } from '@/lib/sourcing-agent/db';

export async function GET() {
  try {
    const pool = getSourcingPool();
    const data = await getAllCategories(pool);

    return NextResponse.json({ success: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
