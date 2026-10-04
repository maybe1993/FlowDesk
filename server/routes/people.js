import { GET, POST, PATCH, DELETE } from '../router.js';
import { all, get, insert, update, run, logActivity } from '../db.js';
import { requireAuth, requireAdmin, hashPassword } from '../auth.js';
import { bad, notFound, forbidden, str, now, num, clamp } from '../util.js';
import { fullUser, userBrief, workloadRows, arr } from '../model.js';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

GET('/api/users', async (ctx) => {
  requireAuth(ctx);
  const q = ctx.query;
  const where = [];
  const params = [];
  if (q.status) {
    where.push('u.status=?');
    params.push(q.status);
  }
  if (q.teamId) {
    where.push('u.id IN (SELECT user_id FROM team_members WHERE team_id=?)');
    params.push(num(q.teamId));
  }
  if (q.q) {
    where.push('(u.name LIKE ? OR u.title LIKE ? OR u.department LIKE ? OR u.email LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  const rows = all(
    `SELECT u.*, m.name AS manager_name FROM users u
     LEFT JOIN users m ON m.id = u.manager_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE u.status WHEN 'active' THEN 0 WHEN 'leave' THEN 1 ELSE 2 END, u.id`,
    ...params
  );
  const withLoad = q.withLoad === '1';
  const loads = withLoad ? new Map(workloadRows(rows.map((r) => r.id), ctx.query.weekStart).map((l) => [l.userId, l])) : new Map();
  return rows.map((u) => ({
    ...fullUser(u),
    manager: u.manager_name ? { id: u.manager_id, name: u.manager_name } : null,
    load: loads.get(u.id) || null,
    teamCount: get('SELECT COUNT(*) AS n FROM team_members WHERE user_id=?', u.id)?.n || 0,
  }));
});

GET('/api/users/:id', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const u = get('SELECT * FROM users WHERE id=?', id);
  if (!u) throw notFound('成员不存在');
  const [load] = workloadRows([id], ctx.query.weekStart);
  const active = all(
    `SELECT id,title,kind,status,priority,due_at,estimate_hours,project_id FROM tasks
     WHERE assignee_id=? AND status NOT IN ('done','cancelled') AND kind='task' ORDER BY
       CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'med' THEN 2 ELSE 3 END, due_at IS NULL, due_at`,
    id
  );
  const recent = all(
    `SELECT id,title,status,project_id,completed_at FROM tasks
     WHERE assignee_id=? AND status='done' AND kind='task' ORDER BY completed_at DESC LIMIT 15`,
    id
  );
  const weekly = all(
    `SELECT substr(completed_at,1,7) AS ym, COUNT(*) AS n FROM tasks
     WHERE assignee_id=? AND status='done' GROUP BY ym ORDER BY ym DESC LIMIT 8`,
    id
  );
  return {
    user: fullUser(u),
    load,
    activeTasks: active,
    recentDone: recent,
    monthlyOutput: weekly.reverse(),
    projects: all(
      `SELECT p.id,p.name,p.color,p.status FROM projects p
       WHERE p.owner_id=? OR p.id IN (SELECT project_id FROM tasks WHERE assignee_id=?)
       ORDER BY p.status='done', p.id DESC LIMIT 20`,
      id,
      id
    ),
    teams: all(
      `SELECT t.id,t.name,t.color,m.role FROM team_members m JOIN teams t ON t.id=m.team_id WHERE m.user_id=?`,
      id
    ),
  };
});

POST('/api/users', async (ctx) => {
  requireAdmin(ctx);
  const b = ctx.body;
  const name = str(b.name, 40)?.trim();
  if (!name) throw bad('请填写姓名');
  const email = str(b.email, 80)?.trim()?.toLowerCase() || null;
  if (email && get('SELECT id FROM users WHERE email=?', email)) throw bad('邮箱已存在');
  const count = get('SELECT COUNT(*) AS n FROM users')?.n || 0;
  const id = insert('users', {
    name,
    email,
    password_hash: b.password ? hashPassword(String(b.password)) : null,
    role: ['admin', 'lead', 'member'].includes(b.role) ? b.role : 'member',
    title: str(b.title, 40),
    department: str(b.department, 40),
    manager_id: b.managerId ? num(b.managerId) : null,
    phone: str(b.phone, 40),
    location: str(b.location, 40),
    avatar: str(b.avatar, 8) || name.slice(0, 1),
    color: COLORS[count % COLORS.length],
    skills: JSON.stringify((b.skills || []).slice(0, 30)),
    weekly_hours: clamp(num(b.weeklyHours, 40), 1, 80),
    focus_hours: clamp(num(b.focusHours, 22), 1, 60),
    status: 'active',
    joined_at: str(b.joinedAt, 10) || now().slice(0, 10),
    created_at: now(),
  });
  if (Array.isArray(b.teamIds)) {
    for (const tid of b.teamIds) {
      insert('team_members', { team_id: num(tid), user_id: id, role: 'member', joined_at: now().slice(0, 10) });
    }
  }
  logActivity(ctx.user.id, 'user.create', 'user', id, name);
  return { ok: true, user: fullUser(get('SELECT * FROM users WHERE id=?', id)) };
});

PATCH('/api/users/:id', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  if (id !== me.id && me.role !== 'admin' && me.role !== 'lead') throw forbidden('无权修改他人资料');
  const target = get('SELECT * FROM users WHERE id=?', id);
  if (!target) throw notFound('成员不存在');
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
    ['status', 'status'],
    ['role', 'role'],
  ]) {
    if (b[k] !== undefined) patch[col] = str(b[k], col === 'note' ? 2000 : 40);
  }
  if (b.managerId !== undefined) patch.manager_id = b.managerId ? num(b.managerId) : null;
  if (b.weeklyHours !== undefined) patch.weekly_hours = clamp(num(b.weeklyHours, 40), 1, 80);
  if (b.focusHours !== undefined) patch.focus_hours = clamp(num(b.focusHours, 22), 1, 60);
  if (b.skills !== undefined) patch.skills = JSON.stringify((b.skills || []).slice(0, 30));
  if (b.password) {
    if (id !== me.id && me.role !== 'admin' && me.role !== 'lead') throw bad('无权重置他人密码');
    patch.password_hash = hashPassword(String(b.password));
  }
  if (patch.status && !['active', 'leave', 'left'].includes(patch.status)) delete patch.status;
  if (patch.role && !['admin', 'lead', 'member'].includes(patch.role)) delete patch.role;
  if (patch.role && id !== me.id && me.role === 'admin') {
    const admins = get("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND status='active'")?.n || 0;
    if (target.role === 'admin' && admins <= 1) throw bad('至少保留一名管理员');
  }
  if (patch.email) {
    patch.email = patch.email.toLowerCase();
    if (get('SELECT id FROM users WHERE email=? AND id<>?', patch.email, id)) throw bad('邮箱已存在');
  }
  update('users', id, patch);
  logActivity(me.id, 'user.update', 'user', id, target.name, { fields: Object.keys(patch) });
  return { ok: true, user: fullUser(get('SELECT * FROM users WHERE id=?', id)) };
});

DELETE('/api/users/:id', async (ctx) => {
  const me = requireAdmin(ctx);
  const id = num(ctx.params.id);
  if (id === me.id) throw forbidden('不能删除自己');
  const u = get('SELECT * FROM users WHERE id=?', id);
  if (!u) throw notFound('成员不存在');
  run("UPDATE users SET status='left' WHERE id=?", id);
  run('DELETE FROM sessions WHERE user_id=?', id);
  logActivity(me.id, 'user.offboard', 'user', id, u.name);
  return { ok: true, note: '成员已标记为离职（保留历史数据）' };
});

POST('/api/users/:id/password-reset', async (ctx) => {
  requireAdmin(ctx);
  const id = num(ctx.params.id);
  const pwd = String(ctx.body.password || '');
  if (pwd.length < 6) throw bad('新密码至少 6 位');
  update('users', id, { password_hash: hashPassword(pwd) });
  run('DELETE FROM sessions WHERE user_id=?', id);
  return { ok: true };
});

// ---- 团队 ----
GET('/api/teams', async (ctx) => {
  requireAuth(ctx);
  return all('SELECT * FROM teams ORDER BY id').map((t) => ({
    id: t.id,
    name: t.name,
    code: t.code,
    description: t.description,
    color: t.color,
    leadId: t.lead_id,
    createdAt: t.created_at,
    memberCount: get('SELECT COUNT(*) AS n FROM team_members WHERE team_id=?', t.id)?.n || 0,
    projectCount: get('SELECT COUNT(*) AS n FROM projects WHERE team_id=?', t.id)?.n || 0,
    members: all(
      `SELECT u.id,u.name,u.avatar,u.color,u.title,u.status,m.role AS team_role FROM team_members m
       JOIN users u ON u.id=m.user_id WHERE m.team_id=? ORDER BY m.role='lead' DESC, u.id`,
      t.id
    ).map((m) => ({ ...userBrief(m), teamRole: m.team_role })),
  }));
});

POST('/api/teams', async (ctx) => {
  requireAuth(ctx);
  const b = ctx.body;
  const name = str(b.name, 40)?.trim();
  if (!name) throw bad('请填写团队名称');
  const id = insert('teams', {
    name,
    code: str(b.code, 20)?.trim() || null,
    description: str(b.description, 500),
    color: str(b.color, 20) || '#0ea5e9',
    lead_id: b.leadId ? num(b.leadId) : ctx.user.id,
    created_at: now(),
  });
  const lead = b.leadId ? num(b.leadId) : ctx.user.id;
  insert('team_members', { team_id: id, user_id: lead, role: 'lead', joined_at: now().slice(0, 10) });
  for (const uid of b.memberIds || []) {
    if (num(uid) === lead) continue;
    try {
      insert('team_members', { team_id: id, user_id: num(uid), role: 'member', joined_at: now().slice(0, 10) });
    } catch {}
  }
  logActivity(ctx.user.id, 'team.create', 'team', id, name);
  return { ok: true, id };
});

PATCH('/api/teams/:id', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const b = ctx.body;
  const patch = {};
  if (b.name !== undefined) patch.name = str(b.name, 40);
  if (b.code !== undefined) patch.code = str(b.code, 20);
  if (b.description !== undefined) patch.description = str(b.description, 500);
  if (b.color !== undefined) patch.color = str(b.color, 20);
  if (b.leadId !== undefined) patch.lead_id = b.leadId ? num(b.leadId) : null;
  if (!Object.keys(patch).length) throw bad('没有需要更新的字段');
  update('teams', id, patch);
  if (patch.lead_id) {
    run("UPDATE team_members SET role='lead' WHERE team_id=? AND user_id=?", id, patch.lead_id);
  }
  return { ok: true };
});

POST('/api/teams/:id/members', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const userId = num(ctx.body.userId);
  const role = ['lead', 'member', 'observer'].includes(ctx.body.role) ? ctx.body.role : 'member';
  if (!get('SELECT id FROM teams WHERE id=?', id)) throw notFound('团队不存在');
  if (!get('SELECT id FROM users WHERE id=?', userId)) throw notFound('成员不存在');
  try {
    insert('team_members', { team_id: id, user_id: userId, role, joined_at: now().slice(0, 10) });
  } catch {
    run('UPDATE team_members SET role=? WHERE team_id=? AND user_id=?', role, id, userId);
  }
  return { ok: true };
});

DELETE('/api/teams/:id/members/:userId', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const userId = num(ctx.params.userId);
  run('DELETE FROM team_members WHERE team_id=? AND user_id=?', id, userId);
  return { ok: true };
});

DELETE('/api/teams/:id', async (ctx) => {
  requireAdmin(ctx);
  const id = num(ctx.params.id);
  run('UPDATE projects SET team_id=NULL WHERE team_id=?', id);
  run('DELETE FROM teams WHERE id=?', id);
  return { ok: true };
});

// ---- 全局负载视图 ----
GET('/api/workload', async (ctx) => {
  requireAuth(ctx);
  const ids = ctx.query.teamId
    ? all('SELECT user_id FROM team_members WHERE team_id=?', num(ctx.query.teamId)).map((r) => r.user_id)
    : all("SELECT id FROM users WHERE status != 'left' ORDER BY id").map((r) => r.id);
  return workloadRows(ids, ctx.query.weekStart);
});