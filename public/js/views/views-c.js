// views-c.js — 项目列表、项目详情、里程碑管理
import {
  el, api, state, bus, navigate, toast, notifyOk, notifyErr, handleError, confirmDialog, openModal,
  avatar, bar, ring, empty, skeleton, statTile, segmented, selectEl, field, insightCard,
  barChart, sparkline, dstr, addDays, fmtDate, relDate, fmtHours, fmtAgo, PRIO, HEALTH, projectTag, bust,
} from '../core.js';
import { taskRow, openTaskDrawer, quickAddBar, attachParsePreview, projectCard, promptText } from '../ui.js';

const PSTATUS = { planning: '规划中', active: '进行中', paused: '已暂停', done: '已完成', cancelled: '已取消' };

export async function projectsView(root, params = {}, query = {}) {
  root.appendChild(skeleton(6));
  const [projects, scan] = await Promise.all([
    api.get('/api/projects' + (query.kind ? `?kind=${query.kind}` : '')),
    api.get('/api/projects-health-scan'),
  ]);
  state.projectsCache = projects;
  root.innerHTML = '';

  const filter = query.status || 'all';
  const list = filter === 'all' ? projects : projects.filter((p) => (filter === 'risk' ? (p.healthAuto || p.health) !== 'good' : p.status === filter));

  const stats = {
    active: projects.filter((p) => p.status === 'active').length,
    risk: projects.filter((p) => (p.healthAuto || p.health) !== 'good').length,
    overdueTasks: projects.reduce((a, p) => a + (p.metrics?.overdue || 0), 0),
    avgProgress: projects.length ? Math.round(projects.reduce((a, p) => a + p.progress, 0) / projects.length) : 0,
  };

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, '📂 项目'), el('div', { class: 'sub' }, `${projects.length} 个项目`)),
      el('div', { class: 'actions' }, el('button', { class: 'btn btn-primary', onClick: () => newProject() }, '+ 新建项目'))
    )
  );

  root.appendChild(
    el(
      'div',
      { class: 'grid grid-4 mb-4' },
      statTile({ label: '进行中', value: stats.active, icon: '🚀', color: 'var(--c-blue)' }),
      statTile({ label: '需关注 / 风险', value: stats.risk, icon: '🩺', color: stats.risk ? 'var(--warn)' : 'var(--fg-3)', onClick: () => { navigate('/projects?status=risk'); } }),
      statTile({ label: '逾期任务', value: stats.overdueTasks, icon: '⚠️', color: stats.overdueTasks ? 'var(--danger)' : 'var(--fg-3)' }),
      statTile({ label: '平均进度', value: stats.avgProgress, unit: '%', icon: '📊', color: 'var(--ok)' })
    )
  );

  // 健康巡检建议
  const risky = scan.filter((s) => s.healthAuto !== 'good').slice(0, 3);
  if (risky.length) {
    root.appendChild(
      el(
        'div',
        { class: 'stack-sm mb-4' },
        el('div', { class: 'label' }, '🩺 项目健康巡检'),
        ...risky.map((s) =>
          insightCard({
            level: s.healthAuto === 'at_risk' ? 'danger' : 'warn',
            title: `${s.name} — ${s.flags.join('、') || '节奏偏慢'}`,
            detail: s.action + (s.dueDate ? `（截止 ${fmtDate(s.dueDate, 'md')}，${s.daysLeft < 0 ? `已超期 ${-s.daysLeft} 天` : `剩 ${s.daysLeft} 天`}）` : ''),
            action: '打开',
            link: `#/projects/${s.id}`,
          })
        )
      )
    );
  }

  root.appendChild(
    el(
      'div',
      { class: 'row gap-2 mb-3' },
      ...[
        { v: 'all', l: '全部' },
        { v: 'active', l: '进行中' },
        { v: 'planning', l: '规划中' },
        { v: 'risk', l: '⚠️ 需关注' },
        { v: 'paused', l: '已暂停' },
        { v: 'done', l: '已完成' },
      ].map((f) =>
        el('button', { class: `chip ${filter === f.v ? 'active' : ''}`, onClick: () => navigate('/projects' + (f.v === 'all' ? '' : `?status=${f.v}`)) }, f.l)
      )
    )
  );

  if (!list.length) {
    root.appendChild(el('div', { class: 'card' }, el('div', { class: 'card-body' }, empty({ art: '📁', title: '还没有项目', desc: '把同一件事下的零散任务归到一个项目，进度和风险一眼看清。', action: el('button', { class: 'btn btn-primary mt-2', onClick: newProject }, '新建项目') }))));
    return;
  }

  root.appendChild(el('div', { class: 'grid grid-auto-lg' }, ...list.map((p) => projectCard(p))));
}

function newProject() {
  const f = {
    name: el('input', { class: 'input', placeholder: '项目名称' }),
    desc: el('textarea', { class: 'textarea', placeholder: '这个项目要达成什么？验收标准是什么？' }),
    team: selectEl([{ value: '', label: '（个人项目）' }, ...state.teams.map((t) => ({ value: t.id, label: t.name }))], '', (v) => (f.team.value = v)),
    owner: selectEl(state.users.map((u) => ({ value: u.id, label: u.name })), state.user.id, (v) => (f.owner.value = v)),
    priority: selectEl(Object.entries(PRIO).map(([v, s]) => ({ value: v, label: s.label })), 'med', (v) => (f.priority.value = v)),
    status: selectEl(Object.entries(PSTATUS).map(([v, s]) => ({ value: v, label: s })), 'active', (v) => (f.status.value = v)),
    start: el('input', { class: 'input', type: 'date', value: dstr() }),
    due: el('input', { class: 'input', type: 'date' }),
    budget: el('input', { class: 'input', type: 'number', placeholder: '可选', min: '0' }),
    tags: el('input', { class: 'input', placeholder: '逗号分隔' }),
  };
  const msList = el('div', { class: 'stack-sm' });
  const addMs = () => {
    const name = el('input', { class: 'input', placeholder: '里程碑名称' });
    const due = el('input', { class: 'input', type: 'date' });
    msList.appendChild(el('div', { class: 'row gap-2' }, el('div', { class: 'flex1' }, name), el('div', { style: { width: '160px' } }, due)));
  };
  addMs();
  const m = openModal({
    title: '新建项目',
    wide: true,
    icon: '📂',
    body: el(
      'div',
      { class: 'stack' },
      field('项目名称', f.name, { required: true }),
      field('描述', f.desc),
      el('div', { class: 'field-row' }, field('类型 / 团队', f.team), field('负责人', f.owner)),
      el('div', { class: 'field-row' }, field('优先级', f.priority), field('状态', f.status)),
      el('div', { class: 'field-row' }, field('开始日期', f.start), field('目标完成', f.due)),
      el('div', { class: 'field-row' }, field('预算工时', f.budget), field('标签', f.tags)),
      el('div', { class: 'label' }, '里程碑（可留空）'),
      msList,
      el('button', { class: 'btn btn-sm', onClick: addMs }, '+ 添加里程碑')
    ),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!f.name.value.trim()) return notifyErr('请填写项目名称');
          const ms = [...msList.querySelectorAll('.row')].map((r) => {
            const [n, d] = r.querySelectorAll('input');
            return n.value.trim() ? { name: n.value.trim(), dueDate: d.value || null } : null;
          }).filter(Boolean);
          const kind = f.team.value ? 'team' : 'personal';
          const r = await api.post('/api/projects', {
            name: f.name.value.trim(), description: f.desc.value, kind,
            teamId: f.team.value ? Number(f.team.value) : null,
            ownerId: Number(f.owner.value), priority: f.priority.value, status: f.status.value,
            startDate: f.start.value, dueDate: f.due.value || null,
            budgetHours: Number(f.budget.value) || null,
            tags: f.tags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            milestones: ms,
          });
          bust('projects');
          m.close();
          toast('项目已创建', { type: 'ok' });
          navigate(`/projects/${r.id}`);
        },
      }, '创建')
    ),
  });
}

/* ==================== 项目详情 ==================== */
export async function projectDetailView(root, params = {}) {
  root.appendChild(skeleton(8));
  const p = await api.get(`/api/projects/${params.id}`);
  root.innerHTML = '';
  state.projectsCache = state.projectsCache || [];

  const health = HEALTH[p.healthAuto || p.health] || HEALTH.good;
  const left = p.dueDate ? Math.round((new Date(p.dueDate) - new Date()) / 86400000) : null;

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        { class: 'titles' },
        el(
          'h1',
          {},
          el('span', { class: 'pt-dot', style: { background: p.color, width: '11px', height: '11px', borderRadius: '3px' } }),
          p.name,
          p.starred && el('span', {}, '⭐'),
          el('span', { class: `badge ${health.cls}` }, health.label)
        ),
        el('div', { class: 'sub' }, `${PSTATUS[p.status]}${p.key ? ' · ' + p.key : ''}${p.teamName ? ' · ' + p.teamName : ''}${p.owner ? ' · 负责人 ' + p.owner.name : ''}${left != null ? (left < 0 ? ` · 已超期 ${-left} 天` : ` · 剩 ${left} 天`) : ''}`),
        p.description && el('p', { class: 'muted fs-sm mt-2', style: { maxWidth: '720px' } }, p.description)
      ),
      el(
        'div',
        { class: 'actions' },
        el('button', { class: 'btn btn-sm', onClick: () => navigate('/projects') }, '← 返回'),
        el('button', { class: 'btn btn-sm', onClick: async () => { await api.post(`/api/projects/${p.id}/recompute-health`, {}); bust('projects'); toast(`健康度重算：${HEALTH[p.healthAuto]?.label}`, { type: 'ok' }); projectDetailView(root, params); } }, '🩺 重算健康'),
        el('button', { class: 'btn btn-sm', onClick: () => editProject(p, () => projectDetailView(root, params)) }, '✏️ 编辑'),
        el('button', { class: 'btn btn-sm btn-primary', onClick: () => navigate(`/tasks/new?projectId=${p.id}`) }, '+ 新任务')
      )
    )
  );

  const m = p.metrics;
  root.appendChild(
    el(
      'div',
      { class: 'grid grid-6 mb-4' },
      statTile({ label: '进度', value: p.progress, unit: '%', icon: '📊', color: p.color, meta: `${m.done}/${m.total} 任务` }),
      statTile({ label: '进行中', value: m.doing, icon: '⚡', color: 'var(--c-orange)' }),
      statTile({ label: '待验收', value: p.tasks.filter((t) => t.status === 'review').length, icon: '👀', color: 'var(--c-purple)' }),
      statTile({ label: '逾期', value: m.overdue, icon: '⚠️', color: m.overdue ? 'var(--danger)' : 'var(--fg-3)', onClick: () => navigate('/tasks?overdue=1') }),
      statTile({ label: '已投入', value: m.loggedHours, unit: 'h', icon: '⏱', color: 'var(--c-purple)', meta: p.budgetHours ? `预算 ${p.budgetHours}h（${Math.round((m.loggedHours / p.budgetHours) * 100)}%）` : '' }),
      statTile({ label: '里程碑', value: `${m.milestoneDone}/${m.milestoneTotal}`, icon: '🚩', color: 'var(--ok)' })
    )
  );

  const grid = el('div', { class: 'split' });

  // 左：任务 + 里程碑 + 趋势
  const tasksCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', {}, '📋 项目任务'),
      el('span', { class: 'badge' }, `${p.tasks.length}`),
      el('span', { style: { flex: 1 } }),
      segmented(
        [
          { value: 'open', label: '未完成' },
          { value: 'all', label: '全部' },
        ],
        'open',
        (v) => {
          const list = v === 'open' ? p.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled') : p.tasks;
          box.innerHTML = '';
          if (!list.length) box.appendChild(empty({ art: '✨', title: '没有任务' }));
          else for (const t of list) box.appendChild(taskRow(t, { showProject: false, showAssignee: true }));
        }
      )
    ),
    el('div', { class: 'card-body' })
  );
  const box = tasksCard.querySelector('.card-body');
  const openTasks = p.tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  if (!openTasks.length) box.appendChild(empty({ art: '✨', title: '所有任务都完成了', desc: '恭喜！' }));
  else for (const t of openTasks) box.appendChild(taskRow(t, { showProject: false, showAssignee: true }));

  const qa = quickAddBar({ projectId: String(p.id), placeholder: '为这个项目添加任务…' });
  attachParsePreview(qa._input, qa.querySelector('.hintline'));
  qa.addEventListener('click', () => setTimeout(() => projectDetailView(root, params), 300));
  tasksCard.querySelector('.card-head').after(qa);

  const leftCol = el('div', { class: 'stack' }, tasksCard);

  // 里程碑
  const msCard = el(
    'div',
    { class: 'card' },
    el(
      'div',
      { class: 'card-head' },
      el('h3', {}, '🚩 里程碑'),
      el('span', { class: 'badge' }, `${m.milestoneDone}/${m.milestoneTotal}`),
      el('span', { style: { flex: 1 } }),
      el('button', { class: 'btn btn-sm', onClick: () => addMilestone(p, () => projectDetailView(root, params)) }, '+ 里程碑')
    ),
    el('div', { class: 'card-body' })
  );
  const msBox = msCard.querySelector('.card-body');
  if (!p.milestones.length) msBox.appendChild(empty({ art: '🚩', title: '还没有里程碑', desc: '把大目标切成几个可验收的节点，进度更可控。' }));
  for (const ms of p.milestones) {
    const done = ms.status === 'done';
    const late = !done && ms.dueDate && ms.dueDate < dstr();
    msBox.appendChild(
      el(
        'div',
        { class: 'row gap-2', style: { padding: '7px 0', borderBottom: '1px solid var(--border)' } },
        el(
          'button',
          {
            class: `tick ${done ? 'on' : ''}`,
            style: done ? {} : late ? { borderColor: 'var(--danger)' } : {},
            onClick: async () => {
              await api.patch(`/api/milestones/${ms.id}`, { status: done ? 'doing' : 'done' });
              bust('projects');
              toast(done ? '已重开' : '里程碑完成 🎉', { type: 'ok' });
              projectDetailView(root, params);
            },
          },
          done ? '✓' : ''
        ),
        el(
          'div',
          { class: 'flex1' },
          el('div', { class: `fs-sm strong ${done ? 'muted' : ''}`, style: done ? { textDecoration: 'line-through' } : null }, ms.name),
          el('div', { class: 'fs-xs muted' }, ms.dueDate ? `${fmtDate(ms.dueDate, 'md')} · ${relDate(ms.dueDate)}` : '未设日期')
        ),
        late && el('span', { class: 'badge danger' }, '逾期'),
        el('button', {
          class: 'icon-btn',
          onClick: async () => {
            if (!(await confirmDialog({ title: '删除里程碑？', confirmText: '删除', danger: true, icon: '🚩' }))) return;
            await api.del(`/api/milestones/${ms.id}`);
            bust('projects');
            toast('已删除', { type: 'ok' });
            projectDetailView(root, params);
          },
        }, '🗑')
      )
    );
  }
  leftCol.appendChild(msCard);

  // 趋势
  if (p.weeklyTrend?.length) {
    leftCol.appendChild(
        el(
          'div',
          { class: 'card' },
          el('div', { class: 'card-head' }, el('h3', {}, '📈 近 8 天投入'), el('span', { class: 'badge' }, `${p.weeklyTrend.reduce((a, b) => a + b.hours, 0).toFixed(1)}h`)),
        el('div', { class: 'card-body' }, barChart(p.weeklyTrend.map((d) => ({ l: fmtDate(d.date, 'md'), v: d.hours, color: p.color })), { h: 110 }))
      )
    );
  }

  // 右栏
  const right = el('div', { class: 'stack' });
  right.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
        ring(p.progress, 110, 10, p.color),
        el('div', { class: 'strong' }, `${p.progress}%`),
        el('div', { class: 'muted fs-xs' }, `${m.done} / ${m.total} 任务完成`)
      )
    )
  );

  // 下一步
  right.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '👉 下一步')),
      el(
        'div',
        { class: 'card-body stack-sm' },
        p.nextStep
          ? el('div', { class: 'fs-sm pre' }, p.nextStep)
          : el('div', { class: 'fs-sm muted' }, '还没写下一步。写一句话，自动排期会优先推进它。'),
        el('button', {
          class: 'btn btn-sm',
          onClick: async () => {
            const v = await promptText('下一步是什么？', '一句话就够，自动排期会把它排到最前面', p.nextStep || '', '例如：完成核算引擎联调并通过 UAT');
            if (v === null) return;
            await api.patch(`/api/projects/${p.id}`, { nextStep: v });
            bust('projects');
            toast('已更新', { type: 'ok' });
            projectDetailView(root, params);
          },
        }, p.nextStep ? '✏️ 修改下一步' : '+ 写下一步')
      )
    )
  );

  // 风险
  right.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '⚠️ 风险与阻塞')),
      el(
        'div',
        { class: 'card-body stack-sm' },
        p.risks
          ? el('div', { class: 'fs-sm pre' }, p.risks)
          : el('div', { class: 'fs-sm muted' }, m.overdue > 0 ? `有 ${m.overdue} 项任务逾期` : '暂无记录'),
        el('button', {
          class: 'btn btn-sm',
          onClick: async () => {
            const v = await promptText('记录风险', '写清楚风险与应对措施', p.risks || '', '例如：第三方接口方排期不确定，可能延迟一周');
            if (v === null) return;
            await api.patch(`/api/projects/${p.id}`, { risks: v });
            bust('projects');
            toast('已更新', { type: 'ok' });
            projectDetailView(root, params);
          },
        }, p.risks ? '✏️ 修改' : '+ 记录风险')
      )
    )
  );

  // 成员
  if (p.members?.length) {
    right.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '👥 参与成员'), el('span', { class: 'badge' }, `${p.members.length}`)),
        el(
          'div',
          { class: 'card-body stack-sm' },
          ...p.members.map((u) =>
            el(
              'div',
              { class: 'row gap-2 pointer', onClick: () => navigate(`/team/${u.id}`) },
              avatar(u, 'sm'),
              el('div', { class: 'flex1' }, el('div', { class: 'fs-sm' }, u.name), el('div', { class: 'fs-xs muted' }, u.title || '')),
              el('span', { class: 'fs-xs muted' }, `${p.tasks.filter((t) => t.assigneeId === u.id && t.status !== 'done').length} 项在办`)
            )
          )
        )
      )
    );
  }

  // 工时明细
  if (p.logs?.length) {
    right.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '⏱ 近期工时'), el('span', { class: 'badge' }, `${m.loggedHours}h`)),
        el(
          'div',
          { class: 'card-body stack-sm scroll-y', style: { maxHeight: '280px' } },
          ...p.logs.slice(0, 20).map((l) =>
            el(
              'div',
              { class: 'spread fs-xs' },
              el('span', { class: 'truncate' }, `${l.userName} · ${l.note || '工时记录'}`),
              el('span', { class: 'muted nowrap' }, `${fmtDate(l.log_date, 'md')} ${fmtHours(l.minutes / 60)}`)
            )
          )
        )
      )
    );
  }

  // 活动
  if (p.activity?.length) {
    right.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '🕘 动态')),
        el('div', { class: 'card-body stack-sm' }, ...p.activity.slice(0, 10).map((a) =>
          el('div', { class: 'fs-xs muted' }, `${actionLabel(a.action)} · ${fmtAgo(a.createdAt)}`)
        ))
      )
    );
  }

  grid.appendChild(leftCol);
  grid.appendChild(right);
  root.appendChild(grid);
}

function actionLabel(a) {
  const map = {
    'project.create': '创建了项目', 'project.update': '更新了项目', 'project.status': '变更了项目状态',
    'task.create': '新建了任务', 'task.done': '完成了任务', 'task.delete': '删除了任务', 'log.time': '记录了工时',
  };
  return map[a] || a;
}

function addMilestone(p, after) {
  const name = el('input', { class: 'input', placeholder: '例如：UAT 验收通过' });
  const due = el('input', { class: 'input', type: 'date' });
  const m = openModal({
    title: '添加里程碑',
    narrow: true,
    body: el('div', { class: 'stack' }, field('名称', name, { required: true }), field('目标日期', due)),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!name.value.trim()) return notifyErr('请填写名称');
          await api.post(`/api/projects/${p.id}/milestones`, { name: name.value.trim(), dueDate: due.value || null });
          bust('projects');
          m.close();
          toast('已添加', { type: 'ok' });
          after?.();
        },
      }, '添加')
    ),
  });
}

function editProject(p, after) {
  const f = {
    name: el('input', { class: 'input', value: p.name }),
    desc: el('textarea', { class: 'textarea' }, p.description || ''),
    status: selectEl(Object.entries(PSTATUS).map(([v, s]) => ({ value: v, label: s })), p.status, (v) => (f.status.value = v)),
    priority: selectEl(Object.entries(PRIO).map(([v, s]) => ({ value: v, label: s.label })), p.priority, (v) => (f.priority.value = v)),
    owner: selectEl(state.users.map((u) => ({ value: u.id, label: u.name })), p.ownerId, (v) => (f.owner.value = v)),
    start: el('input', { class: 'input', type: 'date', value: p.startDate || '' }),
    due: el('input', { class: 'input', type: 'date', value: p.dueDate || '' }),
    budget: el('input', { class: 'input', type: 'number', value: p.budgetHours || '' }),
    color: el('input', { class: 'input', type: 'color', value: p.color || '#6366f1', style: { height: '34px', padding: '2px' } }),
  };
  const m = openModal({
    title: '编辑项目',
    wide: true,
    body: el(
      'div',
      { class: 'stack' },
      field('名称', f.name, { required: true }),
      field('描述', f.desc),
      el('div', { class: 'field-row' }, field('状态', f.status), field('优先级', f.priority)),
      el('div', { class: 'field-row' }, field('负责人', f.owner), field('颜色', f.color)),
      el('div', { class: 'field-row' }, field('开始日期', f.start), field('目标完成', f.due)),
      field('预算工时', f.budget)
    ),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          await api.patch(`/api/projects/${p.id}`, {
            name: f.name.value.trim(), description: f.desc.value, status: f.status.value,
            priority: f.priority.value, ownerId: Number(f.owner.value),
            startDate: f.start.value || null, dueDate: f.due.value || null,
            budgetHours: Number(f.budget.value) || null, color: f.color.value,
          });
          bust('projects');
          m.close();
          toast('已保存', { type: 'ok' });
          after?.();
        },
      }, '保存')
    ),
  });
}