import { GET, POST, PATCH, DELETE } from '../router.js';
import { all, get, insert, update, run, logActivity, tx } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, str, now, num, dateStr, addDaysStr, startOfWeekStr, isDate } from '../util.js';
import { serializeTask, TASK_SELECT, projectMetrics, serializeProject } from '../model.js';
import { parseNatural } from '../natural.js';

// 重复日程（kind='event'）不是"待办工作"，必须排除，否则会污染任务列表、负载与自动排期
const OPEN = `t.status NOT IN ('done','cancelled')`;
const IS_TASK = `t.kind = 'task'`;

function recomputeProject(projectId) {
  if (!projectId) return;
  const p = get('SELECT * FROM projects WHERE id=?', projectId);
  if (!p) return;
  const m = projectMetrics(projectId);
  const progress = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
  const patch = { progress, updated_at: now() };
  if (p.status === 'active' && m.total > 0 && m.done === m.total) {
    patch.status = 'done';
    patch.completed_at = now();
  } else if (p.status === 'done' && m.total > 0 && m.done < m.total) {
    patch.status = 'active';
    patch.completed_at = null;
  }
  if (p.status === 'active' || p.status === 'done') patch.health = 'good';
  update('projects', projectId, patch);
}

function withWeek(dueAt, startAt) {
  const base = startAt || dueAt;
  return base && isDate(base) ? startOfWeekStr(String(base).slice(0, 10)) : null;
}

export function buildFilters(ctx) {
  const q = ctx.query;
  const where = [];
  const params = [];
  const me = ctx.user.id;

  if (q.scope === 'mine') {
    where.push('(t.assignee_id = ? OR t.creator_id = ?)');
    params.push(me, me);
  } else if (q.scope === 'inbox') {
    where.push('t.assignee_id = ?');
    params.push(me);
  } else if (q.scope === 'created') {
    where.push('t.creator_id = ?');
    params.push(me);
  } else if (q.scope === 'today') {
    const d = dateStr();
    where.push(`${OPEN} AND (substr(COALESCE(t.due_at, t.start_at),1,10) = ?)`);
    params.push(d);
  } else if (q.scope === 'week') {
    const ws = q.weekStart || startOfWeekStr();
    const we = addDaysStr(ws, 6);
    where.push(`${OPEN} AND substr(COALESCE(t.due_at,t.start_at),1,10) BETWEEN ? AND ?`);
    params.push(ws, we);
  }

  if (q.projectId) {
    where.push('t.project_id = ?');
    params.push(num(q.projectId));
  }
  if (q.assigneeId) {
    where.push('t.assignee_id = ?');
    params.push(num(q.assigneeId));
  }
  if (q.milestoneId) {
    where.push('t.milestone_id = ?');
    params.push(num(q.milestoneId));
  }
  if (q.teamId) {
    where.push('t.team_id = ?');
    params.push(num(q.teamId));
  }
  if (q.status) {
    const list = q.status.split(',').filter(Boolean);
    where.push(`t.status IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  } else if (q.open === '1') {
    where.push(OPEN);
  }
  if (q.priority) {
    const list = q.priority.split(',').filter(Boolean);
    where.push(`t.priority IN (${list.map(() => '?').join(',')})`);
    params.push(...list);
  }
  if (q.kind) {
    where.push('t.kind = ?');
    params.push(q.kind);
  }
  if (q.tag) {
    where.push('t.tags LIKE ?');
    params.push(`%"${q.tag}"%`);
  }
  if (q.blocked === '1') where.push('t.blocked = 1');
  if (q.pinned === '1') where.push('t.pinned = 1');
  if (q.parentId) {
    where.push('t.parent_id = ?');
    params.push(num(q.parentId));
  } else if (q.withSubtasks !== '1') {
    where.push('t.parent_id IS NULL');
  }
  if (q.dueBefore) {
    where.push('t.due_at IS NOT NULL AND substr(t.due_at,1,10) <= ?');
    params.push(String(q.dueBefore).slice(0, 10));
  }
  if (q.from) {
    where.push('substr(COALESCE(t.due_at,t.start_at),1,10) >= ?');
    params.push(String(q.from).slice(0, 10));
  }
  if (q.to) {
    where.push('substr(COALESCE(t.due_at,t.start_at),1,10) <= ?');
    params.push(String(q.to).slice(0, 10));
  }
  if (q.overdue === '1') {
    where.push(`${OPEN} AND t.due_at IS NOT NULL AND substr(t.due_at,1,10) < ?`);
    params.push(dateStr());
  }
  if (q.weekStart) {
    where.push('t.week_start = ?');
    params.push(String(q.weekStart).slice(0, 10));
  }
  if (q.q) {
    where.push('(t.title LIKE ? OR t.notes LIKE ? OR t.location LIKE ?)');
    const like = `%${q.q}%`;
    params.push(like, like, like);
  }
  return { where, params };
}

GET('/api/tasks', async (ctx) => {
  requireAuth(ctx);
  const { where, params } = buildFilters(ctx);
  const sortMap = {
    due: `CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at ASC`,
    priority: `CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'med' THEN 2 ELSE 3 END, t.due_at IS NULL, t.due_at`,
    created: 't.created_at DESC',
    updated: 't.updated_at DESC',
    manual: 't.order_index ASC, t.id ASC',
    title: 't.title COLLATE NOCASE',
  };
  const order = sortMap[ctx.query.sort] || sortMap.manual;
  const limit = Math.min(2000, num(ctx.query.limit, 500));
  const offset = Math.max(0, num(ctx.query.offset, 0));
  const baseWhere = [...where];
  if (ctx.query.includeEvents !== '1') baseWhere.unshift(IS_TASK);
  const whereSql = baseWhere.length ? 'WHERE ' + baseWhere.join(' AND ') : '';
  // total 必须是"符合条件的总数"，不能是本页行数，否则前端分页会失效
  const totalRow = get(`SELECT COUNT(*) AS n FROM tasks t ${whereSql}`, ...params);
  const total = num(totalRow?.n);
  const rows = all(
    `${TASK_SELECT} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset
  );
  const tasks = rows.map((t) => serializeTask(t));
  const ids = tasks.map((t) => t.id);
  let childCount = {};
  if (ids.length && ctx.query.withSubtasks !== '1') {
    const ph = ids.map(() => '?').join(',');
    for (const r of all(
      `SELECT parent_id, COUNT(*) AS n, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS d FROM tasks
       WHERE parent_id IN (${ph}) GROUP BY parent_id`, ...ids)) {
      childCount[r.parent_id] = { total: r.n, done: r.d };
    }
  }
  for (const t of tasks) if (childCount[t.id]) t.childStats = childCount[t.id];
  return { tasks, total, offset, limit, hasMore: offset + tasks.length < total };
});

GET('/api/tasks/:id', async (ctx) => {
  requireAuth(ctx);
  const t = get(`${TASK_SELECT} WHERE t.id=?`, num(ctx.params.id));
  if (!t) throw notFound('任务不存在');
  const task = serializeTask(t, { withChildren: true });
  task.project = task.projectId ? serializeProject(get('SELECT * FROM projects WHERE id=?', task.projectId)) : null;
  task.logs = all(
    `SELECT l.*, u.name AS user_name FROM work_logs l JOIN users u ON u.id=l.user_id
     WHERE l.task_id=? ORDER BY l.log_date DESC, l.id DESC`,
    task.id
  ).map((l) => ({ id: l.id, userId: l.user_id, userName: l.user_name, minutes: l.minutes, note: l.note, date: l.log_date }));
  task.related = all(
    `SELECT id,title,status FROM tasks WHERE project_id=? AND id<>? AND parent_id IS NULL ORDER BY updated_at DESC LIMIT 8`,
    task.projectId || -1,
    task.id
  );
  return task;
});

POST('/api/tasks', async (ctx) => {
  const me = requireAuth(ctx);
  const b = ctx.body;
  const title = str(b.title, 200)?.trim();
  if (!title) throw bad('请填写任务标题');

  // 自然语言解析：未显式给日期时尝试从标题里抽时间
  let parsed = {};
  if (b.parse !== false) {
    parsed = parseNatural(`${title} ${str(b.notes, 200) || ''}`.trim(), { base: b.baseDate || dateStr(), workStart: b.workStart, workEnd: b.workEnd });
  }
  const startAt = b.startAt || parsed.startAt || null;
  const dueAt = b.dueAt || parsed.dueAt || null;
  const cleanTitle = (parsed.cleanTitle || title).slice(0, 200);

  const id = insert('tasks', {
    title: cleanTitle,
    notes: str(b.notes, 8000),
    kind: b.kind === 'event' ? 'event' : 'task',
    project_id: b.projectId ? num(b.projectId) : null,
    parent_id: b.parentId ? num(b.parentId) : null,
    milestone_id: b.milestoneId ? num(b.milestoneId) : null,
    team_id: b.teamId ? num(b.teamId) : null,
    assignee_id: b.assigneeId ? num(b.assigneeId) : me.id,
    creator_id: me.id,
    status: ['backlog', 'todo', 'doing', 'review', 'done', 'cancelled'].includes(b.status) ? b.status : 'todo',
    priority: ['low', 'med', 'high', 'urgent'].includes(b.priority) ? b.priority : 'med',
    start_at: startAt,
    due_at: dueAt,
    end_at: b.endAt || null,
    all_day: b.allDay ? 1 : 0,
    location: str(b.location, 200),
    tags: JSON.stringify((b.tags || []).slice(0, 12)),
    estimate_hours: num(b.estimateHours, 0),
    actual_hours: num(b.actualHours, 0),
    pinned: b.pinned ? 1 : 0,
    week_start: b.weekStart || withWeek(dueAt, startAt),
    blocked: b.blocked ? 1 : 0,
    blocked_reason: str(b.blockedReason, 300),
    order_index: num(b.orderIndex, Date.now() / 1e6),
    created_at: now(),
    updated_at: now(),
  });

  // 重复日程：克隆后续 N 次
  const repeat = b.repeat || parsed.repeat;
  if (repeat && repeat.kind !== 'none') {
    const created = expandRepeat({ ...b, id, title: cleanTitle, kind: 'event', startAt, dueAt }, repeat);
    if (created) logActivity(me.id, 'task.repeat', 'task', id, cleanTitle, { count: created });
  }

  // 参与人
  if (Array.isArray(b.watcherIds) && b.watcherIds.length) {
    for (const w of b.watcherIds.slice(0, 20)) {
      try {
        insert('activity', { user_id: num(w), action: 'task.watch', target_type: 'task', target_id: id, target_name: cleanTitle, created_at: now() });
      } catch {}
    }
  }
  logActivity(me.id, 'task.create', 'task', id, cleanTitle, { projectId: b.projectId });
  recomputeProject(b.projectId ? num(b.projectId) : null);
  return { ok: true, id, task: serializeTask(get(`${TASK_SELECT} WHERE t.id=?`, id)), parsed };
});

function expandRepeat(base, repeat) {
  let count = Math.min(60, Math.max(1, num(repeat.count, repeat.kind === 'daily' ? 30 : 10)));
  let step = 1;
  if (repeat.kind === 'daily') step = 1;
  else if (repeat.kind === 'weekdays') step = 1;
  else if (repeat.kind === 'weekly') step = 7;
  else if (repeat.kind === 'biweekly') step = 14;
  else if (repeat.kind === 'monthly') step = 30;
  let made = 0;
  const timeOf = (s) => (s ? String(s).slice(11) : null);
  const dateOf = (s) => (s ? String(s).slice(0, 10) : null);
  const baseStart = dateOf(base.startAt) || dateStr();
  const baseEnd = dateOf(base.dueAt) || baseStart;
  const dur = Math.max(0, Math.round((new Date(baseEnd) - new Date(baseStart)) / 86400000));
  for (let i = 1; i <= count; i++) {
    const s = addDaysStr(baseStart, step * i);
    let e = addDaysStr(baseEnd, step * i);
    if (repeat.kind === 'weekdays') {
      const wd = new Date(s).getDay();
      if (wd === 0 || wd === 6) continue;
    }
    try {
      insert('tasks', {
        title: base.title,
        notes: base.notes || null,
        kind: 'event',
        project_id: base.projectId || null,
        parent_id: null,
        team_id: base.teamId || null,
        assignee_id: base.assigneeId || null,
        creator_id: base.creatorId || null,
        status: 'todo',
        priority: base.priority || 'med',
        start_at: timeOf(base.startAt) ? `${s}T${timeOf(base.startAt)}` : s,
        due_at: timeOf(base.dueAt) ? `${e}T${timeOf(base.dueAt)}` : e,
        all_day: base.allDay ? 1 : 0,
        location: base.location || null,
        tags: base.tags || '[]',
        estimate_hours: 0,
        order_index: Date.now() / 1e6 + i,
        week_start: startOfWeekStr(s),
        created_at: now(),
        updated_at: now(),
      });
      made++;
    } catch {}
    if (dur > 0) e = e;
  }
  return made;
}

const PATCHABLE = {
  title: 'title',
  notes: 'notes',
  kind: 'kind',
  status: 'status',
  priority: 'priority',
  startAt: 'start_at',
  dueAt: 'due_at',
  endAt: 'end_at',
  allDay: 'all_day',
  location: 'location',
  estimateHours: 'estimate_hours',
  actualHours: 'actual_hours',
  pinned: 'pinned',
  blocked: 'blocked',
  blockedReason: 'blocked_reason',
  weekStart: 'week_start',
  orderIndex: 'order_index',
};

PATCH('/api/tasks/:id', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  const t = get('SELECT * FROM tasks WHERE id=?', id);
  if (!t) throw notFound('任务不存在');
  const b = ctx.body;
  const patch = { updated_at: now() };

  for (const [k, col] of Object.entries(PATCHABLE)) {
    if (b[k] === undefined) continue;
    let v = b[k];
    if (col === 'all_day' || col === 'pinned' || col === 'blocked') v = v ? 1 : 0;
    if (col === 'title') v = str(v, 200)?.trim() || t.title;
    if (col === 'estimate_hours' || col === 'actual_hours' || col === 'order_index') v = num(v, 0);
    if (col === 'status' && !['backlog', 'todo', 'doing', 'review', 'done', 'cancelled'].includes(v)) throw bad('未知状态');
    patch[col] = v;
  }
  if (b.projectId !== undefined) patch.project_id = b.projectId ? num(b.projectId) : null;
  if (b.assigneeId !== undefined) patch.assignee_id = b.assigneeId ? num(b.assigneeId) : null;
  if (b.parentId !== undefined) {
    const pid = b.parentId ? num(b.parentId) : null;
    if (pid === id) throw bad('任务不能是自己的子任务');
    patch.parent_id = pid;
  }
  if (b.milestoneId !== undefined) patch.milestone_id = b.milestoneId ? num(b.milestoneId) : null;
  if (b.teamId !== undefined) patch.team_id = b.teamId ? num(b.teamId) : null;
  if (b.tags !== undefined) patch.tags = JSON.stringify((b.tags || []).slice(0, 12));

  if (patch.status && patch.status !== t.status) {
    patch.completed_at = patch.status === 'done' ? now() : null;
  }
  if (patch.start_at !== undefined || patch.due_at !== undefined) {
    if (b.weekStart !== undefined) patch.week_start = b.weekStart ? String(b.weekStart).slice(0, 10) : null;
    else patch.week_start = withWeek(patch.due_at ?? t.due_at, patch.start_at ?? t.start_at);
  }

  update('tasks', id, patch);
  recomputeProject(t.project_id);
  if (patch.project_id !== undefined && patch.project_id !== t.project_id) recomputeProject(patch.project_id);

  // 父任务随子任务完成度自动收尾
  if (t.parent_id && (patch.status || patch.title)) {
    const kids = all('SELECT status FROM tasks WHERE parent_id=?', t.parent_id);
    if (kids.length && kids.every((k) => k.status === 'done' || k.status === 'cancelled')) {
      update('tasks', t.parent_id, { status: 'done', completed_at: now(), updated_at: now() });
    }
  }
  logActivity(me.id, patch.status === 'done' && t.status !== 'done' ? 'task.done' : 'task.update', 'task', id, t.title, {
    status: patch.status,
  });
  return { ok: true, task: serializeTask(get(`${TASK_SELECT} WHERE t.id=?`, id)) };
});

POST('/api/tasks/:id/toggle', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  const t = get('SELECT * FROM tasks WHERE id=?', id);
  if (!t) throw notFound('任务不存在');
  const done = t.status === 'done';
  const next = ctx.body.completed !== undefined ? !!ctx.body.completed : !done;
  const status = next ? 'done' : 'todo';
  update('tasks', id, { status, completed_at: next ? now() : null, updated_at: now() });
  recomputeProject(t.project_id);
  logActivity(me.id, next ? 'task.done' : 'task.reopen', 'task', id, t.title);
  return { ok: true, status };
});

POST('/api/tasks/:id/duplicate', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const t = get('SELECT * FROM tasks WHERE id=?', id);
  if (!t) throw notFound('任务不存在');
  const nid = insert('tasks', {
    ...t,
    id: undefined,
    status: 'todo',
    completed_at: null,
    created_at: now(),
    updated_at: now(),
    order_index: num(t.order_index) + 0.001,
  });
  return { ok: true, id: nid };
});

DELETE('/api/tasks/:id', async (ctx) => {
  const me = requireAuth(ctx);
  const id = num(ctx.params.id);
  const t = get('SELECT * FROM tasks WHERE id=?', id);
  if (!t) throw notFound('任务不存在');
  run('DELETE FROM tasks WHERE id=?', id); // 子任务级联
  run('DELETE FROM work_logs WHERE task_id=?', id);
  recomputeProject(t.project_id);
  logActivity(me.id, 'task.delete', 'task', id, t.title);
  return { ok: true };
});

POST('/api/tasks/bulk', async (ctx) => {
  const me = requireAuth(ctx);
  const ids = (ctx.body.ids || []).map(num).filter(Boolean);
  const action = ctx.body.action;
  if (!ids.length) throw bad('未选择任何条目');
  const ph = ids.map(() => '?').join(',');
  const projects = new Set(
    all(`SELECT DISTINCT project_id FROM tasks WHERE id IN (${ph}) AND project_id IS NOT NULL`, ...ids).map(
      (r) => r.project_id
    )
  );
  const stamp = now();
  let affected = 0;
  tx(() => {
    if (action === 'status') {
      const st = ctx.body.status;
      if (!['backlog', 'todo', 'doing', 'review', 'done', 'cancelled'].includes(st)) throw bad('未知状态');
      // 注意：completed_at 为 NULL 时 SQL 里没有占位符，参数个数必须同步减少
      affected =
        st === 'done'
          ? run(
              `UPDATE tasks SET status=?, completed_at=?, updated_at=? WHERE id IN (${ph})`,
              st,
              stamp,
              stamp,
              ...ids
            ).changes
          : run(
              `UPDATE tasks SET status=?, completed_at=NULL, updated_at=? WHERE id IN (${ph})`,
              st,
              stamp,
              ...ids
            ).changes;
    } else if (action === 'priority') {
      affected = run(`UPDATE tasks SET priority=?, updated_at=? WHERE id IN (${ph})`, ctx.body.priority, stamp, ...ids).changes;
    } else if (action === 'assignee') {
      const uid = ctx.body.assigneeId ? num(ctx.body.assigneeId) : null;
      affected = run(`UPDATE tasks SET assignee_id=?, updated_at=? WHERE id IN (${ph})`, uid, stamp, ...ids).changes;
    } else if (action === 'project') {
      const pid = ctx.body.projectId ? num(ctx.body.projectId) : null;
      affected = run(`UPDATE tasks SET project_id=?, updated_at=? WHERE id IN (${ph})`, pid, stamp, ...ids).changes;
    } else if (action === 'dueDate') {
      const d = ctx.body.dueDate;
      affected = run(`UPDATE tasks SET due_at=?, week_start=?, updated_at=? WHERE id IN (${ph})`, d, d ? startOfWeekStr(String(d).slice(0, 10)) : null, stamp, ...ids).changes;
    } else if (action === 'week') {
      const ws = ctx.body.weekStart;
      affected = run(`UPDATE tasks SET week_start=?, updated_at=? WHERE id IN (${ph})`, ws || null, stamp, ...ids).changes;
    } else if (action === 'blocked') {
      affected = run(`UPDATE tasks SET blocked=?, blocked_reason=?, updated_at=? WHERE id IN (${ph})`, ctx.body.blocked ? 1 : 0, str(ctx.body.reason, 300), stamp, ...ids).changes;
    } else if (action === 'tag') {
      const tag = str(ctx.body.tag, 40);
      if (!tag) throw bad('请填写标签');
      for (const id of ids) {
        const t = get('SELECT tags FROM tasks WHERE id=?', id);
        let tags = [];
        try {
          tags = JSON.parse(t?.tags || '[]');
        } catch {}
        if (ctx.body.remove) tags = tags.filter((x) => x !== tag);
        else if (!tags.includes(tag)) tags.push(tag);
        update('tasks', id, { tags: JSON.stringify(tags), updated_at: stamp });
        affected++;
      }
    } else if (action === 'delete') {
      affected = run(`DELETE FROM tasks WHERE id IN (${ph})`, ...ids).changes;
    } else {
      throw bad('未知批量操作');
    }
  });
  for (const p of projects) recomputeProject(p);
  logActivity(me.id, `task.bulk.${action}`, 'task', null, `${affected} 项`);
  return { ok: true, affected };
});

// 看板拖拽：一次性更新 status + order_index
POST('/api/tasks/reorder', async (ctx) => {
  requireAuth(ctx);
  const items = ctx.body.items || [];
  const stamp = now();
  tx(() => {
    for (const it of items) {
      const id = num(it.id);
      if (!id) continue;
      const sets = [];
      const vals = [];
      if (it.status) {
        sets.push('status=?', 'completed_at=?');
        vals.push(it.status, it.status === 'done' ? stamp : null);
      }
      if (it.orderIndex !== undefined) {
        sets.push('order_index=?');
        vals.push(num(it.orderIndex));
      }
      if (it.weekStart !== undefined) {
        sets.push('week_start=?');
        vals.push(it.weekStart || null);
      }
      if (!sets.length) continue;
      sets.push('updated_at=?');
      vals.push(stamp, id);
      run(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`, ...vals);
    }
  });
  const projects = new Set(items.map((i) => get('SELECT project_id FROM tasks WHERE id=?', num(i.id))?.project_id).filter(Boolean));
  for (const p of projects) recomputeProject(p);
  return { ok: true };
});

POST('/api/tasks/repeat', async (ctx) => {
  requireAuth(ctx);
  const b = ctx.body;
  if (!b.title || !b.repeat || b.repeat.kind === 'none') throw bad('缺少重复配置');
  const base = {
    title: str(b.title, 200),
    notes: str(b.notes, 8000),
    kind: b.kind === 'task' ? 'task' : 'event',
    projectId: b.projectId,
    teamId: b.teamId,
    assigneeId: b.assigneeId,
    creatorId: ctx.user.id,
    priority: b.priority,
    startAt: b.startAt,
    dueAt: b.dueAt,
    allDay: b.allDay,
    location: b.location,
    tags: JSON.stringify(b.tags || []),
  };
  const made = expandRepeat(base, b.repeat);
  return { ok: true, created: made };
});

POST('/api/tasks/parse', async (ctx) => {
  requireAuth(ctx);
  const text = String(ctx.body.text || '');
  return parseNatural(text, { base: ctx.body.baseDate || dateStr(), workStart: ctx.body.workStart, workEnd: ctx.body.workEnd });
});

// ---- 工时 ----
POST('/api/work-logs', async (ctx) => {
  const me = requireAuth(ctx);
  const taskId = ctx.body.taskId ? num(ctx.body.taskId) : null;
  const minutes = Math.max(0, Math.min(24 * 60, num(ctx.body.minutes, 0)));
  if (!minutes) throw bad('请填写有效时长（分钟）');
  const t = taskId ? get('SELECT * FROM tasks WHERE id=?', taskId) : null;
  const date = ctx.body.date ? String(ctx.body.date).slice(0, 10) : dateStr();
  const id = insert('work_logs', {
    task_id: taskId,
    project_id: t?.project_id || (ctx.body.projectId ? num(ctx.body.projectId) : null),
    user_id: ctx.body.userId ? num(ctx.body.userId) : me.id,
    minutes,
    note: str(ctx.body.note, 300),
    log_date: date,
    created_at: now(),
  });
  if (t) {
    const total = num(t.actual_hours) + minutes / 60;
    const target = Math.round(total * 100) / 100;
    update('tasks', t.id, { actual_hours: target, updated_at: now() });
    // 工时达标自动推进
    if (t.status === 'doing' && t.estimate_hours > 0 && total >= t.estimate_hours * 1.5) {
      update('tasks', t.id, { status: 'review' });
    }
  }
  logActivity(me.id, 'log.time', 'task', taskId, t?.title || '工时', { minutes });
  return { ok: true, id };
});

DELETE('/api/work-logs/:id', async (ctx) => {
  requireAuth(ctx);
  const id = num(ctx.params.id);
  const l = get('SELECT * FROM work_logs WHERE id=?', id);
  if (!l) throw notFound('记录不存在');
  run('DELETE FROM work_logs WHERE id=?', id);
  if (l.task_id) {
    const t = get('SELECT actual_hours FROM tasks WHERE id=?', l.task_id);
    if (t) update('tasks', l.task_id, { actual_hours: Math.max(0, Math.round((num(t.actual_hours) - l.minutes / 60) * 100) / 100) });
  }
  return { ok: true };
});

// ---- 日历 ----
GET('/api/calendar', async (ctx) => {
  requireAuth(ctx);
  const from = String(ctx.query.from || dateStr()).slice(0, 10);
  const days = Math.min(120, Math.max(1, num(ctx.query.days, 14)));
  const to = addDaysStr(from, days - 1);
  const me = ctx.user.id;
  const scope = ctx.query.scope;
  const scopeSql =
    scope === 'mine' ? 'AND t.assignee_id = ?' : scope === 'created' ? 'AND t.creator_id = ?' : '';
  const scopeArgs = scope === 'mine' || scope === 'created' ? [me] : [];
  const anyScopeSql = scopeSql || 'AND (t.assignee_id = ? OR t.creator_id = ?)';
  const anyScopeArgs = scopeArgs.length ? scopeArgs : [me, me];

  const events = all(
    `${TASK_SELECT} WHERE t.kind='event'
       AND t.status <> 'cancelled'
       AND substr(COALESCE(t.start_at, t.due_at),1,10) BETWEEN ? AND ?
       ${anyScopeSql}
     ORDER BY COALESCE(t.start_at, t.due_at), t.all_day DESC`,
    from,
    to,
    ...anyScopeArgs
  ).map((t) => serializeTask(t));
  const openTasks = all(
    `${TASK_SELECT} WHERE t.kind='task' AND ${OPEN}
       AND t.due_at IS NOT NULL AND substr(t.due_at,1,10) BETWEEN ? AND ?
       ${anyScopeSql} ORDER BY t.due_at`,
    from,
    to,
    ...anyScopeArgs
  ).map((t) => serializeTask(t));
  const milestones = all(
    `SELECT m.*, p.name AS project_name, p.color AS project_color FROM milestones m
     JOIN projects p ON p.id=m.project_id
     WHERE m.due_date BETWEEN ? AND ? ORDER BY m.due_date`,
    from,
    to
  ).map((m) => ({
    id: `ms-${m.id}`,
    realId: m.id,
    name: m.name,
    projectId: m.project_id,
    projectName: m.project_name,
    projectColor: m.project_color,
    dueDate: m.due_date,
    status: m.status,
  }));
  return { from, to, events, tasks: openTasks, milestones };
});

GET('/api/my-tags', async (ctx) => {
  requireAuth(ctx);
  const rows = all('SELECT tags FROM tasks WHERE assignee_id=?', ctx.user.id);
  const set = new Map();
  for (const r of rows) {
    try {
      for (const t of JSON.parse(r.tags || '[]')) set.set(t, (set.get(t) || 0) + 1);
    } catch {}
  }
  return [...set.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count);
});