// 校验：各前端模块的具名导入是否真实存在于被导入模块（浏览器才会暴露，但这里能静态抓到）
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'public', 'js');

function exportsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  // export const/let/function/class/async function
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  // export { a, b as c }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const as = t.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/^export\s+default/m.test(src)) names.add('default');
  return names;
}

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (f.endsWith('.js')) out.push(p);
  }
  return out;
}

const files = walk(root);
const exportMap = new Map();
for (const f of files) exportMap.set(f, exportsOf(f));

let problems = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), spec);
    if (!exportMap.has(target)) {
      console.log(`❌ ${path.relative(root, f)} → 找不到模块 ${spec}`);
      problems++;
      continue;
    }
    const avail = exportMap.get(target);
    for (const raw of m[1].split(',')) {
      const t = raw.trim();
      if (!t) continue;
      const name = t.split(/\s+as\s+/)[0].trim();
      if (!avail.has(name)) {
        console.log(`❌ ${path.relative(root, f)} → ${spec} 没有导出 "${name}"`);
        problems++;
      }
    }
  }
}
console.log(`\n检查 ${files.length} 个模块，${problems} 个导入问题`);
process.exit(problems ? 1 : 0);