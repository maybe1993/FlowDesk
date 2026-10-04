// 管理端：备份 / 恢复 / 导入导出 / CSV 导入 / 重置
import { GET, POST, DELETE } from '../router.js';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { all, get, insert, update, run, db, DATA_DIR, setMeta, getMeta } from '../db.js';
import { requireAdmin, hashPassword, createSession } from '../auth.js';
import { bad, notFound, str, now, num, dateStr } from '../util.js';
import { parseNatural } from '../natural.js';

const TABLES = [
  'users',
  'teams',
  'team_members',
  'projects',
  'milestones',
  'tasks',
  'work_logs',
  'notifications',
  'activity',
  'plans',
  'settings',
];

GET('/api/admin/export', async (ctx) => {
  requireAdmin(ctx);
  const dump = { version: 1, exportedAt: now(), data: {} };
  for (const t of TABLES) {
    const rows = all(`SELECT * FROM ${t}`);
    if (t === 'users') {
      for (const r of rows) delete r.password_hash;
    }
    dump.data[t] = rows;
  }
  return dump;
});

POST('/api/admin/import', async (ctx) => {
  requireAdmin(ctx);
  const mode = ctx.body.mode === 'merge' ? 'merge' : 'replace';
  const data = ctx.body.data;
  if (!data || typeof data !== 'object') throw bad('导入数据格式不正确');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    if (mode === 'replace') {
      db.exec('PRAGMA foreign_keys = OFF');
      for (const t of [...TABLES].reverse()) run(`DELETE FROM ${t}`);
      run(`DELETE FROM sqlite_sequence`);
    }
    const stats = {};
    for (const t of TABLES) {
      const rows = data[t];
      if (!Array.isArray(rows)) continue;
      let n = 0;
      for (const row of rows) {
        const keys = Object.keys(row);
        if (!keys.length) continue;
        if (mode === 'merge' && t === 'users' && row.id) {
          const exists = get('SELECT id FROM users WHERE id=?', row.id);
          if (exists) {
            update('users', row.id, row);
            n++;
            continue;
          }
        }
        try {
          insert(t, row);
          n++;
        } catch {
          /* 主键冲突跳过 */
        }
      }
      stats[t] = n;
    }
    return { ok: true, mode, stats };
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
});

POST('/api/admin/backup', async (ctx) => {
  requireAdmin(ctx);
  await mkdir(join(DATA_DIR, 'backups'), { recursive: true });
  const stamp = now().replace(/[-:]/g, '').slice(0, 15);
  const file = join(DATA_DIR, 'backups', `flowdesk-${stamp}.json`);
  const dump = { version: 1, exportedAt: now(), data: {} };
  for (const t of TABLES) {
    dump.data[t] = all(`SELECT * FROM ${t}`);
  }
  for (const r of dump.data.users) delete r.password_hash;
  await writeFile(file, JSON.stringify(dump, null, 0), 'utf8');
  return { ok: true, file, size: (await readFile(file)).length };
});

GET('/api/admin/backups', async (ctx) => {
  requireAdmin(ctx);
  try {
    const files = await readdir(join(DATA_DIR, 'backups'));
    return files.filter((f) => f.endsWith('.json')).sort().reverse();
  } catch {
    return [];
  }
});

// ---- CSV 导入（任务 / 项目 / 成员） ----
const csvRows = (text) => {
  const rows = [];
  let cur = '';
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else if (c !== '\r') cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
};

const headerMap = {
  标题: 'title',
  任务: 'title',
  名称: 'name',
  项目: 'project',
  负责人: 'assignee',
  状态: 'status',
  优先级: 'priority',
  截止日期: 'dueAt',
  截止: 'dueAt',
  开始: 'startAt',
  开始日期: 'startAt',
  预估工时: 'estimateHours',
  工时: 'estimateHours',
  标签: 'tags',
  备注: 'notes',
  描述: 'description',
  部门: 'department',
  职位: 'title',
  邮箱: 'email',
};

const STATUS_ALIAS = {
  待办: 'todo',
  进行中: 'doing',
  已完成: 'done',
  完成: 'done',
  待验收: 'review',
  规划中: 'backlog',
  已取消: 'cancelled',
  todo: 'todo',
  doing: 'doing',
  done: 'done',
};
const PRIORITY_ALIAS = {
  低: 'low',
  中: 'med',
  高: 'high',
  紧急: 'urgent',
  low: 'low',
  med: 'med',
  medium: 'med',
  high: 'high',
  urgent: 'urgent',
};

POST('/api/admin/import/csv', async (ctx) => {
  const user = requireAdmin(ctx);
  const text = String(ctx.body.text || '');
  const kind = ctx.body.kind || 'tasks'; // tasks | projects | users
  const rows = csvRows(text);
  if (rows.length < 2) throw bad('CSV 内容为空或只有表头');
  const header = rows[0].map((h) => headerMap[String(h).trim()] || String(h).trim());
  const created = [];
  const skipped = [];
  const dryRun = !!ctx.body.dryRun;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const rec = {};
    header.forEach((h, j) => {
      const v = String(r[j] ?? '').trim();
      if (h && v) rec[h] = v;
    });
    try {
      if (kind === 'tasks') {
        if (!rec.title) throw new Error('缺少标题');
        const project = rec.project
          ? get('SELECT id FROM projects WHERE name=? OR key=?', rec.project, String(rec.project).toUpperCase())
          : null;
        const assignee = rec.assignee ? get('SELECT id FROM users WHERE name=?', rec.assignee) : null;
        let dueAt = rec.dueAt || null;
        let startAt = rec.startAt || null;
        if (dueAt && !/^\d{4}-\d{2}-\d{2}/.test(dueAt)) {
          const p = parseNatural(dueAt, { base: dateStr() });
          dueAt = p.dueAt;
          if (!startAt) startAt = p.startAt;
        }
        if (!dryRun) {
          const id = insert('tasks', {
            title: rec.title.slice(0, 200),
            notes: rec.notes || null,
            kind: 'task',
            project_id: project?.id || null,
            assignee_id: assignee?.id || user.id,
            creator_id: user.id,
            status: STATUS_ALIAS[rec.status] || 'todo',
            priority: PRIORITY_ALIAS[rec.priority] || 'med',
            start_at: startAt,
            due_at: dueAt,
            estimate_hours: num(rec.estimateHours, 0),
            tags: JSON.stringify(rec.tags ? rec.tags.split(/[,;、]/).map((s) => s.trim()).filter(Boolean) : []),
            order_index: Date.now() / 1e6 + i,
            created_at: now(),
            updated_at: now(),
          });
          created.push({ id, title: rec.title });
        } else created.push({ id: null, title: rec.title });
      } else if (kind === 'projects') {
        if (!rec.name) throw new Error('缺少名称');
        if (!dryRun) {
          const id = insert('projects', {
            name: rec.name.slice(0, 80),
            key: str(rec.key, 12)?.toUpperCase() || null,
            description: rec.description || null,
            kind: 'personal',
            owner_id: user.id,
            status: STATUS_ALIAS[rec.status] || 'active',
            priority: PRIORITY_ALIAS[rec.priority] || 'med',
            start_date: dateStr(),
            due_date: rec.dueAt && /^\d{4}-\d{2}-\d{2}/.test(rec.dueAt) ? rec.dueAt : null,
            created_by: user.id,
            created_at: now(),
            updated_at: now(),
          });
          created.push({ id, title: rec.name });
        } else created.push({ id: null, title: rec.name });
      } else if (kind === 'users') {
        if (!rec.name) throw new Error('缺少姓名');
        if (!dryRun) {
          const id = insert('users', {
            name: rec.name.slice(0, 40),
            email: rec.email ? rec.email.toLowerCase() : null,
            title: rec.title || null,
            department: rec.department || null,
            role: 'member',
            avatar: rec.name.slice(0, 1),
            weekly_hours: 40,
            focus_hours: 22,
            status: 'active',
            joined_at: dateStr(),
            created_at: now(),
          });
          created.push({ id, title: rec.name });
        } else created.push({ id: null, title: rec.name });
      } else {
        throw new Error('未知导入类型');
      }
    } catch (e) {
      skipped.push({ row: i + 1, reason: e.message, raw: r.join(',').slice(0, 120) });
    }
  }
  return { ok: true, dryRun, created: created.length, skipped, items: created.slice(0, 50) };
});

POST('/api/admin/reset-demo', async (ctx) => {
  requireAdmin(ctx);
  // 清业务数据，保留用户与密码
  for (const t of ['work_logs', 'activity', 'plans', 'notifications', 'tasks', 'milestones', 'projects', 'team_members', 'teams']) {
    run(`DELETE FROM ${t}`);
  }
  run(`DELETE FROM sqlite_sequence WHERE name IN ('tasks','projects','milestones','work_logs','activity','notifications','plans','team_members','teams')`);
  setMeta('needsSeed', '1');
  return { ok: true, note: '业务数据已清空，运行 npm run seed 可重新灌入演示数据' };
});

DELETE('/api/admin/purge-notifications', async (ctx) => {
  const user = requireAdmin(ctx);
  run('DELETE FROM notifications WHERE user_id=?', user.id);
  return { ok: true };
});

GET('/api/admin/stats', async (ctx) => {
  requireAdmin(ctx);
  const counts = {};
  for (const t of TABLES) counts[t] = num(get(`SELECT COUNT(*) AS n FROM ${t}`)?.n);
  return {
    counts,
    dbPath: getMeta('dbPath') || null,
    nodeVersion: process.version,
    uptime: Math.round(process.uptime()),
    seededAt: getMeta('seededAt'),
  };
});

// ---- 首次初始化（空库时创建管理员） ----
POST('/api/admin/init', async (ctx) => {
  const existing = num(get('SELECT COUNT(*) AS n FROM users')?.n);
  if (existing > 0) throw bad('系统已初始化');
  const name = str(ctx.body.name, 40)?.trim() || '管理员';
  const password = String(ctx.body.password || '');
  if (password.length < 6) throw bad('密码至少 6 位');
  const id = insert('users', {
    name,
    email: str(ctx.body.email, 80)?.toLowerCase() || null,
    password_hash: hashPassword(password),
    role: 'admin',
    title: '系统管理员',
    avatar: name.slice(0, 1),
    color: '#6366f1',
    weekly_hours: 40,
    focus_hours: 22,
    status: 'active',
    joined_at: dateStr(),
    created_at: now(),
  });
  insert('settings', { user_id: id, key: 'work_start', value: '09:30' });
  // 关键：初始化后直接发 session，否则前端 reload 会被打回登录页形成死循环
  createSession(ctx.res, id, ctx.req.headers['user-agent']);
  setMeta('seededAt', now());
  return { ok: true, id };
}, { auth: false });
