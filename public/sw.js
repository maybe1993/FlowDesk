// FlowDesk Service Worker
//
// 策略：network-first（网络优先，缓存兜底）
// 原因：本应用由多个独立 ES Module 文件组成，cache-first 会在发版后
// 出现「旧 JS + 新 HTML」的组合，导致应用白屏且难以自愈。
// 本应用跑在本机/局域网，网络请求 1~2ms，网络优先几乎没有代价，
// 却能彻底避免缓存不一致。
const VERSION = 'fd-v2';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/js/core.js', '/js/ui.js', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 数据永远走网络，绝不缓存：任何被缓存的业务数据都是错的
  if (url.pathname.startsWith('/api/')) return;

  // 导航请求：网络优先，断网时回退到应用外壳
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('/index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 静态资源：网络优先，失败时用缓存兜底（离线可用 + 不会缓存不一致）
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        throw new Error('offline and not cached: ' + url.pathname);
      })
  );
});