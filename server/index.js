// FlowDesk 服务入口（零第三方依赖）
import { createServer } from 'node:http';
import { handleApi, serveStatic } from './router.js';
import { sendJson, HttpError } from './util.js';
import { purgeExpiredSessions, currentUser, createSession } from './auth.js';
import { all, get, isSeeded, DB_PATH, setMeta } from './db.js';

import './routes/auth.js';
import './routes/people.js';
import './routes/projects.js';
import './routes/tasks.js';
import './routes/insights.js';
import './routes/admin.js';

const PORT = Number(process.env.PORT || process.env.FLOWDESK_PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

setMeta('dbPath', DB_PATH);
setMeta('lastBoot', new Date().toISOString());

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    if (res.writableEnded) return;
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`[error] ${req.method} ${url.pathname}`, err);
    sendJson(res, status, {
      error: err.message || '服务器内部错误',
      code: err.code || null,
      path: url.pathname,
    });
  }
});

server.listen(PORT, HOST, async () => {
  const seeded = isSeeded();
  const users = seeded ? get('SELECT COUNT(*) AS n FROM users')?.n : 0;
  const line = '─'.repeat(58);
  console.log(`\n\x1b[36m${line}\x1b[0m`);
  console.log('  \x1b[1mFlowDesk 工作台\x1b[0m  ·  个人 + 团队一体化工作管理');
  console.log(`\x1b[36m${line}\x1b[0m`);
  console.log(`  地址    \x1b[32mhttp://${HOST}:${PORT}\x1b[0m`);
  console.log(`  数据    ${DB_PATH}`);
  console.log(`  账号    ${seeded ? `\x1b[32m已初始化（${users} 个成员）\x1b[0m` : '\x1b[33m空库 —— 首次打开网页即可创建管理员\x1b[0m'}`);
  console.log(`\x1b[36m${line}\x1b[0m\n`);

  if (process.env.FLOWDESK_NO_OPEN !== '1') {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const { spawn } = await import('node:child_process');
    try {
      spawn(opener, [`http://${HOST}:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    } catch {}
  }
});

// 清理过期会话
setInterval(purgeExpiredSessions, 60 * 60 * 1000).unref();

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);