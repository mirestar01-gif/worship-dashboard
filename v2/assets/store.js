/* 서울중앙교회 예배위원회 대시보드 — 저장/불러오기 공통 모듈 (P1 · 스키마 v2)
 *
 * index.html 과 settings.html 이 함께 씁니다.
 *   WD.load()            저장된 데이터를 v2 로 맞춰서 반환 (없으면 기본값 복사본)
 *   WD.seed()            기본값(data/seed.js) 의 복사본 — 항상 v2
 *   WD.save(data)        localStorage 에 저장 (v2 로 정규화해서)
 *   WD.reset()           저장분을 백업 키로 옮기고 기본값 복사본 반환
 *   WD.exportData(data)  현재 내용을 JSON 파일로 내려받기
 *   WD.importFromFile(f) 백업 파일을 읽어 검증·마이그레이션 후 Promise<데이터>
 *   WD.validate(obj)     문제 있으면 사람이 읽을 메시지, 없으면 null
 *   WD.migrate(obj)      v1 이든 v2 든 받아서 v2 로 변환 (여러 번 호출해도 안전)
 *   WD.esc(str)          HTML 이스케이프
 *   WD.richText(str)     <b> 만 허용하고 나머지는 이스케이프 (팀 명단 표시용)
 *   WD.won(n)            숫자를 "20,025,570원" 형태로
 *   WD.wonShort(n)       숫자를 "5,120만" 형태로
 *   WD.parseWon(str)     "5,120만" / "20,025,570원" → 숫자
 *
 * ── 스키마 v2 요약 ───────────────────────────────────────────────
 *   schema:    2
 *   meta:      { title, church, year, footer, logoUrl, manualLabel, manualUrl }
 *   budget:    { total:숫자, balance:숫자, note, asOf, warn, link:{label,url}, rows:[{name,pct}] }
 *   vendors:   [ {id, label, name, contact, detail, manualLink} ]   ← 거래처 카탈로그
 *   checklist: [ {id, text, month:1~12|null, vendorId:""|id} ]      ← 거래처를 id 로 참조
 *   servants:  [ {label, name, teamId} ]
 *   teams:     { id: {name, lines:[문자열]} }        ← <b> 만 허용, 표시할 때 살균
 *   months:    { "1"~"12": {label, tags:[{t,c}], major, weeks:[{w,title,desc,badges:[{l,c}],alarm}]} }
 *
 * v1 과 달라진 점
 *   · 거래처가 체크리스트 항목 안에 박혀 있던 것을 vendors 카탈로그로 빼고 id 로 참조합니다.
 *     (같은 업체가 여러 항목에 중복 저장되던 문제 해결)
 *   · 체크리스트 항목이 "문자열 또는 객체" 였던 것을 항상 객체로 통일했습니다.
 *   · 예산 총액·잔액을 문자열("5,120만")이 아니라 숫자로 저장합니다.
 *   · meta 에 흩어져 있던 예산 관련 값을 budget 으로 모았습니다.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'wd_data_v1';        // v1 시절 키를 그대로 씁니다 (기존 저장분을 이어받기 위해)
  var BACKUP_KEY  = 'wd_data_v1_backup';
  var SCHEMA      = 2;

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function isObj(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

  /* ── 문자열 유틸 ───────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // 팀 명단은 <b>대장</b> : 홍길동 처럼 굵게 표시를 쓰기로 되어 있습니다.
  // 통째로 innerHTML 에 넣으면 위험하므로, 전부 이스케이프한 뒤 <b> 만 되살립니다.
  function richText(s) {
    return esc(s).replace(/&lt;(\/?)b&gt;/g, '<$1b>');
  }

  /* ── 금액 유틸 ─────────────────────────────────────────── */

  // "5,120만" · "20,025,570원" · "1억 200만" → 숫자. 못 읽으면 null.
  function parseWon(v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v == null) return null;
    var s = String(v).replace(/,/g, '').replace(/원/g, '').trim();
    if (!s) return null;
    var total = 0, matched = false, m;
    if ((m = s.match(/([\d.]+)\s*억/))) { total += parseFloat(m[1]) * 1e8; s = s.replace(m[0], ''); matched = true; }
    if ((m = s.match(/([\d.]+)\s*만/))) { total += parseFloat(m[1]) * 1e4; s = s.replace(m[0], ''); matched = true; }
    var rest = s.replace(/[^\d.]/g, '');
    if (rest) { total += parseFloat(rest); matched = true; }
    return matched && isFinite(total) ? Math.round(total) : null;
  }

  function won(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '-';
    return Math.round(n).toLocaleString('ko-KR') + '원';
  }

  // 5120 만 단위로 줄여 표시. 1억 이상이면 "1억 200만".
  function wonShort(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '-';
    var v = Math.round(n);
    if (v >= 1e8) {
      var eok = Math.floor(v / 1e8);
      var man = Math.round((v % 1e8) / 1e4);
      return man ? eok + '억 ' + man.toLocaleString('ko-KR') + '만' : eok + '억';
    }
    if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만';
    return v.toLocaleString('ko-KR');
  }

  /* ── 마이그레이션 v1 → v2 ──────────────────────────────── */

  function slug(name, used) {
    var base = 'v_' + String(name || '').replace(/[^0-9A-Za-z가-힣]+/g, '').slice(0, 12);
    if (base === 'v_') base = 'v_vendor';
    var id = base, n = 2;
    while (used[id]) { id = base + '_' + n; n++; }
    used[id] = true;
    return id;
  }

  // v1 은 {label, name, sub, price}, v2 는 {id, label, name, contact, detail} 입니다.
  // 이미 v2 인 데이터를 다시 넣어도 값이 날아가지 않도록 양쪽 이름을 모두 받습니다.
  function normVendor(raw) {
    return {
      id: String(raw.id || '').trim(),
      label: String(raw.label || '').trim(),
      name: String(raw.name || '').trim(),
      contact: String(raw.contact != null ? raw.contact : (raw.sub || '')).trim(),
      detail: String(raw.detail != null ? raw.detail : (raw.price || '')).trim(),
      manualLink: !!raw.manualLink
    };
  }

  // 같은 업체가 여러 체크리스트 항목에 복사돼 있으므로, 내용이 같으면 한 장으로 합칩니다.
  function vendorKey(v) {
    return [v.label, v.name, v.contact, v.detail].join('§');
  }

  function migrateVendors(src, out) {
    var usedIds = {};
    var byKey = {};
    var byId = {};

    function intern(raw, manualLink) {
      if (!isObj(raw)) return '';
      var v = normVendor(raw);
      if (manualLink) v.manualLink = true;
      if (!v.name && !v.label) return '';

      // 이미 같은 id 로 등록돼 있으면 그 장을 씁니다 (v2 → v2 재변환).
      if (v.id && byId[v.id]) {
        if (v.manualLink) byId[v.id].manualLink = true;
        return v.id;
      }
      var key = vendorKey(v);
      if (byKey[key]) {
        if (v.manualLink) byKey[key].manualLink = true;
        return byKey[key].id;
      }
      // 원래 id 가 있으면 지키고, 없을 때만 이름에서 새로 만듭니다.
      if (v.id && !usedIds[v.id]) usedIds[v.id] = true;
      else v.id = slug(v.name || v.label, usedIds);

      byKey[key] = v;
      byId[v.id] = v;
      out.vendors.push(v);
      return v.id;
    }

    // 1) 거래처 카탈로그를 먼저 등록합니다 (v2 는 여기에 다 들어 있습니다).
    (Array.isArray(src.vendors) ? src.vendors : []).forEach(function (raw) {
      intern(raw, raw && raw.manualLink);
    });

    // 2) v1 은 체크리스트 항목 안에 업체가 박혀 있으므로 카탈로그로 끌어냅니다.
    var list = Array.isArray(src.checklist) ? src.checklist : [];
    var usedItemIds = {};
    out.checklist = list.map(function (item, i) {
      var text = '', vendorId = '', month = null, id = '';
      if (isObj(item)) {
        text = String(item.text || '');
        id = String(item.id || '');
        if (typeof item.month === 'number' && item.month >= 1 && item.month <= 12) month = item.month;
        if (item.vendorId) vendorId = String(item.vendorId);   // v2
        else vendorId = intern(item.vendor, item.vendor && item.vendor.manualLink);   // v1
      } else {
        text = String(item == null ? '' : item);
      }
      if (!id || usedItemIds[id]) id = 'c' + (i + 1);
      usedItemIds[id] = true;
      return { id: id, text: text, month: month, vendorId: vendorId };
    });

    // 3) 지워진 거래처를 가리키는 참조는 끊어 둡니다.
    out.checklist.forEach(function (c) {
      if (c.vendorId && !byId[c.vendorId]) c.vendorId = '';
    });
  }

  function migrate(input) {
    if (!isObj(input)) throw new Error('데이터가 객체 형식이 아닙니다.');
    var v1 = deepClone(input);

    var out = {
      schema: SCHEMA,
      meta: {},
      budget: {},
      vendors: [],
      checklist: [],
      servants: [],
      teams: {},
      months: {}
    };

    /* meta — 예산 관련 값은 budget 으로 옮깁니다. */
    var m = isObj(v1.meta) ? v1.meta : {};
    out.meta = {
      title: String(m.title || '예배위원회 운영 대시보드'),
      church: String(m.church || '서울중앙교회'),
      year: Number(m.year) || new Date().getFullYear(),
      footer: String(m.footer || ''),
      logoUrl: String(m.logoUrl || ''),
      manualLabel: String(m.manualLabel || '주일 봉헌 안내 매뉴얼'),
      manualUrl: String(m.manualUrl || '')
    };

    /* budget — 문자열 금액을 숫자로. */
    var b = isObj(v1.budget) ? v1.budget : {};
    var total   = parseWon(b.total   != null ? b.total   : m.budgetTotal);
    var balance = parseWon(b.balance != null ? b.balance : m.budgetBalance);
    out.budget = {
      total: total,
      balance: balance,
      note: String(b.note || m.budgetSub || ''),
      asOf: String(b.asOf || ''),
      warn: String(b.warn || ''),
      link: {
        label: String((isObj(b.link) && b.link.label) || b.linkLabel || '위원회재정통계 (웹교회관리)'),
        url: String((isObj(b.link) && b.link.url) || b.linkUrl || '')
      },
      rows: (Array.isArray(b.rows) ? b.rows : []).map(function (r) {
        return {
          name: String((r && r.name) || ''),
          pct: Math.max(0, Math.min(100, Number(r && r.pct) || 0))
        };
      })
    };

    /* vendors + checklist */
    migrateVendors(v1, out);

    /* teams — 문자열 줄 그대로 유지 (표시할 때 <b> 만 허용해 살균) */
    var teams = isObj(v1.teams) ? v1.teams : {};
    Object.keys(teams).forEach(function (k) {
      var t = teams[k] || {};
      out.teams[k] = {
        name: String(t.name || k),
        lines: (Array.isArray(t.lines) ? t.lines : []).map(String)
      };
    });

    /* servants — team → teamId 로 이름만 바꿉니다. */
    out.servants = (Array.isArray(v1.servants) ? v1.servants : []).map(function (s) {
      s = s || {};
      var tid = String(s.teamId != null ? s.teamId : (s.team || ''));
      if (tid && !out.teams[tid]) tid = '';     // 삭제된 팀을 가리키는 링크는 끊어 둡니다.
      return { label: String(s.label || ''), name: String(s.name || ''), teamId: tid };
    });

    /* months — 구조 그대로. */
    var months = isObj(v1.months) ? v1.months : {};
    for (var i = 1; i <= 12; i++) {
      var d = months[i] || months[String(i)];
      if (!isObj(d)) continue;
      out.months[String(i)] = {
        label: String(d.label || i + '월'),
        major: !!d.major,
        tags: (Array.isArray(d.tags) ? d.tags : []).map(function (t) {
          return { t: String((t && t.t) || ''), c: String((t && t.c) || 't-gray') };
        }),
        weeks: (Array.isArray(d.weeks) ? d.weeks : []).map(function (w) {
          w = w || {};
          return {
            w: String(w.w || ''),
            title: String(w.title || ''),
            desc: String(w.desc || ''),
            alarm: !!w.alarm,
            badges: (Array.isArray(w.badges) ? w.badges : []).map(function (g) {
              return { l: String((g && g.l) || ''), c: String((g && g.c) || 'b-blue') };
            })
          };
        })
      };
    }

    return out;
  }

  /* ── 저장소 ────────────────────────────────────────────── */

  function seed() {
    if (!global.WD_SEED) {
      throw new Error('data/seed.js 를 불러오지 못했습니다. <script src="./data/seed.js"> 가 store.js 보다 먼저 있는지 확인하세요.');
    }
    return migrate(global.WD_SEED);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (isObj(parsed)) return migrate(parsed);   // v1 저장분도 여기서 v2 로 올라옵니다.
      }
    } catch (e) {
      console.warn('[store] 저장된 데이터를 읽지 못해 기본값을 사용합니다.', e);
    }
    return seed();
  }

  function save(data) {
    if (!isObj(data)) throw new Error('저장할 데이터가 올바르지 않습니다.');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(migrate(data)));
    return true;
  }

  function reset() {
    try {
      var cur = localStorage.getItem(STORAGE_KEY);
      if (cur) localStorage.setItem(BACKUP_KEY, cur);   // 되돌릴 수 있게 마지막 상태를 보관
    } catch (e) { /* 보관 실패해도 초기화는 진행 */ }
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    return seed();
  }

  function validate(obj) {
    if (!isObj(obj)) return '내용이 비어 있거나 객체 형식이 아닙니다.';
    if (!isObj(obj.meta)) return 'meta(기본 정보) 항목이 없습니다.';
    if (!isObj(obj.months)) return 'months(월별 일정) 항목이 없습니다.';
    if (!Array.isArray(obj.checklist)) return 'checklist(체크리스트) 항목이 배열이 아닙니다.';
    if (!Array.isArray(obj.servants)) return 'servants(섬기는 분) 항목이 배열이 아닙니다.';
    if (!isObj(obj.budget) || !Array.isArray(obj.budget.rows)) return 'budget(예산) 항목이 올바르지 않습니다.';
    return null;
  }

  function dateStamp() {
    var d = new Date();
    return d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  function exportData(data) {
    var payload = migrate(data || load());
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'worship-dashboard-backup-' + dateStamp() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('파일이 선택되지 않았습니다.')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('파일을 읽을 수 없습니다.')); };
      reader.onload = function () {
        var parsed;
        try {
          parsed = JSON.parse(reader.result);
        } catch (e) {
          reject(new Error('JSON 형식이 아닙니다 — ' + e.message));
          return;
        }
        var problem = validate(parsed);
        if (problem) {
          reject(new Error('백업 파일 형식이 올바르지 않습니다 — ' + problem));
          return;
        }
        try {
          resolve(migrate(parsed));   // v1 백업 파일도 그대로 불러올 수 있습니다.
        } catch (e) {
          reject(new Error('백업 파일을 변환하지 못했습니다 — ' + e.message));
        }
      };
      reader.readAsText(file);
    });
  }

  global.WD = {
    SCHEMA: SCHEMA,
    STORAGE_KEY: STORAGE_KEY,
    BACKUP_KEY: BACKUP_KEY,
    seed: seed,
    load: load,
    save: save,
    reset: reset,
    migrate: migrate,
    validate: validate,
    exportData: exportData,
    importFromFile: importFromFile,
    esc: esc,
    richText: richText,
    won: won,
    wonShort: wonShort,
    parseWon: parseWon
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* Node 에서 시드 생성용으로도 씁니다. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).WD;
}
