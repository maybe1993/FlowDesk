// ui.js — 通用交互组件：任务卡片、任务编辑面板、项目卡、成员选择器、快捷添加
import {
  el,
  api,
  state,
  bus,
  toast,
  notifyOk,
  notifyErr,
  handleError,
  openModal,
  openDrawer,
  confirmDialog,
  openMenu,
  navigate,
  avatar,
  bar,
  prioDot,
  projectTag,
  PRIO,
  STATUS,
  HEALTH,
  fmtDate,
  fmtTime,
  relDate,
  fmtMinutes,
  fmtAgo,
  fmtHours,
  dstr,
  bust,
  segmented,
  selectEl,
  field,
  empty,
} from './core.js';

const today = () => dstr();

/* ================= 任务条目 ================= */
export function taskRow(task, opts = {}) {
  const {
    multiSelect = false,
    selected = false,
    showProject = true,
    showAssignee = false,
    onToggle,
    onOpen,
    compact = false,
  } = opts;

  const done = task.status === 'done';
  const canceled = task.status === 'cancelled';
  const row = el('div', {
    class: `task ${multiSelect ? 'checkable' : ''} ${done ? 'done' : ''} ${
      task.overdue ? 'overdue' : task.dueSoon ? 'soon' : ''
    } ${task.blocked ? 'blocked' : ''} ${selected ? 'selected' : ''}`,
    dataset: { id: task.id },
    tabindex: '0',
    onClick: (e) => {
      if (e.target.closest('.task-actions')) return;
      // Cmd/Shift 点行 = 多选；普通点击 = 打开详情
      if (multiSelect && (e.metaKey || e.ctrlKey || e.shiftKey)) {
        onToggle?.(task);
        return;
      }
      (onOpen || openTaskDrawer)(task.id);
    },
    onKeydown: (e) => {
      if (e.key === 'Enter') (onOpen || openTaskDrawer)(task.id);
      if (e.key === ' ' && multiSelect) {
        e.preventDefault();
        onToggle?.(task);
      }
    },
  });

  if (task.priority && task.priority !== 'med') {
    row.appendChild(el('span', { class: 'prio-stripe', style: { background: PRIO[task.priority].color } }));
  }

  // 行首勾选框 = 完成开关（单击即达，符合直觉）
  row.insertBefore(
    el(
      'button',
      {
        class: `tick ${done ? 'on' : ''}`,
        title: done ? '标记为未完成' : '标记为完成',
        style: canceled ? { opacity: 0.4 } : null,
        onClick: async (e) => {
          e.stopPropagation();
          if (canceled) return;
          await toggleDone(task, !done);
        },
      },
      done ? '✓' : ''
    ),
    row.firstChild
  );

  // 多选模式下，悬停时在左侧露出一个选择框
  if (multiSelect) {
    row.insertBefore(
      el('button', {
        class: `sel-box ${selected ? 'on' : ''}`,
        title: '选择（批量操作）',
        onClick: (e) => {
          e.stopPropagation();
          onToggle?.(task);
        },
      }, selected ? '✓' : ''),
      row.firstChild
    );
  }

  const meta = el('div', { class: 'task-meta' });
  if (showProject && task.projectName) meta.appendChild(projectTag(task));
  if (showAssignee && task.assignee) meta.appendChild(el('span', { class: 'row-tight' }, avatar(task.assignee, 'sm'), el('span', {}, task.assignee.name)));
  if (task.dueAt && !isNaN(Date.parse(task.dueAt))) {
    meta.appendChild(
      el(
        'span',
        {
          class: task.overdue ? 'strong' : '',
          style: task.overdue ? { color: 'var(--danger)' } : task.dueSoon ? { color: 'var(--warn)' } : null,
        },
        `${task.overdue ? '⚠️ ' : ''}${relDate(task.dueAt)}${fmtTime(task.dueAt) ? ' ' + fmtTime(task.dueAt) : ''}`
      )
    );
  }
  if (!compact) {
    if (task.status !== 'todo' && task.status !== 'doing')
      meta.appendChild(el('span', { class: 'badge' }, STATUS[task.status]?.label));
    if (task.pinned) meta.appendChild(el('span', { title: '重点关注' }, '📌'));
    if (task.blocked) meta.appendChild(el('span', { class: 'badge', style: { background: 'var(--accent-soft)', color: 'var(--c-purple)' } }, '受阻'));
    if (task.estimateHours) meta.appendChild(el('span', {}, `预估 ${fmtHours(task.estimateHours)}`));
    if (task.actualHours) meta.appendChild(el('span', {}, `已投入 ${fmtHours(task.actualHours)}`));
    if (task.childStats?.total) meta.appendChild(el('span', {}, `子任务 ${task.childStats.done}/${task.childStats.total}`));
    const tagList = Array.isArray(task.tags) ? task.tags : [];
    for (const t of tagList) if (t) meta.appendChild(el('span', { class: 'badge outline' }, '#' + t));
  }

  const actions = el('div', { class: 'task-actions' });
  if (task.kind === 'event') {
    actions.appendChild(
      el('button', { class: 'icon-btn', title: '改期', onClick: (e) => { e.stopPropagation(); quickReschedule(task); } }, '📆')
    );
  }
  if (!done) {
    actions.appendChild(
      el('button', {
        class: 'icon-btn', title: '记工时',
        onClick: (e) => { e.stopPropagation(); openTimeLog(task); },
      }, '⏱')
    );
  }
  actions.appendChild(
    el('button', {
      class: 'icon-btn', title: '更多',
      onClick: (e) => { e.stopPropagation(); taskMenu(e.currentTarget, task); },
    }, '⋯')
  );
  row.appendChild(el('span', { class: 'flex1' }, el('div', { class: 'task-title' }, task.title), meta));
  row.appendChild(actions);
  return row;
}

export async function toggleDone(task, next) {
  try {
    await api.post(`/api/tasks/${task.id}/toggle`, { completed: next });
    bust('tasks');
    bus.emit('task:changed', { id: task.id, status: next ? 'done' : 'todo' });
    toast(next ? `已完成「${trunc(task.title)}」` : `已重新打开「${trunc(task.title)}」`, {
      type: next ? 'ok' : 'info',
      ms: 2400,
      undo: async () => {
        await api.post(`/api/tasks/${task.id}/toggle`, { completed: !next });
        bust('tasks');
        bus.emit('tasks:refresh');
        toast('已撤销', { type: 'info' });
      },
    });
  } catch (e) {
    handleError(e, '更新失败');
  }
}

const trunc = (s, n = 18) => (String(s).length > n ? String(s).slice(0, n) + '…' : String(s));

export function taskMenu(anchor, task) {
  const items = [
    { label: '编辑', icon: '✏️', onClick: () => openTaskDrawer(task.id) },
    { label: '记工时', icon: '⏱', onClick: () => openTimeLog(task) },
    {
      label: task.pinned ? '取消重点关注' : '标为重点关注',
      icon: '📌',
      onClick: async () => {
        await api.patch(`/api/tasks/${task.id}`, { pinned: !task.pinned });
        bust('tasks');
        bus.emit('tasks:refresh');
        toast(task.pinned ? '已取消标星' : '已标星', { type: 'ok' });
      },
    },
    {
      label: task.blocked ? '解除阻塞' : '标记为受阻',
      icon: '🚧',
      onClick: async () => {
        if (!task.blocked) {
          const reason = await promptText('标记受阻', '写清楚卡在哪里，下周的自动排期会把解阻塞排到最前面', '等待第三方接口回复');
          if (reason === null) return;
          await api.post(`/api/tasks/bulk`, { ids: [task.id], action: 'blocked', blocked: true, reason });
        } else {
          await api.post(`/api/tasks/bulk`, { ids: [task.id], action: 'blocked', blocked: false });
        }
        bust('tasks');
        bus.emit('tasks:refresh');
        toast(task.blocked ? '已解除阻塞' : '已标记受阻', { type: 'ok' });
      },
    },
    { type: 'sep' },
    {
      label: '调整到明天',
      icon: '→',
      onClick: () => shiftTask(task, 1),
    },
    {
      label: '调整到下周一',
      icon: '→',
      onClick: () => shiftTask(task, (8 - new Date().getDay()) % 7 || 7),
    },
    { label: '顺延一周', icon: '→', onClick: () => shiftTask(task, 7) },
    { type: 'sep' },
    {
      label: '复制为子任务',
      icon: '⎘',
      onClick: async () => {
        await api.post(`/api/tasks/${task.id}/duplicate`, {});
        bust('tasks');
        bus.emit('tasks:refresh');
        toast('已复制', { type: 'ok' });
      },
    },
    {
      label: '删除',
      icon: '🗑',
      danger: true,
      onClick: async () => {
        if (!(await confirmDialog({ title: '删除这个任务？', body: `「${task.title}」及其子任务、工时记录会被永久删除。`, confirmText: '删除', danger: true, icon: '🗑️' }))) return;
        await api.del(`/api/tasks/${task.id}`);
        bust('tasks');
        bus.emit('tasks:refresh');
        toast('已删除', { type: 'ok' });
      },
    },
  ];
  openMenu(anchor, items, { align: 'right' });
}

async function shiftTask(task, days) {
  const base = task.dueAt ? String(task.dueAt).slice(0, 10) : today();
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  const nd = dstr(d);
  const hasTime = task.dueAt && task.dueAt.length > 10;
  await api.patch(`/api/tasks/${task.id}`, { dueAt: hasTime ? `${nd}T${String(task.dueAt).slice(11, 16)}` : nd });
  bust('tasks');
  bus.emit('tasks:refresh');
  toast(`已移到 ${fmtDate(nd, 'md')}（${relDate(nd)}）`, { type: 'ok' });
}

function quickReschedule(task) {
  const dateInput = el('input', { type: 'date', class: 'input', value: String(task.dueAt || task.startAt || today()).slice(0, 10) });
  const timeInput = el('input', { type: 'time', class: 'input', value: fmtTime(task.dueAt) || '09:00' });
  openModal({
    title: '调整日程时间',
    icon: '📆',
    body: el(
      'div',
      { class: 'stack' },
      field('日期', dateInput, { required: true }),
      field('时间', timeInput)
    ),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => document.querySelector('.overlay .icon-btn')?.click() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          const v = `${dateInput.value}T${timeInput.value || '09:00'}`;
          await api.patch(`/api/tasks/${task.id}`, { startAt: v, dueAt: addHour(v), allDay: false });
          bust('tasks');
          bus.emit('tasks:refresh');
          document.querySelector('.overlay')?.remove();
          toast('已更新日程', { type: 'ok' });
        },
      }, '保存')
    ),
  });
}
const addHour = (s) => {
  const d = new Date(s.replace(' ', 'T'));
  d.setHours(d.getHours() + 1);
  return `${dstr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ================= 记工时 ================= */
export function openTimeLog(task) {
  let mins = 60;
  const preset = el(
    'div',
    { class: 'row gap-1' },
    ...[15, 30, 45, 60, 90, 120, 240].map((m) =>
      el(
        'button',
        {
          class: 'btn btn-sm',
          onClick: () => {
            mins = m;
            input.value = m;
            note.focus();
          },
        },
        fmtMinutes(m)
      )
    )
  );
  const input = el('input', { class: 'input', type: 'number', min: '1', max: '1440', value: '60', style: { width: '92px' } });
  const dateInput = el('input', { class: 'input', type: 'date', value: today() });
  const note = el('input', { class: 'input', placeholder: '这次做了什么？（可选）' });

  openModal({
    title: '记录工时',
    icon: '⏱',
    narrow: true,
    body: el(
      'div',
      { class: 'stack' },
      el('div', { class: 'strong' }, task.title),
      preset,
      el('div', { class: 'field-row' }, field('时长（分钟）', input), field('日期', dateInput)),
      field('备注', note),
      task.estimateHours
        ? el('div', { class: 'hint' }, `预估 ${fmtHours(task.estimateHours)}，已投入 ${fmtHours(task.actualHours)}。累计超过预估 1.5 倍会自动流转到「待验收」。`)
        : null
    ),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => document.querySelector('.overlay .icon-btn')?.click() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          const m = Number(input.value);
          if (!m || m <= 0) return notifyErr('请填写有效时长');
          try {
            await api.post('/api/work-logs', { taskId: task.id, minutes: m, note: note.value, date: dateInput.value });
            bust('tasks');
            bus.emit('tasks:refresh');
            document.querySelector('.overlay')?.remove();
            notifyOk(`已记录 ${fmtMinutes(m)}`);
          } catch (e) {
            handleError(e);
          }
        },
      }, '记录')
    ),
  });
}

/* ================= 任务编辑面板 ================= */
export async function openTaskDrawer(taskId) {
  let task;
  try {
    task = await api.get(`/api/tasks/${taskId}`);
  } catch (e) {
    return handleError(e, '加载任务失败');
  }
  const drawer = openDrawer({ title: task.title, wide: true, body: buildTaskForm(task), foot: buildFoot() });

  function buildFoot() {
    return el(
      'div',
      { style: { display: 'contents' } },
      el(
        'button',
        {
          class: 'btn btn-danger btn-sm',
          onClick: async () => {
            if (!(await confirmDialog({ title: '删除这个任务？', body: '子任务与工时记录会一并删除。', confirmText: '删除', danger: true, icon: '🗑️' }))) return;
            await api.del(`/api/tasks/${task.id}`);
            bust('tasks');
            bus.emit('tasks:refresh');
            drawer.close();
            toast('已删除', { type: 'ok' });
          },
        },
        '🗑 删除'
      ),
      el('span', { class: 'spacer', style: { flex: 1 } }),
      el('button', { class: 'btn', onClick: () => drawer.close() }, '关闭'),
      el('button', { class: 'btn btn-primary', onClick: save }, '保存')
    );
  }

  function buildTaskForm(t) {
    const f = {};
    f.title = el('input', { class: 'input', value: t.title });
    f.notes = el('textarea', { class: 'textarea', placeholder: '补充说明、验收标准、相关链接…' }, t.notes || '');
    f.status = selectEl(
      Object.entries(STATUS).map(([value, v]) => ({ value, label: v.label })),
      t.status,
      (v) => {
        t.status = v;
        f.status.value = v;
      }
    );
    f.priority = selectEl(
      Object.entries(PRIO).map(([value, v]) => ({ value, label: v.label })),
      t.priority,
      (v) => (t.priority = v)
    );
    f.due = el('input', { class: 'input', type: 'date', value: String(t.dueAt || '').slice(0, 10) });
    f.start = el('input', { class: 'input', type: 'date', value: String(t.startAt || '').slice(0, 10) });
    f.startTime = el('input', { class: 'input', type: 'time', value: fmtTime(t.startAt) });
    f.dueTime = el('input', { class: 'input', type: 'time', value: fmtTime(t.dueAt) });
    f.assignee = selectEl(
      [{ value: '', label: '（未指派）' }, ...state.users.map((u) => ({ value: u.id, label: u.name }))],
      t.assigneeId || '',
      (v) => (t.assigneeId = v ? Number(v) : null)
    );
    f.project = selectEl(
      [{ value: '', label: '（无项目）' }, ...(state.projectsCache || []).map((p) => ({ value: p.id, label: p.name }))],
      t.projectId || '',
      async (v) => {
        t.projectId = v ? Number(v) : null;
        // 切项目时自动继承该项目的团队归属
        const p = (state.projectsCache || []).find((x) => x.id === t.projectId);
        if (p?.teamId) {
          await api.patch(`/api/tasks/${t.id}`, { teamId: p.teamId });
        }
      }
    );
    f.estimate = el('input', { class: 'input', type: 'number', min: '0', step: '0.5', value: t.estimateHours || '' });
    f.location = el('input', { class: 'input', value: t.location || '', placeholder: '地点 / 会议链接' });
    f.tags = el('input', { class: 'input', value: (t.tags || []).join(', '), placeholder: '逗号分隔' });
    f.blocked = el('input', { type: 'checkbox', checked: !!t.blocked });
    f.blockedReason = el('input', { class: 'input', value: t.blockedReason || '', placeholder: '卡在哪里？' });

    const wrap = el(
      'div',
      { class: 'stack' },
      el('div', { class: 'row gap-2' }, el('span', { class: 'badge accent' }, t.kind === 'event' ? '日程' : '任务'), el('span', { class: 'muted fs-xs mono' }, `#${t.id}`)),
      field('标题', f.title, { required: true }),
      field('描述', f.notes),
      el('div', { class: 'field-row' }, field('状态', f.status), field('优先级', f.priority)),
      el('div', { class: 'field-row' }, field('负责人', f.assignee), field('所属项目', f.project)),
      el('div', { class: 'field-row' }, field('开始日期', f.start), field('截止日期', f.due)),
      el('div', { class: 'field-row' }, field('开始时间', f.startTime), field('截止时间', f.dueTime)),
      el('div', { class: 'field-row' }, field('预估工时（小时）', f.estimate), field('标签', f.tags)),
      field('地点', f.location),
      el(
        'label',
        { class: 'check' },
        f.blocked,
        el('span', {}, '当前被阻塞'),
        f.blockedReason
      ),
      t.children?.length
        ? el(
            'div',
            {},
            el('div', { class: 'label mb-2' }, `子任务（${t.children.filter((c) => c.status === 'done').length}/${t.children.length}）`),
            el(
              'div',
              { class: 'stack-sm' },
              ...t.children.map((c) => taskRow(c, { showProject: false }))
            )
          )
        : null,
      t.logs?.length
        ? el(
            'div',
            {},
            el('div', { class: 'label mb-2' }, '工时记录'),
            el(
              'div',
              { class: 'stack-sm' },
              ...t.logs.map((l) =>
                el(
                  'div',
                  { class: 'row spread fs-sm', style: { padding: '5px 0', borderBottom: '1px solid var(--border)' } },
                  el('span', {}, `${l.userName} · ${fmtDate(l.log_date, 'md')}`),
                  el('span', { class: 'row-tight' }, l.note && el('span', { class: 'muted' }, l.note), el('strong', {}, fmtMinutes(l.minutes)))
                )
              ),
              el('div', { class: 'spread fs-sm mt-2' }, el('span', { class: 'muted' }, '合计'), el('strong', {}, fmtHours(t.actualHours)))
            )
          )
        : null,
      t.related?.length
        ? el(
            'div',
            {},
            el('div', { class: 'label mb-2' }, '同项目其他任务'),
            el(
              'div',
              { class: 'stack-sm' },
              ...t.related.slice(0, 5).map((r) =>
                el(
                  'button',
                  { class: 'fs-sm truncate', style: { textAlign: 'left' }, onClick: () => { drawer.close(); openTaskDrawer(r.id); } },
                  `${STATUS[r.status]?.label || ''} · ${r.title}`
                )
              )
            )
          )
        : null
    );
    wrap._fields = f;
    return wrap;
  }

  async function save() {
    const f = drawer.body.querySelector('.stack')._fields;
    const title = f.title.value.trim();
    if (!title) return notifyErr('标题不能为空');
    const hasTime = f.startTime.value && f.dueTime.value;
    try {
      await api.patch(`/api/tasks/${task.id}`, {
        title,
        notes: f.notes.value,
        status: f.status.value,
        priority: f.priority.value,
        assigneeId: f.assignee.value ? Number(f.assignee.value) : null,
        projectId: f.project.value ? Number(f.project.value) : null,
        startAt: hasTime && f.start.value ? `${f.start.value}T${f.startTime.value}` : f.start.value || null,
        dueAt: hasTime && f.due.value ? `${f.due.value}T${f.dueTime.value}` : f.due.value || null,
        estimateHours: Number(f.estimate.value) || 0,
        location: f.location.value,
        tags: f.tags.value.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean),
        blocked: f.blocked.checked,
        blockedReason: f.blockReason?.value || f.blockedReason.value,
      });
      bust('tasks');
      bus.emit('tasks:refresh');
      drawer.close();
      notifyOk('已保存');
    } catch (e) {
      handleError(e, '保存失败');
    }
  }
}

/* ================= 快速添加（自然语言） ================= */
export function quickAddBar(opts = {}) {
  const { projectId = '', placeholder = '添加任务…试试「明天下午3点 评审 #发布 P1 2小时」', compact = false } = opts;
  const input = el('input', {
    placeholder,
    autocomplete: 'off',
    onKeydown: async (e) => {
      if (e.key === 'Enter') submit();
      if (e.key === 'Escape') input.value = '';
    },
  });
  const preview = el('div', { class: 'hintline hide' });

  async function submit() {
    const text = input.value.trim();
    if (!text) return;
    try {
      const parsed = await api.post('/api/tasks/parse', { text });
      const body = { title: text };
      if (parsed.dueAt) body.dueAt = parsed.dueAt;
      if (parsed.startAt) body.startAt = parsed.startAt;
      if (parsed.priority) body.priority = parsed.priority;
      if (parsed.tags?.length) body.tags = parsed.tags;
      if (parsed.estimateHours) body.estimateHours = parsed.estimateHours;
      if (parsed.blocked) {
        body.blocked = true;
        body.blockedReason = parsed.blockedReason;
      }
      if (parsed.repeat && parsed.repeat.kind !== 'none') body.repeat = parsed.repeat;
      if (projectId) body.projectId = Number(projectId);
      const r = await api.post('/api/tasks', body);
      input.value = '';
      preview.classList.add('hide');
      bust('tasks');
      bus.emit('tasks:refresh');
      const bits = [];
      if (parsed.dueAt) bits.push(fmtDate(parsed.dueAt, 'rel'));
      if (parsed.priority) bits.push(PRIO[parsed.priority].label + '优先级');
      if (parsed.repeat) bits.push(`重复 ${parsed.repeat.kind}`);
      toast(`已创建「${trunc(r.task.title)}」${bits.length ? ' · ' + bits.join(' · ') : ''}`, { type: 'ok', ms: 2800 });
    } catch (e) {
      handleError(e, '创建失败');
    }
  }

  const barEl = el(
    'div',
    {},
    el(
      'div',
      { class: 'quick-add' },
      el('span', { class: 'ico' }, '✚'),
      input,
      el('button', { class: 'btn btn-primary btn-sm', onClick: submit }, '添加')
    ),
    preview
  );
  barEl._input = input;
  return barEl;
}

/** 输入时的实时解析预览 */
export function attachParsePreview(input, previewEl) {
  let timer;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const text = input.value.trim();
    if (text.length < 3) return previewEl.classList.add('hide');
    timer = setTimeout(async () => {
      try {
        const p = await api.post('/api/tasks/parse', { text });
        const bits = [];
        if (p.dueAt) bits.push(`📅 ${fmtDate(p.dueAt, 'rel')}${p.allDay ? '' : ' ' + fmtTime(p.dueAt)}`);
        if (p.priority) bits.push(`${PRIO[p.priority].label}优先级`);
        if (p.tags.length) bits.push('#' + p.tags.join(' #'));
        if (p.estimateHours) bits.push(`⏱ ${p.estimateHours}h`);
        if (p.repeat) bits.push(`🔁 ${p.repeat.kind}`);
        if (p.blocked) bits.push('🚧 受阻');
        previewEl.innerHTML = bits.length
          ? `识别到 → ${bits.map((b) => `<b>${b}</b>`).join('  ')}`
          : '未识别到时间/优先级，将创建为普通任务';
        previewEl.classList.remove('hide');
      } catch {
        previewEl.classList.add('hide');
      }
    }, 280);
  });
}

/* ================= 项目卡片 ================= */
export function projectCard(p, opts = {}) {
  const health = HEALTH[p.healthAuto || p.health] || HEALTH.good;
  const left = p.metrics?.daysLeft;
  const card = el(
    'div',
    {
      class: 'card',
      style: { cursor: 'pointer' },
      onClick: () => navigate(opts.base || '/projects') + `/${p.id}`,
      onKeydown: (e) => e.key === 'Enter' && navigate((opts.base || '/projects') + `/${p.id}`),
      tabindex: '0',
    },
    el(
      'div',
      { class: 'card-body', style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
      el(
        'div',
        { class: 'spread' },
        el(
          'div',
          { class: 'row-tight flex1' },
          el('span', { class: 'pt-dot', style: { background: p.color, width: '9px', height: '9px', borderRadius: '3px' } }),
          el('span', { class: 'strong truncate', title: p.name }, p.name),
          p.starred && el('span', {}, '⭐')
        ),
        el(
          'button',
          {
            class: 'icon-btn',
            title: '更多',
            onClick: (e) => {
              e.stopPropagation();
              openMenu(
                e.currentTarget,
                [
                  { label: p.archived ? '取消归档' : '归档项目', icon: '📦', onClick: async () => { await api.del(`/api/projects/${p.id}`); bust('projects'); bus.emit('tasks:refresh'); toast('已归档', { type: 'ok' }); } },
                  { label: p.starred ? '取消星标' : '加星标', icon: '⭐', onClick: async () => { await api.post(`/api/projects/${p.id}/star`, {}); bust('projects'); bus.emit('tasks:refresh'); } },
                  { label: '重算健康度', icon: '🩺', onClick: async () => { const r = await api.post(`/api/projects/${p.id}/recompute-health`, {}); bust('projects'); bus.emit('tasks:refresh'); toast(`健康度：${HEALTH[r.health]?.label}`, { type: 'ok' }); } },
                  { type: 'sep' },
                  { label: '编辑项目', icon: '✏️', onClick: () => navigate(`/projects/${p.id}`) },
                ],
                { align: 'right' }
              );
            },
          },
          '⋯'
        )
      ),
      el(
        'div',
        { class: 'row gap-2' },
        el('span', { class: `badge ${health.cls}` }, health.label),
        el('span', { class: 'badge' }, PSTATUS_LABEL[p.status] || p.status),
        p.priority !== 'med' && el('span', { class: 'badge outline' }, `${PRIO[p.priority].label}优先`),
        p.teamName && el('span', { class: 'badge outline' }, p.teamName),
        (p.kind === 'personal') && el('span', { class: 'badge outline' }, '个人')
      ),
      el(
        'div',
        {},
        el(
          'div',
          { class: 'spread fs-xs muted mb-2' },
          el('span', {}, `${p.metrics.done}/${p.metrics.total} 任务`),
          el('span', { class: 'tnum strong', style: { color: 'var(--fg)' } }, `${p.progress}%`)
        ),
        bar(p.progress, p.progress >= 100 ? 'ok' : p.progress < 35 ? 'warn' : '')
      ),
      p.nextMilestone &&
        el(
          'div',
          { class: 'row-tight fs-xs muted truncate' },
          '🚩',
          el('span', { class: 'truncate' }, p.nextMilestone.name),
          el('span', { class: 'nowrap' }, p.nextMilestone.dueDate ? relDate(p.nextMilestone.dueDate) : '')
        ),
      el(
        'div',
        { class: 'spread fs-xs muted' },
        el(
          'span',
          {},
          p.owner ? `👤 ${p.owner.name}` : '',
          p.metrics.overdue > 0 ? el('span', { style: { color: 'var(--danger)', marginLeft: '6px' } }, `⚠ ${p.metrics.overdue} 逾期`) : null
        ),
        el('span', {}, left != null ? (left < 0 ? `已超期 ${-left} 天` : `剩 ${left} 天`) : '')
      )
    )
  );
  return card;
}
const PSTATUS_LABEL = { planning: '规划中', active: '进行中', paused: '已暂停', done: '已完成', cancelled: '已取消' };

/* ================= 成员选择 ================= */
export function userPicker(anchor, selectedIds, onChange, { multi = true } = {}) {
  const chosen = new Set(selectedIds || []);
  const rows = state.users.map((u) => {
    const cb = el('input', { type: multi ? 'checkbox' : 'radio', checked: chosen.has(u.id), name: 'fp' });
    const row = el(
      'label',
      {
        class: 'row gap-2',
        style: { padding: '4px 2px', cursor: 'pointer' },
        onClick: (e) => {
          e.preventDefault();
          if (multi) {
            chosen.has(u.id) ? chosen.delete(u.id) : chosen.add(u.id);
            cb.checked = chosen.has(u.id);
          } else {
            onChange?.([u.id]);
            document.querySelector('.overlay')?.remove();
            return;
          }
          onChange?.([...chosen]);
        },
      },
      cb,
      avatar(u, 'sm'),
      el('span', { class: 'flex1 truncate' }, u.name),
      el('span', { class: 'muted fs-xs truncate' }, u.title || '')
    );
    return row;
  });
  openModal({
    title: multi ? '选择成员' : '选择一位成员',
    narrow: true,
    body: el(
      'div',
      { class: 'stack-sm' },
      ...rows,
      multi && el('button', { class: 'btn btn-sm mt-2', onClick: () => onChange?.([]) }, '清空选择')
    ),
  });
}

/* ================= 输入文本弹窗 ================= */
export function promptText(title, hint, defaultValue = '', placeholder = '') {
  return new Promise((resolve) => {
    const input = el('input', { class: 'input', value: defaultValue, placeholder });
    let closed = false;
    const done = (v) => {
      if (closed) return;
      closed = true;
      document.querySelector('.overlay')?.remove();
      resolve(v);
    };
    const m = openModal({
      title,
      narrow: true,
      body: el('div', { class: 'stack' }, hint && el('div', { class: 'hint' }, hint), input),
      foot: el(
        'div',
        { style: { display: 'contents' } },
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onClick: () => done(null) }, '取消'),
        el('button', { class: 'btn btn-primary', onClick: () => done(input.value.trim()) }, '确定')
      ),
      onClose: () => done(null),
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
    });
  });
}