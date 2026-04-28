export interface PastReturn {
  sellerName: string;
  reason: string;
  occurredAt: Date;
}

export function shouldWarnReorder(input: {
  sellerName: string;
  pastReturns: PastReturn[];
}): { warn: boolean; count: number; reasons: string[] } {
  const sameSellerReturns = input.pastReturns.filter(
    (r) => r.sellerName === input.sellerName,
  );
  return {
    warn: sameSellerReturns.length >= 2,
    count: sameSellerReturns.length,
    reasons: sameSellerReturns.map((r) => r.reason),
  };
}
