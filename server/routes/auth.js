import { GET, POST, PATCH } from '../router.js';
import { get, all, insert, update, run, logActivity, getSettings, isSeeded } from '../db.js';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth, publicUser } from '../auth.js';
import { bad, str, now } from '../util.js';

GET('/api/bootstrap', async (ctx) => {
  // 首屏一次性拉取：当前用户 + 团队 + 轻量字典
  if (!ctx.user) return { authenticated: false, seeded: isSeeded() };
  return {
    authenticated: true,
    user: ctx.user,
    settings: getSettings(ctx.user.id),
    teams: all(
      `SELECT t.*, (SELECT COUNT(*) FROM team_members m WHERE m.team_id=t.id) AS member_count
       FROM teams t ORDER BY t.id`
    ),
    users: all(
      `SELECT id,name,avatar,color,title,role,status,department FROM users WHERE status != 'left' ORDER BY name`
    ).map(publicUser),
    seeded: true,
    serverDate: now().slice(0, 10),
  };
}, { auth: false });

POST('/api/auth/register', async (ctx) => {
  const b = ctx.body;
  const name = str(b.name, 40)?.trim();
  const password = String(b.password || '');
  if (!name) throw bad('请填写姓名');
  if (password.length < 6) throw bad('密码至少 6 位');
  if (!isSeeded()) throw bad('系统已完成初始化，请使用管理员账号登录');
  const email = str(b.email, 80)?.trim()?.toLowerCase() || null;
  if (email && get('SELECT id FROM users WHERE email=?', email)) throw bad('该邮箱已被使用');
  const id = insert('users', {
    name,
    email,
    password_hash: hashPassword(password),
    role: 'member',
    title: str(b.title, 40),
    avatar: str(b.avatar, 8) || name.slice(0, 1),
    color: '#6366f1',
    weekly_hours: 40,
    focus_hours: 22,
    joined_at: now().slice(0, 10),
    created_at: now(),
  });
  logActivity(id, 'user.register', 'user', id, name);
  createSession(ctx.res, id, ctx.req.headers['user-agent']);
  return { ok: true, user: publicUser(get('SELECT * FROM users WHERE id=?', id)) };
}, { auth: false });

POST('/api/auth/login', async (ctx) => {
  const b = ctx.body;
  const ident = str(b.identifier, 120)?.trim();
  const password = String(b.password || '');
  if (!ident) throw bad('请输入账号');
  const u = get('SELECT * FROM users WHERE email = ? OR name = ?', ident.toLowerCase(), ident);
  if (!u) throw bad('账号不存在');
  if (!u.password_hash) throw bad('该账号尚未设置密码，请联系管理员重置');
  if (!verifyPassword(password, u.password_hash)) throw bad('密码错误，请重试');
  createSession(ctx.res, u.id, ctx.req.headers['user-agent']);
  logActivity(u.id, 'user.login', 'user', u.id, u.name);
  return { ok: true, user: publicUser(u) };
}, { auth: false });

POST('/api/auth/logout', async (ctx) => {
  destroySession(ctx.req, ctx.res);
  return { ok: true };
}, { auth: false });

POST('/api/auth/password', async (ctx) => {
  const u = requireAuth(ctx);
  const { oldPassword, newPassword } = ctx.body;
  if (!verifyPassword(oldPassword || '', get('SELECT password_hash FROM users WHERE id=?', u.id)?.password_hash)) {
    throw bad('原密码不正确');
  }
  if (!newPassword || String(newPassword).length < 6) throw bad('新密码至少 6 位');
  update('users', u.id, { password_hash: hashPassword(newPassword) });
  logActivity(u.id, 'user.password', 'user', u.id, u.name);
  return { ok: true };
});

PATCH('/api/auth/profile', async (ctx) => {
  const u = requireAuth(ctx);
  const b = ctx.body;
  const patch = {};
  for (const [k, col] of [
    ['name', 'name'],
    ['email', 'email'],
    ['title', 'title'],
    ['department', 'department'],
    ['phone', 'phone'],
    ['location', 'location'],
    ['avatar', 'avatar'],
    ['color', 'color'],
    ['note', 'note'],
  ]) {
    if (b[k] !== undefined) patch[col] = str(b[k], col === 'note' ? 2000 : 80);
  }
  if (b.weeklyHours !== undefined) patch.weekly_hours = Math.max(1, Math.min(80, Number(b.weeklyHours) || 40));
  if (b.focusHours !== undefined) patch.focus_hours = Math.max(1, Math.min(60, Number(b.focusHours) || 22));
  if (b.skills !== undefined) patch.skills = JSON.stringify((b.skills || []).slice(0, 30));
  if (patch.email) {
    patch.email = patch.email.toLowerCase();
    const dup = get('SELECT id FROM users WHERE email=? AND id<>?', patch.email, u.id);
    if (dup) throw bad('邮箱已被占用');
  }
  if (patch.name === '') delete patch.name;
  update('users', u.id, patch);
  return { ok: true, user: publicUser(get('SELECT * FROM users WHERE id=?', u.id)) };
});