/* 마이그레이션 점검 — node test-migrate.js
   가장 중요한 건 "여러 번 돌려도 같은 결과" 입니다. load/save 때마다 migrate 가 돌기 때문에,
   멱등하지 않으면 저장할 때마다 데이터가 조금씩 망가집니다. */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');   // 레포 최상위

global.window = global;
require(path.join(ROOT, 'next', 'data', 'seed.js'));            // v1 → window.WD_SEED
const V1 = JSON.parse(JSON.stringify(global.WD_SEED));
require(path.join(ROOT, 'v2', 'assets', 'store.js'));           // → window.WD
const WD = global.WD;

delete global.WD_SEED;
require(path.join(ROOT, 'v2', 'data', 'seed.js'));              // v2 → window.WD_SEED
const V2 = JSON.parse(JSON.stringify(global.WD_SEED));

let pass = 0;
function ok(name, fn) {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); process.exitCode = 1; }
}

console.log('\n[1] v1 → v2 변환');
const a = WD.migrate(V1);
ok('schema 가 2', () => assert.strictEqual(a.schema, 2));
ok('체크리스트 개수가 v1 과 같다', () => assert.strictEqual(a.checklist.length, V1.checklist.length));
ok('체크리스트 문구가 그대로 옮겨졌다', () => {
  V1.checklist.forEach((it, i) => {
    assert.strictEqual(a.checklist[i].text, typeof it === 'object' ? it.text : it);
  });
});
ok('중복 거래처(그리드룸)가 한 장으로 합쳐졌다', () => {
  const names = a.vendors.map(v => v.name);
  assert.strictEqual(new Set(names).size, names.length, '중복: ' + names.join(', '));
  assert.strictEqual(a.vendors.length, 3);
});
ok('그리드룸을 두 항목이 같은 id 로 참조한다', () => {
  // v1 에서는 "고난주간 현수막·배너 발주" 와 "부활절 현수막 발주" 가 같은 업체를 따로 안고 있었습니다.
  const refs = a.checklist.filter(c => /현수막/.test(c.text)).map(c => c.vendorId);
  assert.strictEqual(refs.length, 2, '현수막 항목 개수');
  assert.ok(refs.every(Boolean), '거래처 참조가 비었습니다');
  assert.strictEqual(new Set(refs).size, 1, '참조가 갈렸습니다: ' + refs.join(','));
});
ok('예산이 숫자로 바뀌었다', () => {
  assert.strictEqual(a.budget.total, 51200000);
  assert.strictEqual(a.budget.balance, 20025570);
});
ok('월 12개가 모두 남았다', () => assert.strictEqual(Object.keys(a.months).length, 12));
ok('팀 명단 줄 수가 보존됐다', () => {
  for (const k of Object.keys(V1.teams)) {
    assert.strictEqual(a.teams[k].lines.length, V1.teams[k].lines.length, k);
  }
});
ok('섬기는 분의 팀 연결이 유지됐다', () => {
  V1.servants.forEach((s, i) => assert.strictEqual(a.servants[i].teamId, s.team || ''));
});

console.log('\n[2] 멱등성 — 여러 번 돌려도 같은 결과여야 합니다');
const b = WD.migrate(a);
const c = WD.migrate(b);
ok('migrate(v1) == migrate(migrate(v1))', () => assert.deepStrictEqual(b, a));
ok('세 번 돌려도 같다', () => assert.deepStrictEqual(c, a));
ok('거래처 연락처가 살아남는다', () => {
  b.vendors.forEach(v => {
    const src = a.vendors.find(x => x.id === v.id);
    assert.ok(src, '없어진 거래처: ' + v.id);
    assert.strictEqual(v.contact, src.contact, v.id + ' 연락처');
    assert.strictEqual(v.detail, src.detail, v.id + ' 상세');
  });
});

console.log('\n[3] 배포 기준선(v2 seed) 자체도 멱등해야 합니다');
const s1 = WD.migrate(V2);
ok('seed 는 이미 v2 라 변환해도 그대로다', () => assert.deepStrictEqual(s1, V2));
ok('seed 거래처 id 가 유지된다', () => {
  assert.deepStrictEqual(s1.vendors.map(v => v.id), ['v_offering', 'v_daol', 'v_gridroom']);
});
ok('seed 거래처 연락처가 비어 있지 않다', () => {
  s1.vendors.forEach(v => assert.ok(v.contact || v.detail, v.id + ' 의 내용이 비었습니다'));
});
ok('seed 의 모든 vendorId 참조가 살아 있다', () => {
  const ids = new Set(s1.vendors.map(v => v.id));
  s1.checklist.forEach(c => { if (c.vendorId) assert.ok(ids.has(c.vendorId), c.vendorId); });
});

console.log('\n[4] 망가진 입력을 만나도 죽지 않아야 합니다');
ok('빈 객체', () => { const r = WD.migrate({}); assert.strictEqual(r.schema, 2); assert.deepStrictEqual(r.checklist, []); });
ok('checklist 가 배열이 아님', () => { assert.deepStrictEqual(WD.migrate({ checklist: 'x' }).checklist, []); });
ok('없는 팀을 가리키는 섬기는 분', () => {
  assert.strictEqual(WD.migrate({ servants: [{ label: 'ㄱ', name: 'ㄴ', teamId: 'nope' }] }).servants[0].teamId, '');
});
ok('없는 거래처를 가리키는 체크리스트', () => {
  assert.strictEqual(WD.migrate({ checklist: [{ text: 'ㄱ', vendorId: 'nope' }] }).checklist[0].vendorId, '');
});
ok('객체가 아니면 오류를 던진다', () => assert.throws(() => WD.migrate(null)));

console.log('\n[5] 금액 읽기/쓰기');
ok('parseWon', () => {
  assert.strictEqual(WD.parseWon('5,120만'), 51200000);
  assert.strictEqual(WD.parseWon('20,025,570원'), 20025570);
  assert.strictEqual(WD.parseWon('1억 200만'), 102000000);
  assert.strictEqual(WD.parseWon(''), null);
  assert.strictEqual(WD.parseWon(1234), 1234);
});
ok('wonShort', () => {
  assert.strictEqual(WD.wonShort(51200000), '5,120만');
  assert.strictEqual(WD.wonShort(102000000), '1억 200만');
});

console.log('\n[6] HTML 살균 — 팀 명단은 <b> 만 허용');
ok('스크립트 태그가 글자로 바뀐다', () => {
  assert.strictEqual(WD.richText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
});
ok('<b> 는 살아남는다', () => {
  assert.strictEqual(WD.richText('<b>대장</b> : 홍길동'), '<b>대장</b> : 홍길동');
});
ok('esc 는 전부 막는다', () => assert.strictEqual(WD.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;'));

console.log('\n통과 ' + pass + '개' + (process.exitCode ? ' — 실패 있음' : ' — 전부 통과'));
