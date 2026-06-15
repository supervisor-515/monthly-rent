/* 순수 계산 함수 단위 테스트 (의존성 없음 · node tests/calc.test.js)
 * ------------------------------------------------------------------ */
"use strict";
const assert = require("assert");
const C = require("../js/calc.js");

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.error("  ✗ " + name + "\n    " + e.message); process.exitCode = 1; }
}

/* ---------- unitTotal ---------- */
test("unitTotal: 월세 = 월세 + 관리비", () => {
  assert.strictEqual(C.unitTotal({ contractType: "월세", rent: 500000, maintenance: 50000 }), 550000);
});
test("unitTotal: 전세는 관리비만", () => {
  assert.strictEqual(C.unitTotal({ contractType: "전세", rent: 500000, maintenance: 50000 }), 50000);
});
test("unitTotal: 빈/비정상 값은 0 처리", () => {
  assert.strictEqual(C.unitTotal({ contractType: "월세" }), 0);
  assert.strictEqual(C.unitTotal({ contractType: "월세", rent: "abc", maintenance: null }), 0);
});

/* ---------- isOccupied ---------- */
test("isOccupied: 임차인 이름 유무로 판정", () => {
  assert.strictEqual(C.isOccupied({ tenant: "홍길동" }), true);
  assert.strictEqual(C.isOccupied({ tenant: "  " }), false);
  assert.strictEqual(C.isOccupied({ tenant: "" }), false);
  assert.strictEqual(C.isOccupied({}), false);
});

/* ---------- residenceMonths ---------- */
test("residenceMonths: 도래일 도달 시 1개월 증가", () => {
  const ref = new Date(2024, 5, 15); // 6/15
  assert.strictEqual(C.residenceMonths("2024-05-15", ref), 1);
  assert.strictEqual(C.residenceMonths("2024-05-14", ref), 1);
});
test("residenceMonths: 도래일 미도달 시 미산입", () => {
  const ref = new Date(2024, 5, 14); // 6/14
  assert.strictEqual(C.residenceMonths("2024-05-15", ref), 0);
});
test("residenceMonths: 1년 = 12개월", () => {
  assert.strictEqual(C.residenceMonths("2023-06-15", new Date(2024, 5, 15)), 12);
});
test("residenceMonths: 입주일 없음/미래는 0", () => {
  assert.strictEqual(C.residenceMonths("", new Date(2024, 5, 15)), 0);
  assert.strictEqual(C.residenceMonths("2025-01-01", new Date(2024, 5, 15)), 0);
});

/* ---------- daysToExpiry ---------- */
test("daysToExpiry: 남은 일수 계산", () => {
  assert.strictEqual(C.daysToExpiry("2024-06-20", new Date(2024, 5, 15)), 5);
  assert.strictEqual(C.daysToExpiry("2024-06-10", new Date(2024, 5, 15)), -5);
});
test("daysToExpiry: 만기일 없으면 null", () => {
  assert.strictEqual(C.daysToExpiry("", new Date()), null);
  assert.strictEqual(C.daysToExpiry("bad-date", new Date()), null);
});

/* ---------- unitStatus ---------- */
test("unitStatus: 공실/임대중/만기임박/만기경과", () => {
  const ref = new Date(2024, 5, 15);
  assert.strictEqual(C.unitStatus({ tenant: "" }, ref).label, "공실");
  assert.strictEqual(C.unitStatus({ tenant: "김", expiryDate: "2025-01-01" }, ref).label, "임대중");
  assert.strictEqual(C.unitStatus({ tenant: "김", expiryDate: "2024-07-10" }, ref).cls, "status-warn");
  assert.strictEqual(C.unitStatus({ tenant: "김", expiryDate: "2024-06-01" }, ref).label, "만기경과");
  assert.strictEqual(C.unitStatus({ tenant: "김" }, ref).label, "임대중"); // 만기일 미입력
});

/* ---------- cumulativeIncome ---------- */
test("cumulativeIncome: 거주개월 × 총액", () => {
  const u = { tenant: "김", contractType: "월세", rent: 500000, maintenance: 50000, moveInDate: "2023-06-15" };
  assert.strictEqual(C.cumulativeIncome(u, new Date(2024, 5, 15)), 12 * 550000);
});

/* ---------- 금액 포매팅 ---------- */
test("won: 천 단위 구분 + 원", () => {
  assert.strictEqual(C.won(1234567), "1,234,567원");
  assert.strictEqual(C.won(null), "0원");
});
test("wonShort: 만/억 단위 축약", () => {
  assert.strictEqual(C.wonShort(50000), "5만원");
  assert.strictEqual(C.wonShort(100000000), "1억원");
  assert.strictEqual(C.wonShort(150000000), "1.5억원");
  assert.strictEqual(C.wonShort(5000), "5,000원");
});

console.log(`\n${passed}개 테스트 통과`);
