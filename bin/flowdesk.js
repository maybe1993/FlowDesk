#!/usr/bin/env node
// FlowDesk 启动器：自动处理 node:sqlite 在不同 Node 版本下的可用性差异
//   node bin/flowdesk.js           启动服务
//   node bin/flowdesk.js seed      灌入演示数据（加 --reset 先清空）
//   node bin/flowdesk.js doctor    环境自检
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);

let sqliteOK = true;
try {
  await import('node:sqlite');
} catch {
  sqliteOK = false;
}

if (!sqliteOK) {
  if (process.env.FLOWDESK_REEXEC === '1') {
    console.error(
      '\n✗ 当前 Node.js ' + process.version + ' 不支持内置 node:sqlite。\n' +
        '  FlowDesk 需要 Node.js >= 22.5，推荐 23+。\n' +
        '  下载：https://nodejs.org/zh-cn\n'
    );
    process.exit(1);
  }
  const res = spawnSync(process.execPath, ['--experimental-sqlite', self, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, FLOWDESK_REEXEC: '1' },
  });
  process.exit(res.status ?? 1);
}

const cmd = process.argv[2];
if (cmd === 'seed') {
  await import('../scripts/seed.js');
} else if (cmd === 'doctor') {
  await import('../scripts/doctor.js');
} else {
  await import('../server/index.js');
}