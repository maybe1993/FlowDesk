// 演示数据：一个真实感的小团队 + 3 个月的项目/任务/日程历史
// 用法：node scripts/seed.js [--reset]
import { db, all, get, insert, update, run, tx, now, setMeta, isSeeded } from '../server/db.js';
import { dateStr, addDaysStr, startOfWeekStr, slugKey, num } from '../server/util.js';
import { hashPassword } from '../server/auth.js';

const reset = process.argv.includes('--reset');
if (reset) {
  console.log('清空旧数据…');
  for (const t of ['work_logs', 'activity', 'plans', 'notifications', 'tasks', 'milestones', 'projects', 'team_members', 'teams', 'settings', 'users', 'sessions']) {
    run(`DELETE FROM ${t}`);
  }
  run('DELETE FROM sqlite_sequence');
}
if (isSeeded() && !reset) {
  console.log('数据库已有数据，跳过。如需重置请加 --reset');
  process.exit(0);
}

const TODAY = dateStr();
const MON = startOfWeekStr(TODAY, 1);
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr, n) => {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  return out;
};

const PEOPLE = [
  { name: '周明', email: 'zhouming@demo.com', title: '技术负责人', department: '研发', avatar: '周', color: '#6366f1', role: 'lead', focus: 20 },
  { name: '李娜', email: 'lina@demo.com', title: '产品经理', department: '产品', avatar: '李', color: '#ec4899', role: 'member', focus: 22 },
  { name: '王强', email: 'wangqiang@demo.com', title: '高级前端', department: '研发', avatar: '王', color: '#0ea5e9', role: 'member', focus: 24 },
  { name: '陈静', email: 'chenjing@demo.com', title: '后端工程师', department: '研发', avatar: '陈', color: '#10b981', role: 'member', focus: 24 },
  { name: '刘洋', email: 'liuyang@demo.com', title: '测试工程师', department: '质量', avatar: '刘', color: '#f59e0b', role: 'member', focus: 20 },
  { name: '赵敏', email: 'zhaomin@demo.com', title: '设计师', department: '设计', avatar: '赵', color: '#8b5cf6', role: 'member', focus: 18 },
];

const PROJECTS = [
  {
    key: 'PAYROLL',
    name: '薪资管理系统重构',
    desc: '把现有薪资计算迁移到新平台，支持月薪/年薪/计件三种方案，补齐社保公积金与个税计算，月底前完成一次全量并行核算。',
    kind: 'team',
    priority: 'urgent',
    team: 0,
    owner: 0,
    start: addDaysStr(TODAY, -45),
    due: addDaysStr(TODAY, 38),
    color: '#6366f1',
    milestones: [
      { name: '需求确认与方案评审', due: addDaysStr(TODAY, -30), status: 'done' },
      { name: '数据模型搭建完成', due: addDaysStr(TODAY, -8), status: 'done' },
      { name: '核算引擎联调通过', due: addDaysStr(TODAY, 6), status: 'doing' },
      { name: '全量并行核算演练', due: addDaysStr(TODAY, 25), status: 'planned' },
      { name: '正式上线', due: addDaysStr(TODAY, 36), status: 'planned' },
    ],
  },
  {
    key: 'PORTAL',
    name: '客户自助门户改版',
    desc: '把客户查询入口从旧站迁到新门户，重点优化移动端体验和查询响应速度。',
    kind: 'team',
    priority: 'high',
    team: 0,
    owner: 1,
    start: addDaysStr(TODAY, -25),
    due: addDaysStr(TODAY, 20),
    color: '#0ea5e9',
    milestones: [
      { name: '视觉稿定稿', due: addDaysStr(TODAY, -3), status: 'done' },
      { name: '前端开发完成', due: addDaysStr(TODAY, 12), status: 'doing' },
      { name: 'UAT 验收', due: addDaysStr(TODAY, 19), status: 'planned' },
    ],
  },
  {
    key: 'AUTOMATION',
    name: '内部流程自动化',
    desc: '把手工重复的对账、报表、数据同步流程脚本化，每周节省约 6 小时人工。',
    kind: 'team',
    priority: 'med',
    team: 0,
    owner: 3,
    start: addDaysStr(TODAY, -12),
    due: addDaysStr(TODAY, 55),
    color: '#10b981',
    milestones: [{ name: '对账脚本上线', due: addDaysStr(TODAY, 14), status: 'doing' }],
  },
  {
    key: 'PERSONAL',
    name: '个人成长计划 Q4',
    desc: '每周固定学习 + 输出，把今年欠的技术债还一还，顺带把英语口语练回来。',
    kind: 'personal',
    priority: 'med',
    owner: 0,
    start: addDaysStr(TODAY, -20),
    due: addDaysStr(TODAY, 60),
    color: '#f59e0b',
    milestones: [{ name: '完成 3 篇技术复盘', due: addDaysStr(TODAY, 30), status: 'doing' }],
  },
];

const TASK_POOL = {
  PAYROLL: [
    ['个税专项附加扣除读取逻辑', 'urgent', 6],
    ['计件方案导入表字段对齐', 'high', 4],
    ['入离职按考勤工时折算', 'high', 5],
    ['社保公积金比例配置界面', 'med', 3],
    ['薪资档案导入模板设计', 'med', 2],
    ['核算结果与旧系统对账脚本', 'urgent', 8],
    ['权限矩阵梳理', 'med', 3],
    ['异常薪资记录处理流程', 'high', 4],
    ['月度核算报表导出', 'med', 3],
    ['并行演练数据准备', 'high', 6],
    ['UAT 用例编写', 'med', 4],
    ['上线回滚预案', 'low', 2],
    ['历史数据迁移脚本', 'high', 5],
    ['银行代发文件格式适配', 'high', 3],
    ['薪资条 PDF 模板', 'med', 2],
    ['个税专项附加扣除回归用例', 'med', 3],
    ['试用期与新入职薪资规则', 'med', 3],
    ['年度汇算清缴支持', 'low', 4],
    ['离职补偿金计算', 'med', 3],
    ['考勤数据异常告警', 'low', 2],
    ['薪资结构表权限细分', 'med', 2],
    ['多语言薪资条', 'low', 2],
  ],
  PORTAL: [
    ['移动端首页布局重构', 'high', 6],
    ['查询接口响应优化（分页+缓存）', 'high', 5],
    ['登录态保持方案', 'med', 3],
    ['旧站链接兼容跳转表', 'med', 2],
    ['UAT 用例与缺陷跟踪', 'high', 4],
    ['前端埋点接入', 'low', 2],
    ['客户列表分页加载', 'med', 3],
    ['工单提交表单校验', 'med', 2],
    ['消息通知中心', 'low', 3],
    ['无障碍与键盘导航', 'low', 3],
    ['灰度发布开关', 'med', 2],
  ],
  AUTOMATION: [
    ['对账脚本第一版', 'high', 5],
    ['报表定时推送配置', 'med', 2],
    ['失败重试与告警', 'med', 3],
    ['数据源切换方案', 'low', 2],
    ['日切任务编排', 'med', 3],
    ['异常数据看板', 'med', 3],
    ['脚本运行日志留存', 'low', 2],
  ],
  PERSONAL: [
    ['写一篇「核算引擎设计」复盘', 'med', 4],
    ['读完《数据密集型应用系统设计》第 5-7 章', 'low', 6],
    ['英语口语练习 2 次', 'low', 2],
    ['整理个人技术债清单', 'med', 2],
    ['给团队做一次 SQL 性能优化分享', 'med', 3],
    ['梳理明年技术路线候选', 'med', 3],
    ['优化个人开发环境', 'low', 2],
  ],
};

const EVENTS = [
  ['每日站会', 30, 'daily', '09:30'],
  ['周会', 60, 'weekly', '10:00'],
  ['一对一（李娜）', 45, 'weekly', '14:00'],
  ['代码评审', 45, 'weekly', '16:00'],
  ['月度复盘', 90, 'monthly', '15:00'],
];

let taskCount = 0;

function dt(date, hm) {
  return `${date}T${hm}`;
}

tx(() => {
  // ---------- 用户 ----------
  const userIds = {};
  for (const p of PEOPLE) {
    const id = insert('users', {
      name: p.name,
      email: p.email,
      password_hash: null,
      role: p.role,
      title: p.title,
      department: p.department,
      manager_id: null,
      avatar: p.avatar,
      color: p.color,
      skills: JSON.stringify(p.department === '研发' ? ['架构', '工程效率'] : [p.department]),
      weekly_hours: 40,
      focus_hours: p.focus,
      status: 'active',
      joined_at: addDaysStr(TODAY, -rint(200, 900)),
      created_at: now(),
      is_demo: 1,
    });
    userIds[p.name] = id;
  }
  // 所有人汇报给技术负责人
  for (const p of PEOPLE) update('users', userIds[p.name], { manager_id: userIds['周明'] });

  // 第一个用户作为登录账号（demo 密码）
  update('users', userIds['周明'], {
    password_hash: hashPassword('demo1234'),
    email: 'zhouming@demo.com',
  });

  // ---------- 团队 ----------
  const teamId = insert('teams', {
    name: '交付中台',
    code: 'DELIVERY',
    description: '负责薪资系统、客户门户与内部自动化的交付团队',
    color: '#6366f1',
    lead_id: userIds['周明'],
    created_at: now(),
  });
  for (const p of PEOPLE) {
    insert('team_members', {
      team_id: teamId,
      user_id: userIds[p.name],
      role: p.name === '周明' ? 'lead' : 'member',
      joined_at: now().slice(0, 10),
    });
  }

  // ---------- 项目 ----------
  const projectIds = {};
  for (const p of PROJECTS) {
    const id = insert('projects', {
      name: p.name,
      key: p.key,
      description: p.desc,
      kind: p.kind,
      team_id: p.kind === 'team' ? teamId : null,
      owner_id: userIds[PEOPLE[p.owner].name],
      status: 'active',
      priority: p.priority,
      health: 'good',
      start_date: p.start,
      due_date: p.due,
      color: p.color,
      tags: JSON.stringify(p.key === 'PERSONAL' ? ['个人', '成长'] : ['交付', '本季度']),
      budget_hours: p.key === 'PAYROLL' ? 480 : 240,
      starred: p.priority === 'urgent' ? 1 : 0,
      created_by: userIds['周明'],
      created_at: now(),
      updated_at: now(),
    });
    projectIds[p.key] = id;
    for (let i = 0; i < p.milestones.length; i++) {
      const m = p.milestones[i];
      insert('milestones', {
        project_id: id,
        name: m.name,
        description: null,
        due_date: m.due,
        status: m.status,
        owner_id: userIds[PEOPLE[p.owner].name],
        sort: i + 1,
        created_at: now(),
      });
    }
  }

  // ---------- 任务 ----------
  for (const [key, pool] of Object.entries(TASK_POOL)) {
    const proj = PROJECTS.find((p) => p.key === key);
    const assignees = Object.keys(userIds);
    pool.forEach(([title, priority, hours], i) => {
      // 让项目进度呈现「已完成一部分」
      const roll = Math.random();
      let status = 'todo';
      if (roll < 0.34) status = 'done';
      else if (roll < 0.56) status = 'doing';
      else if (roll < 0.66) status = 'review';
      else if (roll < 0.74) status = 'backlog';

      const isDone = status === 'done';
      // 截止日分布：已完成的在过去，未完成的在未来
      const offset = isDone ? -rint(0, 34) : rint(-5, 30);
      const due = addDaysStr(TODAY, offset);
      const assignee = Math.random() < 0.4 ? userIds[PEOPLE[proj.owner].name] : userIds[rnd(assignees)];
      const completedAt = isDone ? `${addDaysStr(TODAY, offset)}T${String(rint(10, 19)).padStart(2, '0')}:30:00` : null;
      const id = insert('tasks', {
        title,
        notes: null,
        kind: 'task',
        project_id: projectIds[key],
        parent_id: null,
        milestone_id: null,
        team_id: proj.kind === 'team' ? teamId : null,
        assignee_id: assignee,
        creator_id: userIds['周明'],
        status,
        priority,
        start_at: null,
        due_at: due,
        end_at: null,
        all_day: 1,
        tags: JSON.stringify([]),
        estimate_hours: hours,
        actual_hours: isDone ? Math.round(hours * (0.7 + Math.random() * 0.8) * 10) / 10 : Math.round(hours * Math.random() * 0.6 * 10) / 10,
        pinned: priority === 'urgent' && !isDone ? 1 : 0,
        week_start: isDone ? null : startOfWeekStr(due, 1),
        blocked: !isDone && Math.random() < 0.12 ? 1 : 0,
        blocked_reason: null,
        order_index: Date.now() / 1e6 + i,
        created_at: `${addDaysStr(TODAY, offset - rint(3, 20))}T09:00:00`,
        updated_at: completedAt || `${addDaysStr(TODAY, -rint(0, 10))}T15:00:00`,
        completed_at: completedAt,
      });
      taskCount++;
      if (id && !isDone && Math.random() < 0.2) {
        update('tasks', id, { blocked_reason: '等待第三方接口提供方回复' });
      }
      // 工时记录
      if (isDone) {
        const chunks = rint(1, 3);
        for (let c = 0; c < chunks; c++) {
          insert('work_logs', {
            task_id: id,
            project_id: projectIds[key],
            user_id: assignee,
            minutes: rint(30, 150),
            note: null,
            log_date: addDaysStr(TODAY, offset + c),
            created_at: now(),
          });
        }
      } else if (status === 'doing') {
        insert('work_logs', {
          task_id: id,
          project_id: projectIds[key],
          user_id: assignee,
          minutes: rint(30, 120),
          note: null,
          log_date: addDaysStr(TODAY, -rint(0, 3)),
          created_at: now(),
        });
      }
    });
  }

  // ---------- 日程（重复规则实例化：前后各 3 周） ----------
  for (const [title, mins, kind, hm] of EVENTS) {
    const [hh, mm] = hm.split(':').map(Number);
    const startMin = hh * 60 + mm;
    const endMin = startMin + mins;
    for (let i = -21; i <= 21; i++) {
      const date = addDaysStr(TODAY, i);
      const dow = new Date(date + 'T00:00:00').getDay();
      if (kind === 'daily' && dow >= 1 && dow <= 5) {
        // ok
      } else if (kind === 'weekly' && dow !== 2) continue;
      else if (kind === 'monthly' && date.slice(8) !== '28') continue;
      else if (kind === 'daily') continue;
      insert('tasks', {
        title,
        notes: null,
        kind: 'event',
        project_id: null,
        team_id: null,
        assignee_id: userIds['周明'],
        creator_id: userIds['周明'],
        status: 'todo',
        priority: 'med',
        start_at: dt(date, `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`),
        due_at: dt(date, hm),
        all_day: 0,
        estimate_hours: 0,
        week_start: startOfWeekStr(date, 1),
        order_index: Date.now() / 1e6 + i,
        created_at: now(),
        updated_at: now(),
      });
    }
  }

  // ---------- 几条特殊事件（让日历更真实） ----------
  const special = [
    ['与客户对齐门户改版范围', addDaysStr(TODAY, 1), '14:00', 90],
    ['薪资核算演练预演', addDaysStr(TODAY, 3), '10:00', 120],
    ['季度 OKR 讨论', addDaysStr(TODAY, 5), '15:00', 60],
    ['医院', addDaysStr(TODAY, 2), '09:00', 120],
  ];
  for (const [title, date, hm, mins] of special) {
    const [hh, mm] = hm.split(':').map(Number);
    const endMin = hh * 60 + mm + mins;
    insert('tasks', {
      title,
      kind: 'event',
      assignee_id: userIds['周明'],
      creator_id: userIds['周明'],
      status: 'todo',
      priority: 'med',
      start_at: dt(date, `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`),
      due_at: dt(date, hm),
      all_day: 0,
      week_start: startOfWeekStr(date, 1),
      created_at: now(),
      updated_at: now(),
    });
  }

  // ---------- 子任务示例 ----------
  const firstTask = get('SELECT id FROM tasks WHERE kind=? AND project_id=? AND status=? LIMIT 1', 'task', projectIds.PAYROLL, 'doing');
  if (firstTask) {
    for (const [i, st] of ['已完成：核对个税专项扣除表结构', '进行中：实现扣除项读取与合并', '待处理：补充专项附加扣除回归用例'].entries()) {
      insert('tasks', {
        title: st,
        kind: 'task',
        project_id: projectIds.PAYROLL,
        parent_id: firstTask.id,
        assignee_id: firstTask.assignee_id,
        creator_id: userIds['周明'],
        status: i === 0 ? 'done' : i === 1 ? 'doing' : 'todo',
        priority: 'med',
        estimate_hours: 2,
        actual_hours: i === 0 ? 1.5 : i === 1 ? 0.8 : 0,
        completed_at: i === 0 ? `${TODAY}T11:00:00` : null,
        created_at: now(),
        updated_at: now(),
      });
    }
  }

  setMeta('seededAt', now());
  setMeta('demoPassword', 'demo1234');
});

console.log(`✓ 演示数据已生成：${PEOPLE.length} 名成员 / ${PROJECTS.length} 个项目 / ${taskCount} 个任务`);
console.log(`  登录账号：zhouming@demo.com  密码：demo1234`);
console.log(`  数据库：${process.env.FLOWDESK_DB || 'data/flowdesk.db'}`);