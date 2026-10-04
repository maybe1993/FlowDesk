// 认证：scrypt 密码、session cookie、权限中间件
import { scryptSync, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { all, get, run, insert } from './db.js';
import { unauthorized, forbidden, HttpError, now } from './util.js';

const COOKIE = 'fd_session';
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$16384$8$1$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, salt, hash] = parts;
  try {
    const calc = scryptSync(String(password), salt, 64, { N: +N, r: +r, p: +p });
    const want = Buffer.from(hash, 'hex');
    return calc.length === want.length && timingSafeEqual(calc, want);
  } catch {
    return false;
  }
}

const tokenHash = (t) => createHash('sha256').update(String(t)).digest('hex');

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(res, userId, ua = '') {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000);
  insert('sessions', {
    token_hash: tokenHash(token),
    user_id: userId,
    created_at: now(),
    expires_at: expires.toISOString(),
    ua: String(ua).slice(0, 200),
  });
  const parts = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_DAYS * 86400}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
  return token;
}

export function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token_hash=?', tokenHash(token));
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    tokenHash(token),
    new Date().toISOString()
  );
  if (!row) return null;
  try {
    run('UPDATE users SET last_seen_at=? WHERE id=?', now(), row.id);
  } catch {}
  return publicUser(row);
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    title: u.title,
    department: u.department,
    managerId: u.manager_id,
    phone: u.phone,
    location: u.location,
    avatar: u.avatar,
    color: u.color,
    skills: parseArr(u.skills),
    weeklyHours: u.weekly_hours,
    focusHours: u.focus_hours,
    status: u.status,
    joinedAt: u.joined_at,
    note: u.note,
    isDemo: !!u.is_demo,
    lastSeenAt: u.last_seen_at,
    createdAt: u.created_at,
  };
}

const parseArr = (s) => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** 路由守卫：把用户放到 ctx.user */
export function attachUser(ctx) {
  const u = currentUser(ctx.req);
  if (u) ctx.user = u;
  return u;
}

export function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

export function requireAdmin(ctx) {
  const u = requireAuth(ctx);
  if (u.role !== 'admin' && u.role !== 'lead') throw forbidden('需要管理员权限');
  return u;
}

/** 团队可见性：返回该用户可管理的 team_id 列表 */
export function managedTeamIds(user) {
  if (!user) return [];
  if (user.role === 'admin') return all('SELECT id FROM teams').map((t) => t.id);
  const ids = all('SELECT team_id FROM team_members WHERE user_id = ?', user.id).map((r) => r.team_id);
  const lead = all('SELECT id FROM teams WHERE lead_id = ?', user.id).map((t) => t.id);
  return [...new Set([...ids, ...lead])];
}

export function purgeExpiredSessions() {
  run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
}

export { HttpError };
