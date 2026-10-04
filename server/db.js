// SQLite 存储层：连接、建表、迁移、通用查询helper
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { now } from './util.js';

// 便捷再导出：脚本层常常同时需要 db 与日期工具
export { now, dateStr, addDaysStr, startOfWeekStr, round1, num, daysBetween } from './util.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..');
export const DATA_DIR = process.env.FLOWDESK_DATA || join(ROOT, 'data');
export const DB_PATH = process.env.FLOWDESK_DB || join(DATA_DIR, 'flowdesk.db');

mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT UNIQUE,
  password_hash TEXT,
  role          TEXT NOT NULL DEFAULT 'member',      -- admin | lead | member
  title         TEXT,                                -- 职位
  department    TEXT,
  manager_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phone         TEXT,
  location      TEXT,
  avatar        TEXT,                                -- emoji
  color         TEXT DEFAULT '#6366f1',
  skills        TEXT DEFAULT '[]',
  weekly_hours  REAL NOT NULL DEFAULT 40,            -- 每周总工时
  focus_hours   REAL NOT NULL DEFAULT 22,            -- 每周可深度工作工时
  status        TEXT NOT NULL DEFAULT 'active',      -- active | leave | left
  joined_at     TEXT,
  note          TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 0,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT UNIQUE,
  description TEXT,
  color       TEXT DEFAULT '#0ea5e9',
  lead_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',   -- lead | member | observer
  joined_at TEXT,
  UNIQUE(team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS projects (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  key          TEXT,
  description  TEXT,
  kind         TEXT NOT NULL DEFAULT 'personal',   -- personal | team
  team_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT NOT NULL DEFAULT 'active',     -- planning|active|paused|done|cancelled
  priority     TEXT NOT NULL DEFAULT 'med',        -- low|med|high|urgent
  health       TEXT NOT NULL DEFAULT 'good',       -- good|watch|at_risk
  start_date   TEXT,
  due_date     TEXT,
  color        TEXT DEFAULT '#6366f1',
  tags         TEXT DEFAULT '[]',
  progress     REAL NOT NULL DEFAULT 0,
  budget_hours REAL,
  starred      INTEGER NOT NULL DEFAULT 0,
  archived     INTEGER NOT NULL DEFAULT 0,
  parent_id    INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  risks        TEXT,                                -- 风险/阻塞说明
  next_step    TEXT,                                -- 下一步
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);

CREATE TABLE IF NOT EXISTS milestones (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'planned',   -- planned|doing|done|late
  owner_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort        REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ms_project ON milestones(project_id);

CREATE TABLE IF NOT EXISTS tasks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  notes          TEXT,
  kind           TEXT NOT NULL DEFAULT 'task',     -- task | event
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  parent_id      INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  milestone_id   INTEGER REFERENCES milestones(id) ON DELETE SET NULL,
  team_id        INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  assignee_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  creator_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'todo',     -- backlog|todo|doing|review|done|cancelled
  priority       TEXT NOT NULL DEFAULT 'med',      -- low|med|high|urgent
  start_at       TEXT,
  due_at         TEXT,
  end_at         TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0,
  location       TEXT,
  tags           TEXT DEFAULT '[]',
  estimate_hours REAL NOT NULL DEFAULT 0,
  actual_hours   REAL NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,       -- 置顶/重点关注
  week_start     TEXT,                              -- 计划归属周(周一)
  blocked        INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  order_index    REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  completed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_at);
CREATE INDEX IF NOT EXISTS idx_tasks_week ON tasks(week_start);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);

CREATE TABLE IF NOT EXISTS work_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minutes    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  log_date   TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_logs_user_date ON work_logs(user_id, log_date);
CREATE INDEX IF NOT EXISTS idx_logs_project ON work_logs(project_id);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'info',
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  level       TEXT NOT NULL DEFAULT 'info',   -- info|warn|danger
  read        INTEGER NOT NULL DEFAULT 0,
  dedupe_key  TEXT,
  created_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedupe ON notifications(user_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   INTEGER,
  target_name TEXT,
  meta        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);

CREATE TABLE IF NOT EXISTS plans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  title      TEXT,
  scope      TEXT NOT NULL DEFAULT 'me',   -- me | team
  payload    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft', -- draft | adopted
  note       TEXT,
  created_at TEXT NOT NULL,
  adopted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_plans_user_week ON plans(user_id, week_start);

CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

// ---- 迁移：为老库补列 ----
function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}
ensureColumn('users', 'last_seen_at', 'TEXT');
ensureColumn('users', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('projects', 'risks', 'TEXT');
ensureColumn('projects', 'next_step', 'TEXT');
ensureColumn('tasks', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tasks', 'week_start', 'TEXT');
ensureColumn('tasks', 'blocked', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('tasks', 'blocked_reason', 'TEXT');

export function setMeta(key, value) {
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(
    key,
    String(value)
  );
}
export function getMeta(key) {
  const r = db.prepare('SELECT value FROM meta WHERE key=?').get(key);
  return r ? r.value : null;
}

// ---------- 查询 helper ----------
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

export function insert(table, data) {
  const keys = Object.keys(data);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
  const r = db.prepare(sql).run(...keys.map((k) => normalize(data[k])));
  return Number(r.lastInsertRowid);
}

export function update(table, id, data) {
  const keys = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`;
  const r = db.prepare(sql).run(...keys.map((k) => normalize(data[k])), id);
  return r.changes;
}

function normalize(v) {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw e;
  }
}

export function logActivity(userId, action, targetType, targetId, targetName, metaObj = null) {
  try {
    insert('activity', {
      user_id: userId ?? null,
      action,
      target_type: targetType ?? null,
      target_id: targetId ?? null,
      target_name: targetName ?? null,
      meta: metaObj ? JSON.stringify(metaObj) : null,
      created_at: now(),
    });
  } catch {
    /* 活动日志失败不应影响主流程 */
  }
}

// ---------- 设置 ----------
export const DEFAULT_SETTINGS = {
  work_start: '09:30',
  work_end: '18:30',
  work_days: '1,2,3,4,5',
  day_focus_hours: '4',
  week_start: '1',
  theme: 'system',
  locale: 'zh-CN',
  notify_overdue: '1',
  notify_due_soon: '1',
  notify_daily: '1',
  auto_plan: '0',
  calendar_start: '08:00',
  calendar_end: '20:00',
};

export function getSettings(userId) {
  const rows = all('SELECT key, value FROM settings WHERE user_id=?', userId);
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function saveSettings(userId, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (!/^[a-z_][a-z0-9_]{0,40}$/i.test(k)) continue;
    run(
      'INSERT INTO settings(user_id,key,value) VALUES(?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value',
      userId,
      k,
      v == null ? null : String(v)
    );
  }
  return getSettings(userId);
}

export function isSeeded() {
  const u = get('SELECT COUNT(*) AS n FROM users');
  return (u?.n || 0) > 0;
}
