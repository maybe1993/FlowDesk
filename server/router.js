// 极简路由器 + 静态文件服务 + 统一错误处理（零依赖）
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { sendJson, readBody, HttpError, notFound } from './util.js';
import { attachUser } from './auth.js';
import { ROOT } from './db.js';

export const PUBLIC_DIR = join(ROOT, 'public');

const routes = [];

export function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const regexSrc = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  routes.push({ method, regex: new RegExp(`^${regexSrc}$`), keys, handler, auth: opts.auth !== false });
}

export const GET = (p, h, o) => route('GET', p, h, o);
export const POST = (p, h, o) => route('POST', p, h, o);
export const PATCH = (p, h, o) => route('PATCH', p, h, o);
export const PUT = (p, h, o) => route('PUT', p, h, o);
export const DELETE = (p, h, o) => route('DELETE', p, h, o);

export async function handleApi(req, res, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let matched = null;
  let params = {};
  let methodMismatch = false;

  for (const r of routes) {
    const m = r.regex.exec(path);
    if (!m) continue;
    if (r.method !== req.method) {
      methodMismatch = true;
      continue;
    }
    matched = r;
    params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    break;
  }

  if (!matched) throw notFound(methodMismatch ? '接口方法不允许' : '接口不存在');

  const ctx = { req, res, params, query: Object.fromEntries(url.searchParams), url };
  attachUser(ctx);

  // 免鉴权路由由各自注册时的 { auth: false } 显式声明，不再靠路径前缀猜测
  if (matched.auth && !ctx.user) {
    throw new HttpError(401, '登录已失效，请重新登录');
  }

  // CSRF 缓解：写操作要求自定义头（浏览器同源脚本无法跨站携带）
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    if (req.headers['x-fd-client'] !== '1' && process.env.FLOWDESK_ALLOW_NO_HEADER !== '1') {
      throw new HttpError(400, '缺少 X-FD-Client 请求头（可能是跨站请求，已拒绝）');
    }
    const ct = req.headers['content-type'] || '';
    if (ct && !ct.includes('application/json') && !ct.includes('x-www-form-urlencoded')) {
      throw new HttpError(400, '仅支持 application/json');
    }
  }

  ctx.body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  const result = await matched.handler(ctx);
  if (res.writableEnded) return;
  sendJson(res, result === undefined ? 204 : 200, result === undefined ? null : result);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  // 防目录穿越
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  let file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR + sep) && file !== PUBLIC_DIR) throw notFound();

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  // SPA 回退
  if (!info && !extname(safe)) {
    file = join(PUBLIC_DIR, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info) throw notFound('页面不存在');

  const etag = `W/"${info.size}-${Number(info.mtimeMs).toString(36)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag });
    return res.end();
  }
  const buf = await readFile(file);
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
  const immutable = /\/assets\//.test(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': buf.length,
    ETag: etag,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(buf);
}