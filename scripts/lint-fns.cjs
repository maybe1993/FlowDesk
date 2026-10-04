// 开发辅助：定位大文件里每个顶层函数的语法错误位置
const fs = require('fs');
const { execFileSync } = require('child_process');
const file = process.argv[2];
const lines = fs.readFileSync(file, 'utf8').split('\n');
const starts = [];
lines.forEach((l, i) => {
  if (/^(export\s+)?(async\s+)?function\s+\w+/.test(l)) starts.push(i);
});
starts.push(lines.length);
let broken = 0;
for (let k = 0; k < starts.length - 1; k++) {
  const chunk = lines.slice(starts[k], starts[k + 1]).join('\n').replace(/^export /gm, '');
  const name = (chunk.match(/function\s+(\w+)/) || [])[1];
  const tmp = `/tmp/_fn_${k}.mjs`;
  fs.writeFileSync(tmp, chunk);
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    broken++;
    const out = (e.stderr || '').toString().split('\n').filter(Boolean).slice(0, 3).join(' | ');
    const rel = (out.match(/_fn_\d+\.mjs:(\d+)/) || [])[1];
    console.log(`\n=== ${name}  (文件第 ${starts[k] + 1} 行起) ===`);
    console.log('   ' + out.replace(/_fn_\d+\.mjs/g, 'chunk'));
    if (rel) {
      const L = Number(rel);
      for (let i = Math.max(0, L - 5); i < Math.min(lines.length - starts[k], L + 3); i++) {
        const mark = i === L - 1 ? '>>>' : '   ';
        console.log(`  ${mark} ${String(starts[k] + i + 1).padStart(4)}| ${lines[starts[k] + i]}`);
      }
    }
  }
}
console.log(`\n共 ${starts.length - 1} 个顶层函数，${broken} 个有语法错误`);