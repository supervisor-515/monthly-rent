/* 수벨건물 관리 - 알림 공용 저장소/로직
 * ------------------------------------------------------------------
 * 페이지(app.js)와 서비스워커(sw.js) 양쪽에서 공유합니다.
 * - 서비스워커는 localStorage 를 못 읽으므로 알림용 데이터는 IndexedDB 로 미러링합니다.
 * - 만기 알림 계산은 SubelCalc(js/calc.js)에 의존합니다 (반드시 먼저 로드).
 * ------------------------------------------------------------------ */
(function (root) {
  "use strict";

  const DB = "subel-notify", STORE = "kv", VERSION = 1;
  const ALERT_DAYS = 60;   // 만기 2개월 이내

  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbGet(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
  }
  async function idbSet(key, val) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(val, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  /** 저장된 호실 스냅샷에서 만기 임박 목록 계산 (점검 시점 기준 재계산) */
  function buildAlerts(units, ref) {
    const C = root.SubelCalc || (typeof globalThis !== "undefined" && globalThis.SubelCalc);
    const out = [];
    (units || []).forEach(u => {
      if (!C.isOccupied(u)) return;
      const d = C.daysToExpiry(u.expiryDate, ref);
      if (d !== null && d >= 0 && d <= ALERT_DAYS) out.push({ no: u.no, tenant: u.tenant, days: d, expiryDate: u.expiryDate });
    });
    return out.sort((a, b) => a.days - b.days);
  }

  /** 알림 제목/본문 생성 (없으면 null) */
  function formatAlert(alerts) {
    if (!alerts || !alerts.length) return null;
    const title = `만기 임박 ${alerts.length}건 — 재계약 확인`;
    const lines = alerts.slice(0, 5).map(a => `${a.no}호${a.tenant ? " " + a.tenant : ""} · D-${a.days}`);
    if (alerts.length > 5) lines.push(`외 ${alerts.length - 5}건`);
    return { title, body: lines.join("\n") };
  }

  function todayKey(d = new Date()) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  root.SubelStore = { idbGet, idbSet, buildAlerts, formatAlert, todayKey, ALERT_DAYS };
})(typeof self !== "undefined" ? self : this);
