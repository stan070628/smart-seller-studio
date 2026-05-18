-- 소싱 에이전트: 카테고리 관리
CREATE TABLE IF NOT EXISTS sourcing_agent_categories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  coupang_category_url TEXT NOT NULL,
  last_crawled_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- 소싱 에이전트: 발굴 결과
CREATE TABLE IF NOT EXISTS sourcing_agent_results (
  id SERIAL PRIMARY KEY,
  crawled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category_id INT REFERENCES sourcing_agent_categories(id),

  coupang_product_id TEXT NOT NULL,
  coupang_product_name TEXT NOT NULL,
  coupang_rank INT,
  coupang_price INT,
  coupang_image_url TEXT,
  coupang_url TEXT NOT NULL,

  domeggook_product_name TEXT,
  domeggook_price INT,
  domeggook_url TEXT,
  domeggook_image_url TEXT,
  domeggook_similarity FLOAT,

  china_product_name TEXT,
  china_price_krw INT,
  china_url TEXT,
  china_image_url TEXT,

  domeggook_margin_rate FLOAT,
  china_margin_rate FLOAT
);


CREATE INDEX IF NOT EXISTS idx_agent_results_crawled
  ON sourcing_agent_results(crawled_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_categories_last_crawled
  ON sourcing_agent_categories(last_crawled_at ASC NULLS FIRST);

-- 카테고리 시드 데이터 (세부 카테고리 30개)
INSERT INTO sourcing_agent_categories (name, coupang_category_url) VALUES
  ('욕실 수납함',       'https://www.coupang.com/np/search?q=욕실수납함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('지퍼백/위생봉투',   'https://www.coupang.com/np/search?q=지퍼백+위생봉투&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('칫솔/치약홀더',     'https://www.coupang.com/np/search?q=칫솔+치약홀더&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('걸레/밀대',         'https://www.coupang.com/np/search?q=걸레+밀대&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('주방 계량도구',     'https://www.coupang.com/np/search?q=주방계량도구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('케이블 정리함',     'https://www.coupang.com/np/search?q=케이블정리함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('서랍 정리대',       'https://www.coupang.com/np/search?q=서랍정리대&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('냉장고 정리함',     'https://www.coupang.com/np/search?q=냉장고정리함&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('반려견 장난감',     'https://www.coupang.com/np/search?q=강아지장난감&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 리드줄',     'https://www.coupang.com/np/search?q=강아지리드줄&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 의류',       'https://www.coupang.com/np/search?q=강아지옷&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('강아지 배변패드',   'https://www.coupang.com/np/search?q=강아지배변패드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 장난감',     'https://www.coupang.com/np/search?q=고양이장난감&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 스크래처',   'https://www.coupang.com/np/search?q=고양이스크래처&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('고양이 급수기',     'https://www.coupang.com/np/search?q=고양이급수기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('헤어핀/헤어밴드',  'https://www.coupang.com/np/search?q=헤어핀+헤어밴드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('네일 스티커',       'https://www.coupang.com/np/search?q=네일스티커&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('화장솜/면봉',       'https://www.coupang.com/np/search?q=화장솜+면봉&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('유아 목욕완구',     'https://www.coupang.com/np/search?q=유아목욕완구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('이유식 도구',       'https://www.coupang.com/np/search?q=이유식도구&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('치발기',            'https://www.coupang.com/np/search?q=치발기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 식기',         'https://www.coupang.com/np/search?q=캠핑식기&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 조명',         'https://www.coupang.com/np/search?q=캠핑조명+랜턴&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('캠핑 수납',         'https://www.coupang.com/np/search?q=캠핑수납+캠핑박스&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('폼롤러',            'https://www.coupang.com/np/search?q=폼롤러&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('요가블록',          'https://www.coupang.com/np/search?q=요가블록&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('미니 밴드',         'https://www.coupang.com/np/search?q=미니밴드+루프밴드&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('볼펜/형광펜 세트',  'https://www.coupang.com/np/search?q=볼펜세트+형광펜&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('포스트잇',          'https://www.coupang.com/np/search?q=포스트잇&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36'),
  ('다이어리/노트',     'https://www.coupang.com/np/search?q=다이어리+노트&channel=user&isSearchKeyword=true&sorter=saleCountDesc&listSize=36')
ON CONFLICT DO NOTHING;
