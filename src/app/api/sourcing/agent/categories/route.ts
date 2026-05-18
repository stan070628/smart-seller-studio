import { NextResponse } from 'next/server';
import { getSourcingPool } from '@/lib/sourcing/db';
import { getAllCategories } from '@/lib/sourcing-agent/db';

export async function GET() {
  try {
    const pool = getSourcingPool();
    const categories = await getAllCategories(pool);

    return NextResponse.json({ categories });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
