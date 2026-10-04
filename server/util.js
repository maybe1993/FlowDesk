// 通用工具：日期、校验、HTTP 辅助
// 约定：日期用 'YYYY-MM-DD'，时间用 'YYYY-MM-DDTHH:mm'（本机本地时区朴素存储）

export const pad2 = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD' */
export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Date -> 'YYYY-MM-DDTHH:mm' */
export function dateTimeStr(d = new Date()) {
  return `${dateStr(d)}:${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Date -> 'YYYY-MM-DDTHH:mm:ss'（入库时间戳） */
export function stampStr(d = new Date()) {
  return `${dateTimeStr(d)}:${pad2(d.getSeconds())}`;
}

export const now = () => stampStr();

/** 解析 'YYYY-MM-DD' / 'YYYY-MM-DDTHH:mm' 为本地 Date */
export function parseDate(s) {
  if (s instanceof Date) return s;
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

export function addDays(s, n) {
  const d = parseDate(s) || new Date();
  d.setDate(d.getDate() + n);
  return d;
}

export const addDaysStr = (s, n) => dateStr(addDays(s, n));

/** 周起始（weekStart: 1=周一, 0=周日） */
export function startOfWeek(s, weekStart = 1) {
  const d = parseDate(s) || new Date();
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}
export const startOfWeekStr = (s, weekStart = 1) => dateStr(startOfWeek(s, weekStart));

export const endOfWeekStr = (s, weekStart = 1) => addDaysStr(startOfWeekStr(s, weekStart), 6);

/** a,b 都是 'YYYY-MM-DD' 或 datetime；b-a 的天数（浮点） */
export function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return 0;
  return (db - da) / 86400000;
}

export const daysUntil = (s, from = new Date()) => daysBetween(new Date(), s);

export const isWeekend = (s) => {
  const d = parseDate(s);
  return d ? d.getDay() === 0 || d.getDay() === 6 : false;
};

export function isoWeekNumber(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const w1 = new Date(t.getFullYear(), 0, 4);
  return 1 + Math.round(((t - w1) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export const round1 = (n) => Math.round(n * 10) / 10;
export const round2 = (n) => Math.round(n * 100) / 100;

export function uniq(arr) {
  return [...new Set(arr)];
}

export function safeJson(s, fallback = null) {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

export function slugKey(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 12) || 'PRJ';
}

/** 是否为有效 ISO 日期串 */
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);

/** 取某字段的安全字符串 */
export const str = (v, max = 2000) => (v == null ? null : String(v).slice(0, max));

export const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

// ---------- HTTP 辅助 ----------
export class HttpError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const unauthorized = (msg = '请先登录') => new HttpError(401, msg);
export const forbidden = (msg = '没有权限') => new HttpError(403, msg);
export const notFound = (msg = '资源不存在') => new HttpError(404, msg);

export function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(bad('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(bad('JSON 解析失败'));
        }
      } else if (ct.includes('application/x-www-form-urlencoded')) {
        resolve(Object.fromEntries(new URLSearchParams(text)));
      } else {
        resolve({ _raw: text });
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, data) {
  const body = JSON.stringify(data === undefined ? null : data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
