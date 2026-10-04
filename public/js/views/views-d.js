// views-d.js — 团队管理、成员详情、智能规划、报表、设置、周复盘
import {
  el, api, state, bus, navigate, toast, notifyOk, notifyErr, handleError, confirmDialog, openModal,
  avatar, bar, ring, empty, skeleton, statTile, insightCard, segmented, selectEl, field,
  barChart, donutChart, dstr, addDays, startOfWeek, fmtDate, relDate, fmtHours,
  fmtMinutes, fmtAgo, PRIO, STATUS, HEALTH, bust, copyText, downloadText, downloadJSON, applyTheme,
} from '../core.js';
import { taskRow, openTaskDrawer, promptText } from '../ui.js';

const today = () => dstr();
const loadColor = (l) => (l === 'over' ? 'var(--danger)' : l === 'high' ? 'var(--warn)' : l === 'idle' ? 'var(--fg-3)' : 'var(--ok)');
const loadBar = (l) => (l === 'over' ? 'danger' : l === 'high' ? 'warn' : 'ok');

/* ==================== 团队 ==================== */
export async function teamView(root) {
  root.appendChild(skeleton(6));
  const [teams, workload] = await Promise.all([api.get('/api/teams'), api.get('/api/workload')]);
  root.innerHTML = '';
  const memberIds = new Set();
  for (const t of teams) for (const m of t.members) memberIds.add(m.id);
  const active = workload.filter((w) => w.user && w.user.status !== 'left');

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, '👥 团队'), el('div', { class: 'sub' }, `${teams.length} 个团队 · ${memberIds.size} 位成员`)),
      el('div', { class: 'actions' }, el('button', { class: 'btn', onClick: addMember }, '+ 添加成员'), el('button', { class: 'btn btn-primary', onClick: newTeam }, '+ 新建团队'))
    )
  );

  root.appendChild(
    el(
      'div',
      { class: 'grid grid-4 mb-4' },
      statTile({ label: '团队成员', value: memberIds.size, icon: '👥', color: 'var(--c-blue)' }),
      statTile({ label: '团队项目', value: teams.reduce((a, t) => a + t.projectCount, 0), icon: '📂', color: 'var(--ok)' }),
      statTile({ label: '超负载成员', value: active.filter((w) => w.level === 'over').length, icon: '🔥', color: 'var(--danger)' }),
      statTile({ label: '本周团队工时', value: Math.round(active.reduce((a, w) => a + w.loggedThisWeek, 0) * 10) / 10, unit: 'h', icon: '⏱', color: 'var(--c-purple)' })
    )
  );

  root.appendChild(
    el(
      'div',
      { class: 'card mb-4' },
      el('div', { class: 'card-head' }, el('h3', {}, '📊 成员工作负载（本周）'), el('span', { class: 'badge' }, '百分比 = 已排工时 ÷ 该成员每周深度工作额度')),
      el(
        'div',
        { class: 'card-body stack' },
        ...active.map((w) =>
          el(
            'div',
            { style: { cursor: 'pointer' }, onClick: () => navigate(`/team/${w.userId}`) },
            el(
              'div',
              { class: 'spread fs-sm mb-2' },
              el('span', { class: 'row-tight' }, avatar(w.user, 'sm'), el('span', { class: 'strong' }, w.user.name), el('span', { class: 'muted fs-xs' }, w.user.title || '')),
              el(
                'span',
                { class: 'row-tight' },
                el('span', { class: 'muted fs-xs' }, `${w.openTasks} 项在办 · 计划 ${fmtHours(w.plannedHours)}`),
                el('span', { class: 'tnum strong', style: { color: loadColor(w.level), width: '48px', textAlign: 'right' } }, `${w.load}%`)
              )
            ),
            bar(w.load, loadBar(w.level)),
            w.overdue > 0 ? el('div', { class: 'fs-xs', style: { color: 'var(--danger)', marginTop: '3px' } }, `⚠️ ${w.overdue} 项逾期`) : null
          )
        )
      )
    )
  );

  const grid = el('div', { class: 'grid grid-2' });
  for (const t of teams) {
    grid.appendChild(
      el(
        'div',
        { class: 'card' },
        el(
          'div',
          { class: 'card-head' },
          el('span', { class: 'pt-dot', style: { background: t.color, width: '10px', height: '10px', borderRadius: '3px' } }),
          el('h3', {}, t.name),
          el('span', { class: 'badge' }, `${t.memberCount} 人`),
          el('span', { class: 'badge outline' }, `${t.projectCount} 项目`),
          el('span', { style: { flex: 1 } }),
          el('button', { class: 'icon-btn', onClick: (e) => editTeam(e.currentTarget, t) }, '⋯')
        ),
        t.description ? el('div', { class: 'muted fs-sm', style: { padding: '8px 16px 0' } }, t.description) : null,
        el(
          'div',
          { class: 'card-body' },
          el(
            'div',
            { class: 'stack-sm' },
            ...t.members.map((m) => {
              const w = active.find((x) => x.userId === m.id);
              return el(
                'div',
                { class: 'row gap-2 pointer', onClick: () => navigate(`/team/${m.id}`) },
                avatar(m, 'sm'),
                el('div', { class: 'flex1' },
                  el('div', { class: 'row-tight' }, el('span', { class: 'fs-sm' }, m.name), m.teamRole === 'lead' ? el('span', { class: 'badge accent' }, '负责人') : null),
                  el('div', { class: 'fs-xs muted' }, m.title || '')),
                w ? el('span', { class: 'fs-xs tnum', style: { color: loadColor(w.level) } }, `${w.load}%`) : null
              );
            })
          ),
          el('button', { class: 'btn btn-sm mt-3 btn-block', onClick: () => manageMembers(t) }, '管理成员')
        )
      )
    );
  }
  root.appendChild(grid);
}

function editTeam(anchor, t) {
  const nameI = el('input', { class: 'input', value: t.name });
  const desc = el('input', { class: 'input', value: t.description || '' });
  const m = openModal({
    title: '编辑团队',
    narrow: true,
    body: el('div', { class: 'stack' }, field('团队名称', nameI), field('描述', desc)),
    foot: el(
      'div',
      { style: { display: 'contents' } },
      el('button', {
        class: 'btn btn-danger btn-sm',
        onClick: async () => {
          if (!(await confirmDialog({ title: `解散「${t.name}」？`, body: '项目会保留但不再归属该团队。', danger: true, confirmText: '解散', icon: '⚠️' }))) return;
          await api.del(`/api/teams/${t.id}`);
          m.close();
          toast('已解散', { type: 'ok' });
          teamView(document.querySelector('.view'));
        },
      }, '解散'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          await api.patch(`/api/teams/${t.id}`, { name: nameI.value, description: desc.value });
          m.close();
          toast('已保存', { type: 'ok' });
          location.reload();
        },
      }, '保存')
    ),
  });
}

function manageMembers(t) {
  const body = el('div', { class: 'stack' });
  const render = async () => {
    const fresh = (await api.get('/api/teams')).find((x) => x.id === t.id);
    body.innerHTML = '';
    if (!fresh.members.length) body.appendChild(el('div', { class: 'muted fs-sm' }, '还没有成员'));
    for (const mem of fresh.members) {
      body.appendChild(
        el(
          'div',
          { class: 'row gap-2' },
          avatar(mem, 'sm'),
          el('div', { class: 'flex1' }, el('div', { class: 'fs-sm' }, mem.name), el('div', { class: 'fs-xs muted' }, mem.title || '')),
          selectEl(
            [{ value: 'lead', label: '负责人' }, { value: 'member', label: '成员' }, { value: 'observer', label: '观察者' }],
            mem.teamRole,
            async (v) => {
              await api.post(`/api/teams/${t.id}/members`, { userId: mem.id, role: v });
              toast('角色已更新', { type: 'ok' });
              render();
            },
            'sm'
          ),
          el('button', {
            class: 'icon-btn',
            title: '移出团队',
            onClick: async () => {
              await api.del(`/api/teams/${t.id}/members/${mem.id}`);
              toast('已移出', { type: 'ok' });
              render();
            },
          }, '✕')
        )
      );
    }
    const sel = el('select', { class: 'select' });
    for (const u of state.users.filter((u) => u.status !== 'left' && !fresh.members.some((m) => m.id === u.id))) {
      sel.appendChild(el('option', { value: u.id }, u.name));
    }
    body.appendChild(
      el('div', { class: 'row gap-2 mt-2' },
        el('div', { class: 'flex1' }, sel),
        el('button', {
          class: 'btn btn-primary btn-sm',
          onClick: async () => {
            if (!sel.value) return notifyErr('没有可添加的成员');
            await api.post(`/api/teams/${t.id}/members`, { userId: Number(sel.value), role: 'member' });
            toast('已加入', { type: 'ok' });
            render();
          },
        }, '添加'))
    );
  };
  render();
  openModal({ title: `管理「${t.name}」成员`, body, wide: true });
}

function newTeam() {
  const name = el('input', { class: 'input', placeholder: '团队名称' });
  const desc = el('input', { class: 'input', placeholder: '一句话说明这个团队负责什么' });
  const m = openModal({
    title: '新建团队',
    narrow: true,
    body: el('div', { class: 'stack' }, field('名称', name, { required: true }), field('描述', desc)),
    foot: el('div', { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!name.value.trim()) return notifyErr('请填写名称');
          await api.post('/api/teams', { name: name.value.trim(), description: desc.value });
          m.close();
          toast('团队已创建', { type: 'ok' });
          location.reload();
        },
      }, '创建')),
  });
}

function addMember() {
  const f = {
    name: el('input', { class: 'input' }),
    email: el('input', { class: 'input', type: 'email', placeholder: '作为登录账号' }),
    title: el('input', { class: 'input', placeholder: '职位' }),
    dept: el('input', { class: 'input', placeholder: '部门' }),
    role: selectEl([{ value: 'member', label: '普通成员' }, { value: 'lead', label: '组长' }, { value: 'admin', label: '管理员' }], 'member', (v) => (f.role.value = v)),
    focus: el('input', { class: 'input', type: 'number', value: '20', min: '1', max: '60' }),
    weekly: el('input', { class: 'input', type: 'number', value: '40', min: '1', max: '80' }),
    skills: el('input', { class: 'input', placeholder: '逗号分隔，如：前端, 架构' }),
    pwd: el('input', { class: 'input', type: 'text', placeholder: '至少 6 位' }),
  };
  const m = openModal({
    title: '添加成员',
    wide: true,
    icon: '👤',
    body: el(
      'div',
      { class: 'stack' },
      el('div', { class: 'field-row' }, field('姓名', f.name, { required: true }), field('邮箱（登录账号）', f.email)),
      el('div', { class: 'field-row' }, field('职位', f.title), field('部门', f.dept)),
      el('div', { class: 'field-row' }, field('系统角色', f.role), field('每周深度工作额度（小时）', f.focus, { hint: '自动排期按这个额度装箱' })),
      el('div', { class: 'field-row' }, field('每周总工时', f.weekly), field('技能标签', f.skills)),
      field('初始密码', f.pwd, { hint: '留空则该成员暂时无法登录，管理员可在成员页重置' })
    ),
    foot: el('div', { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!f.name.value.trim()) return notifyErr('请填写姓名');
          if (f.pwd.value && f.pwd.value.length < 6) return notifyErr('密码至少 6 位');
          try {
            await api.post('/api/users', {
              name: f.name.value.trim(), email: f.email.value, title: f.title.value, department: f.dept.value,
              role: f.role.value, focusHours: Number(f.focus.value) || 20, weeklyHours: Number(f.weekly.value) || 40,
              skills: f.skills.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean), password: f.pwd.value,
            });
            m.close();
            toast('成员已添加', { type: 'ok' });
            location.reload();
          } catch (e) {
            handleError(e, '添加失败');
          }
        },
      }, '添加')),
  });
}

/* ==================== 成员详情 ==================== */
export async function memberView(root, params = {}) {
  root.appendChild(skeleton(6));
  const d = await api.get(`/api/users/${params.id}`);
  root.innerHTML = '';
  const u = d.user;
  const w = d.load;

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el(
        'div',
        { class: 'row gap-3', style: { alignItems: 'flex-start' } },
        avatar(u, 'xl'),
        el(
          'div',
          {},
          el('h1', {}, u.name,
            el('span', { class: 'badge', style: { marginLeft: '8px' } }, u.role === 'admin' ? '管理员' : u.role === 'lead' ? '组长' : '成员'),
            u.status === 'leave' ? el('span', { class: 'badge warn', style: { marginLeft: '6px' } }, '休假') : null,
            u.status === 'left' ? el('span', { class: 'badge', style: { marginLeft: '6px' } }, '已离职') : null),
          el('div', { class: 'sub' }, [u.title, u.department, u.email, u.location].filter(Boolean).join(' · ') || '未填写资料'),
          u.manager ? el('div', { class: 'sub' }, `汇报给 ${u.manager.name}`) : null,
          u.skills?.length ? el('div', { class: 'row gap-1 mt-2' }, ...u.skills.map((s) => el('span', { class: 'badge outline' }, s))) : null
        )
      ),
      el('div', { class: 'actions' },
        el('button', { class: 'btn btn-sm', onClick: () => navigate('/team') }, '← 团队'),
        el('button', { class: 'btn btn-sm', onClick: () => editMember(u, params.id) }, '✏️ 编辑资料'),
        el('button', { class: 'btn btn-sm', onClick: () => resetPwd(u) }, '🔑 重置密码'))
    )
  );

  root.appendChild(
    el(
      'div',
      { class: 'grid grid-6 mb-4' },
      statTile({ label: '本周负载', value: w.load, unit: '%', icon: '📊', color: loadColor(w.level), meta: `${w.plannedTasks} 项已排` }),
      statTile({ label: '在办任务', value: w.openTasks, icon: '📋', color: 'var(--c-blue)', meta: `预估 ${fmtHours(w.estimateHours)}` }),
      statTile({ label: '逾期', value: w.overdue, icon: '⚠️', color: w.overdue ? 'var(--danger)' : 'var(--fg-3)' }),
      statTile({ label: '本周完成', value: w.doneThisWeek, icon: '✅', color: 'var(--ok)' }),
      statTile({ label: '本周工时', value: w.loggedThisWeek, unit: 'h', icon: '⏱', color: 'var(--c-purple)', meta: `额度 ${fmtHours(w.capacityHours)}` }),
      statTile({ label: '每周额度', value: u.focusHours, unit: 'h', icon: '🎯', color: 'var(--c-teal)', meta: `总工时 ${u.weeklyHours}h` })
    )
  );

  const grid = el('div', { class: 'split' });
  const leftCol = el('div', { class: 'stack' });

  leftCol.appendChild(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🔥 在办任务'), el('span', { class: 'badge' }, `${d.activeTasks.length}`)),
      el('div', { class: 'card-body' },
        d.activeTasks.length
          ? el('div', { class: 'stack-sm' }, ...d.activeTasks.slice(0, 18).map((t) =>
              el(
                'div',
                { class: 'row gap-2 pointer', onClick: () => openTaskDrawer(t.id) },
                el('span', { class: 'dot-prio', style: { background: PRIO[t.priority]?.color } }),
                el('span', { class: 'flex1 truncate fs-sm' }, t.title),
                el('span', { class: 'badge outline' }, STATUS[t.status]?.label),
                t.due_at ? el('span', { class: 'fs-xs muted nowrap' }, relDate(t.due_at)) : null
              )))
          : empty({ art: '✨', title: '没有在办任务' }))
    )
  );

  if (d.monthlyOutput?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '📈 月度产出')),
        el('div', { class: 'card-body' }, barChart(d.monthlyOutput.map((m) => ({ l: m.ym.slice(5), v: m.n })), { h: 120 })))
    );
  }

  if (d.projects?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '📂 参与项目')),
        el('div', { class: 'card-body' },
          el('div', { class: 'grid grid-auto-lg' }, ...d.projects.slice(0, 6).map((p) =>
            el('div', { class: 'row gap-2 pointer', onClick: () => navigate(`/projects/${p.id}`) },
              el('span', { class: 'pt-dot', style: { background: p.color } }),
              el('span', { class: 'flex1 truncate fs-sm' }, p.name),
              el('span', { class: 'badge outline' }, p.status === 'done' ? '已完成' : '进行中'))))))
    );
  }

  const rightCol = el('div', { class: 'stack' });
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
        ring(w.load, 108, 10, w.level === 'idle' ? 'var(--c-blue)' : loadColor(w.level)),
        el('div', { class: 'strong' }, `负载 ${w.load}%`),
        el('div', { class: 'muted fs-xs center', style: { textAlign: 'center' } },
          w.level === 'over' ? '超负载，建议转出部分任务' : w.level === 'high' ? '偏满，注意插单' : w.level === 'idle' ? '较空闲，可以承接更多工作' : '负载正常')))
  );
  if (d.teams?.length) {
    rightCol.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🏷 所属团队')),
      el('div', { class: 'card-body stack-sm' }, ...d.teams.map((t) =>
        el('div', { class: 'row gap-2' },
          el('span', { class: 'pt-dot', style: { background: t.color } }),
          el('span', { class: 'fs-sm' }, t.name),
          el('span', { class: 'badge outline' }, t.role === 'lead' ? '负责人' : t.role === 'observer' ? '观察者' : '成员'))))));
  }
  if (d.recentDone?.length) {
    rightCol.appendChild(el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '✅ 近期完成')),
      el('div', { class: 'card-body stack-sm' }, ...d.recentDone.slice(0, 12).map((t) =>
        el('div', { class: 'row gap-2' },
          el('span', { class: 'flex1 truncate fs-sm muted' }, t.title),
          el('span', { class: 'fs-xs muted nowrap' }, fmtAgo(t.completed_at)))))));
  }

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  root.appendChild(grid);
}

function editMember(u, id) {
  const f = {
    name: el('input', { class: 'input', value: u.name }),
    title: el('input', { class: 'input', value: u.title || '' }),
    dept: el('input', { class: 'input', value: u.department || '' }),
    email: el('input', { class: 'input', value: u.email || '' }),
    phone: el('input', { class: 'input', value: u.phone || '' }),
    loc: el('input', { class: 'input', value: u.location || '' }),
    skills: el('input', { class: 'input', value: (u.skills || []).join(', ') }),
    status: selectEl([{ value: 'active', label: '在职' }, { value: 'leave', label: '休假' }, { value: 'left', label: '离职' }], u.status, (v) => (f.status.value = v)),
    role: selectEl([{ value: 'member', label: '普通成员' }, { value: 'lead', label: '组长' }, { value: 'admin', label: '管理员' }], u.role, (v) => (f.role.value = v)),
    focus: el('input', { class: 'input', type: 'number', value: u.focusHours }),
    weekly: el('input', { class: 'input', type: 'number', value: u.weeklyHours }),
    color: el('input', { class: 'input', type: 'color', value: u.color || '#6366f1', style: { height: '34px', padding: '2px' } }),
  };
  const m = openModal({
    title: '编辑成员资料',
    wide: true,
    body: el('div', { class: 'stack' },
      el('div', { class: 'field-row' }, field('姓名', f.name), field('邮箱', f.email)),
      el('div', { class: 'field-row' }, field('职位', f.title), field('部门', f.dept)),
      el('div', { class: 'field-row' }, field('电话', f.phone), field('地点', f.loc)),
      el('div', { class: 'field-row' }, field('在职状态', f.status), field('系统角色', f.role)),
      el('div', { class: 'field-row' }, field('每周深度工作额度', f.focus), field('每周总工时', f.weekly)),
      field('技能标签', f.skills),
      field('头像颜色', f.color)),
    foot: el('div', { style: { display: 'contents' } },
      el('button', {
        class: 'btn btn-danger btn-sm',
        onClick: async () => {
          if (!(await confirmDialog({ title: `将 ${u.name} 标记为离职？`, body: '保留历史数据，但不能再登录，也不能被指派任务。', danger: true, confirmText: '确认', icon: '🚪' }))) return;
          await api.del(`/api/users/${id}`);
          m.close();
          toast('已标记离职', { type: 'ok' });
          location.reload();
        },
      }, '标记离职'),
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          try {
            await api.patch(`/api/users/${id}`, {
              name: f.name.value, title: f.title.value, department: f.dept.value, email: f.email.value,
              phone: f.phone.value, location: f.loc.value, status: f.status.value, role: f.role.value,
              focusHours: Number(f.focus.value), weeklyHours: Number(f.weekly.value),
              skills: f.skills.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean), color: f.color.value,
            });
            m.close();
            toast('已保存', { type: 'ok' });
            location.reload();
          } catch (e) {
            handleError(e, '保存失败');
          }
        },
      }, '保存')),
  });
}

async function resetPwd(u) {
  const pwd = await promptText(`重置 ${u.name} 的密码`, '设置后该成员当前所有登录会话都会失效', '', '至少 6 位');
  if (!pwd) return;
  if (pwd.length < 6) return notifyErr('密码至少 6 位');
  await api.post(`/api/users/${u.id}/password-reset`, { password: pwd });
  notifyOk('密码已重置');
}

/* ==================== 智能规划 ==================== */
export async function plannerView(root) {
  root.innerHTML = '';
  const scope = localStorage.getItem('fd-plan-scope') || 'me';
  const weekOffset = Number(localStorage.getItem('fd-plan-week') || 1);
  root.appendChild(el('div', { class: 'skel', style: { height: '140px', marginBottom: '16px' } }));

  let plan;
  try {
    plan = await api.get(`/api/planner/${weekOffset === 0 ? 'this-week' : 'next-week'}?scope=${scope}`);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(empty({ art: '😵', title: '生成失败', desc: e.message }));
    return;
  }
  root.innerHTML = '';
  const reload = () => plannerView(root);

  root.appendChild(
    el(
      'div',
      { class: 'page-head' },
      el('div', { class: 'titles' },
        el('h1', {}, '🧠 智能工作安排'),
        el('div', { class: 'sub' }, `${fmtDate(plan.weekStart, 'md')} ~ ${fmtDate(plan.weekEnd, 'md')} · 基于项目进度、任务紧急度、里程碑与时间容量自动生成，每条都给了理由`)),
      el('div', { class: 'actions' },
        segmented([{ value: 'me', label: '我的' }, { value: 'team', label: '团队' }], scope, (v) => { localStorage.setItem('fd-plan-scope', v); reload(); }),
        segmented([{ value: '0', label: '本周' }, { value: '1', label: '下周' }], String(weekOffset), (v) => { localStorage.setItem('fd-plan-week', v); reload(); }),
        el('button', { class: 'btn btn-sm', onClick: reload }, '🔄 重新生成'),
        el('button', {
          class: 'btn btn-sm',
          onClick: async () => {
            const { text } = await api.get(`/api/planner/preview?scope=${scope}`);
            copyText(text, '周计划');
          },
        }, '📋 复制'))
    )
  );

  const s = plan.summary;
  root.appendChild(
    el('div', { class: 'grid grid-6 mb-4' },
      statTile({ label: '已排任务', value: s.taskCount, unit: '项', icon: '📋', color: 'var(--c-blue)' }),
      statTile({ label: '计划工时', value: s.totalHours, unit: 'h', icon: '⏱', color: 'var(--c-purple)', meta: `容量 ${s.totalCapacity}h` }),
      statTile({ label: '利用率', value: s.utilization, unit: '%', icon: '📊', color: s.utilization > 95 ? 'var(--danger)' : s.utilization < 50 ? 'var(--fg-3)' : 'var(--ok)' }),
      statTile({ label: '固定日程', value: s.meetingHours, unit: 'h', icon: '🗓', color: 'var(--c-teal)', meta: `${s.meetingCount} 个会议` }),
      statTile({ label: '排不下', value: s.carryOver, unit: '项', icon: '📤', color: s.carryOver ? 'var(--warn)' : 'var(--fg-3)' }),
      statTile({ label: '受阻任务', value: s.blocked, unit: '项', icon: '🚧', color: s.blocked ? 'var(--c-purple)' : 'var(--fg-3)' }))
  );

  // Top 3
  const taskByTitle = new Map();
  for (const d of plan.days) for (const i of d.items) if (i.type === 'task') taskByTitle.set(i.title, i);
  if (plan.top?.length) {
    root.appendChild(
      el('div', { class: 'card mb-4', style: { borderColor: 'var(--accent-border)' } },
        el('div', { class: 'card-head' }, el('h3', {}, '⭐ 最该做的三件事'), el('span', { class: 'badge accent' }, '按重要性排序')),
        el('div', { class: 'card-body' },
          el('div', { class: 'grid grid-3' },
            ...plan.top.map((t, i) =>
              el('div', {
                class: 'insight highlight',
                style: { cursor: taskByTitle.has(t.title) ? 'pointer' : 'default' },
                onClick: () => { const it = taskByTitle.get(t.title); if (it?.taskId) openTaskDrawer(it.taskId); },
              },
                el('div', { class: 'ico' }, `${i + 1}`),
                el('div', { class: 'txt' },
                  el('div', { class: 't' }, t.title),
                  el('div', { class: 'd' }, `${fmtHours(t.hours)}${t.projectName ? ' · ' + t.projectName : ''} — ${t.why}`)))))))
    );
  }

  const grid = el('div', { class: 'split' });
  const leftCol = el('div', { class: 'stack' });
  for (const d of plan.days) {
    const tasks = d.items.filter((i) => i.type === 'task');
    const events = d.items.filter((i) => i.type === 'event');
    const over = d.plannedHours > d.capacityHours;
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', {}, d.label, el('span', { class: 'muted fs-sm', style: { fontWeight: '400', marginLeft: '8px' } }, fmtDate(d.date, 'md'))),
          el('span', { class: `badge ${over ? 'danger' : d.utilization > 85 ? 'warn' : 'ok'}` }, `${d.plannedHours}h / ${d.capacityHours}h`),
          el('span', { style: { flex: 1, maxWidth: '120px' } }, bar(d.utilization, over ? 'danger' : d.utilization > 85 ? 'warn' : 'ok'))),
        el('div', { class: 'card-body stack-sm' },
          ...events.map((e) =>
            el('div', { class: 'row gap-2 fs-sm muted' },
              el('span', { class: 'badge outline nowrap' }, `${e.time || '--:--'} 日程`),
              el('span', { class: 'truncate' }, e.title),
              el('span', { class: 'fs-xs', style: { marginLeft: 'auto' } }, fmtHours(e.hours)))),
          ...tasks.map((it) =>
            el('div', { class: 'task checkable', onClick: () => openTaskDrawer(it.taskId) },
              el('span', { class: 'pt-dot', style: { background: it.projectColor || 'var(--fg-3)' } }),
              el('span', { class: 'flex1' },
                el('div', { class: 'row-tight' },
                  el('span', { class: 'dot-prio', style: { background: PRIO[it.priority]?.color } }),
                  el('span', { class: 'task-title' }, it.title)),
                el('div', { class: 'task-meta' },
                  el('span', {}, fmtHours(it.hours)),
                  it.projectName ? el('span', { class: 'sep' }, '·') : null,
                  it.projectName ? el('span', {}, it.projectName) : null,
                  it.assigneeName ? el('span', { class: 'sep' }, '·') : null,
                  it.assigneeName ? el('span', {}, it.assigneeName) : null),
                it.reasons?.length
                  ? el('div', { class: 'task-meta', style: { color: 'var(--accent)' } }, el('span', {}, '↳ ' + it.reasons.join('、')))
                  : null),
              it.blocked ? el('span', { class: 'badge' }, '受阻') : null)),
          !tasks.length && !events.length ? el('div', { class: 'muted fs-sm', style: { padding: '8px 0' } }, '这天还很空 — 可以安排一件重要但不紧急的事') : null))
    );
  }
  grid.appendChild(leftCol);

  // 右栏：洞察 + 操作
  const rightCol = el('div', { class: 'stack' });
  const reschedBox = el('input', { type: 'checkbox' });
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '💡 建议与提醒'), el('span', { class: 'badge' }, `${plan.insights.length}`)),
      el('div', { class: 'card-body stack-sm' }, ...plan.insights.map((i) => insightCard(i))))
  );

  if (plan.blockedTasks?.length) {
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '🚧 先解阻塞'), el('span', { class: 'badge danger' }, `${plan.blockedTasks.length}`)),
        el('div', { class: 'card-body stack-sm' },
          ...plan.blockedTasks.map((b) =>
            el('div', { class: 'fs-sm' },
              el('div', { class: 'strong truncate pointer', onClick: () => openTaskDrawer(b.id) }, b.title),
              el('div', { class: 'muted fs-xs' }, b.reason)))))
    );
  }

  if (plan.unplaced?.length) {
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '📤 排不下的任务'), el('span', { class: 'badge warn' }, `${plan.unplaced.length}`)),
        el('div', { class: 'card-body stack-sm' },
          ...plan.unplaced.map((u) =>
            el('div', { class: 'fs-sm' },
              el('div', { class: 'strong truncate pointer', onClick: () => openTaskDrawer(u.taskId) }, u.title),
              el('div', { class: 'muted fs-xs' }, `${fmtHours(u.effort)} · ${u.reason}`)))))
    );
  }

  if (plan.rebalance?.length) {
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '⚖️ 负载再平衡建议')),
        el('div', { class: 'card-body stack-sm' },
          ...plan.rebalance.map((r) =>
            el('div', { class: 'insight warn' },
              el('div', { class: 'ico' }, '⚖️'),
              el('div', { class: 'txt' },
                el('div', { class: 't' }, `${r.from} → ${r.to}`),
                el('div', { class: 'd' }, r.reason),
                el('div', { class: 'row gap-1 mt-2' },
                  ...r.tasks.map((t) => el('span', { class: 'badge outline' }, `${t.title} ${fmtHours(t.hours)}`))))))))
    );
  }

  // 采纳
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '✅ 应用这份计划')),
      el('div', { class: 'card-body stack-sm' },
        el('div', { class: 'hint' }, `将 ${s.taskCount} 项任务标记为属于 ${fmtDate(plan.weekStart, 'md')} 这一周，日历与周视图会立刻反映。`),
        el('label', { class: 'check' }, reschedBox, el('span', {}, '同时按新排期改写截止日期')),
        el('div', { class: 'row gap-2' },
          el('button', {
            class: 'btn btn-primary btn-sm',
            onClick: async () => {
              try {
                const r = await api.post('/api/planner/adopt', { plan, markWeek: true, reschedule: reschedBox.checked });
                bust('tasks');
                toast(`已应用到 ${r.affected} 项任务`, { type: 'ok' });
              } catch (e) {
                handleError(e, '应用失败');
              }
            },
          }, '应用到任务'),
          el('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              try {
                await api.post('/api/planner/draft', { plan });
                notifyOk('已保存为草稿');
              } catch (e) {
                handleError(e, '保存失败');
              }
            },
          }, '存为草稿'),
          el('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              const { text } = await api.get(`/api/planner/preview?scope=${scope}`);
              downloadText(text, `下周安排-${plan.weekStart}.txt`);
            },
          }, '导出 .txt'))))
  );

  grid.appendChild(rightCol);
  root.appendChild(grid);

  // 历史草稿
  try {
    const plans = await api.get('/api/plans');
    if (plans.length > 1) {
      root.appendChild(
        el('div', { class: 'card mt-4' },
          el('div', { class: 'card-head' }, el('h3', {}, '🗂 历史计划')),
          el('div', { class: 'table-wrap' },
            el('table', { class: 'tbl' },
              el('thead', {}, el('tr', {}, el('th', {}, '周次'), el('th', {}, '范围'), el('th', {}, '任务数'), el('th', {}, '状态'), el('th', {}, '创建时间'))),
              el('tbody', {}, ...plans.map((p) =>
                el('tr', {},
                  el('td', {}, fmtDate(p.weekStart, 'md')),
                  el('td', {}, p.scope === 'team' ? '团队' : '个人'),
                  el('td', {}, p.summary?.taskCount ?? '—'),
                  el('td', {}, el('span', { class: `badge ${p.status === 'adopted' ? 'ok' : 'outline'}` }, p.status === 'adopted' ? '已应用' : '草稿')),
                  el('td', { class: 'muted fs-xs' }, fmtAgo(p.createdAt))))))))
      );
    }
  } catch {}
}

/* ==================== 报表 ==================== */
export async function reportsView(root) {
  root.innerHTML = '';
  const days = localStorage.getItem('fd-report-days') || '30';
  const scope = localStorage.getItem('fd-report-scope') || 'mine';
  root.appendChild(el('div', { class: 'skel', style: { height: '180px' } }));
  const r = await api.get(`/api/reports/summary?days=${days}&scope=${scope}`);
  root.innerHTML = '';
  const reload = () => reportsView(root);

  root.appendChild(
    el('div', { class: 'page-head' },
      el('div', { class: 'titles' },
        el('h1', {}, '📈 报表'),
        el('div', { class: 'sub' }, `${fmtDate(r.from, 'md')} ~ ${fmtDate(r.to, 'md')} · 完成 ${r.totals.completed} 项 / ${r.totals.hours}h`)),
      el('div', { class: 'actions' },
        segmented([{ value: 'mine', label: '我的' }, { value: 'team', label: '团队' }], scope, (v) => { localStorage.setItem('fd-report-scope', v); reload(); }),
        segmented([{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }], days, (v) => { localStorage.setItem('fd-report-days', v); reload(); }),
        el('button', { class: 'btn btn-sm', onClick: async () => downloadJSON(r, `报表-${r.from}_${r.to}.json`) }, '导出')))
  );

  root.appendChild(
    el('div', { class: 'grid grid-4 mb-4' },
      statTile({ label: '完成任务', value: r.totals.completed, unit: '项', icon: '✅', color: 'var(--ok)' }),
      statTile({ label: '记录工时', value: r.totals.hours, unit: 'h', icon: '⏱', color: 'var(--c-purple)' }),
      statTile({ label: '日均完成', value: Math.round((r.totals.completed / Number(days)) * 10) / 10, unit: '项/天', icon: '📈', color: 'var(--c-blue)' }),
      statTile({ label: '日均工时', value: Math.round((r.totals.hours / Number(days)) * 10) / 10, unit: 'h/天', icon: '⏱', color: 'var(--c-teal)' }))
  );

  const grid = el('div', { class: 'grid grid-2 mb-4' });
  grid.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '每日完成数')),
      el('div', { class: 'card-body' },
        r.completedByDay.length
          ? barChart(r.completedByDay.map((x) => ({ l: fmtDate(x.date, 'md'), v: x.count })), { h: 140, color: 'var(--ok)' })
          : empty({ art: '📉', title: '这段时间没有完成记录' })))
  );
  grid.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '每日工时')),
      el('div', { class: 'card-body' },
        r.hoursByDay.length
          ? barChart(r.hoursByDay.map((x) => ({ l: fmtDate(x.date, 'md'), v: x.hours })), { h: 140, color: 'var(--c-purple)' })
          : empty({ art: '📉', title: '还没有工时记录', desc: '在任务上点 ⏱ 记录工时。' })))
  );
  root.appendChild(grid);

  const grid2 = el('div', { class: 'split' });
  const leftCol = el('div', { class: 'stack' });

  if (r.byProject?.length) {
    const total = r.byProject.reduce((a, b) => a + b.count, 0);
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '按项目完成分布')),
        el('div', { class: 'card-body' },
          el('div', { class: 'row gap-4' },
            donutChart(r.byProject.slice(0, 6).map((p) => ({ label: p.name, value: p.count, color: p.color }))),
            el('div', { class: 'flex1 stack-sm' },
              ...r.byProject.slice(0, 8).map((p) =>
                el('div', { class: 'spread fs-sm' },
                  el('span', { class: 'row-tight truncate' }, el('span', { class: 'pt-dot', style: { background: p.color } }), el('span', { class: 'truncate' }, p.name)),
                  el('span', { class: 'muted tnum nowrap' }, `${p.count} 项 ${Math.round((p.count / total) * 100)}%`)))))))
    );
  }

  if (r.byPerson?.length && scope === 'team') {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '成员产出对比')),
        el('div', { class: 'table-wrap' },
          el('table', { class: 'tbl' },
            el('thead', {}, el('tr', {}, el('th', {}, '成员'), el('th', { class: 'num' }, '完成'), el('th', { class: 'num' }, '在办'), el('th', { class: 'num' }, '工时'))),
            el('tbody', {}, ...r.byPerson.map((p) =>
              el('tr', { style: { cursor: 'pointer' }, onClick: () => navigate(`/team/${p.id}`) },
                el('td', {}, el('span', { class: 'row-tight' }, avatar(p, 'sm'), el('span', {}, p.name), p.title ? el('span', { class: 'muted fs-xs' }, p.title) : null)),
                el('td', { class: 'num strong' }, p.done),
                el('td', { class: 'num muted' }, p.open),
                el('td', { class: 'num' }, fmtHours(p.hours))))))))
    );
  }

  if (r.byProject?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '按项目工时分布')),
        el('div', { class: 'card-body stack-sm' },
          ...r.hoursByProject.map((p) => {
            const max = Math.max(...r.hoursByProject.map((x) => x.hours));
            return el('div', {},
              el('div', { class: 'spread fs-sm mb-2' }, el('span', { class: 'row-tight' }, el('span', { class: 'pt-dot', style: { background: p.color } }), el('span', {}, p.name)), el('span', { class: 'tnum' }, fmtHours(p.hours))),
              bar((p.hours / max) * 100));
          })))
    );
  }

  const rightCol = el('div', { class: 'stack' });

  const statusMap = { backlog: '待规划', todo: '待办', doing: '进行中', review: '待验收', done: '已完成', cancelled: '已取消' };
  const statusColors = { backlog: '#94a3b8', todo: '#0091ff', doing: '#f76b15', review: '#8e4ec6', done: '#30a46c', cancelled: '#475569' };
  if (r.byStatus?.length) {
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '任务状态分布')),
        el('div', { class: 'card-body', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' } },
          donutChart(r.byStatus.map((s) => ({ label: statusMap[s.key] || s.key, value: s.count, color: statusColors[s.key] })), { size: 148 }),
          el('div', { class: 'row gap-2 wrap center' },
            ...r.byStatus.map((s) => el('span', { class: 'badge' }, el('span', { class: 'pt-dot', style: { background: statusColors[s.key] } }), `${statusMap[s.key] || s.key} ${s.count}`)))))
    );
  }

  if (r.byTag?.length) {
    const max = Math.max(...r.byTag.map((t) => t.count));
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '高频标签')),
        el('div', { class: 'card-body stack-sm' },
          ...r.byTag.map((t) =>
            el('div', { class: 'row gap-2' },
              el('span', { class: 'chip' }, '#' + t.tag),
              el('span', { class: 'flex1' }, bar((t.count / max) * 100)),
              el('span', { class: 'muted fs-xs tnum' }, t.count)))))
    );
  }

  grid2.appendChild(leftCol);
  grid2.appendChild(rightCol);
  root.appendChild(grid2);
}

/* ==================== 周复盘 ==================== */
export async function reviewView(root) {
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'skel', style: { height: '200px' } }));
  const r = await api.get('/api/review/weekly');
  root.innerHTML = '';

  root.appendChild(
    el('div', { class: 'page-head' },
      el('div', { class: 'titles' },
        el('h1', {}, '🪞 周复盘'),
        el('div', { class: 'sub' }, `${fmtDate(r.weekStart, 'md')} ~ ${fmtDate(r.weekEnd, 'md')}`)),
      el('div', { class: 'actions' }, el('button', { class: 'btn btn-sm', onClick: () => navigate('/planner') }, '🧠 看下周安排')))
  );

  root.appendChild(
    el('div', { class: 'grid grid-4 mb-4' },
      statTile({ label: '本周完成', value: r.doneCount, unit: '项', icon: '✅', color: 'var(--ok)', meta: `${r.doneHours}h` }),
      statTile({ label: '未完成', value: r.notDoneCount, unit: '项', icon: '⏳', color: 'var(--warn)' }),
      statTile({ label: '顺延任务', value: r.carryOver.length, unit: '项', icon: '🔁', color: r.carryOver.length > 3 ? 'var(--danger)' : 'var(--fg-3)', meta: '从之前拖过来的' }),
      statTile({ label: '下周已排', value: r.plan?.summary?.taskCount || 0, unit: '项', icon: '🧠', color: 'var(--c-blue)' }))
  );

  const grid = el('div', { class: 'split' });
  const leftCol = el('div', { class: 'stack' });

  if (r.carryOver?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '🔁 反复顺延的任务'), el('span', { class: 'badge warn' }, `${r.carryOver.length}`)),
        el('div', { class: 'card-body' },
          el('div', { class: 'hint mb-3' }, '这些任务已经推迟过多次。要么今天做掉，要么删掉——反复顺延的任务会持续侵蚀计划的可信度。'),
          el('div', { class: 'stack-sm' },
            ...r.carryOver.map((c) =>
              el('div', { class: 'row gap-2' },
                el('span', { class: 'flex1 truncate fs-sm pointer', onClick: () => navigate('/tasks?overdue=1') }, c.title),
                c.projectName ? el('span', { class: 'badge outline' }, c.projectName) : null,
                el('span', { class: 'badge danger' }, `迟 ${c.weeksLate} 周`))))))
    );
  }

  if (r.byProject?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '⏱ 本周时间去向')),
        el('div', { class: 'card-body' },
          el('div', { class: 'stack-sm' },
            ...r.byProject.filter((p) => p.hours > 0).map((p) =>
              el('div', {},
                el('div', { class: 'spread fs-sm mb-2' },
                  el('span', { class: 'row-tight' }, el('span', { class: 'pt-dot', style: { background: p.color } }), el('span', {}, p.name || '未归属项目')),
                  el('span', { class: 'tnum' }, `${fmtHours(p.hours)} · ${p.tasks} 项`)),
                bar((p.hours / Math.max(...r.byProject.map((x) => x.hours))) * 100))))))
    );
  }

  if (r.completed?.length) {
    leftCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '✅ 本周完成'), el('span', { class: 'badge ok' }, `${r.completed.length}`)),
        el('div', { class: 'card-body stack-sm' }, ...r.completed.map((t) => taskRow(t, { showAssignee: false }))))
    );
  }

  const rightCol = el('div', { class: 'stack' });
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '✍️ 复盘提示')),
      el('div', { class: 'card-body' },
        el('ul', { class: 'stack-sm fs-sm', style: { paddingLeft: '18px', margin: 0, lineHeight: '1.7' } },
          ...r.prompts.map((p) => el('li', {}, p)))))
  );

  if (r.remaining?.length) {
    rightCol.appendChild(
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, '⏳ 本周未完成'), el('span', { class: 'badge' }, `${r.remaining.length}`)),
        el('div', { class: 'card-body stack-sm scroll-y', style: { maxHeight: '400px' } },
          ...r.remaining.map((t) => taskRow(t, { showAssignee: false }))))
    );
  }

  grid.appendChild(leftCol);
  grid.appendChild(rightCol);
  root.appendChild(grid);
}

/* ==================== 设置 ==================== */
export async function settingsView(root) {
  root.innerHTML = '';
  const [s, me] = await Promise.all([api.get('/api/settings'), Promise.resolve(state.user)]);
  root.appendChild(
    el('div', { class: 'page-head' },
      el('div', { class: 'titles' }, el('h1', {}, '⚙️ 设置'), el('div', { class: 'sub' }, '工作习惯、外观与数据管理')),
      el('div', { class: 'actions' }, el('button', { class: 'btn btn-sm btn-primary', onClick: saveAll }, '保存设置')))
  );

  const f = {};
  const mk = (k, node) => { f[k] = node; return node; };

  const grid = el('div', { class: 'split' });
  const leftCol = el('div', { class: 'stack' });

  // 工作习惯
  const dayChecks = el('div', { class: 'row gap-2 wrap' });
  const wd = new Set(String(s.work_days || '1,2,3,4,5').split(',').map(Number));
  for (let i = 0; i < 7; i++) {
    const cb = el('input', { type: 'checkbox', checked: wd.has(i) });
    cb.addEventListener('change', () => (cb.checked ? wd.add(i) : wd.delete(i)));
    dayChecks.appendChild(el('label', { class: 'check' }, cb, el('span', {}, ['日', '一', '二', '三', '四', '五', '六'][i])));
  }

  leftCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🕘 工作习惯')),
      el('div', { class: 'card-body stack' },
        el('div', { class: 'field-row' }, field('上班时间', mk('work_start', el('input', { class: 'input', type: 'time', value: s.work_start }))), field('下班时间', mk('work_end', el('input', { class: 'input', type: 'time', value: s.work_end })))),
        field('工作日', dayChecks, { hint: '自动排期只会把任务放进这些日子' }),
        el('div', { class: 'field-row' },
          field('每周深度工作额度（小时）', mk('day_focus_hours', el('input', { class: 'input', type: 'number', value: me.focusHours, min: '1', max: '60' })), { hint: '扣除会议后可排任务的总时长，自动排期按它装箱' }),
          field('每天目标深度工作（小时）', mk('focus_hours', el('input', { class: 'input', type: 'number', value: s.day_focus_hours || '4', min: '1', max: '12' })))),
        el('div', { class: 'field-row' },
          field('日历开始显示', mk('calendar_start', el('input', { class: 'input', type: 'time', value: s.calendar_start || '08:00' }))),
          field('日历结束显示', mk('calendar_end', el('input', { class: 'input', type: 'time', value: s.calendar_end || '20:00' }))))))
  );

  // 外观
  leftCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '🎨 外观与提醒')),
      el('div', { class: 'card-body stack' },
        field('主题', mk('theme', segmented(
          [{ value: 'light', label: '☀️ 亮色' }, { value: 'dark', label: '🌙 暗色' }, { value: 'system', label: '🖥 跟随系统' }],
          s.theme || 'system',
          (v) => { f.theme.value = v; applyTheme(v); }
        ))),
        el('label', { class: 'check' }, mk('notify_overdue', el('input', { type: 'checkbox', checked: s.notify_overdue === '1' })), el('span', {}, '任务逾期时提醒我')),
        el('label', { class: 'check' }, mk('notify_due_soon', el('input', { type: 'checkbox', checked: s.notify_due_soon === '1' })), el('span', {}, '48 小时内到期时提醒我')),
        el('label', { class: 'check' }, mk('notify_daily', el('input', { type: 'checkbox', checked: s.notify_daily === '1' })), el('span', {}, '每天早上汇总今日日程与待办'))))
  );

  // 个人资料
  const pf = {
    name: el('input', { class: 'input', value: me.name }),
    email: el('input', { class: 'input', value: me.email || '' }),
    title: el('input', { class: 'input', value: me.title || '' }),
    dept: el('input', { class: 'input', value: me.department || '' }),
    phone: el('input', { class: 'input', value: me.phone || '' }),
    loc: el('input', { class: 'input', value: me.location || '' }),
    weekly: el('input', { class: 'input', type: 'number', value: me.weeklyHours }),
    focus: el('input', { class: 'input', type: 'number', value: me.focusHours }),
    color: el('input', { class: 'input', type: 'color', value: me.color || '#6366f1', style: { height: '34px', padding: '2px' } }),
    avatar: el('input', { class: 'input', value: me.avatar || '', maxlength: 2 }),
  };
  leftCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '👤 个人资料')),
      el('div', { class: 'card-body stack' },
        el('div', { class: 'field-row' }, field('姓名', pf.name), field('邮箱', pf.email)),
        el('div', { class: 'field-row' }, field('职位', pf.title), field('部门', pf.dept)),
        el('div', { class: 'field-row' }, field('电话', pf.phone), field('办公地点', pf.loc)),
        el('div', { class: 'field-row' }, field('每周总工时', pf.weekly), field('每周深度工作额度', pf.focus)),
        el('div', { class: 'field-row' }, field('头像文字', pf.avatar, { hint: '1-2 个字' }), field('头像颜色', pf.color)),
        el('div', { class: 'row gap-2' },
          el('button', {
            class: 'btn btn-primary btn-sm',
            onClick: async () => {
              await api.patch('/api/auth/profile', {
                name: pf.name.value, email: pf.email.value, title: pf.title.value, department: pf.dept.value,
                phone: pf.phone.value, location: pf.loc.value, weeklyHours: Number(pf.weekly.value),
                focusHours: Number(pf.focus.value), color: pf.color.value, avatar: pf.avatar.value,
              });
              state.user = (await api.get('/api/bootstrap')).user;
              notifyOk('资料已保存');
              location.reload();
            },
          }, '保存资料'),
          el('button', {
            class: 'btn btn-sm',
            onClick: async () => {
              const pwd = await promptText('修改密码', '需要输入原密码');
              if (!pwd) return;
              // 简化：弹一个带两个输入框的表单
              document.querySelector('.overlay')?.remove();
              const o1 = el('input', { class: 'input', type: 'password', placeholder: '原密码' });
              const n1 = el('input', { class: 'input', type: 'password', placeholder: '新密码（至少 6 位）' });
              const m = openModal({
                title: '修改密码',
                narrow: true,
                body: el('div', { class: 'stack' }, field('原密码', o1), field('新密码', n1)),
                foot: el('div', { style: { display: 'contents' } },
                  el('span', { class: 'spacer' }),
                  el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
                  el('button', {
                    class: 'btn btn-primary',
                    onClick: async () => {
                      try {
                        await api.post('/api/auth/password', { oldPassword: o1.value, newPassword: n1.value });
                        m.close();
                        notifyOk('密码已修改');
                      } catch (e) { handleError(e, '修改失败'); }
                    },
                  }, '确认修改')),
              });
            },
          }, '🔑 修改密码'))))
  );

  // 数据
  leftCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '💾 数据管理')),
      el('div', { class: 'card-body stack-sm' },
        el('div', { class: 'row gap-2 wrap' },
          el('button', { class: 'btn btn-sm', onClick: async () => { const d = await api.get('/api/admin/export'); downloadJSON(d, `flowdesk-备份-${dstr()}.json`); notifyOk('已导出'); } }, '导出全部数据'),
          el('button', { class: 'btn btn-sm', onClick: () => importDialog() }, '导入备份'),
          el('button', { class: 'btn btn-sm', onClick: async () => { const r = await api.post('/api/admin/backup', {}); notifyOk(`已备份到 ${r.file.split('/').pop()}`); } }, '立即备份'),
          el('button', { class: 'btn btn-sm', onClick: () => csvDialog() }, 'CSV 导入')),
        el('div', { class: 'hint' }, '导出的 JSON 包含任务、项目、成员、工时等全部数据（不含密码），可在另一台机器上完整恢复。')))
  );

  grid.appendChild(leftCol);

  const rightCol = el('div', { class: 'stack' });
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '⌨️ 快捷键')),
      el('div', { class: 'card-body stack-sm fs-sm' },
        ...[
          ['⌘/Ctrl + K', '全局搜索 / 命令面板'],
          ['N', '新建任务'],
          ['G 然后 D/T/C/P/W', '跳转到 仪表盘/任务/日历/项目/规划'],
          ['T', '回到今天'],
          ['1 / 2 / 3', '切换任务视图：列表/看板/分组'],
          ['Esc', '关闭弹层'],
          ['?', '显示快捷键'],
        ].map(([k, v]) => el('div', { class: 'spread' }, el('span', { class: 'muted' }, v), el('kbd', { class: 'k' }, k)))))
  );
  rightCol.appendChild(
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, '💡 使用建议')),
      el('div', { class: 'card-body' },
        el('ul', { class: 'stack-sm fs-sm', style: { paddingLeft: '18px', margin: 0, lineHeight: '1.75' } },
          el('li', {}, '标题里写「下周三下午2点 评审 #发布 P1 2小时」，日期/标签/优先级/预估会自动填好。'),
          el('li', {}, '在项目里写「下一步」，自动排期会优先推进它。'),
          el('li', {}, '任务卡在某个「 › 」上，标记为受阻，它会被排到解阻塞前面。'),
          el('li', {}, '每周看一眼「智能安排」和「周复盘」，这两页能让计划保持可信。'))))
  );
  grid.appendChild(rightCol);
  root.appendChild(grid);

  async function saveAll() {
    const payload = {
      work_start: f.work_start.value,
      work_end: f.work_end.value,
      work_days: [...wd].sort().join(','),
      day_focus_hours: f.day_focus_hours.value,
      calendar_start: f.calendar_start.value,
      calendar_end: f.calendar_end.value,
      theme: f.theme.value,
      notify_overdue: f.notify_overdue.checked ? '1' : '0',
      notify_due_soon: f.notify_due_soon.checked ? '1' : '0',
      notify_daily: f.notify_daily.checked ? '1' : '0',
    };
    await api.patch('/api/settings', payload);
    await api.patch('/api/auth/profile', { focusHours: Number(f.focus_hours.value) });
    state.settings = await api.get('/api/settings');
    applyTheme(state.settings.theme);
    notifyOk('设置已保存');
  }
}

function importDialog() {
  const file = el('input', { type: 'file', accept: '.json' });
  const mode = selectEl([{ value: 'replace', label: '覆盖（清空现有数据）' }, { value: 'merge', label: '合并（保留现有数据）' }], 'replace', (v) => (mode.value = v));
  const m = openModal({
    title: '导入备份',
    narrow: true,
    body: el('div', { class: 'stack' }, field('备份文件', file), field('导入方式', mode, { hint: '覆盖会删除当前所有数据，请谨慎。' })),
    foot: el('div', { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!file.files[0]) return notifyErr('请选择文件');
          try {
            const text = await file.files[0].text();
            const data = JSON.parse(text);
            if (!(await confirmDialog({ title: '确认导入？', body: `将以「${mode.value === 'replace' ? '覆盖' : '合并'}」方式导入，操作不可撤销。`, danger: mode.value === 'replace', confirmText: '导入', icon: '📥' }))) return;
            const r = await api.post('/api/admin/import', { data, mode: mode.value });
            m.close();
            notifyOk(`导入完成：${Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join('，')}`);
            setTimeout(() => location.reload(), 900);
          } catch (e) {
            handleError(e, '导入失败');
          }
        },
      }, '导入')),
  });
}

function csvDialog() {
  const kind = selectEl([{ value: 'tasks', label: '任务' }, { value: 'projects', label: '项目' }, { value: 'users', label: '成员' }], 'tasks', (v) => (kind.value = v));
  const ta = el('textarea', { class: 'textarea', style: { minHeight: '160px', fontFamily: 'var(--font-mono)', fontSize: '12px' }, placeholder: '标题,项目,优先级,截止日期,预估工时\n补齐个税逻辑,薪资管理系统重构,高,2026-11-01,3' });
  const result = el('div', { class: 'fs-sm' });
  const m = openModal({
    title: 'CSV 导入',
    wide: true,
    body: el('div', { class: 'stack' },
      field('导入类型', kind),
      field('粘贴 CSV 内容', ta, { hint: '第一行是表头，支持中文列名（标题/项目/负责人/状态/优先级/截止日期/预估工时/标签）。"截止日期"也可以写"下周五"这样的说法。' }),
      result),
    foot: el('div', { style: { display: 'contents' } },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onClick: () => m.close() }, '取消'),
      el('button', {
        class: 'btn',
        onClick: async () => {
          const r = await api.post('/api/admin/import/csv', { kind: kind.value, text: ta.value, dryRun: true });
          result.innerHTML = `试运行结果：将导入 <b>${r.created}</b> 行`;
          result.dataset.dry = '1';
        },
      }, '试运行'),
      el('button', {
        class: 'btn btn-primary',
        onClick: async () => {
          if (!result.dataset.dry) return notifyErr('请先点「试运行」确认');
          const r = await api.post('/api/admin/import/csv', { kind: kind.value, text: ta.value });
          m.close();
          bust('tasks');
          toast(`已导入 ${r.created} 行`, { type: 'ok' });
          location.reload();
        },
      }, '正式导入')),
  });
}