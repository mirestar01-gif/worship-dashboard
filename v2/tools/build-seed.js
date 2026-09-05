/* next/data/seed.js (v1) → v2/data/seed.js (v2) 변환 스크립트.
   한 번 쓰고 버리는 스크립트가 아니라, 나중에 v1 을 다시 가져올 때도 씁니다. */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');   // 레포 최상위

global.window = global;
require(path.join(ROOT, 'next', 'data', 'seed.js'));            // window.WD_SEED (v1) 를 채웁니다
require(path.join(ROOT, 'v2', 'assets', 'store.js'));           // window.WD 를 채웁니다

const v2 = global.WD.migrate(global.WD_SEED);

// 체크리스트 항목을 해당 월에 연결합니다 (v1 에는 없던 정보라 문구를 보고 붙입니다).
const MONTH_BY_TEXT = [
  [/연초/,                     1],
  [/12월 공동의회 전/,          12],
  [/고난주간 특새카드/,          3],   // 고난주간 3/30-4/4 · 4주 전
  [/고난주간 현수막/,           3],   // 3주 전
  [/부활절 현수막/,             3],   // 부활주일 4/5 · 2주 전
  [/추수감사절 특새/,           11],
  [/연말 재정 결산/,            12],
  [/인수인계/,                  12],
];
for (const item of v2.checklist) {
  for (const [re, m] of MONTH_BY_TEXT) {
    if (re.test(item.text)) { item.month = m; break; }
  }
}

// 거래처 구분(label)이 항목 문구와 겹쳐 길어진 것을 카탈로그용으로 다듬습니다.
const VENDOR_LABEL = {
  '헌금위원 7명 · 헌금주머니·가운 보관': '헌금위원 · 물품 보관',
};
for (const v of v2.vendors) {
  if (VENDOR_LABEL[v.label]) v.label = VENDOR_LABEL[v.label];
}

// 자동 생성된 id 는 이름을 그대로 붙여 길고 읽기 나쁩니다.
// seed.js 를 손으로 고칠 때를 위해 짧은 id 로 바꾸고 참조도 함께 갱신합니다.
const VENDOR_ID = {
  '식당 자동출입문 왼편 붙박이장': 'v_offering',
  '다올 (임영석 대표)':            'v_daol',
  '그리드룸 (박재준 대표)':        'v_gridroom',
};
for (const v of v2.vendors) {
  const next = VENDOR_ID[v.name];
  if (!next || next === v.id) continue;
  for (const c of v2.checklist) if (c.vendorId === v.id) c.vendorId = next;
  v.id = next;
}

// 참조가 끊긴 항목이 없는지 확인합니다.
const ids = new Set(v2.vendors.map(v => v.id));
for (const c of v2.checklist) {
  if (c.vendorId && !ids.has(c.vendorId)) throw new Error('거래처 참조가 끊겼습니다: ' + c.vendorId + ' (' + c.text + ')');
}

const header = `/* 서울중앙교회 예배위원회 대시보드 — 기본값(배포 기준선) · 스키마 v2.
   이 파일 하나만 고치면 index.html 과 settings.html 양쪽에 반영됩니다.
   관리 화면에서 편집한 내용을 여기에 붙여넣어 커밋하면 두 분이 같은 값을 봅니다.

   ※ window.WD_SEED = { 로 시작해서 }; 로 끝나야 합니다. 중괄호와 끝의 세미콜론을 지우지 마세요. */
window.WD_SEED = `;

fs.writeFileSync(path.join(ROOT, 'v2', 'data', 'seed.js'), header + JSON.stringify(v2, null, 2) + ';\n', 'utf8');

// ── 확인용 요약 ──────────────────────────────────────────────
console.log('schema      :', v2.schema);
console.log('예산 총액   :', v2.budget.total, '/ 잔액', v2.budget.balance);
console.log('거래처      :', v2.vendors.length, '곳 →', v2.vendors.map(v => v.id + '(' + v.name + ')').join(', '));
console.log('체크리스트  :', v2.checklist.length, '개');
for (const c of v2.checklist) {
  console.log('   ', String(c.month ?? '-').padStart(2), '|', c.vendorId.padEnd(12), '|', c.text);
}
console.log('섬기는 분   :', v2.servants.length, '· 팀', Object.keys(v2.teams).length);
console.log('월          :', Object.keys(v2.months).join(','));
