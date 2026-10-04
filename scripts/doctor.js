// 环境自检：Node 版本、node:sqlite、端口占用、数据文件
import { statSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';

const GREEN = '\u001b[32m';
const YELLOW = '\u001b[33m';
const RED = '\u001b[31m';
const RESET = '\u001b[0m';

console.log('\nFlowDesk 环境自检');
console.log('─'.repeat(46));

const [maj, min] = process.versions.node.split('.').map(Number);
const nodeOk = maj > 22 || (maj === 22 && min >= 5);
console.log(nodeOk ? `${GREEN}✓${RESET} Node.js ${process.version}` : `${RED}✗${RESET} Node.js ${process.version}（需要 >= 22.5）`);

try {
  const { DatabaseSync } = await import('node:sqlite');
  const mem = new DatabaseSync(':memory:');
  mem.exec('CREATE TABLE t(a INTEGER)');
  mem.exec('INSERT INTO t VALUES (1)');
  const r = mem.prepare('SELECT COUNT(*) AS n FROM t').get();
  console.log(`${GREEN}✓${RESET} node:sqlite 可用（内存库自检 ${r.n} 行）`);
} catch (e) {
  console.log(`${RED}✗${RESET} node:sqlite 不可用：${e.message}`);
}

const port = Number(process.env.PORT || 4173);
const busy = await new Promise((resolve) => {
  const s = createServer();
  s.once('error', () => resolve(true));
  s.once('listening', () => s.close(() => resolve(false)));
  s.listen(port, '127.0.0.1');
});
console.log(busy ? `${YELLOW}!${RESET} 端口 ${port} 被占用（换端口：PORT=5000 npm start）` : `${GREEN}✓${RESET} 端口 ${port} 可用`);

const { DB_PATH } = await import('../server/db.js');
if (existsSync(DB_PATH)) {
  const size = statSync(DB_PATH).size;
  console.log(`${GREEN}✓${RESET} 数据库 ${DB_PATH}（${(size / 1024).toFixed(0)} KB）`);
} else {
  console.log(`${YELLOW}!${RESET} 数据库尚未创建（首次启动会自动生成）`);
}

console.log('─'.repeat(46));
console.log('  启动：npm start\n');