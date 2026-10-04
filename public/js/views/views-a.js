// views-a.js — 仪表盘、今日、日历
import {
  el, api, state, bus, navigate, toast, notifyOk, notifyErr, handleError,
  avatar, bar, ring, projectTag, prioDot, empty, skeleton, statTile, insightCard,
  barChart, sparkline, segmented, dstr, addDays, startOfWeek, fmtDate, fmtTime,
  relDate, fmtHours, fmtAgo, PRIO, STATUS, HEALTH, WD_S, LEVEL_ICON, bust,
} from '../core.js';
import { taskRow, openTaskDrawer, quickAddBar, attachParsePreview, openTimeLog, projectCard, taskMenu } from '../ui.js';

const today = () => dstr();

/* ==================== 仪表盘 ==================== */
export async function dashboardView(root) {
  root.appendChild(skeleton(6));
  let d;
  try {
    d = await api.get('/api/dashboard');
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(empty({ art: '😵', title: '加载失败', desc: e.message, action: el('button', { class: 'btn btn-primary mt-2', onClick: () => dashboardView(root) }, '重试') }));
    return;
  }
  root.innerHTML = '';
  const s = d.stats;

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        { class: 'titles' },
        el('h1', {}, greeting(), '，', state.user.name),
        el('div', { class: 'sub' }, `${fmtDate(d.today, 'full')} · 本周 ${fmtDate(d.weekStart, 'md')} ~ ${fmtDate(d.weekEnd, 'md')} · 已投入 ${fmtHours(s.hoursWeek)} / 建议 ${fmtHours(s.focusCapacity)}`)
      ),
      el(
        'div',
        { class: 'actions' },
        el('button', { class: 'btn', onClick: () => navigate('/planner') }, '🧠 下周建议'),
        el('button', { class: 'btn btn-primary', onClick: () => navigate('/tasks') }, '去处理任务')
      )
    )
  );

  // 建议
  if (d.suggestions?.length) {
    root.appendChild(
      el(
        'div',
        { class: 'stack-sm mb-4' },
        ...d.suggestions.slice(0, 3).map((x) =>
          insightCard({ level: x.level, title: x.text, actionLabel: x.action ? '去处理' : null }, () => suggestionAction(x))
        )
      )
    );
  }

  // 统计
  root.appendChild(
    el(
      'div',
      { class: 'grid grid-6 mb-4' },
      statTile({ label: '待处理', value: s.open, icon: '📋', color: 'var(--c-blue)', meta: `进行中 ${s.doing} · 待验收 ${s.review}`, onClick: () => navigate('/tasks?scope=mine') }),
      statTile({ label: '逾期', value: s.overdue, icon: '⚠️', color: s.overdue ? 'var(--danger)' : 'var(--fg-3)', meta: s.overdue ? '需要马上处理' : '没有逾期，很棒', onClick: () => navigate('/tasks?overdue=1') }),
      statTile({ label: '本周完成', value: s.doneWeek, icon: '✅', color: 'var(--ok)', meta: `完成率 ${s.progress}%`, onClick: () => navigate('/review') }),
      statTile({ label: '本周工时', value: s.hoursWeek, unit: 'h', icon: '⏱', color: 'var(--c-purple)', meta: `深度工作额度 ${fmtHours(s.focusCapacity)}` }),
      statTile({ label: '阻塞中', value: s.blocked, icon: '🚧', color: s.blocked ? 'var(--c-purple)' : 'var(--fg-3)', meta: s.blocked ? '先解阻塞' : '没有受阻任务', onClick: () => navigate('/tasks?blocked=1') }),
      el(
        'div',
        { class: 'stat', style: { alignItems: 'center', justifyContent: 'center' } },
        ring(s.progress, 54, 6),
        el('div', { class: 'stat-label mt-2' }, '本周完成率')
      )
    )
  );

  // 今日日程 + 焦点任务
  const grid = el('div', { class: 'split mb-4' });

  // 左：焦点任务
  const focusCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', {}, '🎯 今日焦点'),
      el('span', { class: 'badge accent' }, `${d.focus.length} 项`),
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('/tasks') }, '全部 →')
    ),
    el(
      'div',
      { class: 'card-body stack-sm' },
      d.focus.length
        ? el(
            'div',
            { class: 'stack-sm' },
            ...d.focus.slice(0, 8).map((t) => taskRow(t, { showProject: true }))
          )
        : empty({ art: '☕', title: '今天没有待办', desc: '给自己安排一件重要但不紧急的事，或者好好休息一下。' })
    )
  );

  // 右：今日日程时间线 + 里程碑
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const timelineItems = d.todayEvents.length
    ? d.todayEvents.map((e) => {
        const t = fmtTime(e.startAt || e.dueAt);
        const [hh, mm] = (t || '00:00').split(':').map(Number);
        const start = (hh || 0) * 60 + (mm || 0);
        const end = start + 60;
        const past = end < nowMin;
        const current = start <= nowMin && nowMin <= end;
        return el(
          'div',
          { class: `tl-item ${current ? 'accent' : ''}` },
          el('div', { class: 'row-tight' }, el('span', { class: 'tl-time' }, t || '全天'), el('span', { class: `fs-sm strong ${past ? 'muted' : ''} truncate` }, e.title)),
          el('div', { class: 'fs-xs muted' }, e.location || (current ? '正在进行' : past ? '已结束' : '待开始')),
          el('div', { class: 'fs-xs muted mt-1' }, `更新于 ${fmtAgo(e.updatedAt)}`)
        );
      })
    : [empty({ art: '📭', title: '今天没有日程', desc: '点右上角 + 可以快速添加。' })];

  const right = el(
    'div',
    { class: 'stack' },
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🕘 今日日程'), el('span', { class: 'badge' }, `${d.todayEvents.length}`)),
      el('div', { class: 'card-body' }, d.todayEvents.length ? el('div', { class: 'timeline' }, ...timelineItems) : empty({ art: '📭', title: '今天没有日程' }))
    ),
    d.milestonesSoon.length
      ? el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', {}, '🚩 临近里程碑'), el('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('/projects') }, '项目 →')),
          el(
            'div',
            { class: 'card-body stack-sm' },
            ...d.milestonesSoon.slice(0, 5).map((m) =>
              el(
                'div',
                { class: 'row gap-2', style: { cursor: 'pointer' }, onClick: () => navigate(`/projects/${m.projectId}`) },
                el('span', { class: 'pt-dot', style: { background: m.projectColor } }),
                el('span', { class: 'flex1 truncate fs-sm' }, m.name),
                el('span', { class: `badge ${m.daysLeft < 0 ? 'danger' : m.daysLeft <= 3 ? 'warn' : 'outline'}` }, m.daysLeft < 0 ? '已过期' : m.daysLeft === 0 ? '今天' : `${m.daysLeft} 天`)
              )
            )
          )
        )
      : null
  );

  grid.appendChild(el('div', { class: 'stack' }, focusCard));
  grid.appendChild(right);
  root.appendChild(grid);

  // 趋势
  root.appendChild(
    el(
      'div',
      { class: 'grid grid-2 mb-4' },
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h3', {}, '📈 近 14 天完成 / 新建'),
          el('span', { class: 'spacer', style: { flex: 1 } }),
          el('span', { class: 'badge ok' }, `完成 ${d.trend.reduce((a, b) => a + b.done, 0)}`),
          el('span', { class: 'badge' }, `新建 ${d.trend.reduce((a, b) => a + b.created, 0)}`)
        ),
        el('div', { class: 'card-body' }, barChart(d.trend.map((t) => ({ l: fmtDate(t.date, 'md'), v: t.done, color: 'var(--ok)' })), { h: 118 }))
      ),
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '⏱ 近 7 天工时'), el('span', { class: 'badge' }, `${d.hoursByDay.reduce((a, b) => a + b.hours, 0).toFixed(1)}h`)),
        el('div', { class: 'card-body' }, barChart(d.hoursByDay.map((t) => ({ l: fmtDate(t.date, 'md'), v: t.hours, color: 'var(--c-purple)' })), { h: 118 }))
      )
    )
  );

  // 我的项目 + 团队负载
  const bottom = el('div', { class: 'split' });
  bottom.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '📂 我的项目'), el('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('/projects') }, '全部 →')),
      el(
        'div',
        el('div', { class: 'card-body' },
          d.myProjects.length
            ? el(
                'div',
                { class: 'stack-sm' },
                ...d.myProjects.slice(0, 6).map((p) => {
                  const left = p.metrics?.daysLeft;
                  return el(
                    'div',
                    { class: 'task', style: { cursor: 'pointer' }, onClick: () => navigate(`/projects/${p.id}`) },
                    el('span', { class: 'pt-dot', style: { background: p.color, width: '9px', height: '9px', borderRadius: '3px', marginTop: '3px' } }),
                    el('span', { class: 'flex1' },
                      el('div', { class: 'task-title' }, p.name),
                      el('div', { class: 'task-meta' },
                        el('span', {}, `${p.metrics.done}/${p.metrics.total} 任务`),
                        el('span', { class: 'sep' }, '·'),
                        el('span', {}, `${p.progress}%`),
                        p.metrics.overdue > 0 ? el('span', { style: { color: 'var(--danger)' } }, `⚠ ${p.metrics.overdue} 逾期`) : null,
                        left != null ? el('span', { class: 'sep' }, '·') : null,
                        left != null ? el('span', {}, left < 0 ? `超期 ${-left} 天` : `剩 ${left} 天`) : null)),
                    el('span', { style: { width: '90px', flexShrink: 0 } }, bar(p.progress, p.progress >= 100 ? 'ok' : ''))
                  );
                })
              )
            : empty({ art: '📁', title: '还没有项目', desc: '创建一个项目，把零散任务串成一条线。', action: el('button', { class: 'btn btn-primary btn-sm mt-2', onClick: () => navigate('/projects') }, '创建项目') })
        )
    )
  ));
  bottom.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '👥 团队负载'), el('button', { class: 'btn btn-sm btn-ghost', onClick: () => navigate('/team') }, '团队 →')),
      el(
        'div',
        { class: 'card-body stack-sm' },
        d.workload.length
          ? el(
              'div',
              { class: 'stack-sm' },
              ...d.workload.slice(0, 7).map((w) =>
                el(
                  'div',
                  { style: { cursor: 'pointer' }, onClick: () => navigate(`/team/${w.userId}`) },
                  el(
                    'div',
                    { class: 'spread fs-xs mb-2' },
                    el('span', { class: 'row-tight' }, avatar(w.user, 'sm'), el('span', {}, w.user?.name)),
                    el('span', { class: `tnum ${w.level === 'over' ? 'strong' : ''}`, style: { color: w.level === 'over' ? 'var(--danger)' : w.level === 'high' ? 'var(--warn)' : 'var(--fg-3)' } }, `${w.load}%`)
                  ),
                  bar(w.load, w.level === 'over' ? 'danger' : w.level === 'high' ? 'warn' : 'ok')
                )
              )
            )
          : empty({ art: '👥', title: '暂无团队数据' })
      )
    )
  );
  root.appendChild(bottom);

  if (d.teamProjects?.length) {
    root.appendChild(el('div', { class: 'label mt-5 mb-2' }, '团队进行中的项目'));
    root.appendChild(el('div', { class: 'grid grid-auto-lg' }, ...d.teamProjects.slice(0, 4).map((p) => projectCard(p))));
  }
}

function suggestionAction(x) {
  const map = {
    'view-overdue': '/tasks?overdue=1',
    'view-blocked': '/tasks?blocked=1',
    'view-no-estimate': '/tasks?scope=mine',
    'view-stale': '/tasks?scope=mine&sort=updated',
  };
  if (map[x.action]) navigate(map[x.action]);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/* ==================== 今日 ==================== */
export async function todayView(root) {
  const t = today();
  const [cal, tasks, week] = await Promise.all([
    api.get(`/api/calendar?from=${t}&days=1`),
    api.get('/api/tasks?scope=mine&open=1&sort=due'),
    api.get('/api/review/weekly'),
  ]);
  root.innerHTML = '';

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, '今日'), el('div', { class: 'sub' }, fmtDate(t, 'full'))),
      el('div', { class: 'actions' }, el('button', { class: 'btn', onClick: () => navigate('/calendar') }, '📅 日历'))
    )
  );

  const qa = quickAddBar();
  attachParsePreview(qa._input, qa.querySelector('.hintline'));
  root.appendChild(el('div', { class: 'mb-4' }, qa));

  const overdue = tasks.tasks.filter((x) => x.overdue);
  const dueToday = tasks.tasks.filter((x) => !x.overdue && String(x.dueAt || '').slice(0, 10) === t);
  const upcoming = tasks.tasks.filter((x) => !x.overdue && String(x.dueAt || '').slice(0, 10) > t).slice(0, 12);
  const noDate = tasks.tasks.filter((x) => !x.dueAt).slice(0, 12);
  const ms = cal.milestones || [];

  root.appendChild(
    el(
      'div',
      { class: 'grid grid-4 mb-4' },
      statTile({ label: '今日到期', value: dueToday.length, icon: '📌', color: 'var(--c-blue)' }),
      statTile({ label: '已逾期', value: overdue.length, icon: '⚠️', color: overdue.length ? 'var(--danger)' : 'var(--fg-3)' }),
      statTile({ label: '日程', value: cal.events.length, icon: '🗓', color: 'var(--c-purple)' }),
      statTile({ label: '本周完成', value: week.doneCount, icon: '✅', color: 'var(--ok)', meta: `${week.doneHours}h` })
    )
  );

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const left = el('div', { class: 'stack' });
  left.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🕘 日程'), el('span', { class: 'badge' }, `${cal.events.length}`)),
      el(
        'div',
        { class: 'card-body' },
        cal.events.length
          ? el(
              'div',
              { class: 'timeline' },
              ...cal.events.map((e) => {
                const t2 = fmtTime(e.startAt || e.dueAt);
                const [hh, mm] = (t2 || '0:0').split(':').map(Number);
                const s = (hh || 0) * 60 + (mm || 0);
                const past = s + 60 < nowMin;
                const cur = s <= nowMin && nowMin <= s + 60;
                return el(
                  'div',
                  { class: `tl-item ${cur ? 'accent' : ''}` },
                  el(
                    'div',
                    { class: 'row gap-2' },
                    el('span', { class: 'tl-time' }, t2),
                    el('span', { class: `strong truncate ${past ? 'muted' : ''}` }, e.title),
                    cur && el('span', { class: 'badge accent' }, '进行中')
                  ),
                  e.location && el('div', { class: 'fs-xs muted' }, e.location),
                  el('div', { class: 'row-tight mt-1' }, el('button', { class: 'btn btn-sm btn-ghost', onClick: () => openTaskDrawer(e.id) }, '详情'), el('button', { class: 'btn btn-sm btn-ghost', onClick: async () => { await api.post(`/api/tasks/${e.id}/toggle`, { completed: true }); bust('tasks'); bus.emit('tasks:refresh'); toast('已标记完成', { type: 'ok' }); } }, '已完成'))
                );
              })
            )
          : empty({ art: '📭', title: '今天没有日程', desc: '在日历或上方输入框添加。' })
      )
    )
  );

  if (ms.length) {
    left.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '🚩 里程碑')),
        el(
          'div',
          { class: 'card-body stack-sm' },
          ...ms.map((m) =>
            el(
              'div',
              { class: 'row gap-2 pointer', onClick: () => navigate(`/projects/${m.projectId}`) },
              el('span', { class: 'pt-dot', style: { background: m.projectColor } }),
              el('span', { class: 'flex1 truncate fs-sm' }, m.name),
              el('span', { class: 'fs-xs muted' }, m.projectName)
            )
          )
        )
      )
    );
  }

  const right = el('div', { class: 'stack' });
  const section = (title, list, opts = {}) =>
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, title), list.length ? el('span', { class: 'badge' }, `${list.length}`) : null),
      el(
        'div',
        { class: 'card-body' },
        list.length ? el('div', { class: 'stack-sm' }, ...list.map((x) => taskRow(x, opts))) : empty({ art: opts.emptyArt || '✨', title: opts.emptyTitle || '这里是空的', desc: opts.emptyDesc || '' })
      )
    );

  right.appendChild(section('⚠️ 逾期', overdue, { emptyTitle: '没有逾期', emptyDesc: '保持住！', emptyArt: '🎉' }));
  right.appendChild(section('📌 今天到期', dueToday, { emptyTitle: '今天没有到期任务' }));
  if (upcoming.length) right.appendChild(section('📆 接下来', upcoming));
  if (noDate.length) right.appendChild(section('🗂 未安排日期', noDate, { emptyTitle: '全部任务都有日期' }));

  const grid = el('div', { class: 'split' });
  grid.appendChild(left);
  grid.appendChild(right);
  root.appendChild(grid);
}

/* ==================== 日历 ==================== */
let calState = { mode: 'week', anchor: dstr() };

export async function calendarView(root) {
  root.innerHTML = '';
  let view = new URLSearchParams(location.hash.split('?')[1] || '').get('view') || calState.mode;
  const anchor = new URLSearchParams(location.hash.split('?')[1] || '').get('date') || calState.anchor;
  calState = { mode: view, anchor };

  const nav = el('div', { class: 'row gap-2' });
  const container = el('div', {});

  const days = view === 'month' ? 42 : view === 'week' ? 7 : 1;
  const from = view === 'week' ? startOfWeek(anchor) : view === 'month' ? monthStart(anchor) : anchor;
  const data = await api.get(`/api/calendar?from=${from}&days=${days}`);

  const rangeLabel =
    view === 'month'
      ? `${new Date(from).getFullYear()} 年 ${new Date(from).getMonth() + 1} 月`
      : view === 'week'
        ? `${fmtDate(from, 'md')} ~ ${fmtDate(addDays(from, 6), 'md')}`
        : fmtDate(anchor, 'full');

  nav.appendChild(
    segmented(
      [
        { value: 'day', label: '日' },
        { value: 'week', label: '周' },
        { value: 'month', label: '月' },
      ],
      view,
      (v) => {
        calState.mode = v;
        navigate(`/calendar?view=${v}&date=${anchor}`);
        calendarView(root);
      }
    )
  );
  nav.appendChild(el('button', { class: 'btn btn-sm', onClick: () => shift(-1) }, '‹'));
  nav.appendChild(el('button', { class: 'btn btn-sm', onClick: () => { calState.anchor = today(); navigate(`/calendar?view=${view}&date=${today()}`); calendarView(root); } }, '今天'));
  nav.appendChild(el('button', { class: 'btn btn-sm', onClick: () => shift(1) }, '›'));

  function shift(dir) {
    const step = view === 'month' ? 30 : view === 'week' ? 7 : 1;
    calState.anchor = addDays(anchor, step * dir);
    navigate(`/calendar?view=${view}&date=${calState.anchor}`);
    calendarView(root);
  }

  const evCount = data.events.length + data.tasks.length;
  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, '📅 日程'), el('div', { class: 'sub' }, `${rangeLabel} · ${evCount} 项`)),
      el('div', { class: 'actions' }, nav, el('button', { class: 'btn btn-primary btn-sm', onClick: () => newEvent(from) }, '+ 新建日程'))
    )
  );

  if (!data.events.length && !data.tasks.length && !data.milestones.length) {
    container.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-body' }, empty({
          art: '🗓',
          title: '这段时间还没有安排',
          desc: '点「新建日程」添加会议、提醒；或在上方输入框用一句话创建任务，例如「下周三下午2点 评审」。',
          action: el('button', { class: 'btn btn-primary mt-2', onClick: () => newEvent(from) }, '新建日程'),
        }))
      )
    );
  } else if (view === 'month') container.appendChild(monthGrid(data, from));
  else if (view === 'week') container.appendChild(weekGrid(data, from));
  else container.appendChild(dayGrid(data, anchor));

  root.appendChild(container);
}

function monthStart(d) {
  const dt = new Date(d);
  dt.setDate(1);
  const diff = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - diff);
  return dstr(dt);
}

function indexByDay(list) {
  const map = new Map();
  for (const it of list) {
    const d = String(it.startAt || it.dueAt || it.dueDate || '').slice(0, 10);
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(it);
  }
  return map;
}

function monthGrid(data, from) {
  const t = today();
  const evBy = indexByDay([...data.events.map((e) => ({ ...e, _kind: 'event' })), ...data.tasks.map((x) => ({ ...x, _kind: 'task' })), ...data.milestones.map((m) => ({ ...m, _kind: 'ms', startAt: m.dueDate }))]);
  const grid = el('div', { class: 'cal' });
  grid.appendChild(el('div', { class: 'cal-head' }, ...['一', '二', '三', '四', '五', '六', '日'].map((d) => el('div', {}, `周${d}`))));
  const cells = el('div', { class: 'cal-grid' });
  for (let i = 0; i < 42; i++) {
    const d = addDays(from, i);
    const items = evBy.get(d) || [];
    const dt = new Date(d);
    const cell = el(
      'div',
      {
        class: `cal-cell ${d === t ? 'today' : ''} ${dt.getDay() === 0 || dt.getDay() === 6 ? 'weekend' : ''} ${d.slice(0, 7) !== from.slice(0, 7) ? 'out' : ''}`,
        onClick: (e) => {
          if (e.target.closest('.cal-ev')) return;
          newEvent(d);
        },
        onDragover: (e) => {
          e.preventDefault();
          cell.classList.add('drop');
        },
        onDragleave: () => cell.classList.remove('drop'),
        onDrop: async (e) => {
          e.preventDefault();
          cell.classList.remove('drop');
          const id = e.dataTransfer.getData('text/task-id');
          if (!id) return;
          await api.patch(`/api/tasks/${id}`, { dueAt: d });
          bust('tasks');
          bus.emit('tasks:refresh');
          toast(`已移到 ${fmtDate(d, 'md')}`, { type: 'ok' });
        },
      },
      el('div', { class: 'cal-num' }, String(dt.getDate()), d === t && el('span', { class: 'today-pill' }, '今天')),
      ...items.slice(0, 3).map((it) => evChip(it)),
      items.length > 3 && el('div', { class: 'cal-more' }, `+${items.length - 3} 更多`)
    );
    cells.appendChild(cell);
  }
  grid.appendChild(cells);
  return grid;
}

function evChip(it) {
  const isEv = it._kind === 'event' || it.kind === 'event';
  const isMs = it._kind === 'ms';
  return el(
    'div',
    {
      class: `cal-ev ${isMs ? 'ms' : isEv ? 'event' : ''} ${it.overdue ? 'overdue' : ''} ${it.status === 'done' ? 'done' : ''}`,
      draggable: !isEv && !isMs,
      title: `${it.title}${it.projectName ? ' · ' + it.projectName : ''}`,
      onClick: (e) => {
        e.stopPropagation();
        if (isMs) navigate(`/projects/${it.projectId}`);
        else openTaskDrawer(it.id ?? it.realId);
      },
      onDragstart: (e) => {
        e.dataTransfer.setData('text/task-id', it.id);
        e.dataTransfer.effectAllowed = 'move';
      },
    },
    !isEv && !isMs && !it.all_day && fmtTime(it.startAt || it.dueAt) ? el('span', { class: 't' }, fmtTime(it.startAt || it.dueAt)) : null,
    el('span', { class: 't truncate' }, it.title)
  );
}

function weekGrid(data, from) {
  const t = today();
  const evBy = indexByDay(data.events);
  const taskBy = indexByDay(data.tasks);
  const msBy = indexByDay(data.milestones.map((m) => ({ ...m, startAt: m.dueDate })));
  const wrap = el('div', { class: 'card', style: { overflow: 'hidden' } });
  wrap.appendChild(
    el(
      'div',
      { class: 'cal-week-head' },
      el('div', {}),
      ...Array.from({ length: 7 }, (_, i) => {
        const d = addDays(from, i);
        const dt = new Date(d);
        return el(
          'div',
          { class: d === t ? 'today' : '' },
          el('div', { class: 'wd' }, `周${WD_S[dt.getDay()]}`),
          el('div', { class: 'dn' }, String(dt.getDate()))
        );
      })
    )
  );
  const grid = el('div', { class: 'cal-week' });
  grid.appendChild(el('div', {}));
  for (let i = 0; i < 7; i++) grid.appendChild(el('div', { class: 'slot', style: { minHeight: '40px' } }));
  for (let hh = 7; hh <= 21; hh++) {
    grid.appendChild(el('div', { class: 'hour-label' }, `${String(hh).padStart(2, '0')}:00`));
    for (let i = 0; i < 7; i++) {
      const d = addDays(from, i);
      const isNow = d === today() && new Date().getHours() === hh;
      const slot = el('div', {
        class: `slot ${isNow ? 'now' : ''}`,
        onClick: () => newEvent(d, String(hh).padStart(2, '0') + ':00'),
        onDragover: (e) => {
          e.preventDefault();
          slot.classList.add('drop');
        },
        onDragleave: () => slot.classList.remove('drop'),
        onDrop: async (e) => {
          e.preventDefault();
          slot.classList.remove('drop');
          const id = e.dataTransfer.getData('text/task-id');
          if (!id) return;
          const start = `${d}T${String(hh).padStart(2, '0')}:00`;
          const end = `${d}T${String(hh + 1).padStart(2, '0')}:00`;
          await api.patch(`/api/tasks/${id}`, { startAt: start, dueAt: end, allDay: false });
          bust('tasks');
          bus.emit('tasks:refresh');
          toast('已移动到该时段', { type: 'ok' });
        },
      });
      // 事件块
      for (const e of evBy.get(d) || []) {
        const tm = fmtTime(e.startAt || e.dueAt);
        const [hh2, mm2] = (tm || '00:00').split(':').map(Number);
        if (hh2 !== hh) continue;
        const endT = fmtTime(e.dueAt);
        const [eh, em] = (endT || '23:59').split(':').map(Number);
        const span = Math.max(1, eh * 60 + em - (hh2 * 60 + mm2));
        slot.appendChild(
          el(
            'div',
            {
              class: 'cal-day',
              style: { position: 'absolute', left: '3px', right: '4px', top: '1px', height: `${Math.min(span, 120) / 60 * 46 - 2}px`, zIndex: 3 },
            },
            el(
              'div',
              {
                class: 'ev-block',
                style: { position: 'static', height: '100%' },
                onClick: (ev) => { ev.stopPropagation(); openTaskDrawer(e.id); },
              },
              el('div', { class: 'truncate strong' }, e.title),
              e.location && el('div', { class: 'tm truncate' }, e.location)
            )
          )
        );
      }
      // 截止任务
      const dueToday = (taskBy.get(d) || []).filter((x) => !String(x.startAt || '').includes('T'));
      for (const x of dueToday) {
        slot.appendChild(
          el('div', { class: 'cal-ev overdue', style: { position: 'absolute', left: '3px', right: '4px', top: '2px', zIndex: 4 }, onClick: (ev) => { ev.stopPropagation(); openTaskDrawer(x.id); } }, el('span', { class: 't truncate' }, `⏳ ${x.title}`))
        );
      }
      for (const m of msBy.get(d) || []) {
        slot.appendChild(el('div', { class: 'cal-ev ms', style: { position: 'absolute', left: '3px', right: '4px', bottom: '1px', zIndex: 4 }, onClick: (ev) => { ev.stopPropagation(); navigate(`/projects/${m.projectId}`); } }, el('span', { class: 't truncate' }, `🚩 ${m.name}`)));
      }
      grid.appendChild(slot);
    }
  }
  wrap.appendChild(grid);
  return wrap;
}

function dayGrid(data, anchor) {
  const evBy = indexByDay(data.events);
  const taskBy = indexByDay(data.tasks);
  const wrap = el('div', { class: 'card', style: { overflow: 'hidden' } });
  const allDay = el('div', { class: 'cal-day', style: { gridTemplateColumns: '52px 1fr', borderTop: 'none' } });
  allDay.appendChild(el('div', { class: 'fs-xs muted', style: { padding: '8px 6px', textAlign: 'right' } }, '全天'));
  const adCol = el('div', { style: { padding: '6px', display: 'flex', flexDirection: 'column', gap: '3px', minHeight: '32px' } });
  for (const x of taskBy.get(anchor) || []) {
    adCol.appendChild(el('div', { class: `cal-ev ${x.overdue ? 'overdue' : ''} ${x.status === 'done' ? 'done' : ''}`, onClick: () => openTaskDrawer(x.id) }, el('span', { class: 't truncate' }, `📌 ${x.title}`)));
  }
  for (const m of data.milestones) {
    adCol.appendChild(el('div', { class: 'cal-ev ms', onClick: () => navigate(`/projects/${m.projectId}`) }, el('span', { class: 't truncate' }, `🚩 ${m.name}`)));
  }
  allDay.appendChild(adCol);
  wrap.appendChild(allDay);

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  for (let hh = 6; hh <= 23; hh++) {
    const row = el('div', { class: 'cal-day' });
    const isNow = anchor === today() && new Date().getHours() === hh;
    row.appendChild(el('div', { class: 'hour-label', style: isNow ? { color: 'var(--danger)', fontWeight: 700 } : null }, `${String(hh).padStart(2, '0')}:00`));
    const slot = el('div', {
      class: `slot ${isNow ? 'now' : ''}`,
      onClick: () => newEvent(anchor, `${String(hh).padStart(2, '0')}:00`),
      onDragover: (e) => { e.preventDefault(); slot.classList.add('drop'); },
      onDragleave: () => slot.classList.remove('drop'),
      onDrop: async (e) => {
        e.preventDefault();
        slot.classList.remove('drop');
        const id = e.dataTransfer.getData('text/task-id');
        if (!id) return;
        const start = `${anchor}T${String(hh).padStart(2, '0')}:00`;
        await api.patch(`/api/tasks/${id}`, { startAt: start, dueAt: `${anchor}T${String(hh + 1).padStart(2, '0')}:00`, allDay: false });
        bust('tasks');
        bus.emit('tasks:refresh');
        toast('已移动', { type: 'ok' });
      },
    });
    for (const e of evBy.get(anchor) || []) {
      const tm = fmtTime(e.startAt || e.dueAt);
      const [hh2, mm2] = (tm || '00:00').split(':').map(Number);
      if (hh2 !== hh) continue;
      const endT = fmtTime(e.dueAt);
      const [eh, em] = (endT || '23:00').split(':').map(Number);
      const spanMin = Math.max(30, eh * 60 + em - (hh2 * 60 + mm2));
      slot.appendChild(
        el(
          'div',
          {
            class: 'ev-block',
            style: { top: `${2 + (mm2 / 60) * 54}px`, height: `${(spanMin / 60) * 54 - 3}px` },
            onClick: (ev) => { ev.stopPropagation(); openTaskDrawer(e.id); },
          },
          el('div', { class: 'truncate strong' }, e.title),
          el('div', { class: 'tm truncate' }, `${tm}${e.location ? ' · ' + e.location : ''}`)
        )
      );
    }
    for (const x of taskBy.get(anchor) || []) {
      if (String(x.startAt || '').includes('T')) continue;
      slot.appendChild(
        el(
          'div',
          { class: `cal-ev ${x.overdue ? 'overdue' : ''} ${x.status === 'done' ? 'done' : ''}`, style: { position: 'absolute', left: '40px', right: '8px', bottom: '3px', zIndex: 4 }, onClick: (ev) => { ev.stopPropagation(); openTaskDrawer(x.id); } },
          el('span', { class: 't truncate' }, `📌 ${x.title}`)
        )
      );
    }
    row.appendChild(slot);
    wrap.appendChild(row);
  }
  return wrap;
}

function newEvent(date, time = '09:00') {
  navigate(`/tasks/new?date=${date}&time=${time}`);
}