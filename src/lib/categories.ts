export interface Subcategory {
  id: string;
  name: string;
}

export interface ParentCategory {
  id: string;
  name: string;
  subcategories: Subcategory[];
}

export const DEFAULT_CATEGORY_TREE: ParentCategory[] = [
  {
    id: 'goods',
    name: '잡화',
    subcategories: [
      { id: 'tumbler',  name: '텀블러' },
      { id: 'mug',      name: '머그컵' },
      { id: 'bottle',   name: '물병' },
      { id: 'ecobag',   name: '에코백' },
      { id: 'umbrella', name: '우산' },
      { id: 'wallet',   name: '지갑' },
      { id: 'pouch',    name: '파우치' },
    ],
  },
  {
    id: 'beauty',
    name: '뷰티/위생',
    subcategories: [
      { id: 'sunscreen', name: '선크림' },
      { id: 'maskpack',  name: '마스크팩' },
      { id: 'handcream', name: '핸드크림' },
      { id: 'lipbalm',   name: '립밤' },
      { id: 'shampoo',   name: '샴푸' },
      { id: 'bodywash',  name: '바디워시' },
    ],
  },
  {
    id: 'living',
    name: '생활용품',
    subcategories: [
      { id: 'storage',   name: '수납함' },
      { id: 'cleaning',  name: '청소용품' },
      { id: 'kitchen',   name: '주방용품' },
      { id: 'bathroom',  name: '욕실용품' },
      { id: 'fragrance', name: '방향제' },
    ],
  },
  {
    id: 'fashion',
    name: '패션잡화',
    subcategories: [
      { id: 'hat',   name: '모자' },
      { id: 'socks', name: '양말' },
      { id: 'belt',  name: '벨트' },
      { id: 'scarf', name: '스카프' },
      { id: 'glove', name: '장갑' },
    ],
  },
  {
    id: 'sports',
    name: '스포츠',
    subcategories: [
      { id: 'camping',  name: '캠핑용품' },
      { id: 'hiking',   name: '등산용품' },
      { id: 'swimming', name: '수영용품' },
      { id: 'fitness',  name: '헬스용품' },
      { id: 'cycling',  name: '자전거용품' },
    ],
  },
  {
    id: 'food',
    name: '식품',
    subcategories: [
      { id: 'health',    name: '건강식품' },
      { id: 'snack',     name: '간식' },
      { id: 'beverage',  name: '차/음료' },
      { id: 'seasoning', name: '조미료' },
    ],
  },
];
