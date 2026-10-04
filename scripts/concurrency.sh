#!/bin/bash
# 并发写入测试：模拟多人同时操作，验证 SQLite WAL + busy_timeout 不会丢数据或报错
B=${BASE:-http://127.0.0.1:4173}
N=${N:-8}          # 并发"用户"数
ROUNDS=${ROUNDS:-6} # 每人写多少条
H=(-H "Content-Type: application/json" -H "X-FD-Client: 1")

echo -e "\n\033[1m并发写入测试\033[0m  →  $B   （$N 个并发 × $ROUNDS 轮 = $((N*ROUNDS)) 次写）"
echo "────────────────────────────────────────────────────────"

# 先造 $N 个用户
JARS=()
for i in $(seq 1 $N); do
  J=/tmp/fd-conc-$i.jar; rm -f $J
  curl -s "${H[@]}" -c $J -X POST $B/api/auth/login -d '{"identifier":"zhouming@demo.com","password":"demo1234"}' > /dev/null
  JARS+=("$J")
done

TITLE="并发测试_$(date +%s)"
pids=()
for i in $(seq 1 $N); do
  (
    J=${JARS[$((i-1))]}
    ok=0; err=0
    for r in $(seq 1 $ROUNDS); do
      code=$(curl -s -o /tmp/conc-$i-$r.json -w '%{http_code}' "${H[@]}" -b $J -X POST "$B/api/tasks" \
        -d "{\"title\":\"$TITLE u$i r$r\",\"priority\":\"high\",\"estimateHours\":1}")
      if [ "$code" = "200" ]; then ok=$((ok+1)); else err=$((err+1)); echo "$code $(head -c 120 /tmp/conc-$i-$r.json)" > /tmp/conc-err-$i.txt; fi
    done
    echo "$i $ok $err" > /tmp/conc-res-$i.txt
  ) &
  pids+=($!)
done
for p in "${pids[@]}"; do wait $p; done

TOTAL_OK=0; TOTAL_ERR=0
for i in $(seq 1 $N); do
  read -r u ok err < /tmp/conc-res-$i.txt
  TOTAL_OK=$((TOTAL_OK+ok)); TOTAL_ERR=$((TOTAL_ERR+err))
  printf '  用户%-2s 成功 %-3s 失败 %-3s %s\n' "$u" "$ok" "$err" "$( [ -f /tmp/conc-err-$i.txt ] && head -c 100 /tmp/conc-err-$i.txt )"
done

echo "────────────────────────────────────────────────────────"
# 后端实际落库数
JQ=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$TITLE")
curl -s -b "${JARS[0]}" "$B/api/tasks?q=$JQ&limit=200" -o /tmp/conc-list.json
ACTUAL=$(node -e "try{const j=JSON.parse(require('fs').readFileSync('/tmp/conc-list.json'));process.stdout.write(String(j.tasks.length))}catch(e){process.stdout.write('ERR')}")
printf '  成功写入 %s / 实际落库 %s / 期望 %s\n' "$TOTAL_OK" "$ACTUAL" "$((N*ROUNDS))"

# 清理
IDS=$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/conc-list.json'));process.stdout.write(j.tasks.map(t=>t.id).join(','))")
if [ -n "$IDS" ]; then
  curl -s "${H[@]}" -b "${JARS[0]}" -X POST $B/api/tasks/bulk -d "{\"ids\":[${IDS}],\"action\":\"delete\"}" > /dev/null
  printf '  已清理 %s 条测试数据\n' "$(node -e "const j=JSON.parse(require('fs').readFileSync('/tmp/conc-list.json'));process.stdout.write(String(j.tasks.length))")"
fi
rm -f /tmp/conc-*.json /tmp/conc-res-*.txt /tmp/conc-err-*.txt "${JARS[@]}"

echo "────────────────────────────────────────────────────────"
if [ "$TOTAL_ERR" -eq 0 ] && [ "$ACTUAL" -eq "$((N*ROUNDS))" ]; then
  printf '\033[32m✓ 无写入丢失，无数据库锁错误\033[0m\n\n'; exit 0
else
  printf '\033[31m✗ 失败 %s 次，落库 %s/%s\033[0m\n\n' "$TOTAL_ERR" "$ACTUAL" "$((N*ROUNDS))"; exit 1
fi