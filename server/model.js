// 领域模型：行 -> API 对象、可见性、派生指标（进度/健康度/负载）
import { all, get } from './db.js';
import { safeJson, daysBetween, dateStr, startOfWeekStr, round1, num } from './util.js';

export const arr = (s) => {
  const v = safeJson(s, []);
  return Array.isArray(v) ? v : [];
};

export const PRIORITY = { low: 0, med: 1, high: 2, urgent: 3 };
export const PRIORITY_LABEL = { low: '低', med: '中', high: '高', urgent: '紧急' };
export const STATUS_LABEL = {
  backlog: '待规划',
  todo: '待办',
  doing: '进行中',
  review: '待验收',
  done: '已完成',
  cancelled: '已取消',
};
export const PROJECT_STATUS_LABEL = {
  planning: '规划中',
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
  cancelled: '已取消',
};
export const HEALTH_LABEL = { good: '正常', watch: '需关注', at_risk: '风险' };

// ---------- users ----------
export function userBrief(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    avatar: u.avatar || u.name.slice(0, 1),
    color: u.color,
    title: u.title,
    role: u.role,
    status: u.status,
    department: u.department,
  };
}

export function userMap(ids) {
  if (!ids.length) return {};
  const ph = ids.map(() => '?').join(',');
  const rows = all(`SELECT * FROM users WHERE id IN (${ph})`, ...ids);
  return Object.fromEntries(rows.map((r) => [r.id, userBrief(r)]));
}

export function fullUser(u) {
  if (!u) return null;
  return {
    ...userBrief(u),
    email: u.email,
    managerId: u.manager_id,
    phone: u.phone,
    location: u.location,
    skills: arr(u.skills),
    weeklyHours: u.weekly_hours,
    focusHours: u.focus_hours,
    joinedAt: u.joined_at,
    note: u.note,
    isDemo: !!u.is_demo,
    lastSeenAt: u.last_seen_at,
    createdAt: u.created_at,
  };
}

// ---------- projects ----------
export function serializeProject(p, ctx = {}) {
  const today = dateStr();
  const metrics = projectMetrics(p.id);
  const total = ctx.taskTotal ?? metrics.total;
  const done = ctx.taskDone ?? metrics.done;
  const overdue = ctx.taskOverdue ?? metrics.overdue;
  const progress =
    p.status === 'done' ? 1 : total > 0 ? round1((done / total) * 100) : num(p.progress, 0);

  let nextMilestone = null;
  const ms = ctx.milestones ?? all('SELECT * FROM milestones WHERE project_id=? ORDER BY due_date IS NULL, due_date', p.id);
  for (const m of ms) {
    if (m.status === 'done') continue;
    nextMilestone = { ...serializeMilestone(m), daysLeft: daysBetween(today, m.due_date || today) };
    break;
  }

  return {
    id: p.id,
    name: p.name,
    key: p.key,
    description: p.description,
    kind: p.kind,
    teamId: p.team_id,
    teamName: p.team_name || null,
    ownerId: p.owner_id,
    owner: p.owner_id ? userBrief(p.owner_id ? get('SELECT * FROM users WHERE id=?', p.owner_id) : null) : null,
    status: p.status,
    priority: p.priority,
    health: p.health,
    healthAuto: deriveHealth(p, metrics),
    startDate: p.start_date,
    dueDate: p.due_date,
    color: p.color,
    tags: arr(p.tags),
    progress,
    budgetHours: p.budget_hours,
    loggedHours: metrics.loggedHours,
    starred: !!p.starred,
    archived: !!p.archived,
    parentId: p.parent_id,
    risks: p.risks,
    nextStep: p.next_step,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    completedAt: p.completed_at,
    // 派生
    metrics: {
      total,
      done,
      doing: metrics.doing,
      overdue,
      open: Math.max(0, total - done),
      loggedHours: metrics.loggedHours,
      daysLeft: p.due_date ? daysBetween(today, p.due_date) : null,
      burn: burnRate(p.id),
      milestoneTotal: ms.length,
      milestoneDone: ms.filter((m) => m.status === 'done').length,
    },
    nextMilestone,
  };
}

export function projectMetrics(projectId) {
  const row = get(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status='doing' THEN 1 ELSE 0 END) AS doing
     FROM tasks WHERE project_id=? AND parent_id IS NULL AND status != 'cancelled'`,
    projectId
  );
  const today = dateStr();
  const overdue = get(
    `SELECT COUNT(*) AS n FROM tasks
     WHERE project_id=? AND status NOT IN ('done','cancelled') AND due_at IS NOT NULL AND substr(due_at,1,10) < ?`,
    projectId,
    today
  );
  const logged = get(
    `SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE project_id=?`,
    projectId
  );
  return {
    total: num(row?.total),
    done: num(row?.done),
    doing: num(row?.doing),
    overdue: num(overdue?.n),
    loggedHours: round1(num(logged?.m) / 60),
  };
}

/** 近 7 天完成数/投入小时 —— 用于迷你趋势 */
export function burnRate(projectId) {
  const since = dateStr(new Date(Date.now() - 6 * 86400000));
  const done = get(
    `SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND status='done' AND substr(completed_at,1,10) >= ?`,
    projectId,
    since
  );
  const logs = get(
    `SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE project_id=? AND log_date >= ?`,
    projectId,
    since
  );
  return { last7Done: num(done?.n), last7Hours: round1(num(logs?.m) / 60) };
}

/** 健康度自动推导（可覆盖） */
export function deriveHealth(p, cachedMetrics) {
  const m = cachedMetrics || projectMetrics(p.id);
  if (p.status === 'done' || p.status === 'cancelled') return 'good';
  if (!p.due_date || m.total === 0) return 'good';
  const today = dateStr();
  const totalDays = Math.max(1, daysBetween(p.start_date || today, p.due_date));
  const passed = Math.max(0, daysBetween(p.start_date || today, today));
  const expected = totalDays <= 0 ? 1 : (passed / totalDays) * 100;
  const actual = (m.done / m.total) * 100;
  const gap = expected - actual;
  if (m.overdue > 0 && gap > 25) return 'at_risk';
  if (gap > 12) return 'watch';
  if (m.overdue > 2) return 'watch';
  return 'good';
}

export function serializeMilestone(m) {
  return {
    id: m.id,
    projectId: m.project_id,
    name: m.name,
    description: m.description,
    dueDate: m.due_date,
    status: m.status,
    ownerId: m.owner_id,
    sort: m.sort,
    createdAt: m.created_at,
    daysLeft: m.due_date ? daysBetween(dateStr(), m.due_date) : null,
  };
}

// ---------- tasks ----------
export function serializeTask(t, ctx = {}) {
  const today = dateStr();
  const isDone = t.status === 'done' || t.status === 'cancelled';
  const overdue = !isDone && t.due_at && String(t.due_at).slice(0, 10) < today;
  const dueSoon = !isDone && t.due_at && !overdue && daysBetween(today, String(t.due_at).slice(0, 10)) <= 2;

  const o = {
    id: t.id,
    title: t.title,
    notes: t.notes,
    kind: t.kind,
    projectId: t.project_id,
    projectName: t.project_name || null,
    projectColor: t.project_color || null,
    projectKey: t.project_key || null,
    parentId: t.parent_id,
    milestoneId: t.milestone_id,
    teamId: t.team_id,
    assigneeId: t.assignee_id,
    creatorId: t.creator_id,
    status: t.status,
    priority: t.priority,
    startAt: t.start_at,
    dueAt: t.due_at,
    endAt: t.end_at,
    allDay: !!t.all_day,
    location: t.location,
    tags: arr(t.tags),
    estimateHours: t.estimate_hours,
    actualHours: t.actual_hours,
    pinned: !!t.pinned,
    weekStart: t.week_start,
    blocked: !!t.blocked,
    blockedReason: t.blocked_reason,
    orderIndex: t.order_index,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    completedAt: t.completed_at,
    overdue: !!overdue,
    dueSoon: !!dueSoon,
  };
  if (t.assignee_name !== undefined) {
    o.assignee = t.assignee_name
      ? { id: t.assignee_id, name: t.assignee_name, avatar: t.assignee_avatar, color: t.assignee_color }
      : null;
  }
  if (ctx.withChildren) {
    o.children = all('SELECT * FROM tasks WHERE parent_id=? ORDER BY order_index, id', t.id).map((c) =>
      serializeTask(c)
    );
  }
  return o;
}

export const TASK_SELECT = `
  SELECT t.*, p.name AS project_name, p.color AS project_color, p.key AS project_key,
         u.name AS assignee_name, u.avatar AS assignee_avatar, u.color AS assignee_color
  FROM tasks t
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.assignee_id`;

// ---------- 负载 ----------
export function workloadRows(userIds, weekStart) {
  const ws = weekStart || startOfWeekStr();
  const we = dateStr(new Date(new Date(ws).getTime() + 6 * 86400000));
  return userIds.map((id) => {
    const u = get('SELECT * FROM users WHERE id=?', id);
    const open = get(
      `SELECT COUNT(*) AS n, COALESCE(SUM(estimate_hours),0) AS est
       FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled') AND kind='task'`,
      id
    );
    const weekTasks = all(
      `SELECT id FROM tasks WHERE assignee_id=? AND week_start=? AND status NOT IN ('done','cancelled') AND kind='task'`,
      id,
      ws
    );
    const overdue = get(
      `SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=?
       AND status NOT IN ('done','cancelled') AND kind='task' AND due_at IS NOT NULL AND substr(due_at,1,10) < ?`,
      id,
      dateStr()
    );
    const doneWeek = get(
      `SELECT COUNT(*) AS n FROM tasks WHERE assignee_id=? AND status='done' AND substr(completed_at,1,10) BETWEEN ? AND ?`,
      id,
      ws,
      we
    );
    const hoursWeek = get(
      `SELECT COALESCE(SUM(minutes),0) AS m FROM work_logs WHERE user_id=? AND log_date BETWEEN ? AND ?`,
      id,
      ws,
      we
    );
    const plannedHours = weekTasks.length
      ? round1(num(open.est) * (weekTasks.length / Math.max(1, num(open.n))))
      : 0;
    const capacity = u ? num(u.focus_hours, 22) : 22;
    const load = capacity > 0 ? round1((plannedHours / capacity) * 100) : 0;
    return {
      userId: id,
      user: userBrief(u),
      capacityHours: capacity,
      openTasks: num(open?.n),
      estimateHours: round1(num(open?.est)),
      plannedTasks: weekTasks.length,
      plannedHours,
      overdue: num(overdue?.n),
      doneThisWeek: num(doneWeek?.n),
      loggedThisWeek: round1(num(hoursWeek?.m) / 60),
      load,
      level: load > 110 ? 'over' : load > 75 ? 'high' : load < 25 && num(open?.n) > 0 ? 'idle' : 'ok',
    };
  });
}