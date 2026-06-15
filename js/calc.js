/* 수벨건물 관리 - 순수 계산/포매팅 함수
 * ------------------------------------------------------------------
 * state·DOM에 의존하지 않는 순수 함수만 모읍니다.
 * 브라우저(app.js)와 Node(tests/calc.test.js) 양쪽에서 사용합니다.
 * ------------------------------------------------------------------ */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api; // Node (테스트)
  root.SubelCalc = api;                                                   // 브라우저
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 금액 포매팅 ---------- */
  function won(n) { return (Number(n) || 0).toLocaleString("ko-KR") + "원"; }

  function wonShort(n) {
    n = Number(n) || 0;
    if (n >= 100000000) return (n / 100000000).toFixed(n % 100000000 ? 1 : 0) + "억원";
    if (n >= 10000) return Math.round(n / 10000).toLocaleString("ko-KR") + "만원";
    return won(n);
  }

  /* ---------- 호실 상태 ---------- */
  function isOccupied(u) { return !!(u && u.tenant && u.tenant.trim()); }

  /** 총액 = 월세 + 관리비 (전세는 월세 0) */
  function unitTotal(u) {
    if (u.contractType === "전세") return Number(u.maintenance) || 0;
    return (Number(u.rent) || 0) + (Number(u.maintenance) || 0);
  }

  /** 거주개월: 최초 입주일 기준 1달 후 도래일을 1개월로 산출 */
  function residenceMonths(moveIn, ref = new Date()) {
    if (!moveIn) return 0;
    const s = new Date(moveIn);
    if (isNaN(s)) return 0;
    let months = (ref.getFullYear() - s.getFullYear()) * 12 + (ref.getMonth() - s.getMonth());
    if (ref.getDate() < s.getDate()) months -= 1;   // 도래일 미도달 시 미산입
    return Math.max(0, months);
  }

  /** 만기까지 남은 일수 (없으면 null) */
  function daysToExpiry(expiry, ref = new Date()) {
    if (!expiry) return null;
    const e = new Date(expiry); if (isNaN(e)) return null;
    const r = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return Math.round((e - r) / 86400000);
  }

  /** 누적 수령액(추정) = 거주개월 × 총액 (VOC 비용 제외) */
  function cumulativeIncome(u, ref = new Date()) {
    return residenceMonths(u.moveInDate, ref) * unitTotal(u);
  }

  function unitStatus(u, ref = new Date()) {
    if (!isOccupied(u)) return { cls: "status-vacant", label: "공실" };
    const d = daysToExpiry(u.expiryDate, ref);
    if (d === null) return { cls: "status-ok", label: "임대중" };
    if (d < 0) return { cls: "status-danger", label: "만기경과" };
    if (d <= 60) return { cls: "status-warn", label: `만기 ${d}일전` };
    return { cls: "status-ok", label: "임대중" };
  }

  return {
    won, wonShort, isOccupied, unitTotal,
    residenceMonths, daysToExpiry, cumulativeIncome, unitStatus,
  };
});
