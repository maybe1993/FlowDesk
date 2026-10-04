#!/bin/bash
# 性能压测：对每个关键接口测 5 次取中位数，超过阈值标红
B=${BASE:-http://127.0.0.1:4190}
J=/tmp/fd-perf.jar
rm -f $J
WARN=${WARN:-400}   # 毫秒
BAD=${BAD:-1000}

curl -s -c $J -H "Content-Type: application/json" -H "X-FD-Client: 1" \
  -X POST $B/api/auth/login -d '{"identifier":"u1@load.test","password":"load1234"}' > /dev/null

printf '\n\033[1mFlowDesk 性能压测\033[0m  →  %s   （阈值 \033[33m%dms\033[0m 警告 / \033[31m%dms\033[0m 严重）\n' "$B" "$WARN" "$BAD"
printf '────────────────────────────────────────────────────────────────────────\n'
printf '  %-42s %8s %8s %8s\n' 接口 首次 中位 最大
printf '────────────────────────────────────────────────────────────────────────\n'

FAIL=0
bench() {
  local name="$1"; shift
  local times=()
  local n=${N:-5}
  for i in $(seq 1 $n); do
    local ms=$(curl -s -o /tmp/perf-body.json -w '%{time_total}' "$@")
    times+=("$(awk -v t="$ms" 'BEGIN{printf "%d", t*1000}')")
  done
  local sorted=$(printf '%s\n' "${times[@]}" | sort -n)
  local first=${times[0]}
  local med=$(printf '%s\n' "$sorted" | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]}')
  local max=$(printf '%s\n' "$sorted" | tail -1)
  local mark="  "; local color=""
  if [ "$max" -gt "$BAD" ]; then color="\033[31m"; mark="✗"; FAIL=$((FAIL+1));
  elif [ "$med" -gt "$WARN" ]; then color="\033[33m"; mark="!"; fi
  printf '  %s%-42s\033[0m %8s %s%8s\033[0m %s%8s\033[0m\n' "$mark" "$name" "${first}ms" "$color" "${med}ms" "$color" "${max}ms"
}

bench "登录"                 -c $J -H "Content-Type: application/json" -H "X-FD-Client: 1" -X POST $B/api/auth/login -d '{"identifier":"u1@load.test","password":"load1234"}'
bench "bootstrap"            -b $J $B/api/bootstrap
bench "仪表盘"                -b $J $B/api/dashboard
bench "任务列表(我的)"         -b $J "$B/api/tasks?scope=mine&open=1"
bench "任务列表(全部 500)"     -b $J "$B/api/tasks?open=1&limit=500"
bench "任务列表(逾期)"         -b $J "$B/api/tasks?scope=mine&overdue=1"
bench "任务详情"              -b $J "$B/api/tasks/5"
bench "项目列表(20)"          -b $J $B/api/projects
bench "项目详情"              -b $J "$B/api/projects/1"
bench "成员列表(含负载)"        -b $J "$B/api/users?withLoad=1"
bench "团队列表"              -b $J $B/api/teams
bench "团队负载"              -b $J $B/api/workload
bench "日历(14天)"            -b $J "$B/api/calendar?days=14"
bench "日历(月视图42天)"       -b $J "$B/api/calendar?days=42"
bench "★ 智能安排(个人)"       -b $J "$B/api/planner/next-week?scope=me"
bench "★ 智能安排(团队)"       -b $J "$B/api/planner/next-week?scope=team"
bench "计划文本导出"           -b $J "$B/api/planner/preview?scope=team"
bench "报表(30天)"            -b $J "$B/api/reports/summary?days=30"
bench "周复盘"                -b $J $B/api/review/weekly
bench "通知"                  -b $J $B/api/notifications
bench "活动流"                -b $J "$B/api/activity?limit=30"
bench "项目健康巡检"           -b $J $B/api/projects-health-scan
bench "自然语言解析"           -b $J -H "Content-Type: application/json" -H "X-FD-Client: 1" -X POST $B/api/tasks/parse -d '{"text":"下周三下午2点 和陈静对齐 #发布 P1 2h"}'
bench "导出全量数据"           -b $J $B/api/admin/export

printf '────────────────────────────────────────────────────────────────────────\n'
if [ "$FAIL" -gt 0 ]; then
  printf '\033[31m%d 个接口超过严重阈值\033[0m\n\n' "$FAIL"
else
  printf '\033[32m全部接口在阈值内\033[0m\n\n'
fi
[ "$FAIL" -eq 0 ]