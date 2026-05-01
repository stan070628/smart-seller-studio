-- ─────────────────────────────────────────────────────────────────────────
-- 052: sourcing_items.parent_category_name 컬럼 + 백필
--
-- 배경:
--   카테고리 필터(부모 카테고리 = '주방용품' 등) 사용 시 0건이 나오는 문제 해결.
--   기존 코드는 CATEGORY_MAP에 등록된 자식만 IN 절로 SQL에 보내서 매핑 누락된
--   세분류는 검색에서 빠졌고, '기타' 부모는 v.category_name = '기타' 정확 매칭으로
--   항상 0건이었음.
--
-- 변경:
--   1. sourcing_items.parent_category_name 컬럼 추가 (일반 컬럼, NULL 허용)
--   2. CATEGORY_MAP과 동일한 매핑을 가진 SQL 함수 domeggook_parent_category() 정의
--      (일회성 백필 + 향후 SQL 레벨 fallback 용도. 권위 있는 정의는 TS의 toParentCategory)
--   3. 기존 행 백필
--   4. parent_category_name 인덱스 추가
--   5. sales_analysis_view 재생성 — si.parent_category_name 포함
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. 컬럼 추가
ALTER TABLE public.sourcing_items
  ADD COLUMN IF NOT EXISTS parent_category_name text;

-- 2. 매핑 함수 — src/lib/sourcing/category-map.ts 의 CATEGORY_MAP 과 동기화
--    IMMUTABLE 로 선언해 인덱스/제너레이트 컬럼에서도 활용 가능하게 함
CREATE OR REPLACE FUNCTION public.domeggook_parent_category(sub text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE sub
    -- 주방용품
    WHEN '주방정리소품' THEN '주방용품'
    WHEN '일반주방세제' THEN '주방용품'
    WHEN '수세미' THEN '주방용품'
    WHEN '기타주방잡화' THEN '주방용품'
    WHEN '키친타월' THEN '주방용품'
    WHEN '쿠킹호일' THEN '주방용품'
    WHEN '앞치마/토시/두건' THEN '주방용품'
    WHEN '앞치마' THEN '주방용품'
    WHEN '일반프라이팬' THEN '주방용품'
    WHEN '플라스틱용기' THEN '주방용품'
    WHEN '야채탈수기' THEN '주방용품'
    WHEN '주방장갑' THEN '주방용품'
    WHEN '행주' THEN '주방용품'
    WHEN '랩' THEN '주방용품'
    WHEN '지퍼백' THEN '주방용품'
    WHEN '롤백' THEN '주방용품'
    WHEN '쟁반' THEN '주방용품'
    WHEN '식기건조대' THEN '주방용품'
    WHEN '쿠킹타이머' THEN '주방용품'
    WHEN '양념통/설탕프림기' THEN '주방용품'
    WHEN '도마' THEN '주방용품'
    WHEN '어린이식기' THEN '주방용품'
    WHEN '접시' THEN '주방용품'
    WHEN '믹싱볼' THEN '주방용품'
    WHEN '국자' THEN '주방용품'
    WHEN '주걱' THEN '주방용품'
    WHEN '채칼/필러' THEN '주방용품'
    WHEN '찬기' THEN '주방용품'
    WHEN '주방가위' THEN '주방용품'
    WHEN '오프너' THEN '주방용품'
    WHEN '쌀통' THEN '주방용품'
    WHEN '냄비받침' THEN '주방용품'
    WHEN '계량저울' THEN '주방용품'
    WHEN '식탁보' THEN '주방용품'
    WHEN '식기/식탁' THEN '주방용품'
    WHEN '도시락/찬합' THEN '주방용품'
    WHEN '수저' THEN '주방용품'
    WHEN '다기/주기' THEN '주방용품'
    WHEN '티포트' THEN '주방용품'
    WHEN '플라스틱컵' THEN '주방용품'
    WHEN '물병' THEN '주방용품'
    WHEN '텀블러' THEN '주방용품'
    WHEN '기타조리기구' THEN '주방용품'
    WHEN '기타보관용기' THEN '주방용품'
    WHEN '바구니' THEN '주방용품'

    -- 주방가전
    WHEN '무선포트' THEN '주방가전'
    WHEN '믹서기' THEN '주방가전'
    WHEN '전기냄비' THEN '주방가전'
    WHEN '편수냄비' THEN '주방가전'
    WHEN '양수냄비' THEN '주방가전'
    WHEN '궁중팬/튀김팬' THEN '주방가전'
    WHEN '에어프라이어' THEN '주방가전'
    WHEN '전기팬' THEN '주방가전'
    WHEN '식품건조기' THEN '주방가전'
    WHEN '핸드블렌더' THEN '주방가전'
    WHEN '라면포트' THEN '주방가전'
    WHEN '가스레인지후드' THEN '주방가전'
    WHEN '식기건조기' THEN '주방가전'
    WHEN '기타주방가전부속품' THEN '주방가전'
    WHEN '레인지대' THEN '주방가전'
    WHEN '레인지대겸용식탁' THEN '주방가전'
    WHEN '주방수납장' THEN '주방가전'
    WHEN '싱크대' THEN '주방가전'
    WHEN '홍삼제조기' THEN '주방가전'
    WHEN '비닐접착기' THEN '주방가전'

    -- 생활용품
    WHEN '소품정리함' THEN '생활용품'
    WHEN '알람/탁상시계' THEN '생활용품'
    WHEN '벽시계' THEN '생활용품'
    WHEN '생활선물세트' THEN '생활용품'
    WHEN '롤화장지' THEN '생활용품'
    WHEN '갑티슈' THEN '생활용품'
    WHEN '소품걸이' THEN '생활용품'
    WHEN '테이프' THEN '생활용품'
    WHEN '디스펜서' THEN '생활용품'
    WHEN '분무기' THEN '생활용품'
    WHEN '캘린더/달력' THEN '생활용품'
    WHEN '기타커버류' THEN '생활용품'
    WHEN '일반옷걸이' THEN '생활용품'
    WHEN '소품수납함' THEN '생활용품'
    WHEN '데코용품' THEN '생활용품'
    WHEN '장식미니어처' THEN '생활용품'
    WHEN '장식인형' THEN '생활용품'
    WHEN '화분받침' THEN '생활용품'
    WHEN '화분영양제/비료' THEN '생활용품'
    WHEN '물조리개' THEN '생활용품'
    WHEN '부채' THEN '생활용품'
    WHEN '자동우산' THEN '생활용품'
    WHEN '우산' THEN '생활용품'
    WHEN '메모꽂이' THEN '생활용품'
    WHEN '디자인문패' THEN '생활용품'
    WHEN '정리기' THEN '생활용품'

    -- 청소/세탁
    WHEN '먼지떨이/먼지제거기' THEN '청소/세탁'
    WHEN '테이프클리너' THEN '청소/세탁'
    WHEN '세탁볼' THEN '청소/세탁'
    WHEN '보풀제거기' THEN '청소/세탁'
    WHEN '솔' THEN '청소/세탁'
    WHEN '빨래비누' THEN '청소/세탁'
    WHEN '세탁솔' THEN '청소/세탁'
    WHEN '유리닦이용품' THEN '청소/세탁'
    WHEN '유리세정제' THEN '청소/세탁'
    WHEN '스티커/타르제거제' THEN '청소/세탁'
    WHEN '욕실청소도구' THEN '청소/세탁'
    WHEN '고무장갑' THEN '청소/세탁'
    WHEN '비닐장갑' THEN '청소/세탁'

    -- 욕실용품
    WHEN '목욕비누' THEN '욕실용품'
    WHEN '비누' THEN '욕실용품'
    WHEN '바디클렌저' THEN '욕실용품'
    WHEN '바디브러시' THEN '욕실용품'
    WHEN '샤워용품' THEN '욕실용품'
    WHEN '때타월/때장갑' THEN '욕실용품'
    WHEN '세면타월' THEN '욕실용품'
    WHEN '타월/가운' THEN '욕실용품'
    WHEN '목욕바구니' THEN '욕실용품'
    WHEN '욕실화' THEN '욕실용품'
    WHEN '욕실선반' THEN '욕실용품'
    WHEN '변기커버' THEN '욕실용품'
    WHEN '화장지케이스' THEN '욕실용품'
    WHEN '수도/수전용품' THEN '욕실용품'
    WHEN '샤워기/욕조' THEN '욕실용품'

    -- 뷰티/화장품
    WHEN '핸드케어' THEN '뷰티/화장품'
    WHEN '헤어브러시' THEN '뷰티/화장품'
    WHEN '화장품케이스' THEN '뷰티/화장품'
    WHEN '마스크/팩세트' THEN '뷰티/화장품'
    WHEN '마스크시트' THEN '뷰티/화장품'
    WHEN '스킨' THEN '뷰티/화장품'
    WHEN '선크림' THEN '뷰티/화장품'
    WHEN '타투' THEN '뷰티/화장품'
    WHEN '브러시세트' THEN '뷰티/화장품'
    WHEN '남성화장품세트' THEN '뷰티/화장품'
    WHEN '화장품정리함' THEN '뷰티/화장품'
    WHEN '클렌징폼' THEN '뷰티/화장품'
    WHEN '클렌징티슈' THEN '뷰티/화장품'
    WHEN '기타페이스소품' THEN '뷰티/화장품'
    WHEN '남성용면도기' THEN '뷰티/화장품'
    WHEN '면도기' THEN '뷰티/화장품'
    WHEN '쉐이빙폼' THEN '뷰티/화장품'
    WHEN '여성가발' THEN '뷰티/화장품'
    WHEN '트윈케이크' THEN '뷰티/화장품'
    WHEN 'BB크림' THEN '뷰티/화장품'
    WHEN '퍼프' THEN '뷰티/화장품'
    WHEN '립브러시' THEN '뷰티/화장품'
    WHEN '페이스브러시' THEN '뷰티/화장품'
    WHEN '화장품세트' THEN '뷰티/화장품'
    WHEN 'DIY화장품재료' THEN '뷰티/화장품'
    WHEN '속눈썹/속눈썹펌제' THEN '뷰티/화장품'
    WHEN '눈썹칼' THEN '뷰티/화장품'
    WHEN '눈썹가위' THEN '뷰티/화장품'
    WHEN '립케어' THEN '뷰티/화장품'
    WHEN '바디로션' THEN '뷰티/화장품'
    WHEN '바디크림' THEN '뷰티/화장품'
    WHEN '염색약' THEN '뷰티/화장품'
    WHEN '헤어젤' THEN '뷰티/화장품'
    WHEN '피부케어기기' THEN '뷰티/화장품'
    WHEN '이미용가전액세서리' THEN '뷰티/화장품'
    WHEN '미용가위' THEN '뷰티/화장품'
    WHEN '이발기' THEN '뷰티/화장품'
    WHEN '드라이어' THEN '뷰티/화장품'
    WHEN '헤어롤' THEN '뷰티/화장품'
    WHEN '풋케어' THEN '뷰티/화장품'
    WHEN '마사지크림/젤' THEN '뷰티/화장품'

    -- 건강/의료
    WHEN '치약' THEN '건강/의료'
    WHEN '칫솔' THEN '건강/의료'
    WHEN '치실/치간칫솔' THEN '건강/의료'
    WHEN '칫솔치약세트' THEN '건강/의료'
    WHEN '구강청결제' THEN '건강/의료'
    WHEN '구강티슈' THEN '건강/의료'
    WHEN '코건강용품' THEN '건강/의료'
    WHEN '디지털체중계' THEN '건강/의료'
    WHEN '찜질팩' THEN '건강/의료'
    WHEN '마사지도구' THEN '건강/의료'
    WHEN '안마기' THEN '건강/의료'
    WHEN '발지압/발매트' THEN '건강/의료'
    WHEN '발각질제거기' THEN '건강/의료'
    WHEN '발가락교정기' THEN '건강/의료'
    WHEN '손발톱정리기' THEN '건강/의료'
    WHEN '네일케어도구' THEN '건강/의료'
    WHEN '네일케어세트' THEN '건강/의료'
    WHEN '족집게' THEN '건강/의료'
    WHEN '세안도구' THEN '건강/의료'
    WHEN '먼지차단마스크' THEN '건강/의료'
    WHEN '방진용품' THEN '건강/의료'
    WHEN '넥카라' THEN '건강/의료'
    WHEN '헬스기구' THEN '건강/의료'
    WHEN '악력기' THEN '건강/의료'
    WHEN '건강슬리퍼' THEN '건강/의료'

    -- 식품
    WHEN '국수면' THEN '식품'
    WHEN '기타건강즙/과일즙' THEN '식품'
    WHEN '기타분말가루' THEN '식품'
    WHEN '참치/연어' THEN '식품'
    WHEN '기타건강보조식품' THEN '식품'
    WHEN '기타차' THEN '식품'
    WHEN '혼합세트' THEN '식품'
    WHEN '캡슐/환' THEN '식품'
    WHEN '기타홍삼제품' THEN '식품'
    WHEN '홍삼액' THEN '식품'
    WHEN '콜라겐' THEN '식품'
    WHEN '기타비타민' THEN '식품'
    WHEN '루테인' THEN '식품'
    WHEN '건강환/정' THEN '식품'
    WHEN '기타건강/기능성음료' THEN '식품'
    WHEN '기타과자' THEN '식품'
    WHEN '소금' THEN '식품'
    WHEN '마늘' THEN '식품'
    WHEN '인삼' THEN '식품'
    WHEN '누룽지' THEN '식품'
    WHEN '컵라면' THEN '식품'
    WHEN '캐러멜' THEN '식품'
    WHEN '가공안주류' THEN '식품'
    WHEN '생강차' THEN '식품'
    WHEN '율무차' THEN '식품'

    -- 패션의류
    WHEN '코트' THEN '패션의류'
    WHEN '바지' THEN '패션의류'
    WHEN '티셔츠' THEN '패션의류'
    WHEN '잠옷/홈웨어' THEN '패션의류'
    WHEN '레깅스' THEN '패션의류'
    WHEN '니트/스웨터' THEN '패션의류'
    WHEN '레인코트' THEN '패션의류'
    WHEN '티셔츠/후드' THEN '패션의류'
    WHEN '재킷/점퍼' THEN '패션의류'
    WHEN '롱' THEN '패션의류'
    WHEN '압박보정스타킹' THEN '패션의류'
    WHEN '팬티스타킹' THEN '패션의류'

    -- 패션잡화
    WHEN '기타패션소품' THEN '패션잡화'
    WHEN '양말' THEN '패션잡화'
    WHEN '모자' THEN '패션잡화'
    WHEN '머플러' THEN '패션잡화'
    WHEN '넥워머' THEN '패션잡화'
    WHEN '여성장갑' THEN '패션잡화'
    WHEN '비니' THEN '패션잡화'
    WHEN '선글라스' THEN '패션잡화'
    WHEN '패션팔찌' THEN '패션잡화'
    WHEN '패션목걸이' THEN '패션잡화'
    WHEN '패션브로치' THEN '패션잡화'
    WHEN '보석브로치' THEN '패션잡화'
    WHEN '패션발찌' THEN '패션잡화'
    WHEN '수면양말' THEN '패션잡화'
    WHEN '스니커즈양말' THEN '패션잡화'
    WHEN '발가락양말' THEN '패션잡화'
    WHEN '중목/장목양말' THEN '패션잡화'
    WHEN '스포츠양말' THEN '패션잡화'
    WHEN '니삭스' THEN '패션잡화'
    WHEN '페이크삭스' THEN '패션잡화'
    WHEN '덧신' THEN '패션잡화'
    WHEN '목도리' THEN '패션잡화'
    WHEN '스카프' THEN '패션잡화'
    WHEN '스카프/목도리/케이프' THEN '패션잡화'
    WHEN '암워머/토시' THEN '패션잡화'
    WHEN '레그워머' THEN '패션잡화'
    WHEN '헤어핀' THEN '패션잡화'
    WHEN '헤어밴드' THEN '패션잡화'
    WHEN '헤어끈' THEN '패션잡화'
    WHEN '기타헤어소품' THEN '패션잡화'
    WHEN '집게' THEN '패션잡화'
    WHEN '사파리모자' THEN '패션잡화'
    WHEN '귀달이모자' THEN '패션잡화'
    WHEN '선캡' THEN '패션잡화'
    WHEN '일반캡' THEN '패션잡화'
    WHEN '귀마개' THEN '패션잡화'
    WHEN '안경소품' THEN '패션잡화'
    WHEN '안경케이스' THEN '패션잡화'
    WHEN '캐주얼벨트' THEN '패션잡화'
    WHEN '여성벨트' THEN '패션잡화'
    WHEN '정장벨트' THEN '패션잡화'
    WHEN '기본넥타이' THEN '패션잡화'
    WHEN '나비넥타이' THEN '패션잡화'
    WHEN '아이스머플러/스카프' THEN '패션잡화'

    -- 가방/지갑
    WHEN '파우치' THEN '가방/지갑'
    WHEN '키홀더' THEN '가방/지갑'
    WHEN '여행소품케이스' THEN '가방/지갑'
    WHEN '토트백' THEN '가방/지갑'
    WHEN '클러치백' THEN '가방/지갑'
    WHEN '크로스백' THEN '가방/지갑'
    WHEN '백팩' THEN '가방/지갑'
    WHEN '에코백' THEN '가방/지갑'
    WHEN '쇼핑백' THEN '가방/지갑'
    WHEN '보스턴가방' THEN '가방/지갑'
    WHEN '브리프케이스' THEN '가방/지갑'
    WHEN '가방' THEN '가방/지갑'
    WHEN '카드/명함지갑' THEN '가방/지갑'
    WHEN '여권지갑/케이스' THEN '가방/지갑'
    WHEN '지갑' THEN '가방/지갑'
    WHEN '반지갑' THEN '가방/지갑'
    WHEN '머니클립' THEN '가방/지갑'
    WHEN '기내용캐리어' THEN '가방/지갑'
    WHEN '캐리어소품' THEN '가방/지갑'
    WHEN '신발주머니/보조가방' THEN '가방/지갑'
    WHEN '수영가방' THEN '가방/지갑'
    WHEN '여행용세트' THEN '가방/지갑'
    WHEN '네임태그' THEN '가방/지갑'
    WHEN '기타케이스' THEN '가방/지갑'

    -- 신발
    WHEN '실내화' THEN '신발'
    WHEN '슬리퍼' THEN '신발'
    WHEN '아쿠아슈즈' THEN '신발'
    WHEN '신발깔창' THEN '신발'
    WHEN '슈즈커버' THEN '신발'
    WHEN '기타신발용품' THEN '신발'
    WHEN '신발/양말' THEN '신발'

    -- 유아/아동
    WHEN '턱받이' THEN '유아/아동'
    WHEN '유아칫솔' THEN '유아/아동'
    WHEN '아동시계' THEN '유아/아동'
    WHEN '기타유아동잡화' THEN '유아/아동'
    WHEN '젖병' THEN '유아/아동'
    WHEN '유아옷걸이' THEN '유아/아동'
    WHEN '유모차커버' THEN '유아/아동'
    WHEN '신생아모자/보닛' THEN '유아/아동'
    WHEN '모서리보호대' THEN '유아/아동'
    WHEN '콘센트안전커버' THEN '유아/아동'
    WHEN '도어락/안전고리' THEN '유아/아동'
    WHEN '기타안전용품' THEN '유아/아동'

    -- 완구/장난감
    WHEN '팽이' THEN '완구/장난감'
    WHEN '기타블록' THEN '완구/장난감'
    WHEN '레고' THEN '완구/장난감'
    WHEN '비눗방울' THEN '완구/장난감'
    WHEN '장난감/토이' THEN '완구/장난감'
    WHEN '물총' THEN '완구/장난감'
    WHEN '모래놀이' THEN '완구/장난감'
    WHEN '원목블록' THEN '완구/장난감'
    WHEN '자석블록' THEN '완구/장난감'
    WHEN '빅블록' THEN '완구/장난감'
    WHEN '낚시놀이' THEN '완구/장난감'
    WHEN '로봇' THEN '완구/장난감'
    WHEN '기타스포츠완구' THEN '완구/장난감'
    WHEN '봉제인형' THEN '완구/장난감'
    WHEN '기타인형' THEN '완구/장난감'
    WHEN '화장놀이' THEN '완구/장난감'
    WHEN '쿠킹토이' THEN '완구/장난감'
    WHEN '기타역할놀이/소꿉놀이' THEN '완구/장난감'
    WHEN '기타감각발달완구' THEN '완구/장난감'
    WHEN '링쌓기/컵쌓기' THEN '완구/장난감'
    WHEN '딸랑이' THEN '완구/장난감'
    WHEN '기타신생아/영유아완구' THEN '완구/장난감'
    WHEN '기타작동완구' THEN '완구/장난감'
    WHEN '동물작동완구' THEN '완구/장난감'
    WHEN '자동장난감' THEN '완구/장난감'
    WHEN '야광용품' THEN '완구/장난감'
    WHEN '보행기튜브' THEN '완구/장난감'
    WHEN '가면/머리띠' THEN '완구/장난감'
    WHEN '클레이' THEN '완구/장난감'
    WHEN '곤충학습' THEN '완구/장난감'
    WHEN '기타언어/학습완구' THEN '완구/장난감'
    WHEN '스카이콩콩' THEN '완구/장난감'
    WHEN '보드게임' THEN '완구/장난감'
    WHEN '학습보드게임' THEN '완구/장난감'
    WHEN '야구/캐치볼' THEN '완구/장난감'
    WHEN '줄넘기' THEN '완구/장난감'
    WHEN '훌라후프' THEN '완구/장난감'
    WHEN '공/소프트볼' THEN '완구/장난감'
    WHEN '드럼' THEN '완구/장난감'
    WHEN '타악기' THEN '완구/장난감'
    WHEN '기타음악/악기놀이' THEN '완구/장난감'
    WHEN '마이크/노래방' THEN '완구/장난감'
    WHEN '피아노커버' THEN '완구/장난감'

    -- 문구/사무
    WHEN '스케치북/크로키북' THEN '문구/사무'
    WHEN '필통' THEN '문구/사무'
    WHEN '문구세트' THEN '문구/사무'
    WHEN '사무용가위' THEN '문구/사무'
    WHEN '사무용칼' THEN '문구/사무'
    WHEN '연필깎이' THEN '문구/사무'
    WHEN '기타필기도구' THEN '문구/사무'
    WHEN '기타문구용품' THEN '문구/사무'
    WHEN '일반계산기' THEN '문구/사무'
    WHEN '자' THEN '문구/사무'
    WHEN '아크릴물감' THEN '문구/사무'

    -- 반려동물
    WHEN '기타반려동물용품' THEN '반려동물'
    WHEN '배변봉투/집게' THEN '반려동물'
    WHEN '분변통/모래삽' THEN '반려동물'
    WHEN '급수기/물병' THEN '반려동물'
    WHEN '배변패드' THEN '반려동물'
    WHEN '훈련용품' THEN '반려동물'
    WHEN '이동장/이동가방' THEN '반려동물'
    WHEN '스크래쳐' THEN '반려동물'
    WHEN '하우스' THEN '반려동물'
    WHEN '가슴줄' THEN '반려동물'
    WHEN '목줄' THEN '반려동물'
    WHEN '자동급식기' THEN '반려동물'
    WHEN '사료통/사료스푼' THEN '반려동물'
    WHEN '평판형화장실' THEN '반려동물'

    -- 가구/인테리어
    WHEN '인테리어파티션' THEN '가구/인테리어'
    WHEN '쿠션/방석' THEN '가구/인테리어'
    WHEN '에어컨커버' THEN '가구/인테리어'
    WHEN '의자커버' THEN '가구/인테리어'
    WHEN '상커버' THEN '가구/인테리어'
    WHEN '블라인드' THEN '가구/인테리어'
    WHEN '커튼링/봉' THEN '가구/인테리어'
    WHEN '의자' THEN '가구/인테리어'
    WHEN '일자형책상' THEN '가구/인테리어'
    WHEN '의자발받침대' THEN '가구/인테리어'
    WHEN '가구바퀴' THEN '가구/인테리어'
    WHEN '기타가구부속품' THEN '가구/인테리어'
    WHEN '코너선반/진열대' THEN '가구/인테리어'
    WHEN '벽걸이선반/진열대' THEN '가구/인테리어'
    WHEN '이동식선반/진열대' THEN '가구/인테리어'
    WHEN '선반' THEN '가구/인테리어'
    WHEN '진열대' THEN '가구/인테리어'
    WHEN '문풍지' THEN '가구/인테리어'
    WHEN '기타바닥재' THEN '가구/인테리어'
    WHEN '해먹' THEN '가구/인테리어'
    WHEN '마네킹' THEN '가구/인테리어'

    -- 생활가전
    WHEN '멀티탭' THEN '생활가전'
    WHEN '기타전기용품' THEN '생활가전'
    WHEN '스탠드형선풍기' THEN '생활가전'
    WHEN '탁상형선풍기' THEN '생활가전'
    WHEN '휴대용선풍기' THEN '생활가전'
    WHEN '차량용선풍기' THEN '생활가전'
    WHEN '선풍기부속품' THEN '생활가전'
    WHEN '서큘레이터' THEN '생활가전'
    WHEN '스탠드형서큘레이터' THEN '생활가전'
    WHEN '탁상형서큘레이터' THEN '생활가전'
    WHEN '일반용냉풍기' THEN '생활가전'
    WHEN '스팀다리미' THEN '생활가전'
    WHEN '미니세탁기' THEN '생활가전'
    WHEN '세탁기부품' THEN '생활가전'
    WHEN 'USB가습기' THEN '생활가전'
    WHEN '초음파식가습기' THEN '생활가전'
    WHEN '가습기필터' THEN '생활가전'
    WHEN 'LED모듈' THEN '생활가전'
    WHEN '현관조명' THEN '생활가전'
    WHEN '실내등' THEN '생활가전'
    WHEN '단스탠드' THEN '생활가전'
    WHEN '온도계/습도계' THEN '생활가전'
    WHEN '테스트기' THEN '생활가전'
    WHEN '산업용저울' THEN '생활가전'
    WHEN '기타측정기' THEN '생활가전'
    WHEN 'LCoS/기타' THEN '생활가전'

    -- TV/음향가전
    WHEN '블루투스스피커' THEN 'TV/음향가전'
    WHEN '헤드폰' THEN 'TV/음향가전'
    WHEN '일반마이크' THEN 'TV/음향가전'

    -- 디지털기기
    WHEN '보조배터리' THEN '디지털기기'
    WHEN '멀티리더기' THEN '디지털기기'
    WHEN '기타휴대폰액세서리' THEN '디지털기기'
    WHEN '휴대폰거치대' THEN '디지털기기'
    WHEN '휴대폰이어캡' THEN '디지털기기'
    WHEN 'LCD보호커버' THEN '디지털기기'
    WHEN '기타카메라가방/케이스' THEN '디지털기기'
    WHEN '케이블타이/정리함' THEN '디지털기기'
    WHEN '젤리/우레탄밴드시계' THEN '디지털기기'

    -- 자동차용품
    WHEN '핸들커버' THEN '자동차용품'
    WHEN '차량용햇빛가리개' THEN '자동차용품'
    WHEN '자동차' THEN '자동차용품'

    -- 스포츠/아웃도어
    WHEN '스포츠토시' THEN '스포츠/아웃도어'
    WHEN '스포츠넥워머' THEN '스포츠/아웃도어'
    WHEN '바이크장갑' THEN '스포츠/아웃도어'
    WHEN '튜브' THEN '스포츠/아웃도어'
    WHEN '기타캠핑용품' THEN '스포츠/아웃도어'
    WHEN '헤드랜턴' THEN '스포츠/아웃도어'
    WHEN '암밴드' THEN '스포츠/아웃도어'
    WHEN '케이스/파우치' THEN '스포츠/아웃도어'
    WHEN '보호쿠션/패드' THEN '스포츠/아웃도어'

    -- 공구
    WHEN '드라이버' THEN '공구'
    WHEN '렌치' THEN '공구'
    WHEN '공구세트' THEN '공구'
    WHEN '캘리퍼스' THEN '공구'
    WHEN '워킹자/줄자' THEN '공구'
    WHEN '기타수작업공구' THEN '공구'
    WHEN '기타전동공구' THEN '공구'
    WHEN '경첩/꺽쇠/자석철물류' THEN '공구'
    WHEN '핸드카트/운반기' THEN '공구'

    ELSE NULL  -- 매핑 누락 → '기타' 처리는 호출자가 결정
  END;
$$;

COMMENT ON FUNCTION public.domeggook_parent_category(text)
  IS '도매꾹 세분류 → 상위 카테고리 매핑. src/lib/sourcing/category-map.ts 의 CATEGORY_MAP과 동기화 유지';

-- 3. 기존 행 백필
UPDATE public.sourcing_items
SET parent_category_name = COALESCE(public.domeggook_parent_category(category_name), '기타')
WHERE category_name IS NOT NULL
  AND parent_category_name IS DISTINCT FROM COALESCE(public.domeggook_parent_category(category_name), '기타');

-- 4. 인덱스 — 부모 카테고리 단독 필터 + (parent, sales 정렬) 조합 모두 활용
CREATE INDEX IF NOT EXISTS idx_sourcing_items_parent_category
  ON public.sourcing_items (parent_category_name);

-- 5. sales_analysis_view 재생성 — parent_category_name 컬럼 포함
--    CONCURRENTLY refresh를 위한 unique 인덱스 + 부모 카테고리 + sales_7d 정렬용 인덱스도 함께 재구성
DROP MATERIALIZED VIEW IF EXISTS public.sales_analysis_view;

CREATE MATERIALIZED VIEW public.sales_analysis_view AS
WITH latest AS (
  SELECT DISTINCT ON (item_no)
    item_id,
    item_no,
    snapshot_date        AS latest_date,
    inventory            AS latest_inventory,
    price_dome           AS latest_price_dome,
    price_supply         AS latest_price_supply
  FROM public.inventory_snapshots
  ORDER BY item_no, snapshot_date DESC
),
prev_1d AS (
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_1d_date,
    s.inventory          AS prev_inventory_1d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date < l.latest_date
  ORDER BY s.item_no, s.snapshot_date DESC
),
prev_7d AS (
  SELECT DISTINCT ON (s.item_no)
    s.item_no,
    s.snapshot_date      AS prev_7d_date,
    s.inventory          AS prev_inventory_7d
  FROM public.inventory_snapshots s
  INNER JOIN latest l ON l.item_no = s.item_no
  WHERE s.snapshot_date <= l.latest_date - INTERVAL '7 days'
  ORDER BY s.item_no, s.snapshot_date DESC
)
SELECT
  si.id,
  si.item_no,
  si.title,
  si.status,
  si.category_name,
  si.parent_category_name,
  si.seller_nick,
  si.image_url,
  si.dome_url,
  si.is_tracking,
  l.latest_date,
  l.latest_inventory,
  l.latest_price_dome,
  l.latest_price_supply,
  p1.prev_inventory_1d,
  p1.prev_1d_date,
  GREATEST(0, COALESCE(p1.prev_inventory_1d, 0) - l.latest_inventory)  AS sales_1d,
  p7.prev_inventory_7d,
  p7.prev_7d_date,
  GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)  AS sales_7d,
  ROUND(
    GREATEST(0, COALESCE(p7.prev_inventory_7d, 0) - l.latest_inventory)::numeric
    / GREATEST(1, (l.latest_date - COALESCE(p7.prev_7d_date, l.latest_date - 7))::integer),
    2
  )                                                                      AS avg_daily_sales
FROM public.sourcing_items si
JOIN latest l ON l.item_id = si.id
LEFT JOIN prev_1d p1 ON p1.item_no = si.item_no
LEFT JOIN prev_7d p7 ON p7.item_no = si.item_no;

-- CONCURRENTLY refresh 필수 unique 인덱스
CREATE UNIQUE INDEX idx_sales_analysis_view_id ON public.sales_analysis_view (id);

-- 조회 성능 인덱스
CREATE INDEX idx_sales_analysis_view_sales7d        ON public.sales_analysis_view (sales_7d DESC);
CREATE INDEX idx_sales_analysis_view_cat            ON public.sales_analysis_view (category_name);
CREATE INDEX idx_sales_analysis_view_parent_cat     ON public.sales_analysis_view (parent_category_name);

COMMIT;
