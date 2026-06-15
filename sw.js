/* 수벨건물 관리 - 서비스워커 (오프라인 캐시) */
/* ⚠️ 배포(코드 변경)마다 아래 버전을 올려야 정적 자원(css/js)이 갱신됩니다.
 *    캐시 우선 전략이라 버전이 같으면 이전 파일이 계속 제공됩니다. */
const CACHE = "subel-v2";
const ASSETS = [
  "./",
  "./index.html",
  "./css/styles.css",
  "./js/calc.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

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
