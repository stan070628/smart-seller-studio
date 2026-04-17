"""
naver_demand.py
---------------
네이버 데이터랩 쇼핑인사이트 + 쇼핑 검색 API를 이용해
키워드의 '수요 점수(demand_score)'와 '경쟁 점수(competition_score)',
그리고 이 둘을 결합한 '니치 점수(niche_score)'를 계산합니다.

niche_finder.py의 스코어링에 가중치로 끼워넣는 것을 목적으로 합니다.

사용 API
- 네이버 검색 API (쇼핑):       https://openapi.naver.com/v1/search/shop.json
- 네이버 데이터랩 쇼핑인사이트:  https://openapi.naver.com/v1/datalab/shopping/category/keywords

필요 환경변수
- NAVER_CLIENT_ID
- NAVER_CLIENT_SECRET
"""

from __future__ import annotations

import os
import math
import json
import time
import logging
from dataclasses import dataclass, asdict
from datetime import date, timedelta
from typing import Iterable

import requests

logger = logging.getLogger(__name__)

NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/shop.json"
NAVER_DATALAB_KEYWORDS_URL = (
    "https://openapi.naver.com/v1/datalab/shopping/category/keywords"
)

# 네이버 쇼핑 대분류 cid 예시 (niche_finder에서 주로 쓰는 것 위주)
# 전체 목록은 네이버 쇼핑 카테고리 페이지 URL의 catId 참고
CATEGORY_CID = {
    "패션의류": "50000000",
    "패션잡화": "50000001",
    "화장품미용": "50000002",
    "디지털가전": "50000003",
    "가구인테리어": "50000004",
    "출산육아": "50000005",
    "식품": "50000006",
    "스포츠레저": "50000007",
    "생활건강": "50000008",
    "여가생활편의": "50000009",
}


# ---------------------------------------------------------------------------
# 데이터 클래스
# ---------------------------------------------------------------------------

@dataclass
class NaverScore:
    keyword: str
    category: str
    trend_growth: float          # 최근 구간 평균 / 이전 구간 평균
    recent_volume: float         # 최근 구간 평균 ratio (데이터랩 정규화 값)
    total_products: int          # 네이버 쇼핑 노출 상품 수
    demand_score: float          # 0~100
    competition_score: float     # 0~100 (높을수록 경쟁 낮음 = 좋음)
    niche_score: float           # 0~100 (최종)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# 저수준 호출
# ---------------------------------------------------------------------------

class NaverClient:
    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        timeout: int = 10,
    ):
        self.client_id = client_id or os.getenv("NAVER_CLIENT_ID")
        self.client_secret = client_secret or os.getenv("NAVER_CLIENT_SECRET")
        if not (self.client_id and self.client_secret):
            raise RuntimeError(
                "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다."
            )
        self.timeout = timeout

    def _headers_search(self) -> dict:
        return {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }

    def _headers_datalab(self) -> dict:
        return {
            **self._headers_search(),
            "Content-Type": "application/json",
        }

    def shopping_search_total(self, keyword: str) -> int:
        """네이버 쇼핑 검색 결과 total 수 (경쟁강도 프록시)"""
        params = {"query": keyword, "display": 1, "start": 1, "sort": "sim"}
        r = requests.get(
            NAVER_SEARCH_URL,
            headers=self._headers_search(),
            params=params,
            timeout=self.timeout,
        )
        r.raise_for_status()
        return int(r.json().get("total", 0))

    def datalab_keyword_trend(
        self,
        category_cid: str,
        keyword: str,
        *,
        months: int = 3,
        time_unit: str = "date",   # "date" | "week" | "month"
    ) -> list[dict]:
        """
        특정 카테고리 내에서 키워드의 클릭 추이를 조회.
        반환: [{"period": "YYYY-MM-DD", "ratio": float}, ...]
        ratio는 구간 내 최대값을 100으로 정규화한 상대값.
        """
        end = date.today()
        start = end - timedelta(days=months * 30)

        body = {
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "timeUnit": time_unit,
            "category": category_cid,
            "keyword": [{"name": keyword, "param": [keyword]}],
        }
        r = requests.post(
            NAVER_DATALAB_KEYWORDS_URL,
            headers=self._headers_datalab(),
            data=json.dumps(body),
            timeout=self.timeout,
        )
        r.raise_for_status()
        results = r.json().get("results", [])
        if not results:
            return []
        return results[0].get("data", [])


# ---------------------------------------------------------------------------
# 스코어 계산
# ---------------------------------------------------------------------------

def _split_recent_prior(series: list[dict], recent_ratio: float = 0.33):
    """
    시계열을 최근 구간(recent_ratio)과 이전 구간으로 쪼개 평균 비율을 반환.

    recent_ratio=0.33이면 전체의 마지막 1/3을 최근 구간으로 사용.
    데이터가 없으면 (0.0, 0.0) 반환.
    """
    if not series:
        return 0.0, 0.0

    n = max(1, int(len(series) * recent_ratio))
    recent = series[-n:]
    prior = series[:-n]

    avg = lambda s: (sum(x["ratio"] for x in s) / len(s)) if s else 0.0
    return avg(recent), avg(prior)


def _demand_score(recent_avg: float, prior_avg: float) -> tuple[float, float]:
    """
    수요 점수 (0~100).
    - 최근 볼륨 (50점): 데이터랩 ratio는 0~100 상대값이므로 그대로 사용
    - 성장률   (50점): recent/prior 비율 기반. 1.0=보합, 1.5 이상 만점

    데이터 자체가 없으면(recent_avg == 0 and prior_avg == 0) (0.0, 0.0) 반환.
    """
    # 데이터 없는 키워드 — 점수 부여 안 함
    if recent_avg == 0 and prior_avg == 0:
        return 0.0, 0.0

    volume_pts = min(recent_avg, 100.0) * 0.5   # 0~50

    if prior_avg <= 0:
        # prior가 없고 recent는 있는 경우 → 새로 뜬 키워드 보너스
        growth = 1.5
    else:
        growth = recent_avg / prior_avg

    # 성장률 1.0 → 25점, 1.5 이상 → 50점, 0.5 이하 → 0점 (선형)
    growth_pts = max(0.0, min(50.0, (growth - 0.5) * 50.0))
    return volume_pts + growth_pts, growth


def _competition_score(total_products: int) -> float:
    """
    경쟁 점수 (0~100). 상품 수가 적을수록 점수 높음.
    log10 스케일: 100개=100점, 1,000개=80점, 10,000개=60점,
                 100,000개=40점, 1,000,000개=20점, 1,000만+ =0점
    """
    if total_products <= 0:
        return 100.0
    score = 140.0 - 20.0 * math.log10(total_products)
    return max(0.0, min(100.0, score))


def score_keyword(
    client: NaverClient,
    keyword: str,
    category: str,
    *,
    months: int = 3,
    demand_weight: float = 0.6,
    competition_weight: float = 0.4,
) -> NaverScore:
    """한 키워드에 대한 수요/경쟁/니치 점수 계산."""
    if category not in CATEGORY_CID:
        raise ValueError(
            f"Unknown category '{category}'. "
            f"choices={list(CATEGORY_CID)}"
        )
    cid = CATEGORY_CID[category]

    series = client.datalab_keyword_trend(cid, keyword, months=months)
    recent_avg, prior_avg = _split_recent_prior(series)
    demand, growth = _demand_score(recent_avg, prior_avg)

    total = client.shopping_search_total(keyword)
    comp = _competition_score(total)

    niche = demand * demand_weight + comp * competition_weight

    return NaverScore(
        keyword=keyword,
        category=category,
        trend_growth=round(growth, 3),
        recent_volume=round(recent_avg, 2),
        total_products=total,
        demand_score=round(demand, 2),
        competition_score=round(comp, 2),
        niche_score=round(niche, 2),
    )


def score_keywords(
    keywords: Iterable[str],
    category: str,
    *,
    sleep: float = 0.3,
    **kwargs,
) -> list[NaverScore]:
    """여러 키워드를 순차 처리. API rate limit 고려해 sleep 기본 0.3s."""
    client = NaverClient()
    out: list[NaverScore] = []
    for kw in keywords:
        try:
            out.append(score_keyword(client, kw, category, **kwargs))
        except requests.HTTPError as e:
            logger.warning("HTTP %s on keyword '%s': %s", e.response.status_code, kw, e)
        except Exception as e:
            logger.exception("Failed on keyword '%s': %s", kw, e)
        time.sleep(sleep)
    return out


# ---------------------------------------------------------------------------
# niche_finder.py 연동 헬퍼
# ---------------------------------------------------------------------------

def inject_into_row(row: dict, score: NaverScore, weight: float = 0.3) -> dict:
    """
    niche_finder의 스코어링 dict에 네이버 수요 지표를 덧붙인다.
    기존 final_score에 weight만큼 가중 합산.

    예)
        row = {"keyword": "무선 청소기", "final_score": 72.1, ...}
        score = score_keyword(client, "무선 청소기", "생활건강")
        row = inject_into_row(row, score, weight=0.3)
    """
    row["naver_trend_growth"] = score.trend_growth
    row["naver_recent_volume"] = score.recent_volume
    row["naver_total_products"] = score.total_products
    row["naver_demand_score"] = score.demand_score
    row["naver_competition_score"] = score.competition_score
    row["naver_niche_score"] = score.niche_score

    base = row.get("final_score", 0.0)
    row["final_score"] = round(base * (1 - weight) + score.niche_score * weight, 2)
    return row


# ---------------------------------------------------------------------------
# CLI 테스트
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("keywords", nargs="+", help="검사할 키워드들")
    parser.add_argument(
        "--category", default="생활건강",
        help=f"카테고리 (기본 생활건강). choices={list(CATEGORY_CID)}",
    )
    parser.add_argument("--months", type=int, default=3)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    results = score_keywords(args.keywords, args.category, months=args.months)
    results.sort(key=lambda r: r.niche_score, reverse=True)

    print(f"\n{'키워드':<20} {'성장률':>7} {'최근볼륨':>8} {'상품수':>10} "
          f"{'수요':>6} {'경쟁':>6} {'니치':>6}")
    print("-" * 75)
    for r in results:
        print(
            f"{r.keyword:<20} {r.trend_growth:>7.2f} {r.recent_volume:>8.1f} "
            f"{r.total_products:>10,} {r.demand_score:>6.1f} "
            f"{r.competition_score:>6.1f} {r.niche_score:>6.1f}"
        )
