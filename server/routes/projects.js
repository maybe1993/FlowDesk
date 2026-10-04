import { GET, POST, PATCH, DELETE } from '../router.js';
import { all, get, insert, update, run, logActivity } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, forbidden, str, now, num, slugKey, dateStr, daysBetween, clamp } from '../util.js';
import {
  serializeProject,
  serializeMilestone,
  serializeTask,
  deriveHealth,
  projectMetrics,
  userBrief,
} from '../model.js';

const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6'];

const PROJECT_FIELDS = {
  name: 'name',
  key: 'key',
  description: 'description',
  kind: 'kind',
  priority: 'priority',
  health: 'health',
  startDate: 'start_date',
  dueDate: 'due_date',
  color: 'color',
  risks: 'risks',
  nextStep: 'next_step',
  archived: 'archived',
};

GET('/api/projects', async (ctx) => {
  requireAuth(ctx);
  const q = ctx.query;
  const where = [];
  const params = [];
  if (q.scope === 'mine') {
    where.push('(p.owner_id = ? OR p.id IN (SELECT project_id FROM tasks WHERE assignee_id = ?))');
    params.push(ctx.user.id, ctx.user.id);
  } else if (q.scope === 'team') {
    where.push('p.kind = ?');
    params.push('team');
  } else if (q.kind) {
    where.push('p.kind = ?');
    params.push(q.kind);
  }
  if (q.teamId) {
    where.push('p.team_id = ?');
    params.push(num(q.teamId));
  }
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  } else if (q.includeArchived !== '1') {
    where.push('p.archived = 0');
  }
  if (q.q) {
    where.push('(p.name LIKE ? OR p.description LIKE ? OR p.key LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like);
  }
  const rows = all(
    `SELECT p.*, t.name AS team_name FROM projects p LEFT JOIN teams t ON t.id = p.team_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.starred DESC, p.status='done', p.status='cancelled', p.due_date IS NULL, p.due_date, p.id DESC`,
    ...params
  );
  const map = rows.map((p) => serializeProject(p, { teamName: p.team_name }));
  if (q.sort === 'load') {
    map.sort((a, b) => b.metrics.open - a.metrics.open || a.dueDate?.localeCompare(b.dueDate || '9999'));
  }
  return map;
});

GET('/api/projects/:id', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const p = get(
    `SELECT p.*, t.name AS team_name FROM projects p LEFT JOIN teams t ON t.id=p.team_id WHERE p.id=?`,
    id
  );
  if (!p) throw notFound('项目不存在');
  const owner = p.owner_id ? get('SELECT * FROM users WHERE id=?', p.owner_id) : null;
  const project = serializeProject(p, { teamName: p.team_name });
  project.owner = owner ? userBrief(owner) : null;
  project.healthAuto = project.healthAuto || deriveHealth(p);
  project.milestones = all('SELECT * FROM milestones WHERE project_id=? ORDER BY sort, due_date IS NULL, due_date', id).map(
    serializeMilestone
  );
  const taskRows = all(
    `SELECT t.*, u.name AS assignee_name, u.avatar AS assignee_avatar, u.color AS assignee_color
     FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=? ORDER BY t.status='done', t.order_index, t.id`,
    id
  );
  project.tasks = taskRows.map((t) => serializeTask(t));
  project.members = all(
    `SELECT DISTINCT u.id,u.name,u.avatar,u.color,u.title FROM tasks t JOIN users u ON u.id=t.assignee_id WHERE t.project_id=?`,
    id
  ).map(userBrief);
  project.logs = all(
    `SELECT l.*, u.name AS user_name FROM work_logs l JOIN users u ON u.id=l.user_id
     WHERE l.project_id=? ORDER BY l.log_date DESC, l.id DESC LIMIT 50`,
    id
  ).map((l) => ({ id: l.id, userId: l.user_id, userName: l.user_name, minutes: l.minutes, note: l.note, date: l.log_date }));
  project.activity = all(
    `SELECT * FROM activity WHERE target_type='project' AND target_id=? ORDER BY created_at DESC LIMIT 30`,
    id
  ).map((a) => ({ id: a.id, action: a.action, userId: a.user_id, createdAt: a.created_at, targetName: a.target_name }));
  project.weeklyTrend = trend(id);
  return project;
});

function trend(projectId) {
  const out = [];
  for (let i = 7; i >= 0; i--) {
    const d = dateStr(new Date(Date.now() - i * 86400000));
    const done = get(
      `SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND status='done' AND substr(completed_at,1,10)=?`,
      projectId,
      d
    );
    const mins = get('SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE project_id=? AND log_date=?', projectId, d);
    out.push({ date: d, done: num(done?.n), hours: Math.round((num(mins?.m) / 60) * 10) / 10 });
  }
  return out;
}

POST('/api/projects', async (ctx) => {
  const me = requireAuth(ctx);
  const b = ctx.body;
  const name = str(b.name, 80)?.trim();
  if (!name) throw bad('请填写项目名称');
  const kind = b.kind === 'team' ? 'team' : 'personal';
  const count = get('SELECT COUNT(*) AS n FROM projects')?.n || 0;
  const key = (str(b.key, 12) || slugKey(name)).toUpperCase();
  const id = insert('projects', {
    name,
    key,
    description: str(b.description, 3000),
    kind,
    team_id: b.teamId ? num(b.teamId) : null,
    owner_id: b.ownerId ? num(b.ownerId) : me.id,
    status: ['planning', 'active', 'paused', 'done', 'cancelled'].includes(b.status) ? b.status : 'active',
    priority: ['low', 'med', 'high', 'urgent'].includes(b.priority) ? b.priority : 'med',
    health: ['good', 'watch', 'at_risk'].includes(b.health) ? b.health : 'good',
    start_date: b.startDate || dateStr(),
    due_date: b.dueDate || null,
    color: str(b.color, 20) || PALETTE[count % PALETTE.length],
    tags: JSON.stringify((b.tags || []).slice(0, 12)),
    budget_hours: b.budgetHours ? num(b.budgetHours) : null,
    risks: str(b.risks, 2000),
    next_step: str(b.nextStep, 500),
    starred: b.starred ? 1 : 0,
    created_by: me.id,
    created_at: now(),
    updated_at: now(),
  });
  const milestones = Array.isArray(b.milestones) ? b.milestones.slice(0, 20) : [];
  milestones.forEach((m, i) => {
    if (!str(m.name, 80)) return;
    insert('milestones', {
      project_id: id,
      name: str(m.name, 80),
      description: str(m.description, 500),
      due_date: m.dueDate || null,
      status: 'planned',
      owner_id: me.id,
      sort: i + 1,
      created_at: now(),
    });
  });
  logActivity(me.id, 'project.create', 'project', id, name);
  return { ok: true, id };
});

PATCH('/api/projects/:id', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw notFound('项目不存在');
  const b = ctx.body;
  const patch = { updated_at: now() };
  for (const [k, col] of Object.entries(PROJECT_FIELDS)) {
    if (b[k] !== undefined) patch[col] = col === 'archived' ? (b[k] ? 1 : 0) : str(b[k], col === 'description' ? 3000 : 500);
  }
  if (b.teamId !== undefined) patch.team_id = b.teamId ? num(b.teamId) : null;
  if (b.ownerId !== undefined) patch.owner_id = b.ownerId ? num(b.ownerId) : null;
  if (b.tags !== undefined) patch.tags = JSON.stringify((b.tags || []).slice(0, 12));
  if (b.budgetHours !== undefined) patch.budget_hours = b.budgetHours ? num(b.budgetHours) : null;
  if (b.status && b.status !== p.status) {
    patch.completed_at = b.status === 'done' ? now() : null;
    if (b.status === 'active') patch.start_date = p.start_date || dateStr();
  }
  update('projects', id, patch);
  logActivity(me.id, `project.${b.status && b.status !== p.status ? 'status' : 'update'}`, 'project', id, p.name);
  return { ok: true, project: serializeProject(get('SELECT * FROM projects WHERE id=?', id)) };
});

POST('/api/projects/:id/recompute-health', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw notFound('项目不存在');
  const h = deriveHealth(p);
  update('projects', id, { health: h, updated_at: now() });
  return { ok: true, health: h, metrics: projectMetrics(id) };
});

POST('/api/projects/:id/star', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw notFound('项目不存在');
  update('projects', id, { starred: p.starred ? 0 : 1 });
  return { ok: true, starred: !p.starred };
});

DELETE('/api/projects/:id', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  const p = get('SELECT * FROM projects WHERE id=?', id);
  if (!p) throw notFound('项目不存在');
  if (me.role === 'member' && p.owner_id !== me.id) throw forbidden('只有项目负责人或管理员可删除项目');
  if (ctx.query.hard === '1') {
    run('UPDATE tasks SET project_id=NULL WHERE project_id=?', id);
    run('DELETE FROM milestones WHERE project_id=?', id);
    run('DELETE FROM projects WHERE id=?', id);
    logActivity(me.id, 'project.delete', 'project', id, p.name);
    return { ok: true, hard: true };
  }
  update('projects', id, { archived: 1, status: 'cancelled' });
  return { ok: true, archived: true };
});

// ---- 里程碑 ----
POST('/api/projects/:id/milestones', async (ctx) => {
  requireAuth(ctx);
  const pid = num(ctx.params.id);
  const name = str(ctx.body.name, 80)?.trim();
  if (!name) throw bad('请填写里程碑名称');
  const maxSort = get('SELECT COALESCE(MAX(sort),0) AS s FROM milestones WHERE project_id=?', pid)?.s || 0;
  const id = insert('milestones', {
    project_id: pid,
    name,
    description: str(ctx.body.description, 500),
    due_date: ctx.body.dueDate || null,
    status: ['planned', 'doing', 'done', 'late'].includes(ctx.body.status) ? ctx.body.status : 'planned',
    owner_id: ctx.body.ownerId ? num(ctx.body.ownerId) : ctx.user.id,
    sort: maxSort + 1,
    created_at: now(),
  });
  return { ok: true, milestone: serializeMilestone(get('SELECT * FROM milestones WHERE id=?', id)) };
});

PATCH('/api/milestones/:id', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const b = ctx.body;
  const patch = {};
  for (const [k, col] of [
    ['name', 'name'],
    ['description', 'description'],
    ['dueDate', 'due_date'],
    ['status', 'status'],
  ]) {
    if (b[k] !== undefined) patch[col] = str(b[k], 500);
  }
  if (b.ownerId !== undefined) patch.owner_id = b.ownerId ? num(b.ownerId) : null;
  if (b.sort !== undefined) patch.sort = num(b.sort);
  if (!Object.keys(patch).length) throw bad('没有需要更新的字段');
  update('milestones', id, patch);
  const ms = get('SELECT * FROM milestones WHERE id=?', id);
  // 里程碑完成 -> 重算项目进度
  if (patch.status === 'done') {
    const p = get('SELECT * FROM projects WHERE id=?', ms.project_id);
    const m = projectMetrics(ms.project_id);
    if (p && m.total > 0 && m.done / m.total >= 0.999) {
      update('projects', ms.project_id, { status: 'done', completed_at: now(), progress: 100, health: 'good' });
    }
  }
  return { ok: true, milestone: serializeMilestone(ms) };
});

DELETE('/api/milestones/:id', async (ctx) => {
  requireAuth(ctx);
  run('UPDATE tasks SET milestone_id=NULL WHERE milestone_id=?', num(ctx.params.id));
  run('DELETE FROM milestones WHERE id=?', num(ctx.params.id));
  return { ok: true };
});

// ---- 项目健康巡检 ----
GET('/api/projects-health-scan', async (ctx) => {
  requireAuth(ctx);
  const rows = all("SELECT * FROM projects WHERE archived=0 AND status NOT IN ('done','cancelled')");
  const today = dateStr();
  const report = rows.map((p) => {
    const m = projectMetrics(p.id);
    const auto = deriveHealth(p);
    const ms = all(
      "SELECT * FROM milestones WHERE project_id=? AND status <> 'done' ORDER BY due_date",
      p.id
    )[0];
    const flags = [];
    if (m.overdue > 0) flags.push(`${m.overdue} 项任务逾期`);
    if (p.due_date && daysBetween(today, p.due_date) < 0) flags.push('项目已过截止日');
    if (ms && ms.due_date && daysBetween(today, ms.due_date) <= 7) flags.push(`里程碑「${ms.name}」${Math.max(0, daysBetween(today, ms.due_date))} 天内到期`);
    if (auto === 'at_risk' && p.health !== 'at_risk') flags.push('进度明显落后于时间线');
    if (m.total === 0) flags.push('尚未拆解任何任务');
    return {
      id: p.id,
      name: p.name,
      color: p.color,
      status: p.status,
      priority: p.priority,
      health: p.health,
      healthAuto: auto,
      dueDate: p.due_date,
      daysLeft: p.due_date ? daysBetween(today, p.due_date) : null,
      metrics: m,
      flags,
      action: auto === 'at_risk' ? '建议：缩范围或加人，先补最关键的 1-2 项' : m.overdue > 0 ? '建议：先清理逾期任务，再排新工作' : '节奏正常',
    };
  });
  report.sort((a, b) => {
    const rank = { at_risk: 0, watch: 1, good: 2 };
    return rank[a.healthAuto] - rank[b.healthAuto] || (a.daysLeft ?? 999) - (b.daysLeft ?? 999);
  });
  return report;
});