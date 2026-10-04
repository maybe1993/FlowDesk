// 压力数据生成：造一个大到能暴露性能问题的库（默认 15 人 / 20 项目 / 900 任务 / 4000 工时）
import { db, all, get, insert, run, tx, now, setMeta } from '../server/db.js';
import { hashPassword } from '../server/auth.js';
import { dateStr, addDaysStr, startOfWeekStr } from '../server/util.js';

const USERS = Number(process.env.PN || 15);
const PROJECTS = Number(process.env.PJ || 20);
const TASKS = Number(process.env.PT || 900);
const LOGS = Number(process.env.PL || 4000);
const EVENTS = Number(process.env.PE || 600);

const TODAY = dateStr();
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6'];
const DEPTS = ['研发', '产品', '质量', '设计', '运营', '市场', '销售', '客户成功'];

console.log('清空旧数据…');
for (const t of ['work_logs', 'activity', 'plans', 'notifications', 'tasks', 'milestones', 'projects', 'team_members', 'teams', 'settings', 'users', 'sessions']) {
  run(`DELETE FROM ${t}`);
}
run('DELETE FROM sqlite_sequence');

const t0 = Date.now();
tx(() => {
  // 用户
  const uids = [];
  for (let i = 0; i < USERS; i++) {
    const id = insert('users', {
      name: `成员${String(i + 1).padStart(2, '0')}`,
      email: `u${i + 1}@load.test`,
      password_hash: i === 0 ? hashPassword('load1234') : null,
      role: i === 0 ? 'admin' : i < 4 ? 'lead' : 'member',
      title: pick(['工程师', '设计师', '产品经理', '测试', '运营', '分析师']),
      department: pick(DEPTS),
      manager_id: null,
      avatar: '人',
      color: PALETTE[i % PALETTE.length],
      skills: JSON.stringify(['技能' + rint(1, 5)]),
      weekly_hours: 40,
      focus_hours: rint(16, 26),
      status: 'active',
      joined_at: addDaysStr(TODAY, -rint(100, 900)),
      created_at: now(),
      is_demo: 1,
    });
    uids.push(id);
  }
  for (const id of uids) update_manager(id, uids[0]);

  // 团队
  const teamIds = [];
  for (let t = 0; t < 4; t++) {
    const tid = insert('teams', {
      name: `团队${t + 1}`, code: `T${t + 1}`,
      description: `第 ${t + 1} 个交付团队`,
      color: PALETTE[t % PALETTE.length], lead_id: uids[t * 3 % uids.length], created_at: now(),
    });
    teamIds.push(tid);
    for (let i = t; i < uids.length; i += 4) {
      insert('team_members', { team_id: tid, user_id: uids[i], role: i === t ? 'lead' : 'member', joined_at: TODAY });
    }
  }

  // 项目
  const pids = [];
  for (let p = 0; p < PROJECTS; p++) {
    const start = addDaysStr(TODAY, -rint(10, 120));
    const pid = insert('projects', {
      name: `项目${String(p + 1).padStart(2, '0')} ${pick(['重构', '改版', '自动化', '优化', '迁移', '集成'])}`,
      key: `P${p + 1}`,
      description: '压力测试用项目，覆盖多状态多负责人场景。',
      kind: p % 5 === 4 ? 'personal' : 'team',
      team_id: p % 5 === 4 ? null : teamIds[p % teamIds.length],
      owner_id: pick(uids),
      status: pick(['active', 'active', 'active', 'planning', 'paused', 'done']),
      priority: pick(['low', 'med', 'med', 'high', 'urgent']),
      health: 'good',
      start_date: start,
      due_date: addDaysStr(start, rint(30, 200)),
      color: PALETTE[p % PALETTE.length],
      tags: JSON.stringify(['压测', pick(['Q3', 'Q4', '长期'])]),
      budget_hours: rint(100, 800),
      created_by: uids[0], created_at: now(), updated_at: now(),
    });
    pids.push(pid);
    for (let m = 0; m < rint(3, 7); m++) {
      insert('milestones', {
        project_id: pid, name: `里程碑 ${m + 1}`,
        due_date: addDaysStr(start, rint(10, 180)),
        status: pick(['planned', 'doing', 'done']), owner_id: pick(uids), sort: m + 1, created_at: now(),
      });
    }
  }

  // 任务
  const tids = [];
  for (let i = 0; i < TASKS; i++) {
    const pid = pids[i % pids.length];
    const roll = Math.random();
    const status = roll < 0.35 ? 'done' : roll < 0.58 ? 'doing' : roll < 0.68 ? 'review' : roll < 0.76 ? 'backlog' : 'todo';
    const isDone = status === 'done';
    const offset = isDone ? -rint(0, 45) : rint(-8, 60);
    const due = addDaysStr(TODAY, offset);
    const est = pick([1, 2, 3, 4, 5, 6, 8, 12, 20]);
    const id = insert('tasks', {
      title: `任务${i + 1} ${pick(['优化', '修复', '实现', '联调', '设计', '评审', '补充', '重构'])}${pick(['接口', '页面', '流程', '数据', '文档'])}`,
      notes: Math.random() < 0.3 ? '一些补充说明 '.repeat(rint(1, 5)) : null,
      kind: 'task',
      project_id: pid,
      parent_id: null,
      milestone_id: null,
      team_id: null,
      assignee_id: pick(uids),
      creator_id: uids[0],
      status,
      priority: pick(['low', 'med', 'med', 'high', 'urgent']),
      start_at: null,
      due_at: due,
      all_day: 1,
      tags: JSON.stringify(Math.random() < 0.5 ? [pick(['前端', '后端', '发布', '优化', '调研'])] : []),
      estimate_hours: est,
      actual_hours: isDone ? Math.round(est * (0.6 + Math.random()) * 10) / 10 : Math.round(est * Math.random() * 0.5 * 10) / 10,
      pinned: !isDone && Math.random() < 0.05 ? 1 : 0,
      week_start: isDone ? null : startOfWeekStr(due, 1),
      blocked: !isDone && Math.random() < 0.08 ? 1 : 0,
      blocked_reason: null,
      order_index: Date.now() / 1e6 + i,
      created_at: `${addDaysStr(TODAY, offset - rint(1, 30))}T09:00:00`,
      updated_at: `${addDaysStr(TODAY, -rint(0, 10))}T15:00:00`,
      completed_at: isDone ? `${addDaysStr(TODAY, offset)}T18:00:00` : null,
    });
    tids.push(id);
  }

  // 子任务
  for (let i = 0; i < Math.floor(TASKS / 12); i++) {
    const parent = pick(tids);
    for (let c = 0; c < rint(2, 4); c++) {
      const done = Math.random() < 0.6;
      insert('tasks', {
        title: `子任务 ${c + 1}`, kind: 'task', project_id: null, parent_id: parent,
        assignee_id: pick(uids), creator_id: uids[0], status: done ? 'done' : 'todo',
        priority: 'med', due_at: addDaysStr(TODAY, rint(-5, 20)), estimate_hours: 2,
        actual_hours: done ? 2 : 0, completed_at: done ? `${TODAY}T12:00:00` : null,
        created_at: now(), updated_at: now(),
      });
    }
  }

  // 日程
  for (let i = 0; i < EVENTS; i++) {
    const d = addDaysStr(TODAY, rint(-40, 40));
    const hh = rint(9, 18);
    const dur = pick([30, 45, 60, 90]);
    const start = `${d}T${String(hh).padStart(2, '0')}:00`;
    const endM = hh * 60 + dur;
    insert('tasks', {
      title: pick(['站会', '周会', '评审', '对齐', '面试', '培训', '客户会议']),
      kind: 'event', assignee_id: pick(uids), creator_id: uids[0], status: 'todo',
      priority: 'med', start_at: `${d}T${String(Math.floor(endM / 60) % 24).padStart(2, '0')}:${String(endM % 60).padStart(2, '0')}`,
      due_at: start, all_day: 0, week_start: startOfWeekStr(d, 1),
      created_at: now(), updated_at: now(),
    });
  }

  // 工时
  for (let i = 0; i < LOGS; i++) {
    const t = pick(tids);
    const row = get('SELECT project_id FROM tasks WHERE id=?', t);
    insert('work_logs', {
      task_id: t, project_id: row?.project_id ?? null, user_id: pick(uids),
      minutes: pick([30, 45, 60, 90, 120]), note: null,
      log_date: addDaysStr(TODAY, -rint(0, 45)), created_at: now(),
    });
  }

  // 通知
  for (let i = 0; i < 20; i++) {
    insert('notifications', {
      user_id: pick(uids), type: 'info', title: `通知 ${i + 1}`, body: '压测数据',
      link: '#/dashboard', level: pick(['info', 'warn', 'danger']),
      read: Math.random() < 0.5 ? 1 : 0, dedupe_key: null, created_at: now(),
    });
  }

  setMeta('seededAt', now());
  setMeta('loadTest', '1');
});

function update_manager(id, managerId) {
  run('UPDATE users SET manager_id=? WHERE id=?', managerId, id);
}

const size = (await import('node:fs')).statSync(process.env.FLOWDESK_DB || 'data/flowdesk.db').size;
console.log(`\n✓ 压测数据生成完毕（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
console.log(`  ${USERS} 成员 / ${PROJECTS} 项目 / ${TASKS} 任务 + 子任务 / ${EVENTS} 日程 / ${LOGS} 工时记录`);
console.log(`  数据库 ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  登录：u1@load.test / load1234`);