// app.js — 应用外壳：导航、路由、命令面板、快捷键、通知、登录
import {
  el, $, $$, api, state, bus, route, navigate, parseHash, toast, notifyOk, notifyErr,
  handleError, openModal, confirmDialog, avatar, empty, skeleton, applyTheme, debounce,
  dstr, fmtAgo, bust,
} from './core.js';
import { openTaskDrawer, quickAddBar, taskMenu } from './ui.js';
import { dashboardView, todayView, calendarView } from './views/views-a.js';
import { tasksView, newTaskView } from './views/views-b.js';
import { projectsView, projectDetailView } from './views/views-c.js';
import { teamView, memberView, plannerView, reportsView, reviewView, settingsView } from './views/views-d.js';

/* ==================== 路由表 ==================== */
route('/dashboard', (r, q) => dashboardView(r, q));
route('/', (r) => dashboardView(r));
route('/today', (r) => todayView(r));
route('/calendar', (r, q) => calendarView(r, q));
route('/tasks', (r, p, q) => tasksView(r, p, q));
route('/tasks/new', (r, p, q) => newTaskView(r, p, q));
route('/projects', (r, p, q) => projectsView(r, p, q));
route('/projects/:id', (r, p) => projectDetailView(r, p));
route('/team', (r) => teamView(r));
route('/team/:id', (r, p) => memberView(r, p));
route('/planner', (r) => plannerView(r));
route('/reports', (r) => reportsView(r));
route('/review', (r) => reviewView(r));
route('/settings', (r) => settingsView(r));

const NAV = [
  { group: '日常', items: [
    { view: 'dashboard', icon: '🏠', label: '仪表盘', path: '/dashboard' },
    { view: 'today', icon: '📌', label: '今日', path: '/today' },
    { view: 'calendar', icon: '📅', label: '日历', path: '/calendar' },
  ]},
  { group: '执行', items: [
    { view: 'tasks', icon: '📋', label: '任务', path: '/tasks', badge: 'overdue' },
    { view: 'projects', icon: '📂', label: '项目', path: '/projects' },
    { view: 'planner', icon: '🧠', label: '智能安排', path: '/planner', accent: true },
  ]},
  { group: '团队', items: [
    { view: 'team', icon: '👥', label: '团队', path: '/team' },
    { view: 'reports', icon: '📈', label: '报表', path: '/reports' },
    { view: 'review', icon: '🪞', label: '周复盘', path: '/review' },
  ]},
  { group: '其他', items: [
    { view: 'settings', icon: '⚙️', label: '设置', path: '/settings' },
  ]},
];

const app = $('#app');
let mainEl, navEl, topEl;
let navCollapsed = localStorage.getItem('fd-nav-collapsed') === '1';
let badgeData = { overdue: 0, unread: 0 };

/* ==================== 外壳渲染 ==================== */
function shell() {
  navEl = el('aside', { class: 'nav', id: 'nav' });
  topEl = el('header', { class: 'topbar' });
  mainEl = el('main', { class: 'main', id: 'main' });
  app.replaceChildren(navEl, topEl, mainEl);
  app.classList.toggle('nav-collapsed', navCollapsed);
  renderNav();
  renderTop();
  mountMobileTabs();
  window.addEventListener('hashchange', render);
}

function renderNav() {
  const user = state.user;
  navEl.innerHTML = '';
  navEl.appendChild(
    el('div', { class: 'brand' },
      el('div', { class: 'brand-mark' }, 'F'),
      el('div', { class: 'brand-text' },
        el('div', { class: 'brand-name' }, 'FlowDesk'),
        el('div', { class: 'brand-sub' }, '工作台'))
    )
  );
  const scroll = el('div', { class: 'nav-scroll' });
  const cur = parseHash().view;
  for (const g of NAV) {
    const group = el('div', { class: 'nav-group' }, el('div', { class: 'nav-label' }, g.group));
    for (const it of g.items) {
      const badgeVal = it.badge ? badgeData[it.badge] : 0;
      group.appendChild(
        el('a', {
          class: `nav-item ${cur === it.view || (it.view === 'tasks' && cur === 'tasks') ? 'active' : ''}`,
          href: '#' + it.path,
          title: it.label,
          style: it.accent ? { color: cur === it.view ? undefined : 'var(--accent)' } : null,
        },
          el('span', { class: 'nav-ico' }, it.icon),
          el('span', { class: 'nav-text' }, it.label),
          badgeVal > 0 && el('span', { class: 'nav-badge' }, String(badgeVal > 99 ? '99+' : badgeVal)))
      );
    }
    scroll.appendChild(group);
  }
  navEl.appendChild(scroll);
  navEl.appendChild(
    el('div', { class: 'nav-footer' },
      el('button', {
        class: 'nav-item',
        onClick: (e) => userMenu(e.currentTarget),
        title: user.name,
      },
        avatar(user, 'sm'),
        el('span', { class: 'nav-text' }, user.name),
        el('span', { class: 'nav-text muted fs-xs' }, user.title || '')),
      el('button', {
        class: 'icon-btn',
        title: navCollapsed ? '展开侧栏' : '收起侧栏',
        onClick: () => {
          navCollapsed = !navCollapsed;
          localStorage.setItem('fd-nav-collapsed', navCollapsed ? '1' : '0');
          app.classList.toggle('nav-collapsed', navCollapsed);
          renderNav();
        },
      }, navCollapsed ? '»' : '«'))
  );
}

function renderTop() {
  topEl.innerHTML = '';
  topEl.appendChild(
    el('button', { class: 'nav-toggle', title: '菜单', onClick: toggleMobileNav }, '☰')
  );
  topEl.appendChild(
    el('button', { class: 'search-trigger', onClick: openCmdk },
      el('span', {}, '🔍'),
      el('span', { class: 'flex1', style: { textAlign: 'left' } }, '搜索任务、项目、成员…'),
      el('kbd', {}, '⌘K'))
  );
  topEl.appendChild(el('div', { class: 'topbar-spacer' }));
  const actions = el('div', { class: 'topbar-actions' });
  actions.appendChild(
    el('button', { class: 'icon-btn', title: '智能安排建议', onClick: () => navigate('/planner') }, '🧠')
  );
  actions.appendChild(
    el('button', { class: 'icon-btn', title: '快速新建', onClick: (e) => quickCreate(e.currentTarget) }, '＋')
  );
  actions.appendChild(
    el('button', { class: 'icon-btn', title: '通知', onClick: (e) => openNotifications(e.currentTarget) },
      '🔔',
      badgeData.unread > 0 ? el('span', { class: 'dot' }, badgeData.unread > 9 ? '9+' : String(badgeData.unread)) : null)
  );
  const themeBtn = state.settings.theme === 'dark' ? '🌙' : state.settings.theme === 'light' ? '☀️' : '🖥';
  actions.appendChild(
    el('button', {
      class: 'icon-btn',
      title: '切换主题（跟随系统 / 亮 / 暗）',
      onClick: async (e) => {
        const order = ['system', 'light', 'dark'];
        const next = order[(order.indexOf(state.settings.theme || 'system') + 1) % 3];
        await api.patch('/api/settings', { theme: next });
        state.settings.theme = next;
        applyTheme(next);
        renderTop();
        toast({ system: '跟随系统', light: '亮色模式', dark: '暗色模式' }[next], { type: 'info', ms: 1500 });
      },
    }, themeBtn)
  );
  topEl.appendChild(actions);
}

function mountMobileTabs() {
  const tabs = el('div', { class: 'mobile-tabs' });
  for (const it of [...NAV[0].items, ...NAV[1].items].slice(0, 5)) {
    tabs.appendChild(
      el('button', { 'data-view': it.view, onClick: () => navigate(it.path) },
        el('span', { class: 'mi' }, it.icon),
        el('span', {}, it.label))
    );
  }
  document.body.appendChild(tabs);
  bus.on('route:view', (v) => {
    for (const b of $$('.mobile-tabs button')) b.classList.toggle('active', b.dataset.view === v);
  });
}

function toggleMobileNav() {
  const open = app.classList.toggle('nav-open');
  if (open) {
    const bd = el('div', { class: 'nav-backdrop', onClick: toggleMobileNav });
    document.body.appendChild(bd);
    app._backdrop = bd;
  } else app._backdrop?.remove();
}

/* ==================== 路由渲染 ==================== */
let currentToken = 0;
async function render() {
  if (!state.user) return;
  const token = ++currentToken;
  const { view } = parseHash();
  bus.emit('route:view', view);
  renderNav();
  // 保留滚动位置感：切页回顶
  mainEl.scrollTop = 0;
  mainEl.replaceChildren(el('div', { class: 'view' }));
  const root = mainEl.firstChild;
  const r = api;
  const map = {
    dashboard: dashboardView, today: todayView, calendar: calendarView, tasks: tasksView,
    projects: projectsView, team: teamView, planner: plannerView, reports: reportsView,
    review: reviewView, settings: settingsView,
  };
  try {
    if (view === 'projects' && parseHash().params.id) await projectDetailView(root, parseHash().params);
    else if (view === 'team' && parseHash().params.id) await memberView(root, parseHash().params);
    else if (view === 'tasks' && parseHash().params.id) await openTaskDrawer(parseHash().params.id);
    else if (view === 'tasks' && location.hash.includes('/new')) await newTaskView(root, {}, parseHash().query);
    else if (map[view]) await map[view](root, parseHash().params, parseHash().query);
    else {
      root.appendChild(empty({ art: '🧭', title: '页面不存在', desc: `找不到 ${view}`, action: el('button', { class: 'btn btn-primary mt-2', onClick: () => navigate('/dashboard') }, '回到仪表盘') }));
    }
  } catch (e) {
    if (token !== currentToken) return;
    console.error(e);
    root.replaceChildren(
      el('div', { class: 'card' }, el('div', { class: 'card-body' },
        empty({ art: '😵', title: '页面加载失败', desc: e?.message || String(e), action: el('button', { class: 'btn btn-primary mt-2', onClick: () => render() }, '重试') })))
    );
  }
  if (token === currentToken) refreshBadges();
}

/* ==================== 徽标 ==================== */
async function refreshBadges() {
  try {
    const n = await api.get('/api/notifications?limit=1');
    badgeData.unread = n.unread || 0;
    const t = await api.get('/api/tasks?scope=mine&overdue=1&open=1&limit=1');
    badgeData.overdue = t.total || 0;
    renderTop();
    renderNav();
  } catch {}
}

/* ==================== 快速新建 ==================== */
function quickCreate(anchor) {
  import('./core.js').then(({ openMenu }) => {
    openMenu(anchor, [
      { type: 'label', label: '新建' },
      { label: '任务', icon: '📋', kbd: 'N', onClick: () => navigate('/tasks/new') },
      { label: '日程', icon: '📅', onClick: () => navigate('/tasks/new?kind=event') },
      { label: '项目', icon: '📂', onClick: async () => { navigate('/projects'); setTimeout(() => document.querySelector('.page-head .btn-primary')?.click(), 300); } },
      { type: 'sep' },
      { label: '搜一搜', icon: '🔍', kbd: '⌘K', onClick: openCmdk },
      { label: '看下周安排', icon: '🧠', onClick: () => navigate('/planner') },
    ], { align: 'right' });
  });
}

/* ==================== 通知 ==================== */
async function openNotifications(anchor) {
  const data = await api.get('/api/notifications');
  const body = el('div', { class: 'stack-sm' });
  const m = openModal({
    title: `通知${data.unread ? `（${data.unread} 条未读）` : ''}`,
    icon: '🔔',
    body,
    foot: el('div', { style: { display: 'contents' } },
      el('button', {
        class: 'btn btn-ghost btn-sm',
        onClick: async () => {
          await api.post('/api/notifications/read-all', {});
          badgeData.unread = 0;
          renderTop();
          m.close();
        },
      }, '全部标为已读'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '关闭')),
  });
  if (!data.items.length) {
    body.appendChild(empty({ art: '🔔', title: '没有通知', desc: '任务逾期、里程碑临近时会在这里提醒你。' }));
    return;
  }
  for (const n of data.items) {
    body.appendChild(
      el('button', {
        class: 'insight ' + n.level,
        style: { width: '100%', textAlign: 'left', opacity: n.read ? 0.6 : 1 },
        onClick: async () => {
          await api.post(`/api/notifications/${n.id}/read`, {});
          m.close();
          if (n.link) navigate(n.link.replace(/^#/, ''));
          else render();
        },
      },
        el('div', { class: 'ico' }, { danger: '⛔', warn: '⚠️', info: '💡', ok: '✅' }[n.level] || '💡'),
        el('div', { class: 'txt' },
          el('div', { class: 't' }, n.title),
          n.body && el('div', { class: 'd' }, n.body),
          el('div', { class: 'fs-xs muted mt-1' }, fmtAgo(n.createdAt))))
    );
  }
}

/* ==================== 用户菜单 ==================== */
function userMenu(anchor) {
  import('./core.js').then(({ openMenu }) => {
    openMenu(anchor, [
      { type: 'label', label: state.user.email || state.user.name },
      { label: '个人设置', icon: '⚙️', onClick: () => navigate('/settings') },
      { label: '周复盘', icon: '🪞', onClick: () => navigate('/review') },
      { type: 'sep' },
      {
        label: '退出登录',
        icon: '🚪',
        danger: true,
        onClick: async () => {
          if (!(await confirmDialog({ title: '退出登录？', confirmText: '退出', icon: '🚪' }))) return;
          await api.post('/api/auth/logout', {});
          location.reload();
        },
      },
    ]);
  });
}

/* ==================== 命令面板 ==================== */
let cmdkState = null;
async function openCmdk() {
  if (cmdkState) return;
  const input = el('input', { placeholder: '搜索任务、项目、成员，或输入命令…', autocomplete: 'off' });
  const results = el('div', { class: 'cmdk-results' });
  const box = el('div', { class: 'cmdk-box' },
    el('div', { class: 'cmdk-input' }, el('span', {}, '🔍'), input, el('kbd', { class: 'k' }, 'Esc')),
    results,
    el('div', { class: 'cmdk-foot' },
      el('span', {}, el('kbd', { class: 'k' }, '↑↓'), ' 选择'),
      el('span', {}, el('kbd', { class: 'k' }, 'Enter'), ' 打开'),
      el('span', {}, el('kbd', { class: 'k' }, 'Esc'), ' 关闭'),
      el('span', { style: { marginLeft: 'auto' } }, '试试输入「新建任务」「下周安排」「深色」')));
  const overlay = el('div', {
    class: 'cmdk',
    onClick: (e) => { if (e.target === overlay) close(); },
  }, box);
  document.body.appendChild(overlay);
  input.focus();

  let items = [];
  let selIdx = 0;
  const close = () => {
    overlay.remove();
    cmdkState = null;
    document.removeEventListener('keydown', onKey, true);
  };
  cmdkState = { overlay, close };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); selIdx = Math.min(items.length - 1, selIdx + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIdx = Math.max(0, selIdx - 1); paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[selIdx];
      if (it) { close(); it.run(); }
    }
  };
  document.addEventListener('keydown', onKey, true);
  const paint = () => {
    results.innerHTML = '';
    if (!items.length) {
      results.appendChild(el('div', { class: 'cmdk-item', style: { color: 'var(--fg-3)' } }, '没有匹配结果'));
      return;
    }
    let group = null;
    items.forEach((it, i) => {
      if (it.group !== group) {
        group = it.group;
        results.appendChild(el('div', { class: 'cmdk-group' }, group));
      }
      results.appendChild(
        el('button', {
          class: `cmdk-item ${i === selIdx ? 'sel' : ''}`,
          onClick: () => { close(); it.run(); },
          onMouseenter: () => { selIdx = i; paint(); },
        },
          el('span', {}, it.icon || '·'),
          el('span', { class: 'truncate' }, it.label),
          it.sub && el('span', { class: 'sub' }, it.sub))
      );
    });
  };

  const commands = [
    { group: '命令', icon: '📋', label: '新建任务', sub: 'N', run: () => navigate('/tasks/new') },
    { group: '命令', icon: '📅', label: '新建日程', run: () => navigate('/tasks/new?kind=event') },
    { group: '命令', icon: '🧠', label: '看下周工作安排', run: () => navigate('/planner') },
    { group: '命令', icon: '🪞', label: '周复盘', run: () => navigate('/review') },
    { group: '命令', icon: '📈', label: '报表', run: () => navigate('/reports') },
    { group: '命令', icon: '☀️', label: '切换到亮色主题', run: () => setTheme('light') },
    { group: '命令', icon: '🌙', label: '切换到暗色主题', run: () => setTheme('dark') },
    { group: '命令', icon: '🖥', label: '主题跟随系统', run: () => setTheme('system') },
    { group: '导航', icon: '🏠', label: '仪表盘', run: () => navigate('/dashboard') },
    { group: '导航', icon: '📌', label: '今日', run: () => navigate('/today') },
    { group: '导航', icon: '📋', label: '任务', run: () => navigate('/tasks') },
    { group: '导航', icon: '📂', label: '项目', run: () => navigate('/projects') },
    { group: '导航', icon: '👥', label: '团队', run: () => navigate('/team') },
    { group: '导航', icon: '📅', label: '日历', run: () => navigate('/calendar') },
    { group: '导航', icon: '⚙️', label: '设置', run: () => navigate('/settings') },
  ];
  const setTheme = async (t) => {
    await api.patch('/api/settings', { theme: t });
    state.settings.theme = t;
    applyTheme(t);
    renderTop();
  };

  const search = debounce(async (q) => {
    selIdx = 0;
    if (!q.trim()) {
      items = commands;
      paint();
      return;
    }
    const out = [];
    // 本地命令匹配
    for (const c of commands) if (c.label.includes(q)) out.push(c);
    try {
      const [tasks, projects] = await Promise.all([
        api.get(`/api/tasks?q=${encodeURIComponent(q)}&limit=6`),
        api.get(`/api/projects?q=${encodeURIComponent(q)}`),
      ]);
      for (const t of tasks.tasks.slice(0, 6)) {
        out.push({ group: '任务', icon: '📋', label: t.title, sub: t.projectName || '', run: () => openTaskDrawer(t.id) });
      }
      for (const p of projects.slice(0, 5)) {
        out.push({ group: '项目', icon: '📂', label: p.name, sub: `${p.progress}%`, run: () => navigate(`/projects/${p.id}`) });
      }
      const users = (state.users || []).filter((u) => u.name.includes(q)).slice(0, 4);
      for (const u of users) {
        out.push({ group: '成员', icon: '👤', label: u.name, sub: u.title || '', run: () => navigate(`/team/${u.id}`) });
      }
    } catch {}
    items = out;
    paint();
  }, 200);

  input.addEventListener('input', () => search(input.value.trim()));
  items = commands;
  paint();
}

/* ==================== 快捷键 ==================== */
let gPending = false;
function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    // ⌘/Ctrl + K
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCmdk();
      return;
    }
    // g 前缀跳转
    if (gPending && !typing) {
      gPending = false;
      const map = { d: '/dashboard', t: '/today', k: '/tasks', c: '/calendar', p: '/projects', w: '/team', m: '/planner', r: '/review' };
      if (map[e.key]) {
        e.preventDefault();
        navigate(map[e.key]);
        return;
      }
    }
    if (e.key === 'g' && !typing && !e.metaKey && !e.ctrlKey) {
      gPending = true;
      setTimeout(() => (gPending = false), 1200);
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    // N 新建
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      navigate('/tasks/new');
      return;
    }
    // T 今天
    if (e.key === 't' || e.key === 'T') {
      e.preventDefault();
      navigate('/today');
      return;
    }
    // 1/2/3 切换任务视图
    if (['1', '2', '3'].includes(e.key) && parseHash().view === 'tasks') {
      e.preventDefault();
      const v = { 1: 'list', 2: 'board', 3: 'group' }[e.key];
      const q = parseHash().query;
      delete q.view;
      navigate('/tasks?' + new URLSearchParams({ ...q, view: v }).toString());
      return;
    }
    // ? 快捷键
    if (e.key === '?') {
      e.preventDefault();
      showShortcutHelp();
    }
  });
}

function showShortcutHelp() {
  openModal({
    title: '键盘快捷键',
    icon: '⌨️',
    body: el('div', { class: 'stack-sm' },
      ...[
        ['⌘ / Ctrl + K', '打开命令面板（搜索一切）'],
        ['N', '新建任务'],
        ['G 然后 D', '仪表盘'],
        ['G 然后 T', '今日'],
        ['G 然后 K', '任务'],
        ['G 然后 C', '日历'],
        ['G 然后 P', '项目'],
        ['G 然后 W', '团队'],
        ['G 然后 M', '智能安排'],
        ['G 然后 R', '周复盘'],
        ['T', '回到今天'],
        ['1 / 2 / 3', '任务视图：列表 / 看板 / 分组'],
        ['Enter', '打开选中的任务'],
        ['Esc', '关闭弹层'],
      ].map(([k, v]) => el('div', { class: 'spread fs-sm' },
        el('span', { class: 'muted' }, v),
        el('kbd', { class: 'k' }, k))))
  });
}

/* ==================== 登录页 ==================== */
async function renderLogin(boot) {
  document.body.innerHTML = '';
  // 之前登录过、现在被弹回来 —— 说明会话过期，说清楚原因，别让用户以为丢数据了
  const expired = !!localStorage.getItem('fd-was-logged-in');
  if (expired) localStorage.removeItem('fd-was-logged-in');
  const wrap = el('div', { style: { display: 'grid', placeItems: 'center', height: '100vh', padding: '20px' } });
  const isFirstRun = boot && !boot.seeded;
  const errBox = el('div', { class: 'hide' });
  const showErr = (msg) => {
    errBox.className = 'insight danger mb-3';
    errBox.replaceChildren(el('div', { class: 'ico' }, '⚠️'), el('div', { class: 'txt' }, el('div', { class: 't' }, msg)));
  };
  const f = {
    identifier: el('input', { class: 'input', placeholder: '邮箱或姓名', autocomplete: 'username' }),
    password: el('input', { class: 'input', type: 'password', placeholder: '密码', autocomplete: 'current-password' }),
    name: el('input', { class: 'input', placeholder: '你的名字' }),
    email: el('input', { class: 'input', type: 'email', placeholder: '邮箱（可选）' }),
    npwd: el('input', { class: 'input', type: 'password', placeholder: '至少 6 位' }),
  };
  const submit = async () => {
    errBox.classList.add('hide');
    try {
      if (isFirstRun) {
        await api.post('/api/admin/init', {
          name: f.name.value.trim() || '管理员',
          email: f.email.value.trim(),
          password: f.npwd.value,
        });
        toast('初始化完成，正在进入…', { type: 'ok' });
      } else {
        await api.post('/api/auth/login', { identifier: f.identifier.value.trim(), password: f.password.value });
      }
      location.reload();
    } catch (e) {
      showErr(e.message || '登录失败');
      f.password.focus();
    }
  };
  const form = el(
    'form',
    { class: 'card', style: { width: 'min(400px, 100%)' }, onSubmit: (e) => { e.preventDefault(); submit(); } },
    el('div', { class: 'card-body' },
      el('div', { class: 'row gap-2 mb-4' },
        el('div', { class: 'brand-mark', style: { width: '38px', height: '38px', fontSize: '19px', borderRadius: '11px' } }, 'F'),
        el('div', {},
          el('div', { style: { fontWeight: '700', fontSize: '17px', letterSpacing: '-0.02em' } }, isFirstRun ? '欢迎使用 FlowDesk' : '登录 FlowDesk'),
          el('div', { class: 'muted fs-xs' }, isFirstRun ? '首次使用，创建一个管理员账号' : '个人与团队一体化工作管理'))),
      errBox,
      expired
        ? el(
            'div',
            { class: 'insight warn mb-3' },
            el('div', { class: 'ico' }, '🔒'),
            el(
              'div',
              { class: 'txt' },
              el('div', { class: 't' }, '登录已过期'),
              el('div', { class: 'd' }, '你的登录状态失效了（可能是长时间未操作或服务重启）。数据都在，重新登录即可回到原处。')
            )
          )
        : null,
      isFirstRun
        ? el('div', { class: 'stack' },
            el('div', { class: 'field' }, el('label', { class: 'label' }, '姓名'), f.name),
            el('div', { class: 'field' }, el('label', { class: 'label' }, '邮箱'), f.email),
            el('div', { class: 'field' }, el('label', { class: 'label' }, '设置密码'), f.npwd))
        : el('div', { class: 'stack' },
            el('div', { class: 'field' }, el('label', { class: 'label' }, '账号'), f.identifier),
            el('div', { class: 'field' }, el('label', { class: 'label' }, '密码'), f.password)),
      el('button', { class: 'btn btn-primary btn-lg btn-block mt-3', type: 'submit' }, isFirstRun ? '创建并进入' : '登录'),
      !isFirstRun && boot?.seeded
        ? el('div', { class: 'hint', style: { marginTop: '14px', textAlign: 'center' } },
            '演示账号：zhouming@demo.com / demo1234',
            el('button', {
              class: 'btn btn-sm btn-ghost mt-2',
              onClick: () => { f.identifier.value = 'zhouming@demo.com'; f.password.value = 'demo1234'; submit(); },
            }, '一键填入演示账号'))
        : null)
  );
  wrap.appendChild(form);
  document.body.appendChild(wrap);
  setTimeout(() => (isFirstRun ? f.name : f.identifier).focus(), 60);
  for (const i of Object.values(f)) i.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
}

/* ==================== 启动 ==================== */
async function boot() {
  applyTheme(localStorage.getItem('fd-theme') || 'system');
  let b;
  try {
    b = await api.get('/api/bootstrap');
  } catch (e) {
    document.body.innerHTML = '';
    const offline = e?.status === 0;
    document.body.appendChild(
      el(
        'div',
        { style: { display: 'grid', placeItems: 'center', height: '100vh', padding: '20px' } },
        el(
          'div',
          { class: 'card', style: { width: 'min(460px, 100%)' } },
          el(
            'div',
            { class: 'card-body', style: { textAlign: 'center' } },
            el('div', { style: { fontSize: '38px', marginBottom: '10px' } }, offline ? '📴' : '⚠️'),
            el('h2', { style: { fontSize: '16px', marginBottom: '8px' } }, offline ? 'FlowDesk 服务没有在运行' : '无法连接到服务'),
            el(
              'p',
              { class: 'muted fs-sm', style: { lineHeight: '1.7', marginBottom: '16px' } },
              offline
                ? '界面资源已从本地缓存加载，但数据存在服务端，需要把服务启动起来。'
                : e.message
            ),
            offline
              ? el(
                  'div',
                  { class: 'card', style: { textAlign: 'left', marginBottom: '16px', background: 'var(--surface-2)' } },
                  el(
                    'div',
                    { class: 'card-body tight mono', style: { fontSize: '12px', lineHeight: '1.9' } },
                    el('div', {}, 'cd /Users/steven/hermes/flowdesk'),
                    el('div', {}, 'npm start')
                  )
                )
              : null,
            el(
              'div',
              { class: 'row gap-2', style: { justifyContent: 'center' } },
              el('button', { class: 'btn btn-primary', onClick: () => location.reload() }, '重试连接')
            )
          )
        )
      )
    );
    return;
  }
  if (!b.authenticated) {
    await renderLogin(b);
    return;
  }
  state.user = b.user;
  try { localStorage.setItem('fd-was-logged-in', '1'); } catch {}
  state.users = b.users || [];
  state.teams = b.teams || [];
  state.settings = b.settings || {};
  state.serverDate = b.serverDate || dstr();
  applyTheme(state.settings.theme || 'system');

  shell();
  initShortcuts();

  if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
  await render();
  refreshBadges();
  setInterval(refreshBadges, 120000);

  bus.on('auth:lost', () => location.reload());
  bus.on('route:force', () => render());

  // 首次进入给一点引导
  if (!localStorage.getItem('fd-welcomed')) {
    localStorage.setItem('fd-welcomed', '1');
    setTimeout(() => welcome(), 700);
  }

  registerServiceWorker();
}

/* ==================== Service Worker ==================== */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  const reg = () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不影响主流程（本机 HTTP、隐私模式等场景） */
    });
    // 新版本接管时自动刷新，避免用户面对「旧 JS + 新 HTML」的错乱
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      location.reload();
    });
  };
  // boot() 是异步的，等到它跑到这里时 load 事件往往已经过去了，
  // 必须判断 readyState，不能只挂 load 监听。
  if (document.readyState === 'complete') reg();
  else window.addEventListener('load', reg, { once: true });
}

function welcome() {
  openModal({
    title: '欢迎使用 FlowDesk 👋',
    icon: '🎉',
    body: el('div', { class: 'stack' },
      el('p', { class: 'fs-sm dim' }, '这是一个把「日程 + 任务 + 项目 + 团队 + 自动排期」串在一起的个人工作台。几个马上能用的入口：'),
      el('div', { class: 'stack-sm' },
        ...[
          ['🧠', '智能安排', '根据项目进度、紧急度、里程碑和你的时间容量，自动生成下周每天该做什么——每条都写清理由，可一键采纳。'],
          ['✍️', '一句话建任务', '在输入框写「下周三下午2点 评审 #发布 P1 2小时」，日期/标签/优先级/预估会自动填好。'],
          ['📋', '看板拖拽', '任务视图切到「看板」，卡片可以在列之间拖动，进度即时更新。'],
          ['⌘K', '全局搜索', '任何页面按 ⌘K，搜任务、项目、成员，或者直接输命令。'],
        ].map(([i, t, d]) =>
          el('div', { class: 'insight info' },
            el('div', { class: 'ico' }, i),
            el('div', { class: 'txt' }, el('div', { class: 't' }, t), el('div', { class: 'd' }, d))))),
      el('div', { class: 'hint' }, '提示：数据存在本机 data/flowdesk.db，可随时在「设置 → 数据管理」里备份导出。')),
    foot: el('div', { style: { display: 'contents' } },
      el('button', { class: 'btn', onClick: () => { document.querySelector('.overlay')?.remove(); navigate('/planner'); } }, '看看下周安排'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onClick: () => document.querySelector('.overlay')?.remove() }, '开始使用')),
  });
}

boot();