/* 수벨건물 관리 - 서비스워커 (오프라인 캐시 + 만기 알림) */
/* ⚠️ 배포(코드 변경)마다 아래 버전을 올려야 정적 자원(css/js)이 갱신됩니다.
 *    캐시 우선 전략이라 버전이 같으면 이전 파일이 계속 제공됩니다. */
const CACHE = "subel-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/calc.js",
  "./js/notify-store.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

/* 백그라운드 만기 점검에 필요한 공용 로직 (SubelCalc, SubelStore) */
importScripts("./js/calc.js", "./js/notify-store.js");

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* HTML은 네트워크 우선(최신 반영), 정적 자원은 캐시 우선 */
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const isHTML = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    e.respondWith(
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => cached))
    );
  }
});

/* ---------- 만기 알림 (백그라운드) ----------
 * IndexedDB 에 미러링된 호실 스냅샷을 읽어 만기 임박 호실을 다시 계산하고,
 * 하루 1회만 시스템 알림을 띄운다. (Periodic Background Sync · Chrome/Android)
 */
async function runExpiryCheck() {
  const S = self.SubelStore;
  if (!S) return;
  const units = (await S.idbGet("units")) || [];
  const alerts = S.buildAlerts(units, new Date());
  const msg = S.formatAlert(alerts);
  if (!msg) return;                                   // 임박 호실 없음
  const today = S.todayKey();
  if ((await S.idbGet("lastNotifyDay")) === today) return;  // 오늘 이미 알림
  await self.registration.showNotification(msg.title, {
    body: msg.body,
    tag: "subel-expiry",
    renotify: true,
    icon: "./icons/icon-192.png",
    badge: "./icons/icon-192.png",
    data: { url: "./index.html" },
  });
  await S.idbSet("lastNotifyDay", today);
}

self.addEventListener("periodicsync", e => {
  if (e.tag === "rent-expiry-check") e.waitUntil(runExpiryCheck());
});

// 페이지에서 즉시 점검을 요청할 때
self.addEventListener("message", e => {
  if (e.data && e.data.type === "check-expiry") e.waitUntil(runExpiryCheck());
});

// 알림 탭 → 앱 열기/포커스
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./index.html";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
