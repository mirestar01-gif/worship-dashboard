/* 서울중앙교회 예배위원회 대시보드 — 저장/불러오기 공통 모듈 (P0)
 *
 * index.html 과 settings.html 이 함께 씁니다.
 *   WD.load()            저장된 데이터를 반환 (없으면 기본값 WD_SEED 복사본)
 *   WD.save(data)        localStorage 에 저장
 *   WD.seed()            기본값(data/seed.js) 의 복사본
 *   WD.reset()           저장분을 백업 키로 옮기고 기본값 복사본 반환
 *   WD.exportData(data)  현재 내용을 JSON 파일로 내려받기
 *   WD.importFromFile(f) 백업 파일을 읽어 검증 후 Promise<데이터>
 *   WD.validate(obj)     문제 있으면 사람이 읽을 메시지, 없으면 null
 *
 * ※ 아직 v1 스키마 그대로입니다. 스키마 v2 전환과 자동 마이그레이션은 P1 에서 이 파일에 추가됩니다.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'wd_data_v1';
  var BACKUP_KEY  = 'wd_data_v1_backup';

  function deepClone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function seed() {
    if (!global.WD_SEED) {
      throw new Error('data/seed.js 를 불러오지 못했습니다. <script src="./data/seed.js"> 가 store.js 보다 먼저 있는지 확인하세요.');
    }
    return deepClone(global.WD_SEED);
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.warn('[store] 저장된 데이터를 읽지 못해 기본값을 사용합니다.', e);
    }
    return seed();
  }

  function save(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('저장할 데이터가 올바르지 않습니다.');
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  }

  function reset() {
    try {
      var cur = localStorage.getItem(STORAGE_KEY);
      if (cur) localStorage.setItem(BACKUP_KEY, cur); // 되돌릴 수 있게 마지막 상태를 보관
    } catch (e) { /* 보관 실패해도 초기화는 진행 */ }
    localStorage.removeItem(STORAGE_KEY);
    return seed();
  }

  function validate(obj) {
    if (!obj || typeof obj !== 'object') return '내용이 비어 있거나 객체 형식이 아닙니다.';
    if (!obj.meta || typeof obj.meta !== 'object') return 'meta(기본 정보) 항목이 없습니다.';
    if (!obj.months || typeof obj.months !== 'object') return 'months(월별 일정) 항목이 없습니다.';
    if (!Array.isArray(obj.checklist)) return 'checklist(체크리스트) 항목이 배열이 아닙니다.';
    if (!Array.isArray(obj.servants)) return 'servants(섬기는 분) 항목이 배열이 아닙니다.';
    if (!obj.budget || !Array.isArray(obj.budget.rows)) return 'budget(예산) 항목이 올바르지 않습니다.';
    return null;
  }

  function dateStamp() {
    var d = new Date();
    return d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0');
  }

  function exportData(data) {
    var payload = data || load();
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
        resolve(parsed);
      };
      reader.readAsText(file);
    });
  }

  global.WD = {
    STORAGE_KEY: STORAGE_KEY,
    BACKUP_KEY: BACKUP_KEY,
    seed: seed,
    load: load,
    save: save,
    reset: reset,
    validate: validate,
    exportData: exportData,
    importFromFile: importFromFile
  };
})(window);
