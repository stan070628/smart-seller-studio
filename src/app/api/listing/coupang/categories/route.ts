/**
 * GET /api/listing/coupang/categories
 *
 * ?keyword=등산가방   → 키워드로 카테고리 검색 (말단 카테고리 + 경로 반환)
 * ?parentCode=69182  → 해당 카테고리의 하위 목록
 * 파라미터 없으면    → 최상위 카테고리
 */

import { NextRequest } from 'next/server';
import { getCoupangClient } from '@/lib/listing/coupang-client';

interface CategoryNode {
  displayItemCategoryCode: number;
  name: string;
  status: string;
  child: CategoryNode[];
}

// ─── 메모리 캐시 (서버리스 인스턴스 수명 동안 유지) ─────────────
let _cachedTree: CategoryNode | null = null;
let _cachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1시간

async function getCategoryTree(): Promise<CategoryNode> {
  if (_cachedTree && Date.now() - _cachedAt < CACHE_TTL) {
    return _cachedTree;
  }
  const client = getCoupangClient();
  _cachedTree = (await client.getCategoryTree()) as CategoryNode;
  _cachedAt = Date.now();
  return _cachedTree;
}

// ─── 트리 유틸 ──────────────────────────────────────────────────

/** 특정 코드의 자식 노드 찾기 */
function findChildren(nodes: CategoryNode[], targetCode: number): CategoryNode[] | null {
  for (const node of nodes) {
    if (node.displayItemCategoryCode === targetCode) {
      return node.child ?? [];
    }
    if (node.child && node.child.length > 0) {
      const found = findChildren(node.child, targetCode);
      if (found) return found;
    }
  }
  return null;
}

/** 키워드로 카테고리 검색 — 말단 노드 + 전체 경로 반환 */
function searchCategories(
  nodes: CategoryNode[],
  keyword: string,
  path: string[] = [],
  results: { code: number; name: string; path: string }[] = [],
  limit: number = 30,
): { code: number; name: string; path: string }[] {
  for (const node of nodes) {
    if (results.length >= limit) break;
    if (node.status !== 'ACTIVE') continue;

    const currentPath = [...path, node.name];
    const nameMatch = node.name.toLowerCase().includes(keyword.toLowerCase());

    // 말단 노드이면서 이름이 매치되거나, 경로 중 하나가 매치
    const isLeaf = !node.child || node.child.length === 0;

    if (nameMatch) {
      if (isLeaf) {
        results.push({
          code: node.displayItemCategoryCode,
          name: node.name,
          path: currentPath.join(' > '),
        });
      } else {
        // 매치된 비-말단 노드의 모든 말단 자식을 수집
        collectLeaves(node.child, currentPath, results, limit);
      }
    } else if (node.child && node.child.length > 0) {
      searchCategories(node.child, keyword, currentPath, results, limit);
    }
  }
  return results;
}

/** 특정 노드 아래의 모든 말단 카테고리 수집 */
function collectLeaves(
  nodes: CategoryNode[],
  path: string[],
  results: { code: number; name: string; path: string }[],
  limit: number,
) {
  for (const node of nodes) {
    if (results.length >= limit) break;
    if (node.status !== 'ACTIVE') continue;

    const currentPath = [...path, node.name];
    const isLeaf = !node.child || node.child.length === 0;

    if (isLeaf) {
      results.push({
        code: node.displayItemCategoryCode,
        name: node.name,
        path: currentPath.join(' > '),
      });
    } else {
      collectLeaves(node.child, currentPath, results, limit);
    }
  }
}

function simplify(nodes: CategoryNode[]) {
  return nodes
    .filter((n) => n.status === 'ACTIVE')
    .map((n) => ({
      code: n.displayItemCategoryCode,
      name: n.name,
      hasChildren: Array.isArray(n.child) && n.child.length > 0,
    }));
}

// ─── 핸들러 ─────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const keyword = request.nextUrl.searchParams.get('keyword');
  const parentCode = request.nextUrl.searchParams.get('parentCode');

  try {
    const root = await getCategoryTree();

    if (!root || !root.child) {
      return Response.json({ success: true, data: [] });
    }

    // 키워드 검색
    if (keyword && keyword.trim().length > 0) {
      const results = searchCategories(root.child, keyword.trim());
      return Response.json({ success: true, data: results });
    }

    // 하위 카테고리 조회
    if (parentCode) {
      const code = parseInt(parentCode, 10);
      const children = findChildren(root.child, code);
      return Response.json({ success: true, data: simplify(children ?? []) });
    }

    // 최상위 카테고리
    return Response.json({ success: true, data: simplify(root.child) });
  } catch (err) {
    console.error('[GET /api/listing/coupang/categories]', err);
    const message = err instanceof Error ? err.message : '알 수 없는 오류';
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
