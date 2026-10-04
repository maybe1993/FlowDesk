// core.js — API 客户端、全局状态、工具函数、哈希路由
// 无框架，原生 ES Module

/* ================= 工具 ================= */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && k !== 'list' && k !== 'form') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  add(node, children);
  return node;
}

function add(parent, children) {
  for (const c of children.flat(6)) {
    if (c == null || c === false || c === '') continue;
    parent.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- 日期 ---------- */
const pad = (n) => String(n).padStart(2, '0');
export const dstr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dtstr = (d = new Date()) => `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function pdate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}
export const addDays = (s, n) => {
  const d = pdate(s) || new Date();
  d.setDate(d.getDate() + n);
  return dstr(d);
};
export const startOfWeek = (s = dstr(), weekStart = 1) => {
  const d = pdate(s) || new Date();
  d.setHours(0, 0, 0, 0);
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return dstr(d);
};
export const daysBetween = (a, b) => {
  const da = pdate(a), db = pdate(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
};
export const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export const WD_S = ['日', '一', '二', '三', '四', '五', '六'];

export function fmtDate(s, style = 'md') {
  const d = pdate(s);
  if (!d) return '';
  const t = dstr(d);
  if (style === 'full') return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${WD[d.getDay()]}`;
  if (style === 'md') return `${d.getMonth() + 1}/${d.getDate()}`;
  if (style === 'ymd') return t;
  if (style === 'rel') return relDate(s);
  return t;
}

/** 人话日期：今天 / 明天 / 昨天 / 3 天后 / 逾期 2 天 */
export function relDate(s) {
  if (!s) return '';
  const today = dstr();
  const d = String(s).slice(0, 10);
  const diff = daysBetween(today, d);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff === -1) return '昨天';
  if (diff === -2) return '前天';
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff <= 7) return `${diff} 天后`;
  const dt = pdate(d);
  return `${dt.getMonth() + 1}月${dt.getDate()}日`;
}

export function fmtTime(s) {
  if (!s) return '';
  const m = String(s).match(/[T ](\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;
  if (String(s).length === 10) return '全天';
  return '';
}

export function fmtMinutes(min) {
  min = Number(min) || 0;
  if (min < 60) return `${min} 分钟`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h} 小时` : `${h.toFixed(1)} 小时`;
}

export function fmtHours(h) {
  h = Number(h) || 0;
  if (h === 0) return '0h';
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function fmtAgo(iso) {
  const t = pdate(String(iso).replace(' ', 'T'));
  if (!t) return '';
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  if (mins < 1440) return `${Math.floor(mins / 60)} 小时前`;
  const d = Math.floor(mins / 1440);
  if (d < 30) return `${d} 天前`;
  return fmtDate(iso, 'md');
}

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const debounce = (fn, ms = 260) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

export const PRIO = {
  urgent: { label: '紧急', cls: 'prio-urgent', color: 'var(--c-red)', w: 3 },
  high: { label: '高', cls: 'prio-high', color: 'var(--c-orange)', w: 2 },
  med: { label: '中', cls: 'prio-med', color: 'var(--c-blue)', w: 1 },
  low: { label: '低', cls: 'prio-low', color: 'var(--fg-3)', w: 0 },
};
export const STATUS = {
  backlog: { label: '待规划', color: 'var(--fg-3)' },
  todo: { label: '待办', color: 'var(--c-blue)' },
  doing: { label: '进行中', color: 'var(--c-orange)' },
  review: { label: '待验收', color: 'var(--c-purple)' },
  done: { label: '已完成', color: 'var(--ok)' },
  cancelled: { label: '已取消', color: 'var(--fg-3)' },
};
export const PSTATUS = {
  planning: '规划中',
  active: '进行中',
  paused: '已暂停',
  done: '已完成',
  cancelled: '已取消',
};
export const HEALTH = {
  good: { label: '正常', cls: 'ok' },
  watch: { label: '需关注', cls: 'warn' },
  at_risk: { label: '风险', cls: 'danger' },
};
export const LEVEL_ICON = { danger: '⛔', warn: '⚠️', info: '💡', ok: '✅' };

/* ================= API ================= */
class ApiError extends Error {
  constructor(status, message, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}
export { ApiError };

async function request(method, path, body) {
  const opts = {
    method,
    headers: { 'X-FD-Client': '1' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch {
    throw new ApiError(0, '网络连接失败，请检查服务是否还在运行', path);
  }
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !location.pathname.startsWith('/login')) {
      state.user = null;
      bus.emit('auth:lost');
    }
    throw new ApiError(res.status, data?.error || `请求失败（${res.status}）`, path);
  }
  return data;
}

export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  patch: (p, b = {}) => request('PATCH', p, b),
  del: (p, b = {}) => request('DELETE', p, b),
};

/* ================= 全局状态 ================= */
export const state = {
  user: null,
  users: [],
  teams: [],
  settings: {},
  serverDate: dstr(),
  notifications: [],
  unread: 0,
  route: { view: 'dashboard', params: {}, query: {} },
  cache: new Map(),
};

const listeners = new Map();
export const bus = {
  on(evt, fn) {
    if (!listeners.has(evt)) listeners.set(evt, new Set());
    listeners.get(evt).add(fn);
    return () => listeners.get(evt).delete(fn);
  },
  emit(evt, data) {
    (listeners.get(evt) || []).forEach((fn) => {
      try {
        fn(data);
      } catch (e) {
        console.error(`[bus:${evt}]`, e);
      }
    });
  },
};

/** 带缓存与失效的读取 */
export async function load(key, fetcher, { ttl = 0 } = {}) {
  const hit = state.cache.get(key);
  if (hit && (ttl === 0 || Date.now() - hit.at < ttl)) return hit.data;
  const data = await fetcher();
  state.cache.set(key, { data, at: Date.now() });
  return data;
}
export const bust = (prefix) => {
  for (const k of [...state.cache.keys()]) if (!prefix || k.startsWith(prefix)) state.cache.delete(k);
};

/* ================= 路由 ================= */
const routes = [];
export const route = (path, handler) => {
  const keys = [];
  const src = path
    .split('/')
    .map((s) => {
      if (s.startsWith(':')) {
        keys.push(s.slice(1));
        return '([^/]+)';
      }
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  routes.push({ regex: new RegExp(`^${src}/?$`), keys, handler, path });
};

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  const segs = pathPart.split('/').filter(Boolean);
  const view = segs[0] || 'dashboard';
  const params = {};
  const r = routes.find((x) => x.regex.test(pathPath(pathPart)));
  if (r) {
    const m = r.regex.exec(pathPath(pathPart));
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
  }
  return { view, params, query, path: pathPart, segs };
}
const pathPath = (p) => (p.startsWith('/') ? p : '/' + p);

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : '#' + to;
  if (location.hash === target) {
    bus.emit('route:force');
    return;
  }
  if (replace) location.replace(target);
  else location.hash = target;
}

/* ================= Toast ================= */
let toastHost;
export function toast(msg, opts = {}) {
  if (!toastHost) {
    toastHost = el('div', { class: 'toasts', id: 'toasts' });
    document.body.appendChild(toastHost);
  }
  const { type = 'info', ms = 3200, undo } = opts;
  const node = el('div', { class: `toast ${type}` }, el('div', { class: 'body', text: msg }));
  if (undo) {
    node.appendChild(
      el('button', {
        class: 'undo',
        text: '撤销',
        onClick: () => {
          undo();
          dismiss();
        },
      })
    );
  }
  node.addEventListener('click', (e) => {
    if (!e.target.classList.contains('undo')) dismiss();
  });
  toastHost.appendChild(node);
  const timer = setTimeout(dismiss, ms);
  function dismiss() {
    clearTimeout(timer);
    if (!node.isConnected) return;
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 200);
  }
  return dismiss;
}

export const notifyOk = (m, o) => toast(m, { ...o, type: 'ok' });
export const notifyErr = (m, o) => toast(m || '操作失败', { ...o, type: 'error', ms: 4600 });

/** 统一的错误处理：把 ApiError 变成人话 toast */
export function handleError(e, fallback = '操作失败') {
  console.error(e);
  if (e instanceof ApiError) {
    if (e.status === 401) return;
    notifyErr(e.message || fallback);
  } else {
    notifyErr(fallback + '：' + (e?.message || e));
  }
}

/* ================= 确认框 ================= */
export function confirmDialog({ title, body, confirmText = '确认', danger = false, icon = '🤔' }) {
  return new Promise((resolve) => {
    const close = (v) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter') close(true);
    };
    const overlay = el('div', {
      class: 'overlay',
      onClick: (e) => {
        if (e.target === overlay) close(false);
      },
    });
    const box = el(
      'div',
      { class: 'modal narrow', onClick: (e) => e.stopPropagation() },
      el(
        'div',
        { class: 'modal-body', style: { padding: '26px 24px' } },
        el('div', { style: { fontSize: '30px', marginBottom: '8px' } }, icon),
        el('h2', { style: { fontSize: '16px', marginBottom: '6px' } }, title),
        body && el('p', { class: 'muted fs-sm', style: { lineHeight: '1.6' } }, body)
      ),
      el(
        'div',
        { class: 'modal-foot' },
        el('span', { class: 'spacer' }),
        el('button', { class: 'btn', onClick: () => close(false) }, '取消'),
        el(
          'button',
          { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onClick: () => close(true) },
          confirmText
        )
      )
    );
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey);
    setTimeout(() => box.querySelector('.btn-primary, .btn-danger')?.focus(), 30);
  });
}

/* ================= 菜单 ================= */
export function openMenu(anchor, items, opts = {}) {
  closeMenu();
  const menu = el('div', { class: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.type === 'sep') {
      menu.appendChild(el('div', { class: 'menu-sep' }));
      continue;
    }
    if (it.type === 'label') {
      menu.appendChild(el('div', { class: 'menu-label', text: it.label }));
      continue;
    }
    menu.appendChild(
      el(
        'button',
        {
          class: `menu-item ${it.danger ? 'danger' : ''} ${it.active ? 'active' : ''}`,
          onClick: () => {
            closeMenu();
            it.onClick?.();
          },
        },
        it.icon && el('span', { text: it.icon }),
        el('span', { class: 'flex1', text: it.label }),
        it.kbd && el('span', { class: 'kbd', text: it.kbd })
      )
    );
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth;
  let top = opts.align === 'right' ? r.top : r.bottom + 5;
  let left = opts.align === 'right' ? r.right - mw : r.left;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 5);
  if (left + mw > innerWidth - 8) left = Math.max(8, innerWidth - mw - 8);
  if (left < 8) left = 8;
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  activeMenu = menu;
  setTimeout(() => document.addEventListener('mousedown', onDocDown, { once: true }), 0);
  return menu;
}
let activeMenu = null;
function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
}
function onDocDown(e) {
  if (activeMenu && !activeMenu.contains(e.target)) closeMenu();
  else if (activeMenu) document.addEventListener('mousedown', onDocDown, { once: true });
}
export { closeMenu };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

/* ================= 弹层 ================= */
export function openModal({ title, body, foot, wide = false, narrow = false, onClose, icon }) {
  const overlay = el('div', {
    class: 'overlay',
    onClick: (e) => {
      if (e.target === overlay) close();
    },
  });
  const box = el('div', {
    class: `modal ${wide ? 'wide' : ''} ${narrow ? 'narrow' : ''}`,
    onClick: (e) => e.stopPropagation(),
  });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  box.appendChild(
    el(
      'div',
      { class: 'modal-head' },
      icon && el('span', { style: { fontSize: '17px' } }, icon),
      el('h2', {}, title || ''),
      el('button', { class: 'icon-btn', onClick: close, title: '关闭 (Esc)' }, '✕')
    )
  );
  const bodyNode = el('div', { class: 'modal-body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.appendChild(body);
  box.appendChild(bodyNode);
  if (foot) {
    const f = el('div', { class: 'modal-foot' });
    if (typeof foot === 'string') f.innerHTML = foot;
    else f.appendChild(foot);
    box.appendChild(f);
  }
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  setTimeout(() => {
    const first = box.querySelector('input:not([type=hidden]), textarea, select, .btn-primary');
    first?.focus();
  }, 40);
  return { close, box, body: bodyNode };
}

export function openDrawer({ title, body, foot, wide = false, onClose }) {
  const overlay = el('div', {
    class: 'overlay',
    style: { display: 'flex', justifyContent: 'flex-end', padding: '0', alignItems: 'stretch' },
    onClick: (e) => {
      if (e.target === overlay) close();
    },
  });
  const box = el('div', { class: `drawer ${wide ? 'wide' : ''}`, onClick: (e) => e.stopPropagation() });
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  box.appendChild(
    el(
      'div',
      { class: 'drawer-head' },
      el('h2', { class: 'truncate' }, title || ''),
      el('button', { class: 'icon-btn', onClick: close, title: '关闭 (Esc)' }, '✕')
    )
  );
  const bodyNode = el('div', { class: 'drawer-body' });
  if (typeof body === 'string') bodyNode.innerHTML = body;
  else if (body) bodyNode.appendChild(body);
  box.appendChild(bodyNode);
  if (foot) {
    const f = el('div', { class: 'drawer-foot' });
    if (typeof foot === 'string') f.innerHTML = foot;
    else f.appendChild(foot);
    box.appendChild(f);
  }
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  return { close, box, body: bodyNode };
}

/* ================= 渲染原语 ================= */
export function avatar(user, size = '') {
  if (!user) return el('div', { class: `avatar ${size}`, text: '?' });
  return el('div', {
    class: `avatar ${size}`,
    style: { background: user.color || 'var(--fg-3)' },
    title: user.title ? `${user.name} · ${user.title}` : user.name,
    text: user.avatar || user.name?.slice(0, 1),
  });
}

export function bar(pct, cls = '', label = '') {
  return el(
    'div',
    { class: `bar ${cls}`, title: label || `${Math.round(pct)}%` },
    el('div', { class: `bar-fill ${cls}`, style: { width: `${clamp(pct, 0, 100)}%` } })
  );
}

export function ring(pct, size = 44, stroke = 5, color) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - clamp(pct, 0, 100) / 100);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ring');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.innerHTML = `<circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>
    <circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" ${color ? `stroke="${color}"` : ''}/>`;
  return svg;
}

export function projectTag(p) {
  if (!p) return null;
  const name = p.name || p.projectName || '';
  if (!name) return null;
  return el(
    'span',
    {
      class: 'project-tag',
      style: { background: `${p.color}1f`, color: p.color },
      title: name,
    },
    el('span', { class: 'pt-dot', style: { background: p.color } }),
    el('span', { class: 'truncate' }, name)
  );
}

export function prioDot(p) {
  const meta = PRIO[p] || PRIO.med;
  return el('span', {
    class: `dot-prio ${meta.cls}`,
    title: `优先级：${meta.label}`,
    style: { background: meta.color },
  });
}

export function empty({ art = '🗒️', title = '这里还是空的', desc = '', action } = {}) {
  return el(
    'div',
    { class: 'empty' },
    el('div', { class: 'art' }, art),
    el('div', { class: 't' }, title),
    desc && el('div', { class: 'd' }, desc),
    action
  );
}

export function skeleton(n = 4) {
  return el(
    'div',
    { class: 'stack-sm' },
    ...Array.from({ length: n }, () =>
      el('div', { class: 'skel skel-card', style: { height: '62px' } })
    )
  );
}

export function statTile({ label, value, unit, meta, color, onClick, icon }) {
  return el(
    'div',
    {
      class: `stat ${onClick ? 'clickable' : ''}`,
      onClick: onClick || null,
      tabindex: onClick ? '0' : null,
      onKeydown: onClick ? (e) => e.key === 'Enter' && onClick() : null,
    },
    color && el('div', { class: 'stat-accent', style: { background: color } }),
    el('div', { class: 'stat-label' }, icon && el('span', {}, icon), label),
    el('div', { class: 'stat-value tnum' }, String(value), unit && el('small', {}, ` ${unit}`)),
    meta && el('div', { class: 'stat-meta' }, meta)
  );
}

export function insightCard(i, onAction) {
  return el(
    'div',
    { class: `insight ${i.level || 'info'}` },
    el('div', { class: 'ico' }, LEVEL_ICON[i.level] || '💡'),
    el(
      'div',
      { class: 'txt' },
      el('div', { class: 't' }, i.title),
      i.detail && el('div', { class: 'd' }, i.detail)
    ),
    (i.actionLabel || i.link) &&
      el(
        'button',
        {
          class: 'btn btn-sm btn-ghost nowrap',
          onClick: () => (i.link ? navigate(i.link) : onAction?.(i)),
        },
        i.actionLabel || '查看'
      )
  );
}

export function segmented(options, current, onChange) {
  return el(
    'div',
    { class: 'segmented' },
    ...options.map((o) =>
      el(
        'button',
        {
          class: o.value === current ? 'active' : '',
          onClick: () => o.value !== current && onChange(o.value),
          title: o.title || '',
        },
        o.icon ? `${o.icon} ${o.label}` : o.label
      )
    )
  );
}

export function field(label, control, { hint, required } = {}) {
  return el(
    'div',
    { class: 'field' },
    label && el('label', { class: 'label' }, label, required ? el('span', { class: 'req' }, '*') : null),
    control,
    hint && el('div', { class: 'hint' }, hint)
  );
}

export function selectEl(options, value, onChange, cls = '') {
  const s = el('select', {
    class: `select ${cls}`,
    onChange: (e) => onChange(e.target.value),
  });
  for (const o of options) {
    const opt = el('option', { value: o.value }, o.label);
    if (String(o.value) === String(value)) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

export function userOptions(includeEmpty) {
  const list = state.users.map((u) => ({ value: u.id, label: u.name }));
  return includeEmpty ? [{ value: '', label: '（未指派）' }, ...list] : list;
}

export function projectOptions(includeEmpty = true) {
  const list = state.projectsCache || [];
  return includeEmpty ? [{ value: '', label: '（无项目）' }, ...list.map((p) => ({ value: p.id, label: p.name }))] : list;
}

/* ================= 迷你图表（手写 SVG） ================= */
export function sparkline(data, { w = 220, h = 44, color = 'var(--accent)', fill = true } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', h);
  svg.setAttribute('preserveAspectRatio', 'none');
  const vals = data.map((d) => (typeof d === 'number' ? d : d.v ?? 0));
  const max = Math.max(1, ...vals);
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const pts = vals.map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`);
  let path = `M ${pts.join(' L ')}`;
  if (fill) {
    path += ` L ${w},${h} L 0,${h} Z`;
    svg.innerHTML = `<defs><linearGradient id="sg${Math.random().toString(36).slice(2, 7)}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${path}" fill="url(#sg)" stroke="none"/>`;
    svg.innerHTML += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  } else {
    svg.innerHTML += `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.8"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  }
  return svg;
}

export function barChart(data, { h = 150, color = 'var(--accent)', valueKey = 'v', labelKey = 'l' } = {}) {
  const max = Math.max(1, ...data.map((d) => d[valueKey]));
  return el(
    'div',
    { class: 'stack-sm' },
    el(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-end',
          gap: '3px',
          height: `${h}px`,
        },
      },
      ...data.map((d) =>
        el(
          'div',
          {
            title: `${d[labelKey]}: ${d[valueKey]}`,
            style: {
              flex: 1,
              minWidth: '3px',
              height: `${Math.max(2, (d[valueKey] / max) * 100)}%`,
              background: d.color || color,
              borderRadius: '3px 3px 0 0',
              opacity: d.dim ? 0.4 : 0.9,
              transition: 'height .3s',
            },
          }
        )
      )
    )
  );
}

export function donutChart(data, { size = 132, thickness = 20 } = {}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('ring');
  let inner = `<circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${thickness}"/>`;
  for (const d of data) {
    const len = (d.value / total) * c;
    inner += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${d.color}"
      stroke-width="${thickness}" stroke-dasharray="${len} ${c - len}"
      stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(
      d.label
    )}: ${d.value}</title></circle>`;
    offset += len;
  }
  svg.innerHTML = inner;
  return svg;
}

/* ================= 主题 ================= */
export function applyTheme(mode) {
  const m = mode || state.settings.theme || 'system';
  const dark =
    m === 'dark' || (m === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0f13' : '#f7f8fa');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if ((state.settings.theme || 'system') === 'system') applyTheme();
});

/* ================= 其他 ================= */
export async function copyText(text, label = '内容') {
  try {
    await navigator.clipboard.writeText(text);
    notifyOk(`${label}已复制到剪贴板`);
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    notifyOk(`${label}已复制`);
  }
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function initials(name) {
  return String(name || '?').trim().slice(0, 1).toUpperCase();
}