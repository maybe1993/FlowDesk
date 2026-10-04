import { GET, POST, PATCH } from '../router.js';
import { all, get, insert, update, run, logActivity, getSettings, saveSettings } from '../db.js';
import { requireAuth } from '../auth.js';
import { bad, notFound, str, now, num, dateStr, addDaysStr, startOfWeekStr, round1, daysBetween } from '../util.js';
import { serializeProject, serializeTask, TASK_SELECT, workloadRows, userBrief } from '../model.js';
import { generatePlan, adoptPlan, saveDraft, listPlans, planToText } from '../planner.js';

// ============ 智能规划 ============
GET('/api/planner/next-week', async (ctx) => {
  const user = requireAuth(ctx);
  return generatePlan(user, {
    weekStart: ctx.query.weekStart,
    scope: ctx.query.scope || 'me',
    teamId: ctx.query.teamId,
    capacityHours: ctx.query.capacityHours ? num(ctx.query.capacityHours) : undefined,
  });
});

GET('/api/planner/this-week', async (ctx) => {
  const user = requireAuth(ctx);
  return generatePlan(user, {
    weekStart: ctx.query.weekStart || startOfWeekStr(),
    scope: ctx.query.scope || 'me',
    teamId: ctx.query.teamId,
  });
});

GET('/api/planner/preview', async (ctx) => {
  const user = requireAuth(ctx);
  const plan = generatePlan(user, {
    weekStart: ctx.query.weekStart,
    scope: ctx.query.scope || 'me',
    teamId: ctx.query.teamId,
  });
  return { text: planToText(plan) };
});

POST('/api/planner/adopt', async (ctx) => {
  const user = requireAuth(ctx);
  const plan = ctx.body.plan || (ctx.body.planId ? listPlans(user).find((p) => p.id === num(ctx.body.planId))?.plan : null);
  if (!plan) throw bad('缺少计划数据');
  return adoptPlan(user, plan, {
    reschedule: !!ctx.body.reschedule,
    markWeek: ctx.body.markWeek !== false,
    note: str(ctx.body.note, 300),
  });
});

POST('/api/planner/draft', async (ctx) => {
  const user = requireAuth(ctx);
  const plan = ctx.body.plan;
  if (!plan) throw bad('缺少计划数据');
  return saveDraft(user, plan, str(ctx.body.title, 120));
});

GET('/api/plans', async (ctx) => {
  const user = requireAuth(ctx);
  return listPlans(user, ctx.query.weekStart);
});

// ============ 仪表盘 ============
GET('/api/dashboard', async (ctx) => {
  const user = requireAuth(ctx);
  const today = dateStr();
  const ws = ctx.query.weekStart || startOfWeekStr(today);
  const we = addDaysStr(ws, 6);

  const counts = get(
    `SELECT
      SUM(CASE WHEN status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) AS doing,
      SUM(CASE WHEN status='review' THEN 1 ELSE 0 END) AS review,
      SUM(CASE WHEN status='done' AND substr(completed_at,1,10) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS doneWeek,
      SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_at IS NOT NULL AND substr(due_at,1,10) < ? THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN status NOT IN ('done','cancelled') AND due_at IS NOT NULL AND substr(due_at,1,10) = ? THEN 1 ELSE 0 END) AS dueToday,
      SUM(CASE WHEN blocked=1 AND status NOT IN ('done','cancelled') THEN 1 ELSE 0 END) AS blocked,
      SUM(CASE WHEN status NOT IN ('done','cancelled') AND parent_id IS NULL THEN 1 ELSE 0 END) AS topLevel
     FROM tasks WHERE assignee_id = ? AND kind = 'task'`,
    ws,
    we,
    today,
    today,
    user.id
  );

  const dueToday = all(
    `${TASK_SELECT} WHERE t.assignee_id=? AND t.kind='task' AND t.status NOT IN ('done','cancelled')
       AND t.due_at IS NOT NULL AND substr(t.due_at,1,10) <= ?
     ORDER BY t.due_at LIMIT 30`,
    user.id,
    addDaysStr(today, 2)
  ).map(serializeTask);

  const todayEvents = all(
    `${TASK_SELECT} WHERE t.kind='event' AND substr(COALESCE(t.start_at,t.due_at),1,10)=? AND t.status <> 'cancelled'
     ORDER BY COALESCE(t.start_at,t.due_at)`,
    today
  ).map(serializeTask);

  const focus = all(
    `${TASK_SELECT} WHERE t.assignee_id=? AND t.kind='task' AND t.status IN ('todo','doing','review')
       AND (t.pinned=1 OR t.week_start=? OR t.due_at IS NOT NULL)
     ORDER BY t.pinned DESC,
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'med' THEN 2 ELSE 3 END,
       t.due_at IS NULL, t.due_at LIMIT 12`,
    user.id,
    ws
  ).map(serializeTask);

  const myProjects = all(
    `SELECT p.* FROM projects p WHERE p.archived=0 AND (p.owner_id=? OR p.id IN (SELECT project_id FROM tasks WHERE assignee_id=?))
     ORDER BY p.starred DESC, p.status='done', p.due_date IS NULL, p.due_date LIMIT 12`,
    user.id,
    user.id
  ).map((p) => serializeProject(p));

  const teamProjects = all(
    `SELECT p.*, t.name AS team_name FROM projects p LEFT JOIN teams t ON t.id=p.team_id
     WHERE p.kind='team' AND p.archived=0 AND p.status NOT IN ('done','cancelled')
     ORDER BY CASE p.health WHEN 'at_risk' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, p.due_date LIMIT 8`
  ).map((p) => ({ ...serializeProject(p, { teamName: p.team_name }), healthLabel: undefined }));

  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = dateStr(new Date(Date.now() - i * 86400000));
    const done = get(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND status='done' AND substr(completed_at,1,10)=?`, user.id, d);
    const created = get(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND substr(created_at,1,10)=?`, user.id, d);
    trend.push({ date: d, done: num(done?.n), created: num(created?.n) });
  }

  const hoursByDay = [];
  for (let i = 6; i >= 0; i--) {
    const d = dateStr(new Date(Date.now() - i * 86400000));
    const m = get('SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE user_id=? AND log_date=?', user.id, d);
    hoursByDay.push({ date: d, hours: round1(num(m?.m) / 60) });
  }

  const milestonesSoon = all(
    `SELECT m.*, p.name AS project_name, p.color AS project_color FROM milestones m JOIN projects p ON p.id=m.project_id
     WHERE m.status <> 'done' AND m.due_date IS NOT NULL AND m.due_date <= ?
     ORDER BY m.due_date LIMIT 10`,
    addDaysStr(today, 21)
  ).map((m) => ({
    id: m.id,
    name: m.name,
    projectId: m.project_id,
    projectName: m.project_name,
    projectColor: m.project_color,
    dueDate: m.due_date,
    status: m.status,
    daysLeft: daysBetween(today, m.due_date),
  }));

  const workload = workloadRows(
    all('SELECT user_id FROM team_members').map((r) => r.user_id).filter(Boolean),
    ws
  );

  const hoursWeek = get(
    'SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE user_id=? AND log_date BETWEEN ? AND ?',
    user.id,
    ws,
    we
  );

  return {
    today,
    weekStart: ws,
    weekEnd: we,
    stats: {
      open: num(counts?.open),
      doing: num(counts?.doing),
      review: num(counts?.review),
      doneWeek: num(counts?.doneWeek),
      overdue: num(counts?.overdue),
      dueToday: num(counts?.dueToday),
      blocked: num(counts?.blocked),
      hoursWeek: round1(num(hoursWeek?.m) / 60),
      focusCapacity: user.focusHours,
      progress: num(counts?.open) + num(counts?.doneWeek) > 0
        ? Math.round((num(counts?.doneWeek) / (num(counts?.open) + num(counts?.doneWeek))) * 100)
        : 0,
    },
    dueToday,
    todayEvents,
    focus,
    myProjects,
    teamProjects,
    trend,
    hoursByDay,
    milestonesSoon,
    workload: workload.filter((w) => w.openTasks > 0 || w.doneThisWeek > 0).sort((a, b) => b.load - a.load).slice(0, 10),
    suggestions: quickSuggestions(user, today),
  };
});

function quickSuggestions(user, today) {
  const out = [];
  const overdue = num(get(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled') AND kind='task' AND due_at IS NOT NULL AND substr(due_at,1,10) < ?`, user.id, today)?.n);
  const blocked = num(get(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND blocked=1 AND status NOT IN ('done','cancelled') AND kind='task'`, user.id)?.n);
  const noEstimate = num(get(`SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND kind='task' AND status IN ('todo','doing') AND (estimate_hours IS NULL OR estimate_hours=0)`, user.id)?.n);
  const stale = all(
    `SELECT id,title FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled') AND kind='task'
       AND date(updated_at) < date(?) ORDER BY updated_at LIMIT 3`,
    user.id,
    addDaysStr(today, -14)
  );
  if (overdue) out.push({ level: 'danger', text: `${overdue} 项任务已逾期，建议今天先处理最紧急的一项`, action: 'view-overdue' });
  if (blocked) out.push({ level: 'warn', text: `${blocked} 项任务被阻塞，排期再满也推不动，先解阻塞`, action: 'view-blocked' });
  if (noEstimate >= 5) out.push({ level: 'info', text: `${noEstimate} 项在办任务没有预估工时，补上后自动排期会准确得多`, action: 'view-no-estimate' });
  if (stale.length) out.push({ level: 'warn', text: `${stale.length} 项任务超过两周没动：${stale.map((s) => `「${s.title}」`).join('、')}`, action: 'view-stale' });
  return out;
}

// ============ 周复盘 ============
GET('/api/review/weekly', async (ctx) => {
  const user = requireAuth(ctx);
  const today = dateStr();
  const ws = ctx.query.weekStart || startOfWeekStr(today);
  const we = addDaysStr(ws, 6);
  const done = all(
    `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
     WHERE t.assignee_id=? AND t.status='done' AND substr(t.completed_at,1,10) BETWEEN ? AND ? ORDER BY t.completed_at`,
    user.id,
    ws,
    we
  );
  const notDone = all(
    `SELECT t.*, p.name AS project_name, p.color AS project_color FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
     WHERE t.assignee_id=? AND t.status NOT IN ('done','cancelled') AND t.week_start=? ORDER BY t.due_at`,
    user.id,
    ws
  );
  const movedOver = all(
    `SELECT t.*, p.name AS project_name FROM tasks t LEFT JOIN projects p ON p.id=t.project_id
     WHERE t.assignee_id=? AND t.status NOT IN ('done','cancelled') AND t.due_at IS NOT NULL
       AND substr(t.due_at,1,10) < ? ORDER BY t.due_at LIMIT 20`,
    user.id,
    ws
  );
  const hours = get(
    `SELECT log_date, SUM(minutes) AS m FROM work_logs WHERE user_id=? AND log_date BETWEEN ? AND ? GROUP BY log_date`,
    user.id,
    ws,
    we
  );
  const byProject = all(
    `SELECT p.id,p.name,p.color, COALESCE(SUM(l.minutes),0) AS m, COUNT(DISTINCT l.task_id) AS n
     FROM work_logs l LEFT JOIN projects p ON p.id=l.project_id
     WHERE l.user_id=? AND l.log_date BETWEEN ? AND ? GROUP BY p.id ORDER BY m DESC`,
    user.id,
    ws,
    we
  );
  const carryWeeks = movedOver.map((t) => ({
    id: t.id,
    title: t.title,
    projectName: t.project_name,
    weeksLate: Math.max(1, Math.round(daysBetween(String(t.due_at).slice(0, 10), ws))),
  }));

  return {
    weekStart: ws,
    weekEnd: we,
    doneCount: done.length,
    doneHours: round1(done.reduce((s, t) => s + num(t.actual_hours), 0)),
    notDoneCount: notDone.length,
    completed: done,
    remaining: notDone,
    hoursByDay: hours,
    byProject: byProject.map((p) => ({ id: p.id, name: p.name, color: p.color, hours: round1(num(p.m) / 60), tasks: p.n })),
    carryOver: carryWeeks,
    plan: generatePlan(user, { weekStart: addDaysStr(ws, 7), scope: 'me' }),
    prompts: [
      '本周哪件事做得最满意？',
      '哪件事花了比预期更多时间？为什么？',
      '下周最重要的一件事是什么？',
      '有没有需要别人配合但还没开口的事？',
    ],
  };
});

// ============ 报表 ============
GET('/api/reports/summary', async (ctx) => {
  requireAuth(ctx);
  const today = dateStr();
  const days = Math.min(180, Math.max(7, num(ctx.query.days, 30)));
  const from = addDaysStr(today, -days + 1);
  const scope = ctx.query.scope === 'team' ? 'team' : 'mine';
  const where = scope === 'mine' ? 'assignee_id = ?' : '1=1';
  const params = scope === 'mine' ? [ctx.user.id] : [];

  const byDay = all(
    `SELECT substr(completed_at,1,10) AS d, COUNT(*) AS n FROM tasks
     WHERE ${where} AND status='done' AND substr(completed_at,1,10) >= ? GROUP BY d ORDER BY d`,
    ...params,
    from
  );
  const logByDay = all(
    `SELECT log_date AS d, SUM(minutes) AS m FROM work_logs
     WHERE ${scope === 'mine' ? 'user_id = ?' : '1=1'} AND log_date >= ? GROUP BY d ORDER BY d`,
    ...params,
    from
  );
  const byProject = all(
    `SELECT p.id, p.name, p.color, COUNT(*) AS n FROM tasks t JOIN projects p ON p.id=t.project_id
     WHERE t.${scope === 'mine' ? 'assignee_id = ?' : 'id > 0'} AND t.status='done' AND substr(t.completed_at,1,10) >= ?
     GROUP BY p.id ORDER BY n DESC LIMIT 12`,
    ...params,
    from
  );
  const byPriority = all(
    `SELECT priority, COUNT(*) AS n FROM tasks WHERE ${where} AND status='done' AND substr(completed_at,1,10) >= ? GROUP BY priority`,
    ...params,
    from
  );
  const byStatus = all(`SELECT status, COUNT(*) AS n FROM tasks WHERE ${where} GROUP BY status`, ...params);
  const byPerson = all(
    `SELECT u.id,u.name,u.avatar,u.color,u.title,
       COUNT(DISTINCT CASE WHEN t.status='done' AND t.kind='task' THEN t.id END) AS done,
       COUNT(CASE WHEN t.status NOT IN ('done','cancelled') AND t.kind='task' THEN 1 END) AS open,
       COALESCE(SUM(CASE WHEN t.status='done' THEN t.actual_hours ELSE 0 END),0) AS hours
     FROM tasks t JOIN users u ON u.id=t.assignee_id
     WHERE t.completed_at IS NOT NULL AND substr(t.completed_at,1,10) >= ?
       AND (${scope === 'mine' ? 't.assignee_id = ?' : '1=1'})
     GROUP BY u.id ORDER BY done DESC`,
    from,
    ...(scope === 'mine' ? [ctx.user.id] : [])
  );
  const tagRows = all(`SELECT tags FROM tasks WHERE ${where} AND substr(completed_at,1,10) >= ?`, ...params, from);
  const tagMap = new Map();
  for (const r of tagRows) {
    try {
      for (const t of JSON.parse(r.tags || '[]')) tagMap.set(t, (tagMap.get(t) || 0) + 1);
    } catch {}
  }
  const hoursByProject = all(
    `SELECT p.id,p.name,p.color, SUM(l.minutes) AS m FROM work_logs l JOIN projects p ON p.id=l.project_id
     WHERE l.${scope === 'mine' ? 'user_id = ?' : 'id > 0'} AND l.log_date >= ? GROUP BY p.id ORDER BY m DESC LIMIT 12`,
    ...params,
    from
  );

  return {
    from,
    to: today,
    scope,
    completedByDay: byDay.map((r) => ({ date: r.d, count: r.n })),
    hoursByDay: logByDay.map((r) => ({ date: r.d, hours: round1(num(r.m) / 60) })),
    byProject: byProject.map((p) => ({ id: p.id, name: p.name, color: p.color, count: p.n })),
    hoursByProject: hoursByProject.map((p) => ({ id: p.id, name: p.name, color: p.color, hours: round1(num(p.m) / 60) })),
    byPriority: byPriority.map((p) => ({ key: p.priority, count: p.n })),
    byStatus: byStatus.map((p) => ({ key: p.status, count: p.n })),
    byPerson: byPerson.map((p) => ({ ...userBrief(p), done: p.done, open: p.open, hours: round1(num(p.hours)) })),
    byTag: [...tagMap.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 15),
    totals: {
      completed: byDay.reduce((s, r) => s + r.n, 0),
      hours: round1(logByDay.reduce((s, r) => s + num(r.m) / 60, 0)),
    },
  };
});

// ============ 通知 ============
export function generateNotifications(userId) {
  const today = dateStr();
  const created = [];
  const push = (type, title, body, link, level, key) => {
    try {
      const id = insert('notifications', {
        user_id: userId,
        type,
        title,
        body,
        link,
        level,
        dedupe_key: key,
        created_at: now(),
      });
      created.push(id);
    } catch {
      /* dedupe 冲突：已存在 */
    }
  };

  const overdue = all(
    `SELECT id,title FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')
       AND due_at IS NOT NULL AND substr(due_at,1,10) < ? LIMIT 10`,
    userId,
    today
  );
  if (overdue.length) {
    push('overdue', `${overdue.length} 项任务已逾期`, overdue.slice(0, 3).map((t) => t.title).join('、'), '#/tasks?overdue=1', 'danger', `overdue:${today}`);
  }
  const soon = all(
    `SELECT id,title FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')
       AND due_at IS NOT NULL AND substr(due_at,1,10) BETWEEN ? AND ? LIMIT 10`,
    userId,
    today,
    addDaysStr(today, 2)
  );
  if (soon.length) push('due-soon', `${soon.length} 项任务 48 小时内到期`, soon.slice(0, 3).map((t) => t.title).join('、'), '#/tasks?scope=week', 'warn', `soon:${today}`);

  const events = all(
    `SELECT id,title,start_at FROM tasks WHERE kind='event' AND assignee_id=? AND status <> 'cancelled'
       AND substr(COALESCE(start_at,due_at),1,10) = ?`,
    userId,
    today
  );
  if (events.length) push('event', `今天有 ${events.length} 个日程`, events.map((e) => e.title).slice(0, 3).join('、'), '#/calendar', 'info', `events:${today}`);

  const ms = all(
    `SELECT m.id,m.name,m.due_date,p.name AS pn FROM milestones m JOIN projects p ON p.id=m.project_id
     WHERE m.status<>'done' AND m.due_date IS NOT NULL AND m.due_date <= ? LIMIT 5`,
    addDaysStr(today, 3)
  );
  for (const m of ms) {
    push('milestone', `里程碑临近：${m.name}`, `所属项目「${m.pn}」，${daysBetween(today, m.due_date) < 0 ? '已过期' : `${daysBetween(today, m.due_date)} 天后到期`}`, `#/projects/${m.id}`, daysBetween(today, m.due_date) <= 1 ? 'danger' : 'warn', `ms:${m.id}:${today}`);
  }
  return created;
}

GET('/api/notifications', async (ctx) => {
  const user = requireAuth(ctx);
  const settings = getSettings(user.id);
  if (settings.notify_overdue === '1' || settings.notify_due_soon === '1') generateNotifications(user.id);
  const limit = Math.min(60, num(ctx.query.limit, 30));
  const rows = all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?', user.id, limit);
  return {
    items: rows.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      link: n.link,
      level: n.level,
      read: !!n.read,
      createdAt: n.created_at,
    })),
    unread: num(get('SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read=0', user.id)?.n),
  };
});

POST('/api/notifications/:id/read', async (ctx) => {
  const user = requireAuth(ctx);
  update('notifications', num(ctx.params.id), { read: 1 });
  return { ok: true };
});

POST('/api/notifications/read-all', async (ctx) => {
  const user = requireAuth(ctx);
  run('UPDATE notifications SET read=1 WHERE user_id=?', user.id);
  return { ok: true };
});

// ============ 设置 ============
GET('/api/settings', async (ctx) => {
  const user = requireAuth(ctx);
  return getSettings(user.id);
});

PATCH('/api/settings', async (ctx) => {
  const user = requireAuth(ctx);
  return saveSettings(user.id, ctx.body);
});

// ============ 活动流 ============
GET('/api/activity', async (ctx) => {
  requireAuth(ctx);
  const limit = Math.min(100, num(ctx.query.limit, 30));
  return all(
    `SELECT a.*, u.name AS user_name, u.avatar AS user_avatar, u.color AS user_color
     FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT ?`,
    limit
  ).map((a) => ({
    id: a.id,
    action: a.action,
    targetType: a.target_type,
    targetId: a.target_id,
    targetName: a.target_name,
    user: a.user_id ? { id: a.user_id, name: a.user_name, avatar: a.user_avatar, color: a.user_color } : null,
    createdAt: a.created_at,
  }));
});