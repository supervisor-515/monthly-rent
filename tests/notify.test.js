/* 알림 로직 단위 테스트 (node tests/notify.test.js)
 * ------------------------------------------------------------------ */
"use strict";
const assert = require("assert");
globalThis.SubelCalc = require("../js/calc.js");   // buildAlerts 가 참조
const S = require("../js/notify-store.js").SubelStore;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

const ref = new Date(2024, 5, 15); // 2024-06-15

/* ---------- buildAlerts ---------- */
test("buildAlerts: 60일 이내 임박 호실만, 가까운 순 정렬", () => {
  const units = [
    { no: "101", tenant: "김", expiryDate: "2024-07-10" }, // D-25
    { no: "201", tenant: "이", expiryDate: "2024-06-20" }, // D-5
    { no: "301", tenant: "박", expiryDate: "2025-01-01" }, // 멀어서 제외
    { no: "401", tenant: "",  expiryDate: "2024-06-20" }, // 공실 → 제외
    { no: "402", tenant: "최", expiryDate: "2024-06-01" }, // 만기경과 → 제외
  ];
  const a = S.buildAlerts(units, ref);
  assert.deepStrictEqual(a.map(x => x.no), ["201", "101"]);
  assert.strictEqual(a[0].days, 5);
});

test("buildAlerts: 임박 없으면 빈 배열", () => {
  assert.strictEqual(S.buildAlerts([{ no: "101", tenant: "김", expiryDate: "2025-12-31" }], ref).length, 0);
  assert.strictEqual(S.buildAlerts([], ref).length, 0);
});

/* ---------- formatAlert ---------- */
test("formatAlert: 없으면 null", () => {
  assert.strictEqual(S.formatAlert([]), null);
  assert.strictEqual(S.formatAlert(null), null);
});
test("formatAlert: 제목/본문 생성", () => {
  const m = S.formatAlert([{ no: "201", tenant: "이", days: 5 }, { no: "101", tenant: "김", days: 25 }]);
  assert.ok(m.title.includes("2건"));
  assert.ok(m.body.includes("201호 이 · D-5"));
  assert.ok(m.body.includes("101호 김 · D-25"));
});
test("formatAlert: 5건 초과는 '외 N건' 축약", () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ no: String(i), tenant: "X", days: i }));
  const m = S.formatAlert(many);
  assert.ok(m.body.includes("외 2건"));
});

/* ---------- todayKey ---------- */
test("todayKey: YYYY-MM-DD 포맷", () => {
  assert.strictEqual(S.todayKey(new Date(2024, 0, 5)), "2024-01-05");
});

console.log(`\n${passed}개 테스트 통과`);
