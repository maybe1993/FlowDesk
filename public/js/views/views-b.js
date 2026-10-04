// views-b.js — 任务中心（列表/看板/分组）、新建任务
import {
  el, api, state, bus, navigate, toast, notifyOk, notifyErr, handleError, confirmDialog,
  openModal, avatar, bar, empty, skeleton, statTile, segmented, selectEl, field,
  dstr, addDays, startOfWeek, fmtDate, relDate, fmtHours, PRIO, STATUS, projectTag, bust, debounce,
} from '../core.js';
import { taskRow, openTaskDrawer, quickAddBar, attachParsePreview, taskMenu } from '../ui.js';

const today = () => dstr();
let sel = new Set();

export async function tasksView(root, params = {}, query = {}) {
  // 只有真正进入/切换筛选时才清空；内部交互不再重渲染本视图（否则选择会被清掉）
  sel = new Set();
  root.appendChild(skeleton(8));
  const mode = query.view || localStorage.getItem('fd-task-view') || 'list';
  localStorage.setItem('fd-task-view', mode);

  // 分页：默认每页 80 条，避免上千条任务一次性铺进 DOM
  const PAGE = 80;
  // 只有列表视图分页；看板/分组必须一次拿全，否则用户看不到被截断的任务
  const isList = mode === 'list';
  let offset = 0;
  const data = { tasks: [], total: 0 };
  const fetchPage = async (reset) => {
    if (reset) {
      offset = 0;
      data.tasks = [];
    }
    const qs = new URLSearchParams(buildQuery(query));
    if (isList) {
      qs.set('limit', String(PAGE));
      qs.set('offset', String(offset));
    } else {
      qs.set('limit', '2000');
    }
    const r = await api.get('/api/tasks?' + qs.toString());
    data.tasks.push(...r.tasks);
    data.total = r.total;
    offset += r.tasks.length;
    return r;
  };
  await fetchPage(true);
  const hasMore = isList && data.tasks.length < data.total;
  const capped = !isList && data.total > data.tasks.length;
  state.projectsCache = await api.get('/api/projects').catch(() => []);

  root.innerHTML = '';
  const filters = query;

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        { class: 'titles' },
        el('h1', {}, '📋 任务'),
        el('div', { class: 'sub' }, `${data.total} 项${filters.q ? ` · 搜索「${filters.q}」` : ''}`)
      ),
      el(
        'div',
        { class: 'actions' },
        segmented(
          [
            { value: 'list', label: '列表' },
            { value: 'board', label: '看板' },
            { value: 'group', label: '分组' },
          ],
          mode,
          (v) => {
            localStorage.setItem('fd-task-view', v);
            navigate('/tasks?' + new URLSearchParams({ ...filters, view: v }).toString());
          }
        ),
        el('button', { class: 'btn btn-sm', onClick: () => openFilterBar(root, query) }, '⚙️ 筛选'),
        el('button', { class: 'btn btn-primary', onClick: () => navigate('/tasks/new') }, '+ 新建任务')
      )
    )
  );

  // 快速筛选
  root.appendChild(
    el(
      'div',
      { class: 'row gap-2 mb-3' },
      ...[
        { k: 'scope', v: 'mine', l: '我的' },
        { k: 'scope', v: 'inbox', l: '指派给我' },
        { k: 'scope', v: 'today', l: '今天' },
        { k: 'scope', v: 'week', l: '本周' },
        { k: 'overdue', v: '1', l: '⚠️ 逾期' },
        { k: 'blocked', v: '1', l: '🚧 受阻' },
        { k: 'status', v: 'done', l: '已完成' },
        { k: 'status', v: 'backlog,todo', l: '未开始' },
      ].map((f) => {
        const active = String(filters[f.k] || '') === f.v;
        return el(
          'button',
          {
            class: `chip ${active ? 'active' : ''}`,
            onClick: () => {
              const next = { ...filters };
              if (active) delete next[f.k];
              else next[f.k] = f.v;
              delete next.view;
              navigate('/tasks?' + new URLSearchParams(next).toString());
              tasksView(root, params, next);
            },
          },
          f.l
        );
      })
    )
  );

  const qa = quickAddBar({ projectId: filters.projectId || '' });
  attachParsePreview(qa._input, qa.querySelector('.hintline'));
  root.appendChild(el('div', { class: 'mb-3' }, qa));

  const bulkBar = el('div', { class: 'hide' });
  const renderBulk = () => {
    bulkBar.innerHTML = '';
    if (!sel.size) {
      bulkBar.classList.add('hide');
      return;
    }
    bulkBar.classList.remove('hide');
    bulkBar.appendChild(
      el(
        'div',
        { class: 'card mb-3' },
        el(
          'div',
          { class: 'card-body tight row gap-2' },
          el('span', { class: 'strong' }, `已选 ${sel.size} 项`),
          el('button', { class: 'btn btn-sm', onClick: () => bulk('status', { status: 'doing' }) }, '→ 进行中'),
          el('button', { class: 'btn btn-sm', onClick: () => bulk('status', { status: 'done' }) }, '→ 已完成'),
          el('button', { class: 'btn btn-sm', onClick: () => bulk('priority', { priority: 'urgent' }) }, '优先级紧急'),
          el(
            'button',
            {
              class: 'btn btn-sm',
              onClick: () => {
                const p = prompt('统一设置截止日期（YYYY-MM-DD，留空清除）', '');
                if (p !== null) bulk('dueDate', { dueDate: p || null });
              },
            },
            '设截止日'
          ),
          el('button', { class: 'btn btn-sm', onClick: () => bulk('week', { weekStart: startOfWeek(addDays(today(), 7)) }) }, '排入下周'),
          el('span', { style: { flex: 1 } }),
          el('button', { class: 'btn btn-sm btn-ghost', onClick: () => { sel.clear(); renderBulk(); tasksView(root, params, filters); } }, '取消选择'),
          el('button', { class: 'btn btn-sm btn-danger', onClick: async () => { if (await confirmDialog({ title: `删除 ${sel.size} 个任务？`, body: '不可恢复。', danger: true, confirmText: '删除', icon: '🗑️' })) bulk('delete'); } }, '删除')
        )
      )
    );
  };
  root.appendChild(bulkBar);

  async function bulk(action, extra = {}) {
    try {
      const r = await api.post('/api/tasks/bulk', { ids: [...sel], action, ...extra });
      sel.clear();
      bust('tasks');
      bus.emit('tasks:refresh');
      toast(`已更新 ${r.affected} 项`, { type: 'ok' });
      tasksView(root, params, filters);
    } catch (e) {
      handleError(e, '批量操作失败');
    }
  }

  if (!data.tasks.length) {
    root.appendChild(
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-body' }, empty({
          art: '🎉',
          title: '这里没有任务',
          desc: '可以换个筛选条件，或者在上方用一句话创建新任务。',
          action: el('button', { class: 'btn btn-primary mt-2', onClick: () => navigate('/tasks/new') }, '新建任务'),
        }))
      )
    );
    return;
  }

  const onToggle = (t) => {
    if (sel.has(t.id)) sel.delete(t.id); else sel.add(t.id);
    // 原地更新高亮，保持滚动位置
    const rowEl = root.querySelector(`.task[data-id="${t.id}"]`);
    if (rowEl) {
      rowEl.classList.toggle('selected', sel.has(t.id));
      const box = rowEl.querySelector('.sel-box');
      if (box) { box.classList.toggle('on', sel.has(t.id)); box.textContent = sel.has(t.id) ? '✓' : ''; }
    }
    renderBulk();
  };

  if (mode === 'board') {
    root.appendChild(boardView(root, data.tasks));
    if (capped) {
      root.insertBefore(
        el('div', { class: 'hint', style: { marginTop: '12px' } }, `仅显示前 ${data.tasks.length} 项（共 ${data.total} 项）。想看全部请切到「列表」视图并使用筛选。`),
        root.firstChild
      );
    }
  } else if (mode === 'group') {
    root.appendChild(groupView(data.tasks, onToggle));
  } else {
    const hint = el(
      'div',
      { class: 'hint', style: { textAlign: 'center', padding: '10px 0 2px' } },
      '点击行首圆圈 = 标记完成（可撤销）· 按住 Cmd / Shift 点行 = 多选后批量操作'
    );
    const listBox = el('div', { class: 'stack-sm' });
    for (const t of data.tasks) listBox.appendChild(taskRow(t, { multiSelect: true, selected: sel.has(t.id), onToggle }));
    listBox.appendChild(hint);

    let sentinel = null;
    let loading = false;
    const loadMore = async () => {
      if (loading || !sentinel) return;
      loading = true;
      const before = data.tasks.length;
      sentinel.textContent = '加载中…';
      try {
        await fetchPage(false);
        const frag = document.createDocumentFragment();
        for (const t of data.tasks.slice(before)) frag.appendChild(taskRow(t, { multiSelect: true, onToggle }));
        listBox.insertBefore(frag, sentinel);
        const remaining = data.total - data.tasks.length;
        if (remaining > 0) {
          sentinel.textContent = `加载更多（还有 ${remaining} 项）`;
        } else {
          sentinel.remove();
          sentinel = null;
          const sub2 = root.querySelector('.page-head .sub');
          if (sub2) sub2.textContent = `${data.total} 项`;
        }
      } catch (e) {
        handleError(e, '加载更多失败');
        sentinel.textContent = '加载失败，点击重试';
      } finally {
        loading = false;
      }
    };

    if (hasMore) {
      sentinel = el('button', { class: 'btn btn-block mt-2' }, `加载更多（还有 ${data.total - data.tasks.length} 项）`);
      sentinel.addEventListener('click', loadMore);
      listBox.appendChild(sentinel);
    }
    root.appendChild(listBox);
  }
  renderBulk();
}

function buildQuery(q = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k === 'view' || v === '' || v == null) continue;
    p.set(k, v);
  }
  if (!p.get('open')) p.set('open', '1');
  return p.toString();
}

const COLS = [
  { key: 'backlog', label: '待规划', color: 'var(--fg-3)' },
  { key: 'todo', label: '待办', color: 'var(--c-blue)' },
  { key: 'doing', label: '进行中', color: 'var(--c-orange)' },
  { key: 'review', label: '待验收', color: 'var(--c-purple)' },
  { key: 'done', label: '已完成', color: 'var(--ok)' },
];

function boardView(root, tasks) {
  const board = el('div', { class: 'board' });
  for (const c of COLS) {
    const items = tasks.filter((t) => t.status === c.key);
    const body = el('div', { class: 'board-col-body' });
    const col = el(
      'div',
      { class: 'board-col', dataset: { status: c.key } },
      el(
        'div',
        { class: 'board-col-head' },
        el('span', { class: 'dot-prio', style: { background: c.color } }),
        el('span', { class: 'fs-sm strong' }, c.label),
        el('span', { class: 'n' }, String(items.length))
      ),
      body
    );
    for (const t of items) {
      const card = taskRow(t, { showAssignee: true, showProject: true });
      card.classList.add('board-card');
      card.draggable = true;
      card.dataset.taskId = t.id;
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/task-id', t.id);
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      body.appendChild(card);
    }
    body.appendChild(el('button', { class: 'board-add', onClick: () => navigate(`/tasks/new?status=${c.key}`) }, '+ 添加'));
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('dragover');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('dragover');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      const id = Number(e.dataTransfer.getData('text/task-id'));
      if (!id) return;
      const cardNode = root.querySelector(`.board-card[data-task-id="${id}"]`);
      if (!cardNode || cardNode.closest('.board-col') === col) return;
      const task = tasks.find((x) => x.id === id);

      // 1) 先本地移动 DOM，保持滚动位置与动画（不整页刷新）
      const after = [...body.querySelectorAll('.board-card')].find((n) => {
        const r = n.getBoundingClientRect();
        return e.clientY < r.top + r.height / 2;
      });
      body.insertBefore(cardNode, after || null);
      refreshCounts();
      cardNode.animate?.(
        [{ transform: 'scale(0.96)' }, { transform: 'scale(1)' }],
        { duration: 180, easing: 'cubic-bezier(.32,.72,0,1)' }
      );

      // 2) 再落库：状态 + 该列全部顺序
      const order = [...body.querySelectorAll('.board-card')].map((n, i) => ({
        id: Number(n.dataset.taskId),
        orderIndex: (i + 1) / 1000,
      }));
      try {
        await api.post('/api/tasks/reorder', {
          items: [{ id, status: c.key }, ...order],
        });
        if (task) task.status = c.key;
        bust('tasks');
        bus.emit('tasks:refresh');
        toast(`已移动到「${c.label}」`, { type: 'ok' });
      } catch (err) {
        handleError(err, '移动失败');
        tasksView(root, {}, parseHashSafe());
      }
    });
    board.appendChild(col);
  }
  function refreshCounts() {
    for (const c2 of board.querySelectorAll('.board-col')) {
      const n = c2.querySelectorAll('.board-card').length;
      const badge = c2.querySelector('.board-col-head .n');
      if (badge) badge.textContent = String(n);
    }
  }
  return board;
}

function parseHashSafe() {
  const [, q] = location.hash.split('?');
  return Object.fromEntries(new URLSearchParams(q || ''));
}

function groupView(tasks, onToggle) {
  const groups = new Map();
  for (const t of tasks) {
    const key = t.projectName || '未归类';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const wrap = el('div', { class: 'stack' });
  for (const [name, list] of groups) {
    const done = list.filter((t) => t.status === 'done').length;
    wrap.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('h3', {}, list[0]?.projectName ? list[0].projectName : name),
          el('span', { class: 'badge' }, `${done}/${list.length}`),
          el('span', { style: { flex: 1, maxWidth: '160px' } }, bar((done / list.length) * 100, done === list.length ? 'ok' : ''))
        ),
        el('div', { class: 'card-body stack-sm' }, ...list.map((t) => taskRow(t, { multiSelect: true, selected: sel.has(t.id), onToggle, showProject: false })))
      )
    );
  }
  return wrap;
}

function openFilterBar(root, query) {
  const next = { ...query };
  const projSel = selectEl([{ value: '', label: '全部项目' }, ...(state.projectsCache || []).map((p) => ({ value: p.id, label: p.name }))], query.projectId || '', (v) => (next.projectId = v));
  const asgSel = selectEl([{ value: '', label: '全部负责人' }, ...state.users.map((u) => ({ value: u.id, label: u.name }))], query.assigneeId || '', (v) => (next.assigneeId = v));
  const statusSel = selectEl([{ value: '', label: '全部状态' }, ...Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label }))], query.status || '', (v) => (next.status = v));
  const sortSel = selectEl([
    { value: 'due', label: '按截止日期' },
    { value: 'priority', label: '按优先级' },
    { value: 'created', label: '按创建时间' },
    { value: 'manual', label: '按手动排序' },
  ], query.sort || 'due', (v) => (next.sort = v));
  const search = el('input', { class: 'input', value: query.q || '', placeholder: '搜索标题、描述…' });

  const m = openModal({
    title: '筛选与排序',
    body: el(
      'div',
      { class: 'stack' },
      field('关键词', search),
      el('div', { class: 'field-row' }, field('项目', projSel), field('负责人', asgSel)),
      el('div', { class: 'field-row' }, field('状态', statusSel), field('排序', sortSel))
    ),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('button', { class: 'btn btn-ghost btn-sm', onClick: () => { next.projectId = ''; next.assigneeId = ''; next.status = ''; next.q = ''; m.close(); navigate('/tasks'); tasksView(root, {}, {}); } }, '清除全部'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: () => {
          if (search.value) next.q = search.value; else delete next.q;
          for (const k of ['projectId', 'assigneeId', 'status']) if (!next[k]) delete next[k];
          delete next.view;
          m.close();
          navigate('/tasks?' + new URLSearchParams(next).toString());
          tasksView(root, {}, next);
        },
      }, '应用')
    ),
  });
}

/* ==================== 新建任务 ==================== */
export async function newTaskView(root, params = {}, query = {}) {
  root.innerHTML = '';
  state.projectsCache = await api.get('/api/projects').catch(() => []);
  const pre = {
    date: query.date || today(),
    time: query.time || '',
    projectId: query.projectId || '',
    status: query.status || 'todo',
    kind: query.kind || 'task',
    assignee: query.assignee || String(state.user.id),
    title: query.title || '',
  };

  const f = {
    title: el('input', { class: 'input', placeholder: '要做什么？支持「明天下午3点 评审 #发布 P1 2小时」', value: pre.title }),
    notes: el('textarea', { class: 'textarea', placeholder: '补充说明、验收标准、链接…' }),
    project: selectEl([{ value: '', label: '（无项目）' }, ...(state.projectsCache || []).map((p) => ({ value: p.id, label: p.name }))], pre.projectId, (v) => (f.project.value = v)),
    assignee: selectEl(state.users.map((u) => ({ value: u.id, label: u.name })), pre.assignee, (v) => (f.assignee.value = v)),
    status: selectEl(Object.entries(STATUS).map(([v, s]) => ({ value: v, label: s.label })), pre.status, (v) => (f.status.value = v)),
    priority: selectEl(Object.entries(PRIO).map(([v, s]) => ({ value: v, label: s.label })), 'med', (v) => (f.priority.value = v)),
    start: el('input', { class: 'input', type: 'date', value: pre.date }),
    startTime: el('input', { class: 'input', type: 'time', value: pre.time }),
    due: el('input', { class: 'input', type: 'date' }),
    estimate: el('input', { class: 'input', type: 'number', min: '0', step: '0.5', placeholder: '0' }),
    location: el('input', { class: 'input', placeholder: '地点 / 会议链接' }),
    tags: el('input', { class: 'input', placeholder: '逗号分隔，如：发布, 后端' }),
  };
  const repeatSel = selectEl(
    [{ value: 'none', label: '不重复' }, { value: 'daily', label: '每天' }, { value: 'weekdays', label: '每个工作日' }, { value: 'weekly', label: '每周' }, { value: 'biweekly', label: '每两周' }, { value: 'monthly', label: '每月' }],
    'none', (v) => (repeatSel.value = v)
  );
  const preview = el('div', { class: 'hintline hide' });

  // 标题实时解析
  let timer;
  f.title.addEventListener('input', () => {
    clearTimeout(timer);
    const text = f.title.value.trim();
    if (text.length < 3) return preview.classList.add('hide');
    timer = setTimeout(async () => {
      const p = await api.post('/api/tasks/parse', { text });
      const bits = [];
      if (p.dueAt) {
        bits.push(`📅 ${fmtDate(p.dueAt, 'rel')}${p.allDay ? '' : ' ' + fmtTime(p.dueAt)}`);
        if (!f.due.value && p.allDay) f.due.value = String(p.dueAt).slice(0, 10);
        if (!f.startTime.value && !p.allDay) f.startTime.value = fmtTime(p.startAt);
      }
      if (p.priority) { f.priority.value = p.priority; bits.push(`${PRIO[p.priority].label}优先级`); }
      if (p.tags.length) { f.tags.value = p.tags.join(', '); bits.push('#' + p.tags.join(' #')); }
      if (p.estimateHours) { f.estimate.value = p.estimateHours; bits.push(`⏱ ${p.estimateHours}h`); }
      if (p.repeat) { repeatSel.value = p.repeat.kind; bits.push(`🔁 ${p.repeat.kind}`); }
      preview.innerHTML = bits.length ? `自动识别 → ${bits.map((b) => `<b>${b}</b>`).join('  ')}` : '';
      preview.classList.toggle('hide', !bits.length);
    }, 280);
  });

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, pre.kind === 'event' ? '新建日程' : '新建任务'), el('div', { class: 'sub' }, '标题里写时间/优先级/标签，会自动解析'))
    )
  );

  const save = async () => {
    const title = f.title.value.trim();
    if (!title) return notifyErr('请填写标题');
    const hasTime = f.startTime.value;
    const body = {
      title,
      notes: f.notes.value,
      projectId: f.project.value ? Number(f.project.value) : null,
      assigneeId: f.assignee.value ? Number(f.assignee.value) : null,
      status: f.status.value,
      priority: f.priority.value,
      startAt: hasTime && f.start.value ? `${f.start.value}T${f.startTime.value}` : f.start.value || null,
      dueAt: f.due.value ? (hasTime ? `${f.due.value}T${f.startTime.value}` : f.due.value) : (hasTime ? `${f.start.value}T${f.startTime.value}` : null),
      estimateHours: Number(f.estimate.value) || 0,
      location: f.location.value,
      tags: f.tags.value.split(/[,，;；]/).map((s) => s.trim()).filter(Boolean),
      kind: pre.kind,
      repeat: repeatSel.value === 'none' ? null : { kind: repeatSel.value, count: repeatSel.value === 'daily' || repeatSel.value === 'weekdays' ? 20 : 10 },
    };
    try {
      const r = await api.post('/api/tasks', body);
      bust('tasks');
      toast(`已创建「${r.task.title}」`, {
        type: 'ok',
        undo: async () => {
          await api.del(`/api/tasks/${r.id}`);
          bust('tasks');
          bus.emit('tasks:refresh');
          toast('已撤销', { type: 'info' });
        },
      });
      navigate(r.task.kind === 'event' ? '/calendar' : '/tasks');
    } catch (e) {
      handleError(e, '创建失败');
    }
  };

  root.appendChild(
    el(
      'div',
      { class: 'split' },
      el(
        'div',
        { class: 'stack' },
        el('div', { class: 'card' }, el('div', { class: 'card-body stack' },
          field('标题', f.title, { required: true }),
          preview,
          field('描述', f.notes),
          el('div', { class: 'field-row' }, field('所属项目', f.project), field('负责人', f.assignee)),
          el('div', { class: 'field-row' }, field('状态', f.status), field('优先级', f.priority)),
          el('div', { class: 'field-row' }, field('开始日期', f.start), field('开始时间', f.startTime)),
          el('div', { class: 'field-row' }, field('截止日期', f.due), field('预估工时（小时）', f.estimate)),
          el('div', { class: 'field-row' }, field('标签', f.tags), field('重复', repeatSel)),
          field('地点', f.location),
          el('div', { class: 'row gap-2' },
            el('button', { class: 'btn btn-primary', onClick: save }, '创建'),
            el('button', { class: 'btn', onClick: () => navigate('/tasks') }, '取消'),
            el('span', { class: 'spacer', style: { flex: 1 } }),
            el('span', { class: 'hint' }, '⌘/Ctrl + Enter 保存')
          )
        )),
        el('span', { class: 'hint', style: { marginTop: '-6px' } }, '小技巧：标题里写「下周三下午2点 评审 #发布 P1 2小时」，会同时填好时间、标签、优先级和预估工时。')
      ),
      el(
        'div',
        { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '💡 语法速查')),
        el(
          'div',
          { class: 'card-body stack-sm fs-sm' },
          ...[
            ['时间', '明天 / 下周三 / 12月25日 / 3天后 / 月底前'],
            ['时刻', '下午3点 / 15:30 / 晚上8点半 / 下班前'],
            ['重复', '每天 / 每个工作日 / 每周五 / 每两周'],
            ['优先级', 'P0 / 紧急 / P1 高优 / P2 / 有空再'],
            ['标签', '#发布 #后端'],
            ['预估', '2小时 / 90分钟 / ~3h'],
            ['阻塞', '阻塞 / 卡住 / 等待中'],
          ].map(([k, v]) => el('div', { class: 'row gap-2' }, el('span', { class: 'badge accent nowrap' }, k), el('span', { class: 'muted' }, v)))
        )
      )
    )
  );

  f.title.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save();
  });
  setTimeout(() => f.title.focus(), 50);
}