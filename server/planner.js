// 智能规划引擎：根据项目/任务/人员状态生成「下周工作安排建议」
// 特点：可解释（每条建议都给理由）、按容量装箱、可一键采纳写入日历
import { all, get, insert, update, tx, logActivity, getSettings, now } from './db.js';
import {
  dateStr,
  addDaysStr,
  startOfWeekStr,
  daysBetween,
  round1,
  num,
  parseDate,
} from './util.js';
import { serializeTask, projectMetrics, deriveHealth, workloadRows } from './model.js';

const PRI_W = { urgent: 30, high: 20, med: 10, low: 3 };
const PROJ_W = { urgent: 22, high: 14, med: 7, low: 2 };
const STATUS_W = { doing: 12, review: 14, todo: 4, backlog: 0, done: 0, cancelled: 0 };
const WD = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function nextMonday(from = new Date()) {
  // "下周"始终指下一个自然周：本周一 + 7 天。
  // （周日时本周一已过去 6 天，本周一+7 正好是明天，符合"下周从明天开始"的直觉。）
  return addDaysStr(startOfWeekStr(dateStr(from), 1), 7);
}

function workDaysOf(settings) {
  const raw = String(settings.work_days || '1,2,3,4,5');
  const set = new Set(raw.split(',').map((n) => parseInt(n, 10)).filter((n) => n >= 0 && n <= 6));
  if (!set.size) return [1, 2, 3, 4, 5];
  return [...set].sort();
}

/** 单条任务评分 + 理由 */
function scoreTask(t, ctx) {
  const today = ctx.today;
  const reasons = [];
  let score = 0;

  score += PRI_W[t.priority] ?? 10;
  if (t.priority === 'urgent') reasons.push('标记为紧急');
  else if (t.priority === 'high') reasons.push('高优先级');

  const dueDate = t.due_at ? String(t.due_at).slice(0, 10) : null;
  if (dueDate) {
    const dLeft = daysBetween(today, dueDate);
    if (dLeft < 0) {
      const over = Math.round(-dLeft);
      const add = Math.min(40, 8 + over * 4);
      score += add;
      reasons.push(`已逾期 ${over} 天`);
    } else if (dLeft <= 7) {
      score += (7 - dLeft) * 5 + 5;
      reasons.push(dLeft === 0 ? '今天到期' : `${dLeft} 天后到期（${dueDate}）`);
    } else if (dLeft <= 21) {
      score += 6;
      reasons.push(`两周多内到期（${dueDate}）`);
    }
  } else {
    score += 5;
  }

  const p = t.project_id ? ctx.projects.get(t.project_id) : null;
  if (p) {
    if (p.status === 'done' || p.status === 'cancelled') return null; // 已结束项目不再排
    score += PROJ_W[p.priority] ?? 7;
    if (p.priority === 'urgent') reasons.push(`所属项目「${p.name}」为紧急`);
    else if (p.priority === 'high') reasons.push(`所属项目「${p.name}」优先级高`);

    const ph = ctx.health.get(p.id) || 'good';
    if (ph === 'at_risk') {
      score += 14;
      reasons.push(`项目「${p.name}」进度落后于时间线`);
    } else if (ph === 'watch') {
      score += 7;
      reasons.push(`项目「${p.name}」需关注`);
    }

    const ms = ctx.milestones.get(p.id);
    if (ms) {
      const md = daysBetween(today, ms.due_date);
      if (md >= 0 && md <= 10) {
        score += 16;
        reasons.push(`里程碑「${ms.name}」${md === 0 ? '今天' : `${md} 天后`}到期`);
      } else if (md < 0) {
        score += 20;
        reasons.push(`里程碑「${ms.name}」已过期`);
      }
    }
    // 下一步已写明 → 直接对齐
    if (p.next_step && p.next_step.length > 1) score += 4;
  }

  score += STATUS_W[t.status] ?? 0;
  if (t.status === 'doing') reasons.push('已在进行中，收尾成本最低');
  if (t.status === 'review') reasons.push('待验收，推进即可关闭');

  if (t.pinned) {
    score += 25;
    reasons.push('你标记为重点关注');
  }

  if (t.blocked) {
    score += 16;
    reasons.push(`被阻塞：${t.blocked_reason || '未说明'}`);
  }

  // 长期未动的任务：连续顺延
  const idle = daysBetween(String(t.updated_at || t.created_at).slice(0, 10), today);
  if (idle >= 7) {
    const add = Math.min(12, (idle - 7) * 1.5);
    score += add;
    if (idle >= 14) reasons.push(`已 ${Math.round(idle)} 天没有进展`);
  }

  // 太大的任务先拆
  if (t.estimate_hours >= 8) {
    score -= 8;
    reasons.push('预估工时偏大，建议拆解后再排');
  }

  const effort = num(t.estimate_hours) > 0 ? num(t.estimate_hours) : 1;
  return { score: Math.round(score * 10) / 10, reasons, effort, priorityWeight: PRI_W[t.priority] ?? 10, dueDate, project: p };
}

function buildContext(user, teamId) {
  const projects = new Map();
  for (const p of all('SELECT * FROM projects WHERE archived=0')) projects.set(p.id, p);
  const health = new Map();
  for (const p of projects.values()) health.set(p.id, deriveHealth(p));
  const milestones = new Map();
  for (const m of all(`SELECT * FROM milestones WHERE status <> 'done' ORDER BY due_date IS NULL, due_date`)) {
    if (!milestones.has(m.project_id)) milestones.set(m.project_id, m);
  }
  return { projects, health, milestones, today: dateStr() };
}

function capacityFor(days, settings, focusHours) {
  const per = focusHours / Math.max(1, days.length);
  return Math.round(per * 10) / 10;
}

export function generatePlan(user, opts = {}) {
  const settings = getSettings(user.id);
  const today = dateStr();
  const scope = opts.scope === 'team' ? 'team' : 'me';
  const weekStart = (opts.weekStart || nextMonday()).slice(0, 10);
  const weekEnd = addDaysStr(weekStart, 6);
  const ctx = buildContext(user, opts.teamId);

  // ---- 候选任务 ----
  let rows = [];
  if (scope === 'me') {
    rows = all(
      `SELECT * FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')
         AND parent_id IS NULL AND kind='task'`,
      user.id
    );
  } else {
    const teamIds = opts.teamId
      ? [num(opts.teamId)]
      : all('SELECT team_id FROM team_members WHERE user_id=?', user.id).map((r) => r.team_id);
    if (teamIds.length) {
      const ph = teamIds.map(() => '?').join(',');
      rows = all(
        `SELECT * FROM tasks WHERE team_id IN (${ph}) AND status NOT IN ('done','cancelled')
           AND parent_id IS NULL AND kind='task'`,
        ...teamIds
      );
    }
    if (!rows.length) {
      rows = all(
        `SELECT * FROM tasks WHERE assignee_id=? AND status NOT IN ('done','cancelled')
           AND parent_id IS NULL AND kind='task'`,
        user.id
      );
    }
  }

  const scored = [];
  for (const t of rows) {
    const s = scoreTask(t, ctx);
    if (s) scored.push({ task: t, ...s });
  }
  scored.sort((a, b) => b.score - a.score || a.task.id - b.task.id);

  // ---- 时间格 ----
  const workDays = workDaysOf(settings);
  const capacity = capacityFor(workDays, settings, num(opts.capacityHours, user.focusHours || 22));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysStr(weekStart, i);
    const dow = parseDate(date).getDay();
    if (!workDays.includes(dow)) continue;
    days.push({ date, dow, label: WD[dow === 0 ? 6 : dow - 1], capacityHours: capacity, used: 0, items: [] });
  }
  if (!days.length) days.push({ date: weekStart, dow: 1, label: '周一', capacityHours: 6, used: 0, items: [] });

  // 会议占用
  const dayIdx = new Map(days.map((d, i) => [d.date, i]));
  const events = all(
    `SELECT * FROM tasks WHERE kind='event' AND status NOT IN ('cancelled')
       AND substr(COALESCE(start_at,due_at),1,10) BETWEEN ? AND ?`,
    weekStart,
    weekEnd
  );
  const meetings = [];
  for (const e of events) {
    const d = String(e.start_at || e.due_at).slice(0, 10);
    const i = dayIdx.get(d);
    const hours = eventHours(e);
    if (i !== undefined) {
      days[i].used = round1(days[i].used + hours);
      days[i].items.push({
        type: 'event',
        id: e.id,
        title: e.title,
        hours,
        time: e.start_at ? String(e.start_at).slice(11, 16) : '',
        assigneeId: e.assignee_id,
        reasons: ['固定日程'],
      });
    }
    meetings.push({
      id: e.id,
      title: e.title,
      date: d,
      time: e.start_at ? String(e.start_at).slice(11, 16) : '',
      hours,
    });
  }

  // 每一天至少保留 1 小时给实际工作，否则会议一多就整天空白
  for (const d of days) {
    if (d.capacityHours - d.used < 1 && d.used > 0 && d.capacityHours > 1) {
      d.used = round1(d.capacityHours - 1);
    }
  }
  const meetingHours = round1(meetings.reduce((s, m) => s + m.hours, 0));

  // ---- 装箱 ----
  const placed = [];
  const unplaced = [];
  for (const item of scored) {
    const t = item.task;
    // 截止日约束：落在本周内的截止日 => 最晚排到那天
    let deadlineIdx = days.length - 1;
    if (item.dueDate && item.dueDate >= weekStart && item.dueDate <= weekEnd) {
      deadlineIdx = Math.max(0, dayIdx.get(item.dueDate) ?? days.length - 1);
    }
    // 优先放到最靠前且有容量的日子
    let target = -1;
    for (let i = 0; i <= deadlineIdx && i < days.length; i++) {
      if (days[i].used + item.effort <= days[i].capacityHours + 0.01) {
        target = i;
        break;
      }
    }
    if (target < 0) {
      // 试一下超载塞入（>80% 利用率时提示但不硬塞）
      const overflow = days.findIndex((d, i) => i <= deadlineIdx && d.used <= d.capacityHours);
      unplaced.push({
        taskId: t.id,
        title: t.title,
        effort: item.effort,
        priority: t.priority,
        projectName: t.project_id ? ctx.projects.get(t.project_id)?.name : null,
        reasons: item.reasons,
        reason: days.every((d) => d.used >= d.capacityHours)
          ? `本周容量已满（每天 ${capacity}h），建议推迟到下下周或压缩范围`
          : '截止日前没有可用时段',
      });
      continue;
    }
    const d = days[target];
    d.used = round1(d.used + item.effort);
    const entry = {
      type: 'task',
      taskId: t.id,
      title: t.title,
      hours: item.effort,
      priority: t.priority,
      status: t.status,
      projectId: t.project_id,
      projectName: t.project_id ? ctx.projects.get(t.project_id)?.name : null,
      projectColor: t.project_id ? ctx.projects.get(t.project_id)?.color : null,
      milestoneId: t.milestone_id,
      assigneeId: t.assignee_id,
      assigneeName: scope === 'team' ? assigneeName(t.assignee_id) : null,
      blocked: !!t.blocked,
      reasons: item.reasons,
      score: item.score,
    };
    d.items.push(entry);
    placed.push(entry);
  }

  // ---- 阻塞前置提醒 ----
  const blocked = rows.filter((t) => t.blocked);

  // ---- 团队负载再平衡 ----
  let rebalance = [];
  if (scope === 'team') {
    const ids = [...new Set(rows.map((t) => t.assignee_id).filter(Boolean))];
    const loads = workloadRows(ids, weekStart);
    const over = loads.filter((l) => l.load > 105);
    const under = loads.filter((l) => l.load < 55 && l.user);
    for (const o of over) {
      const movable = rows
        .filter((t) => t.assignee_id === o.userId && t.priority !== 'urgent')
        .sort((a, b) => num(a.estimate_hours, 1) - num(b.estimate_hours, 1))
        .slice(0, 3);
      for (const target of under.slice(0, 1)) {
        rebalance.push({
          from: o.user?.name,
          fromId: o.userId,
          fromLoad: o.load,
          to: target.user?.name,
          toId: target.userId,
          toLoad: target.load,
          tasks: movable.map((t) => ({ id: t.id, title: t.title, hours: num(t.estimate_hours, 1) })),
          reason: `${o.user?.name} 下周负载 ${o.load}%，${target.user?.name} 仅 ${target.load}%，建议转移 ${Math.min(movable.length, 2)} 项`,
        });
      }
    }
  }

  // ---- 洞察 ----
  const insights = buildInsights({
    rows,
    placed,
    unplaced,
    blocked,
    ctx,
    days,
    meetings,
    capacity,
    user,
    weekStart,
    scope,
  });

  const totalHours = round1(days.reduce((s, d) => s + d.items.filter((i) => i.type === 'task').reduce((a, b) => a + b.hours, 0), 0));
  const totalCap = round1(days.length * capacity);

  const top = placed.slice(0, 3).map((p) => ({
    title: p.title,
    hours: p.hours,
    projectName: p.projectName,
    why: p.reasons[0] || '优先级较高',
  }));

  const plan = {
    weekStart,
    weekEnd,
    scope,
    capacityHours: capacity,
    days: days.map((d) => ({
      date: d.date,
      label: d.label,
      capacityHours: d.capacityHours,
      plannedHours: round1(d.used),
      utilization: d.capacityHours ? Math.round((d.used / d.capacityHours) * 100) : 0,
      items: d.items,
    })),
    summary: {
      taskCount: placed.length,
      meetingCount: meetings.length,
      meetingHours,
      totalHours,
      totalCapacity: totalCap,
      utilization: totalCap ? Math.round((totalHours / totalCap) * 100) : 0,
      carryOver: unplaced.length,
      blocked: blocked.length,
    },
    top,
    unplaced,
    blockedTasks: blocked.map((t) => ({ id: t.id, title: t.title, reason: t.blocked_reason || '未说明原因' })),
    rebalance,
    insights,
    meetings,
    generatedAt: now(),
  };
  return plan;
}

function assigneeName(id) {
  return id ? get('SELECT name FROM users WHERE id=?', id)?.name : null;
}

/** 事件实际占用小时数：优先用起止时间差 */
function eventHours(e) {
  if (e.all_day) return 0.5;
  const s = parseDate(e.start_at);
  const t = parseDate(e.due_at);
  if (s && t) {
    const mins = (t - s) / 60000;
    if (mins > 0 && mins < 12 * 60) return Math.max(0.25, Math.round((mins / 60) * 100) / 100);
  }
  return 1;
}

function buildInsights(ctx) {
  const { rows, placed, unplaced, blocked, ctx: c, days, meetings, capacity, weekStart } = ctx;
  const out = [];
  const today = c.today;
  const overdue = rows.filter((t) => t.due_at && String(t.due_at).slice(0, 10) < today && t.status !== 'done');
  const urgent = rows.filter((t) => t.priority === 'urgent');
  const blockedCount = blocked.length;

  if (overdue.length >= 3) {
    out.push({
      level: 'danger',
      title: `有 ${overdue.length} 项逾期任务`,
      detail: `逾期最久的是「${overdue.sort((a, b) => (a.due_at < b.due_at ? -1 : 1))[0].title}」。建议本周前两天集中清理，逾期会持续侵蚀计划。`,
      action: '筛选逾期',
      filter: { overdue: 1 },
    });
  }

  // 里程碑临期
  for (const [pid, ms] of c.milestones) {
    if (!ms.due_date) continue;
    const d = daysBetween(today, ms.due_date);
    if (d < 0 || d > 10) continue;
    const p = c.projects.get(pid);
    if (!p || p.status === 'done') continue;
    const related = placed.filter((x) => x.projectId === pid).length;
    out.push({
      level: d <= 3 ? 'danger' : 'warn',
      title: `「${p.name}」里程碑 ${ms.name} ${d < 0 ? '已过期' : `还有 ${d} 天`}`,
      detail: `下周已为该项目排入 ${related} 项${related === 0 ? '，但目前没有排任何工作——建议今天就启动' : ''}。`,
      action: '打开项目',
      link: `#/projects/${pid}`,
    });
  }

  // 大任务拆解
  const big = rows.filter((t) => num(t.estimate_hours) >= 8 && t.status !== 'done');
  if (big.length) {
    out.push({
      level: 'info',
      title: `${big.length} 项任务预估超过 8 小时`,
      detail: `例如「${big[0].title}」（${round1(big[0].estimate_hours)}h）。大块任务容易一拖再拖，拆成 2-3 个能当天收尾的子任务更稳。`,
      action: '去拆解',
    });
  }

  // 阻塞
  if (blockedCount) {
    out.push({
      level: 'danger',
      title: `${blockedCount} 项任务处于阻塞状态`,
      detail: `阻塞的任务排进日程也没用。建议先花 30 分钟集中解阻塞：${blocked.slice(0, 2).map((t) => `「${t.title}」`).join('、')}。`,
      action: '查看阻塞',
      filter: { blocked: 1 },
    });
  }

  // 容量
  if (days.some((d) => d.used > d.capacityHours)) {
    const over = days.filter((d) => d.used > d.capacityHours);
    out.push({
      level: 'warn',
      title: '排期超出每日容量',
      detail: over.map((d) => `${d.label} ${round1(d.used)}h/${d.capacityHours}h`).join('，') + '。要么挪到下下周，要么把其中一项拆给队友。',
    });
  }

  const util = ctx.days.length ? Math.round((days.reduce((s, d) => s + d.used, 0) / (days.length * capacity)) * 100) : 0;
  if (util < 45 && rows.length > 3) {
    out.push({
      level: 'ok',
      title: `下周计划偏松（利用率 ${util}%）`,
      detail: '有较多空闲。可以主动安排：技术攻坚、文档梳理、或者提前启动一个还没到期的项目。',
    });
  } else if (util > 95) {
    out.push({
      level: 'warn',
      title: `下周几乎排满（利用率 ${util}%）`,
      detail: '没有缓冲。建议预留至少 20% 给突发插单，否则一旦被打断就会连环延期。',
    });
  }

  if (!urgent.length && rows.length >= 4) {
    out.push({
      level: 'info',
      title: '下周没有紧急任务',
      detail: '适合安排一件"重要但不紧急"的事：比如重构、优化流程、学习新工具。',
    });
  }

  if (unplaced.length) {
    out.push({
      level: 'warn',
      title: `${unplaced.length} 项任务排不进下周`,
      detail: unplaced.slice(0, 3).map((u) => `「${u.title}」`).join('、') + '。可以推迟一周，或先压缩范围做完一部分。',
    });
  }

  const meetingHours = round1((ctx.meetings || []).reduce((s, m) => s + (m.hours || 0), 0));
  const dayTotal = days.length * capacity;
  if (meetingHours > dayTotal * 0.3) {
    out.push({
      level: 'warn',
      title: `会议占用 ${meetingHours} 小时（占可用时间 ${Math.round((meetingHours / dayTotal) * 100)}%）`,
      detail: '会议偏多，深度工作时间被切碎。考虑把部分例会改成异步周报，或合并到同一时段。',
      action: '查看日程',
      link: '#/calendar',
    });
  }

  const byProject = new Map();
  for (const p of placed) {
    if (!p.projectName) continue;
    byProject.set(p.projectName, (byProject.get(p.projectName) || 0) + p.hours);
  }
  const topProject = [...byProject.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topProject) {
    out.push({
      level: 'info',
      title: `下周重心：${topProject[0]}`,
      detail: `占 ${round1(topProject[1])} 小时（${Math.round((topProject[1] / Math.max(0.1, placed.reduce((s, p) => s + p.hours, 0))) * 100)}%）。确认这符合预期，否则其他项目会被挤压。`,
    });
  }

  if (!out.length) {
    out.push({ level: 'ok', title: '下周节奏健康', detail: '没有明显风险。保持当前节奏即可。' });
  }
  return out;
}

// ---------------- 采纳计划 ----------------
export function adoptPlan(user, plan, opts = {}) {
  const { reschedule, markWeek, includeEvents } = opts;
  const items = (plan.days || []).flatMap((d) =>
    d.items.filter((i) => i.type === 'task').map((i) => ({ ...i, date: d.date }))
  );
  if (!items.length) return { ok: true, affected: 0, note: '计划里没有可采纳的任务' };

  let affected = 0;
  tx(() => {
    for (const it of items) {
      const t = get('SELECT * FROM tasks WHERE id=?', it.taskId);
      if (!t) continue;
      const patch = { updated_at: now() };
      if (markWeek) patch.week_start = plan.weekStart;
      if (reschedule) {
        patch.due_at = it.date;
        patch.start_at = null;
        patch.all_day = 1;
        patch.week_start = plan.weekStart;
      }
      if (t.status === 'backlog' && it.status === 'backlog') patch.status = 'todo';
      update('tasks', t.id, patch);
      affected++;
    }
    insert('plans', {
      user_id: user.id,
      week_start: plan.weekStart,
      title: `${plan.weekStart} 工作安排（${affected} 项）`,
      scope: plan.scope || 'me',
      payload: JSON.stringify(plan),
      status: 'adopted',
      note: opts.note || null,
      created_at: now(),
      adopted_at: now(),
    });
  });
  logActivity(user.id, 'plan.adopt', 'plan', null, `${plan.weekStart} ${affected} 项`);
  return { ok: true, affected, rescheduled: !!reschedule };
}

export function saveDraft(user, plan, title) {
  if (!plan || !plan.weekStart || !Array.isArray(plan.days)) throw new Error('计划数据不完整');
  const existing = get(
    'SELECT id FROM plans WHERE user_id=? AND week_start=? AND status=\'draft\'',
    user.id,
    plan.weekStart
  );
  if (existing) {
    update('plans', existing.id, {
      payload: JSON.stringify(plan),
      title: title || existing.title,
      created_at: now(),
    });
    return { ok: true, id: existing.id, updated: true };
  }
  const id = insert('plans', {
    user_id: user.id,
    week_start: plan.weekStart,
    title: title || `${plan.weekStart} 工作安排建议`,
    scope: plan.scope || 'me',
    payload: JSON.stringify(plan),
    status: 'draft',
    created_at: now(),
  });
  return { ok: true, id };
}

export function listPlans(user, weekStart) {
  const rows = weekStart
    ? all('SELECT * FROM plans WHERE user_id=? AND week_start=? ORDER BY created_at DESC', user.id, weekStart)
    : all('SELECT * FROM plans WHERE user_id=? ORDER BY created_at DESC LIMIT 20', user.id);
  return rows.map((p) => ({
    id: p.id,
    weekStart: p.week_start,
    title: p.title,
    scope: p.scope,
    status: p.status,
    createdAt: p.created_at,
    adoptedAt: p.adopted_at,
    note: p.note,
    summary: (() => {
      try {
        const pl = JSON.parse(p.payload);
        return pl.summary || null;
      } catch {
        return null;
      }
    })(),
    plan: p.status === 'draft' ? safeParse(p.payload) : safeParse(p.payload),
  }));
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** 导出为可复制的纯文本周计划 */
export function planToText(plan) {
  const lines = [];
  lines.push(`【下周工作安排 · ${plan.weekStart} ~ ${plan.weekEnd}】`);
  lines.push(`共 ${plan.summary.taskCount} 项 / ${plan.summary.totalHours} 小时（利用率 ${plan.summary.utilization}%）`);
  lines.push('');
  for (const d of plan.days) {
    const tasks = d.items.filter((i) => i.type === 'task');
    const events = d.items.filter((i) => i.type === 'event');
    if (!tasks.length && !events.length) continue;
    lines.push(`${d.label}（${d.date}） ${d.plannedHours}h / ${d.capacityHours}h`);
    for (const e of events) lines.push(`    ${e.time || '--:--'}  [日程] ${e.title}`);
    for (const t of tasks) {
      const why = t.reasons?.length ? `  ← ${t.reasons[0]}` : '';
      lines.push(`    ${String(t.hours).padStart(4)}h  [${pLabel(t.priority)}] ${t.title}${t.projectName ? ` @${t.projectName}` : ''}${why}`);
    }
    lines.push('');
  }
  if (plan.insights?.length) {
    lines.push('—— 建议与提醒 ——');
    for (const i of plan.insights) lines.push(`· ${i.title}${i.detail ? `：${i.detail}` : ''}`);
  }
  return lines.join('\n');
}

const pLabel = (p) => ({ urgent: '紧急', high: '高', med: '中', low: '低' })[p] || '中';