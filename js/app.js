/* 수벨건물 입주자 관리 프로그램
 * 순수 바닐라 JS · localStorage 저장 · 오프라인(PWA) 지원
 * ------------------------------------------------------------------ */
(function () {
  "use strict";

  const STORAGE_KEY = "subel-building-v1";
  const DEFAULT_UNITS = [
    "101",
    "201", "202", "203", "204", "205",
    "301", "302", "303", "304", "305",
    "401", "402", "403",
  ];
  const DEFAULT_OPTIONS = [
    "냉장고", "세탁기", "에어컨", "전자레인지",
    "인덕션", "가스레인지", "실링팬", "소화기",
  ];
  const EXPENSE_KEYS = ["상수도", "정화조", "공동전기", "기타"];

  /* ---------- 상태 ---------- */
  let state = load();
  let activeFilter = "all";
  let searchTerm = "";

  function freshUnit(no) {
    return {
      id: no, no,
      tenant: "", birthYear: "", job: "",
      moveInDate: "", expiryDate: "",
      contractType: "월세",          // 전세 / 월세
      payment: "후불",               // 선불 / 후불
      deposit: 0, rent: 0, maintenance: 0,
      options: {},
      voc: [],                       // { id, date, content, cost, resolved }
    };
  }

  function defaultState() {
    return {
      units: DEFAULT_UNITS.map(freshUnit),
      expenses: { 상수도: 0, 정화조: 0, 공동전기: 0, 기타: 0 },
      optionCatalog: [...DEFAULT_OPTIONS],
      ledger: {},                    // "YYYY-MM": { income, expense }
      settings: { theme: "light", notify: false },
      updatedAt: Date.now(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      const base = defaultState();
      // 안전 병합 (구버전 호환)
      return {
        ...base, ...data,
        expenses: { ...base.expenses, ...(data.expenses || {}) },
        settings: { ...base.settings, ...(data.settings || {}) },
        optionCatalog: data.optionCatalog && data.optionCatalog.length ? data.optionCatalog : base.optionCatalog,
        units: (data.units && data.units.length ? data.units : base.units).map(u => ({ ...freshUnit(u.no), ...u })),
      };
    } catch (e) {
      console.warn("저장 데이터 로드 실패, 초기화합니다.", e);
      return defaultState();
    }
  }

  function save() {
    state.updatedAt = Date.now();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const el = document.getElementById("lastSaved");
      if (el) el.textContent = "자동 저장됨 · " + new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      toast("저장 공간이 부족합니다.");
    }
    pushAlertSnapshot();   // 서비스워커 백그라운드 점검용 미러링
  }

  /* ---------- 유틸 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  // 순수 계산/포매팅 함수는 js/calc.js 로 분리되어 단위 테스트 대상입니다.
  const {
    won, wonShort, isOccupied, unitTotal,
    residenceMonths, daysToExpiry, cumulativeIncome, unitStatus,
  } = window.SubelCalc;

  /* ---------- 집계 ---------- */
  function totals() {
    let income = 0, deposit = 0, occupied = 0;
    state.units.forEach(u => {
      if (isOccupied(u)) { occupied++; income += unitTotal(u); deposit += Number(u.deposit) || 0; }
    });
    const expense = EXPENSE_KEYS.reduce((s, k) => s + (Number(state.expenses[k]) || 0), 0);
    return { income, expense, deposit, occupied, net: income - expense };
  }

  /** 만기 2개월 이내 알림 목록 */
  function expiringAlerts() {
    const out = [];
    state.units.forEach(u => {
      if (!isOccupied(u)) return;
      const d = daysToExpiry(u.expiryDate);
      if (d !== null && d >= 0 && d <= 60) out.push({ u, days: d });
    });
    return out.sort((a, b) => a.days - b.days);
  }

  /* ---------- 렌더링 ---------- */
  function render() {
    renderDashboard();
    renderAlerts();
    renderRows();
    renderExpenseSummary();
    applyTheme();
  }

  function renderDashboard() {
    const t = totals();
    $("#statOccupied").textContent = t.occupied;
    $("#statOccRate").textContent = "가동률 " + Math.round((t.occupied / state.units.length) * 100) + "%";
    $("#statIncome").textContent = won(t.income);
    $("#statExpense").textContent = won(t.expense);
    $("#statNet").textContent = won(t.net);
    $("#statNet").style.color = t.net >= 0 ? "var(--net)" : "var(--danger)";
    $("#statDeposit").textContent = "보증금 합계 " + wonShort(t.deposit);
  }

  function renderAlerts() {
    const alerts = expiringAlerts();
    [$("#alertCount"), $("#navAlertCount")].forEach(badge => {
      if (!badge) return;
      if (alerts.length) { badge.textContent = alerts.length; badge.hidden = false; }
      else badge.hidden = true;
    });

    const banner = $("#alertBanner");
    if (!alerts.length) { banner.hidden = true; banner.innerHTML = ""; return; }
    banner.hidden = false;
    banner.innerHTML = alerts.map(a =>
      `<div>⚠️ <b>${esc(a.u.no)}호</b> 만기 2개월 전입니다. 재계약 여부 확인 바랍니다. <span class="muted">(${a.days}일 남음 · ${esc(a.u.tenant)})</span></div>`
    ).join("");
  }

  function matchesFilter(u) {
    const occ = isOccupied(u);
    if (activeFilter === "occupied" && !occ) return false;
    if (activeFilter === "vacant" && occ) return false;
    if (activeFilter === "expiring") {
      const d = daysToExpiry(u.expiryDate);
      if (!(occ && d !== null && d >= 0 && d <= 60)) return false;
    }
    if (searchTerm) {
      const hay = `${u.no} ${u.tenant} ${u.job}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  }

  function renderRows() {
    const tbody = $("#unitRows");
    const rows = state.units.filter(matchesFilter);
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="voc-empty">조건에 맞는 호실이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(u => {
      const st = unitStatus(u);
      const occ = isOccupied(u);
      const typeTag = u.contractType === "전세"
        ? `<span class="tag tag-jeonse">전세</span>`
        : `<span class="tag tag-wolse">월세</span>`;
      return `<tr data-id="${esc(u.id)}">
        <td><span class="unit-no">${esc(u.no)}</span></td>
        <td>${occ ? esc(u.tenant) : '<span class="tenant-empty">공실</span>'}</td>
        <td>${typeTag}</td>
        <td class="num">${esc(u.moveInDate || "—")}</td>
        <td class="num">${esc(u.expiryDate || "—")}</td>
        <td class="num">${u.contractType === "전세" ? "—" : won(u.rent)}</td>
        <td class="num">${won(u.maintenance)}</td>
        <td class="num"><b>${won(unitTotal(u))}</b></td>
        <td class="num">${occ ? residenceMonths(u.moveInDate) + "개월" : "—"}</td>
        <td><span class="status ${st.cls}">${st.label}</span></td>
      </tr>`;
    }).join("");
    tbody.querySelectorAll("tr[data-id]").forEach(tr =>
      tr.addEventListener("click", () => openUnitDetail(tr.dataset.id)));
  }

  function renderExpenseSummary() {
    const total = EXPENSE_KEYS.reduce((s, k) => s + (Number(state.expenses[k]) || 0), 0);
    const vocTotal = state.units.reduce((s, u) =>
      s + u.voc.reduce((a, v) => a + (Number(v.cost) || 0), 0), 0);
    const el = $("#expenseSummary");
    el.innerHTML = `
      <h3>월 지출 총액 <span class="total">${won(total)}</span></h3>
      ${EXPENSE_KEYS.map(k => `
        <div class="exp-item"><div class="k">${k}</div><div class="v">${won(state.expenses[k])}</div></div>
      `).join("")}
      <div class="exp-item"><div class="k">호실 VOC 처리비 누계</div><div class="v">${won(vocTotal)}</div></div>`;
  }

  /* ---------- 모달 기반 ---------- */
  function openModal(html, opts = {}) {
    const root = $("#modalRoot");
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    overlay.addEventListener("mousedown", e => { if (e.target === overlay) close(); });
    function close() { overlay.remove(); if (opts.onClose) opts.onClose(); document.removeEventListener("keydown", onKey); }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    overlay.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", close));
    root.appendChild(overlay);
    if (opts.onMount) opts.onMount(overlay, close);
    return { overlay, close };
  }

  /* ---------- 호실 상세 ---------- */
  function openUnitDetail(id) {
    const u = state.units.find(x => x.id === id);
    if (!u) return;
    const html = `
      <div class="modal-head">
        <div>
          <h2>${esc(u.no)}호 상세</h2>
          <div class="sub">${isOccupied(u) ? esc(u.tenant) + " 임차인" : "공실"}</div>
        </div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="info">계약·임차인</button>
        <button class="tab" data-tab="options">세대 옵션</button>
        <button class="tab" data-tab="voc">VOC 민원</button>
      </div>
      <div class="modal-body">
        <div class="tab-panel active" data-panel="info">${infoPanel(u)}</div>
        <div class="tab-panel" data-panel="options">${optionsPanel(u)}</div>
        <div class="tab-panel" data-panel="voc">${vocPanel(u)}</div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger btn-sm" data-clear>입주 정보 비우기</button>
        <button class="btn" data-close>닫기</button>
        <button class="btn btn-primary" data-save>저장</button>
      </div>`;

    openModal(html, {
      onMount(overlay, close) {
        // 탭 전환
        overlay.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
          overlay.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
          overlay.querySelectorAll(".tab-panel").forEach(x => x.classList.remove("active"));
          t.classList.add("active");
          overlay.querySelector(`[data-panel="${t.dataset.tab}"]`).classList.add("active");
        }));

        // 옵션 토글 시각효과
        wireOptions(overlay, u);
        const rerenderVoc = () => {
          overlay.querySelector('[data-panel="voc"]').innerHTML = vocPanel(u);
          wireVoc(overlay, u, rerenderVoc);
        };
        wireVoc(overlay, u, rerenderVoc);

        // 계약유형 변경 시 월세 입력 토글
        const typeSel = overlay.querySelector('[name="contractType"]');
        const rentField = overlay.querySelector('[data-rent-field]');
        const syncType = () => { rentField.style.opacity = typeSel.value === "전세" ? .45 : 1; };
        typeSel.addEventListener("change", syncType); syncType();

        overlay.querySelector("[data-save]").addEventListener("click", () => {
          const err = validateUnitForm(overlay);
          if (err) { toast(err); return; }
          readUnitForm(overlay, u);
          save(); render(); close(); toast(u.no + "호 저장됨");
        });
        overlay.querySelector("[data-clear]").addEventListener("click", () => {
          if (!confirm(u.no + "호의 입주자·계약 정보를 모두 비우시겠습니까? (옵션·VOC 포함)")) return;
          Object.assign(u, freshUnit(u.no));
          save(); render(); close(); toast(u.no + "호 공실 처리됨");
        });
      },
    });
  }

  function infoPanel(u) {
    const cum = cumulativeIncome(u);
    return `
      <div class="mini-stats">
        <div class="mini"><div class="k">총액(월)</div><div class="v">${won(unitTotal(u))}</div></div>
        <div class="mini"><div class="k">거주개월</div><div class="v">${residenceMonths(u.moveInDate)}개월</div></div>
        <div class="mini"><div class="k">누적 수령(추정)</div><div class="v">${wonShort(cum)}</div></div>
      </div>
      <div class="field"><label>임차인 이름</label><input name="tenant" value="${esc(u.tenant)}" placeholder="홍길동" /></div>
      <div class="grid2">
        <div class="field"><label>출생년</label><input name="birthYear" type="number" inputmode="numeric" value="${esc(u.birthYear)}" placeholder="1980" /></div>
        <div class="field"><label>직업</label><input name="job" value="${esc(u.job)}" placeholder="회사원" /></div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>최초 입주일</label><input name="moveInDate" type="date" value="${esc(u.moveInDate)}" /></div>
        <div class="field"><label>만기일</label><input name="expiryDate" type="date" value="${esc(u.expiryDate)}" /></div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>계약 구분</label>
          <select name="contractType">
            <option value="월세" ${u.contractType === "월세" ? "selected" : ""}>월세</option>
            <option value="전세" ${u.contractType === "전세" ? "selected" : ""}>전세</option>
          </select>
        </div>
        <div class="field"><label>선불 / 후불</label>
          <select name="payment">
            <option value="후불" ${u.payment === "후불" ? "selected" : ""}>후불</option>
            <option value="선불" ${u.payment === "선불" ? "selected" : ""}>선불</option>
          </select>
        </div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label>보증금</label><input name="deposit" type="number" inputmode="numeric" value="${esc(u.deposit)}" /></div>
        <div class="field" data-rent-field><label>월세</label><input name="rent" type="number" inputmode="numeric" value="${esc(u.rent)}" /></div>
      </div>
      <div class="field" style="margin-top:14px"><label>관리비</label><input name="maintenance" type="number" inputmode="numeric" value="${esc(u.maintenance)}" /></div>
      <p class="hint">총액(월) = 월세 + 관리비 · 전세는 관리비만 합산됩니다.</p>`;
  }

  /** 저장 전 입력값 검증. 문제가 있으면 사용자용 메시지를, 없으면 null 을 반환 */
  function validateUnitForm(overlay) {
    const g = n => overlay.querySelector(`[name="${n}"]`);
    const moveIn = g("moveInDate").value;
    const expiry = g("expiryDate").value;
    if (moveIn && expiry && moveIn > expiry) return "만기일이 최초 입주일보다 빠를 수 없습니다.";
    const numFields = { deposit: "보증금", rent: "월세", maintenance: "관리비" };
    for (const [name, label] of Object.entries(numFields)) {
      const raw = g(name).value.trim();
      if (raw === "") continue;
      const v = Number(raw);
      if (!isFinite(v) || v < 0) return `${label} 금액을 0 이상으로 입력하세요.`;
    }
    const by = g("birthYear").value.trim();
    if (by !== "") {
      const y = Number(by);
      if (!Number.isInteger(y) || y < 1900 || y > new Date().getFullYear()) {
        return "출생년을 올바르게 입력하세요.";
      }
    }
    return null;
  }

  function readUnitForm(overlay, u) {
    const g = n => overlay.querySelector(`[name="${n}"]`);
    u.tenant = g("tenant").value.trim();
    u.birthYear = g("birthYear").value.trim();
    u.job = g("job").value.trim();
    u.moveInDate = g("moveInDate").value;
    u.expiryDate = g("expiryDate").value;
    u.contractType = g("contractType").value;
    u.payment = g("payment").value;
    u.deposit = Number(g("deposit").value) || 0;
    u.rent = Number(g("rent").value) || 0;
    u.maintenance = Number(g("maintenance").value) || 0;
  }

  function optionsPanel(u) {
    return `
      <p class="hint" style="margin-bottom:12px">제공 중인 세대 옵션을 선택하세요. 새 항목을 추가할 수 있습니다.</p>
      <div class="opt-grid" data-opt-grid>
        ${state.optionCatalog.map(name => `
          <label class="opt ${u.options[name] ? "checked" : ""}">
            <input type="checkbox" data-opt="${esc(name)}" ${u.options[name] ? "checked" : ""}/>
            <span>${esc(name)}</span>
          </label>`).join("")}
      </div>
      <div class="opt-add">
        <input type="text" data-new-opt placeholder="옵션 추가 (예: 건조기)" />
        <button class="btn btn-sm" data-add-opt>추가</button>
      </div>`;
  }

  function wireOptions(overlay, u) {
    const grid = overlay.querySelector("[data-opt-grid]");
    overlay.querySelectorAll("[data-opt]").forEach(cb => {
      cb.addEventListener("change", () => {
        u.options[cb.dataset.opt] = cb.checked;
        cb.closest(".opt").classList.toggle("checked", cb.checked);
      });
    });
    const addBtn = overlay.querySelector("[data-add-opt]");
    const addInput = overlay.querySelector("[data-new-opt]");
    const doAdd = () => {
      const name = addInput.value.trim();
      if (!name) return;
      if (!state.optionCatalog.includes(name)) state.optionCatalog.push(name);
      u.options[name] = true;
      overlay.querySelector('[data-panel="options"]').innerHTML = optionsPanel(u);
      wireOptions(overlay, u);
      save();
    };
    if (addBtn) addBtn.addEventListener("click", doAdd);
    if (addInput) addInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
  }

  function vocPanel(u) {
    const list = u.voc.length ? `<div class="voc-list">${u.voc.map(v => `
      <div class="voc-card" data-voc="${v.id}">
        <div class="voc-top">
          <span>📅 ${esc(v.date || "처리일 미정")}</span>
          <span class="voc-cost">${won(v.cost)}</span>
        </div>
        <div class="voc-content">${esc(v.content)}</div>
        <div style="text-align:right;margin-top:6px">
          <button class="btn btn-sm btn-danger" data-del-voc="${v.id}">삭제</button>
        </div>
      </div>`).join("")}</div>` : `<div class="voc-empty">등록된 VOC 민원이 없습니다.</div>`;
    return `
      ${list}
      <div class="field"><label>민원 내용</label><textarea data-voc-content placeholder="예: 보일러 누수 신고"></textarea></div>
      <div class="grid2">
        <div class="field"><label>처리일자</label><input type="date" data-voc-date /></div>
        <div class="field"><label>비용</label><input type="number" inputmode="numeric" data-voc-cost placeholder="0" /></div>
      </div>
      <button class="btn btn-primary btn-sm" data-add-voc style="margin-top:6px">VOC 추가</button>`;
  }

  function wireVoc(overlay, u, rerender) {
    const panel = overlay.querySelector('[data-panel="voc"]');
    const addBtn = panel.querySelector("[data-add-voc]");
    if (addBtn) addBtn.addEventListener("click", () => {
      const content = panel.querySelector("[data-voc-content]").value.trim();
      if (!content) { toast("민원 내용을 입력하세요."); return; }
      u.voc.unshift({
        id: uid(),
        content,
        date: panel.querySelector("[data-voc-date]").value,
        cost: Number(panel.querySelector("[data-voc-cost]").value) || 0,
        resolved: false,
      });
      save(); renderExpenseSummary(); rerender();
    });
    panel.querySelectorAll("[data-del-voc]").forEach(b => b.addEventListener("click", () => {
      u.voc = u.voc.filter(v => v.id !== b.dataset.delVoc);
      save(); renderExpenseSummary(); rerender();
    }));
  }

  /* ---------- 지출 모달 ---------- */
  function openExpense() {
    const html = `
      <div class="modal-head">
        <div><h2>지출 관리</h2><div class="sub">월별 공통 지출 항목</div></div>
        <button class="modal-close" data-close>×</button>
      </div>
      <div class="modal-body">
        ${EXPENSE_KEYS.map(k => `
          <div class="field"><label>${k}</label>
            <input type="number" inputmode="numeric" data-exp="${k}" value="${esc(state.expenses[k])}" /></div>
        `).join("")}
        <p class="hint">여기 입력한 값은 하단 ‘월 지출 총액’과 상황판·추이 그래프에 반영됩니다.</p>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>닫기</button>
        <button class="btn btn-primary" data-save>저장</button>
      </div>`;
    openModal(html, {
      onMount(overlay, close) {
        overlay.querySelector("[data-save]").addEventListener("click", () => {
          EXPENSE_KEYS.forEach(k => {
            state.expenses[k] = Number(overlay.querySelector(`[data-exp="${k}"]`).value) || 0;
          });
          save(); render(); close(); toast("지출 저장됨");
        });
      },
    });
  }

  /* ---------- 알림 모달 ---------- */
  function openAlerts() {
    const alerts = expiringAlerts();
    const body = alerts.length ? alerts.map(a => `
      <div class="voc-card" style="margin-bottom:10px">
        <div class="voc-top"><span><b>${esc(a.u.no)}호</b> · ${esc(a.u.tenant)}</span><span>D-${a.days}</span></div>
        <div class="voc-content">${esc(a.u.no)}호 만기 2개월 전입니다. 재계약 여부 확인 바랍니다.</div>
        <div class="muted" style="margin-top:6px;font-size:13px">만기일 ${esc(a.u.expiryDate)}</div>
      </div>`).join("") : `<div class="voc-empty">2개월 이내 만기 예정 호실이 없습니다. 👍</div>`;
    openModal(`
      <div class="modal-head"><div><h2>만기 알림</h2><div class="sub">만기 2개월 이내 재계약 대상</div></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>확인</button></div>`);
  }

  /* ---------- 추이 그래프 모달 ---------- */
  function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function last12Months() {
    const arr = [], now = new Date();
    for (let i = 11; i >= 0; i--) arr.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    return arr;
  }
  function ledgerFor(key) {
    const t = totals();
    const rec = state.ledger[key];
    // 현재 수입/지출 자동 적용은 '해당 월'(현재 달)에만 적용한다.
    // 과거/미래 달은 저장된 실적이 없으면 0으로 둔다.
    const isCurrent = key === monthKey(new Date());
    return {
      income: rec && rec.income != null ? rec.income : (isCurrent ? t.income : 0),
      expense: rec && rec.expense != null ? rec.expense : (isCurrent ? t.expense : 0),
    };
  }

  function openChart() {
    const months = last12Months();
    const data = months.map(d => ({ key: monthKey(d), label: (d.getMonth() + 1) + "월", ...ledgerFor(monthKey(d)) }));
    const html = `
      <div class="modal-head"><div><h2>월별 수입·지출 추이</h2><div class="sub">최근 12개월</div></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">
        <div class="chart-legend">
          <span><i style="background:var(--income)"></i>수입</span>
          <span><i style="background:var(--expense)"></i>지출</span>
          <span><i style="background:var(--net)"></i>순수입</span>
        </div>
        <canvas id="trendChart" width="600" height="300"></canvas>
        <p class="hint" style="margin-top:10px">값을 직접 입력하면 해당 월 실적으로 저장됩니다. 현재 달은 비워두면 현재 수입/지출이 자동 적용되며, 다른 달은 입력한 달에만 반영됩니다.</p>
        <table class="ledger-table">
          <thead><tr><th>월</th><th>수입</th><th>지출</th><th>순수입</th></tr></thead>
          <tbody>
            ${data.map(d => `<tr>
              <td>${d.label}</td>
              <td><input type="number" data-ledger-income="${d.key}" placeholder="${d.income}" value="${state.ledger[d.key] && state.ledger[d.key].income != null ? state.ledger[d.key].income : ""}"/></td>
              <td><input type="number" data-ledger-expense="${d.key}" placeholder="${d.expense}" value="${state.ledger[d.key] && state.ledger[d.key].expense != null ? state.ledger[d.key].expense : ""}"/></td>
              <td class="num">${won(d.income - d.expense)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="modal-foot">
        <button class="btn" data-close>닫기</button>
        <button class="btn btn-primary" data-save>실적 저장</button>
      </div>`;
    openModal(html, {
      onMount(overlay, close) {
        drawChart(overlay.querySelector("#trendChart"), data);
        overlay.querySelector("[data-save]").addEventListener("click", () => {
          months.forEach(d => {
            const key = monthKey(d);
            const inc = overlay.querySelector(`[data-ledger-income="${key}"]`).value;
            const exp = overlay.querySelector(`[data-ledger-expense="${key}"]`).value;
            if (inc === "" && exp === "") { delete state.ledger[key]; return; }
            state.ledger[key] = {
              income: inc === "" ? null : Number(inc),
              expense: exp === "" ? null : Number(exp),
            };
          });
          save(); close(); toast("월별 실적 저장됨");
        });
      },
    });
  }

  /** Canvas 라인 차트 (외부 라이브러리 없음) */
  function drawChart(canvas, data) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600, cssH = 300;
    canvas.width = cssW * dpr; canvas.height = cssH * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.body);
    const colLine = css.getPropertyValue("--line").trim() || "#e2e8f0";
    const colText = css.getPropertyValue("--text-soft").trim() || "#64748b";
    const colInc = css.getPropertyValue("--income").trim() || "#2f855a";
    const colExp = css.getPropertyValue("--expense").trim() || "#c05621";
    const colNet = css.getPropertyValue("--net").trim() || "#6b46c1";

    const padL = 52, padR = 12, padT = 14, padB = 28;
    const W = cssW - padL - padR, H = cssH - padT - padB;
    const incomes = data.map(d => d.income), expenses = data.map(d => d.expense);
    const nets = data.map(d => d.income - d.expense);
    const maxV = Math.max(1, ...incomes, ...expenses, ...nets);
    const minV = Math.min(0, ...nets);
    const range = maxV - minV || 1;
    const x = i => padL + (data.length === 1 ? W / 2 : (W * i) / (data.length - 1));
    const y = v => padT + H - ((v - minV) / range) * H;

    ctx.clearRect(0, 0, cssW, cssH);
    // grid + y labels
    ctx.strokeStyle = colLine; ctx.fillStyle = colText;
    ctx.font = "11px sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i) / 4;
      const yy = y(v);
      ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(cssW - padR, yy); ctx.stroke(); ctx.globalAlpha = 1;
      ctx.fillText(wonShortAxis(v), padL - 6, yy);
    }
    // x labels
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    data.forEach((d, i) => ctx.fillText(d.label, x(i), cssH - padB + 6));

    const plot = (vals, color, fill) => {
      ctx.beginPath();
      vals.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v)));
      ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.lineJoin = "round"; ctx.stroke();
      if (fill) {
        ctx.lineTo(x(vals.length - 1), y(minV)); ctx.lineTo(x(0), y(minV)); ctx.closePath();
        ctx.globalAlpha = .08; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      }
      vals.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, 7); ctx.fillStyle = color; ctx.fill(); });
    };
    plot(incomes, colInc, true);
    plot(expenses, colExp, false);
    plot(nets, colNet, false);
  }
  function wonShortAxis(n) {
    n = Math.round(n);
    if (Math.abs(n) >= 10000) return Math.round(n / 10000) + "만";
    return String(n);
  }

  /* ---------- 설정 / 백업 ---------- */
  function openMenu() {
    const dark = state.settings.theme === "dark";
    const notifyOn = !!state.settings.notify && (!("Notification" in window) || Notification.permission === "granted");
    openModal(`
      <div class="modal-head"><div><h2>설정 · 데이터 관리</h2></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">
        <div class="menu-list">
          <button class="menu-item" data-act="theme"><span class="ico">${dark ? "☀️" : "🌙"}</span><span>${dark ? "라이트 모드로 전환" : "다크 모드로 전환"}</span></button>
          <button class="menu-item" data-act="notify"><span class="ico">🔔</span><span>만기 폰 알림 ${notifyOn ? "끄기" : "켜기"}</span></button>
          <button class="menu-item" data-act="units"><span class="ico">🏗️</span><span>호실 추가 · 삭제</span></button>
          <button class="menu-item" data-act="export"><span class="ico">💾</span><span>데이터 백업 (JSON 내보내기)</span></button>
          <button class="menu-item" data-act="import"><span class="ico">📂</span><span>데이터 복원 (JSON 가져오기)</span></button>
          <button class="menu-item" data-act="print"><span class="ico">🖨️</span><span>현황 인쇄 / PDF 저장</span></button>
          <button class="menu-item" data-act="install"><span class="ico">📲</span><span>홈 화면에 앱 설치</span></button>
          <button class="menu-item" data-act="reset" style="color:var(--danger)"><span class="ico">🗑️</span><span>전체 초기화</span></button>
        </div>
        <input type="file" id="importFile" accept="application/json" hidden />
        <p class="hint" style="margin-top:14px">모든 데이터는 이 기기 브라우저에만 저장됩니다. 기기 변경·삭제에 대비해 정기적으로 백업하세요.</p>
      </div>`, {
      onMount(overlay, close) {
        const act = a => overlay.querySelector(`[data-act="${a}"]`);
        act("theme").addEventListener("click", () => {
          state.settings.theme = dark ? "light" : "dark"; save(); applyTheme(); close(); openMenu();
        });
        act("notify").addEventListener("click", async () => { close(); await toggleNotifications(); });
        act("units").addEventListener("click", () => { close(); openUnitManager(); });
        act("export").addEventListener("click", exportData);
        act("import").addEventListener("click", () => overlay.querySelector("#importFile").click());
        overlay.querySelector("#importFile").addEventListener("change", e => importData(e, close));
        act("print").addEventListener("click", () => { close(); window.print(); });
        act("install").addEventListener("click", () => { promptInstall(); });
        act("reset").addEventListener("click", () => {
          if (!confirm("모든 호실·지출·실적 데이터를 삭제하고 기본값으로 되돌립니다. 계속할까요?")) return;
          state = defaultState(); save(); render(); close(); toast("초기화되었습니다");
        });
      },
    });
  }

  /* ---------- 호실 추가 / 삭제 ---------- */
  function openUnitManager() {
    const tpl = () => `
      <div class="unit-manage-list">
        ${state.units.map(u => `
          <div class="unit-manage-row" data-row="${esc(u.id)}">
            <span class="unit-manage-no">${esc(u.no)}호</span>
            <span class="muted">${isOccupied(u) ? esc(u.tenant) + " 임대중" : "공실"}</span>
            <button class="btn btn-sm btn-danger" data-del-unit="${esc(u.id)}">삭제</button>
          </div>`).join("")}
      </div>
      <div class="opt-add" style="margin-top:12px">
        <input type="text" inputmode="numeric" data-new-unit placeholder="추가할 호실번호 (예: 404)" />
        <button class="btn btn-sm btn-primary" data-add-unit>추가</button>
      </div>
      <p class="hint" style="margin-top:10px">호실을 삭제하면 해당 호실의 계약·옵션·VOC 기록이 함께 사라집니다.</p>`;

    openModal(`
      <div class="modal-head"><div><h2>호실 추가 · 삭제</h2><div class="sub">현재 ${state.units.length}개 호실</div></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-body" data-unit-mgr>${tpl()}</div>
      <div class="modal-foot"><button class="btn btn-primary" data-close>완료</button></div>`, {
      onMount(overlay) {
        const body = overlay.querySelector("[data-unit-mgr]");
        const sub = overlay.querySelector(".modal-head .sub");
        const rerender = () => {
          body.innerHTML = tpl();
          if (sub) sub.textContent = `현재 ${state.units.length}개 호실`;
          wire();
        };
        const wire = () => {
          const addBtn = body.querySelector("[data-add-unit]");
          const addInput = body.querySelector("[data-new-unit]");
          const doAdd = () => {
            const no = addInput.value.trim();
            if (!no) return;
            if (state.units.some(u => String(u.no) === no)) { toast("이미 존재하는 호실입니다."); return; }
            state.units.push(freshUnit(no));
            save(); render(); rerender();
            toast(no + "호 추가됨");
          };
          if (addBtn) addBtn.addEventListener("click", doAdd);
          if (addInput) addInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } });
          body.querySelectorAll("[data-del-unit]").forEach(b => b.addEventListener("click", () => {
            const u = state.units.find(x => x.id === b.dataset.delUnit);
            if (!u) return;
            if (state.units.length <= 1) { toast("최소 1개 호실은 있어야 합니다."); return; }
            if (!confirm(u.no + "호를 삭제하시겠습니까? 계약·옵션·VOC 기록이 모두 사라집니다.")) return;
            state.units = state.units.filter(x => x.id !== u.id);
            save(); render(); rerender();
            toast(u.no + "호 삭제됨");
          }));
        };
        wire();
      },
    });
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `수벨건물_백업_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
    toast("백업 파일을 내려받았습니다");
  }
  function importData(e, close) {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("형식 오류");
        if (!Array.isArray(data.units) || !data.units.length) throw new Error("호실 데이터 없음");
        // 각 호실에 식별용 호실번호가 있어야 함
        if (!data.units.every(u => u && (typeof u.no === "string" || typeof u.no === "number") && String(u.no).trim())) {
          throw new Error("호실번호 누락");
        }
        if (data.expenses != null && typeof data.expenses !== "object") throw new Error("지출 형식 오류");
        if (data.ledger != null && typeof data.ledger !== "object") throw new Error("실적 형식 오류");
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state = load(); save(); render();   // load() 가 누락 필드를 기본값으로 보정
        if (close) close(); toast("데이터를 복원했습니다");
      } catch (err) { toast("올바른 백업 파일이 아닙니다"); }
    };
    reader.readAsText(file);
  }

  /* ---------- 테마 ---------- */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.settings.theme || "light");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", state.settings.theme === "dark" ? "#20201B" : "#6B7253");
  }

  /* ---------- 토스트 ---------- */
  let toastTimer;
  function toast(msg) {
    clearTimeout(toastTimer);
    document.querySelectorAll(".toast").forEach(t => t.remove());
    const el = document.createElement("div");
    el.className = "toast"; el.textContent = msg;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 2200);
  }

  /* ---------- PWA 설치 ---------- */
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; });
  function promptInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(() => { deferredPrompt = null; });
    } else {
      toast("브라우저 메뉴 ‘홈 화면에 추가’로 설치하세요");
    }
  }

  /* ---------- 만기 알림 (실제 폰 알림) ---------- */
  const notifySupported = () => "Notification" in window && "serviceWorker" in navigator;

  /** 현재 호실 데이터를 IndexedDB 로 미러링 (SW 백그라운드 점검용) */
  function pushAlertSnapshot() {
    if (!window.SubelStore || !window.SubelStore.idbSet) return;
    const units = state.units
      .filter(isOccupied)
      .map(u => ({ no: u.no, tenant: u.tenant, expiryDate: u.expiryDate }));
    window.SubelStore.idbSet("units", units).catch(() => {});
  }

  /** 백그라운드 주기 점검 등록 (Chrome/Android · best-effort) */
  async function registerPeriodicSync() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!("periodicSync" in reg)) return false;
      const status = await navigator.permissions.query({ name: "periodic-background-sync" });
      if (status.state !== "granted") return false;
      await reg.periodicSync.register("rent-expiry-check", { minInterval: 24 * 60 * 60 * 1000 });
      return true;
    } catch (e) { return false; }
  }

  /** 앱이 열려있을 때 즉시 점검 → 임박 호실 있으면 시스템 알림 */
  async function foregroundExpiryCheck() {
    if (!state.settings.notify || !notifySupported() || Notification.permission !== "granted") return;
    try {
      pushAlertSnapshot();
      const reg = await navigator.serviceWorker.ready;
      // SW 가 IndexedDB 를 읽어 하루 1회 알림을 처리한다.
      if (reg.active) reg.active.postMessage({ type: "check-expiry" });
    } catch (e) {}
  }

  /** 설정에서 알림 켜기/끄기 */
  async function toggleNotifications() {
    if (!notifySupported()) { toast("이 브라우저는 알림을 지원하지 않습니다"); return; }
    if (state.settings.notify) {
      state.settings.notify = false; save();
      toast("만기 폰 알림을 껐습니다");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") {
      toast("알림 권한이 거부되어 있습니다. 브라우저 사이트 설정에서 허용해 주세요");
      return;
    }
    state.settings.notify = true; save();
    const bg = await registerPeriodicSync();
    await foregroundExpiryCheck();
    toast(bg
      ? "만기 폰 알림을 켰습니다 (백그라운드 점검 포함)"
      : "만기 폰 알림을 켰습니다 (앱 실행 시 점검)");
  }

  /* ---------- 통합 메뉴(햄버거) ---------- */
  function openNav() {
    const alerts = expiringAlerts();
    const alertTail = alerts.length ? `<span class="nav-count">${alerts.length}</span>` : "";
    openModal(`
      <div class="modal-head"><div><h2>메뉴</h2></div><button class="modal-close" data-close>×</button></div>
      <div class="modal-body">
        <div class="menu-list">
          <button class="menu-item" data-nav="alerts"><span class="ico">🔔</span><span>만기 알림</span>${alertTail}</button>
          <button class="menu-item" data-nav="chart"><span class="ico">📈</span><span>월별 수입·지출 추이</span></button>
          <button class="menu-item" data-nav="expense"><span class="ico">🧾</span><span>지출 관리</span></button>
          <button class="menu-item" data-nav="menu"><span class="ico">⚙️</span><span>설정 · 데이터 관리</span></button>
        </div>
      </div>`, {
      onMount(overlay, close) {
        const go = fn => { close(); fn(); };
        const map = { alerts: openAlerts, chart: openChart, expense: openExpense, menu: openMenu };
        overlay.querySelectorAll("[data-nav]").forEach(b =>
          b.addEventListener("click", () => go(map[b.dataset.nav])));
      },
    });
  }

  /* ---------- 이벤트 바인딩 ---------- */
  function init() {
    applyTheme();
    render();

    $("#btnAlerts").addEventListener("click", openAlerts);
    $("#btnChart").addEventListener("click", openChart);
    $("#btnExpense").addEventListener("click", openExpense);
    $("#btnMenu").addEventListener("click", openMenu);
    $("#btnNav").addEventListener("click", openNav);

    $("#search").addEventListener("input", e => { searchTerm = e.target.value.trim().toLowerCase(); renderRows(); });
    $("#filters").addEventListener("click", e => {
      const chip = e.target.closest(".chip"); if (!chip) return;
      activeFilter = chip.dataset.filter;
      $("#filters").querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === chip));
      renderRows();
    });

    // 서비스워커 등록 (오프라인/PWA)
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js")
          .then(() => { pushAlertSnapshot(); foregroundExpiryCheck(); })
          .catch(() => {});
      });
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
