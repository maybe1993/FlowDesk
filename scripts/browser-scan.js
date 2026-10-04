// 浏览器端巡检脚本：在页面控制台里跑，注入到 FlowDesk 里逐页渲染并回收错误
window.__fdScan = async function scan(paths) {
  const out = [];
  const orig = { err: window.onerror, rej: window.onunhandledrejection };
  for (const p of paths) {
    const errors = [];
    window.onerror = (m, s, l, c, e) => errors.push(String(m));
    window.onunhandledrejection = (e) => errors.push('unhandled: ' + (e.reason?.message || e.reason));
    location.hash = '#' + p;
    await new Promise((r) => setTimeout(r, 900));
    const main = document.querySelector('.main .view');
    const txt = (main?.innerText || '').replace(/\s+/g, ' ').trim();
    out.push({
      path: p,
      hash: location.hash,
      ok: !!main && txt.length > 20 && !/页面加载失败|页面不存在/.test(txt),
      errors,
      skels: document.querySelectorAll('.skel').length,
      chars: txt.length,
      head: txt.slice(0, 130),
      emptyStates: document.querySelectorAll('.empty').length,
      cards: document.querySelectorAll('.card').length,
    });
  }
  window.onerror = orig.err;
  window.onunhandledrejection = orig.rej;
  return out;
};