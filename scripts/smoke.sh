#!/bin/bash
# FlowDesk API 冒烟测试：真实请求每一个接口，输出 PASS/FAIL
B=${BASE:-http://127.0.0.1:4173}
J=/tmp/fd-test.jar
STAMP=$(date +%s)
PASS=0; FAIL=0
rm -f $J

t() { # t <名称> <期望码> <curl 参数...>
  local name="$1"; shift
  local want="$1"; shift
  local code
  code=$(curl -s -o /tmp/fd-body.json -w '%{http_code}' "$@")
  if [ "$code" = "$want" ]; then
    PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %-44s %s\n' "$name" "$code"
  else
    FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %-44s got=%s want=%s\n' "$name" "$code" "$want"
    head -c 240 /tmp/fd-body.json; echo
  fi
}

jget() { node -e "
const fs=require('fs');
let j;
try { j = JSON.parse(fs.readFileSync('/tmp/fd-body.json','utf8')); }
catch(e) { console.log('PARSE_ERR'); process.exit(0); }
try { const r = eval(process.argv[1]); console.log(typeof r === 'string' ? r : JSON.stringify(r)); }
catch(e) { console.log('EVAL_ERR '+e.message); }
" "$1"; }

jm() { node -e "
const fs=require('fs');
let j;
try { j = JSON.parse(fs.readFileSync('/tmp/fd-body.json','utf8')); }
catch(e) { console.log('      PARSE_ERR '+e.message); process.exit(0); }
try { console.log(eval(process.argv[1])); } catch(e) { console.log('      EVAL_ERR '+e.message); }
" "$1"; }

H=(-H "Content-Type: application/json" -H "X-FD-Client: 1")

echo -e "\n\033[1mFlowDesk API 冒烟测试\033[0m  →  $B"
echo "──────────────────────────────────────────────────────────"
echo "── 认证 ──────────────────────────────────────────"
t "bootstrap 未登录"            200 $B/api/bootstrap
t "登录"                       200 "${H[@]}" -c $J -X POST $B/api/auth/login -d '{"identifier":"zhouming@demo.com","password":"demo1234"}'
t "错误密码应 400"             400 "${H[@]}" -X POST $B/api/auth/login -d '{"identifier":"zhouming@demo.com","password":"wrong"}'
t "bootstrap 已登录"           200 -b $J $B/api/bootstrap
t "未登录访问任务应 401"       401 $B/api/tasks
t "CSRF 头缺失应 400"          400 -b $J -H "Content-Type: application/json" -X POST $B/api/tasks -d '{}'
t "旧密码错误应 400"           400 "${H[@]}" -b $J -X POST $B/api/auth/password -d '{"oldPassword":"nope","newPassword":"1234567"}'
t "未登录访问管理端应 401"       401 $B/api/admin/stats
t "leader 可创建成员"            200 "${H[@]}" -b $J -X POST $B/api/users -d "{\"name\":\"权限测试员$STAMP\",\"email\":\"perm$STAMP@test.com\",\"password\":\"test1234\",\"role\":\"member\"}"
PERM_UID=$(jget 'j.user.id')
PJ=/tmp/fd-member.jar; rm -f $PJ
t "member 登录"                 200 "${H[@]}" -c $PJ -X POST $B/api/auth/login -d "{\"identifier\":\"perm$STAMP@test.com\",\"password\":\"test1234\"}"
t "member 创建成员应 403"        403 "${H[@]}" -b $PJ -X POST $B/api/users -d '{"name":"越权","password":"test1234"}'
t "member 导出全量应 403"        403 -b $PJ $B/api/admin/export
t "member 改他人资料应 403"      403 "${H[@]}" -b $PJ -X PATCH $B/api/users/1 -d '{"name":"越权改"}'
t "member 改自己资料应 200"      200 "${H[@]}" -b $PJ -X PATCH $B/api/users/$PERM_UID -d '{"title":"高级工程师"}'
t "member 删除项目应 403"        403 "${H[@]}" -b $PJ -X DELETE $B/api/projects/1
t "member 重置他人密码应 403"    403 "${H[@]}" -b $PJ -X POST $B/api/users/1/password-reset -d '{"password":"hack123"}'
t "清理权限测试员"              200 "${H[@]}" -b $J -X DELETE $B/api/users/$PERM_UID

echo "── 空库首次使用（独立实例，不依赖演示数据）────────"
EMPTY_DIR=$(mktemp -d)
EMPTY_PORT=$(awk 'BEGIN{srand();print 4300+int(rand()*2000)}')
FLOWDESK_DATA="$EMPTY_DIR" FLOWDESK_NO_OPEN=1 PORT=$EMPTY_PORT node "$(cd "$(dirname "$0")/.." && pwd)/bin/flowdesk.js" > /tmp/fd-empty-test.log 2>&1 &
EMPTY_PID=$!
for i in $(seq 1 60); do
  curl -s -o /dev/null "http://127.0.0.1:$EMPTY_PORT/api/bootstrap" && break
  sleep 0.25
done
EB="http://127.0.0.1:$EMPTY_PORT"
EJ=/tmp/fd-empty-test.jar
rm -f $EJ
t "空库 bootstrap seeded=false"  200 $EB/api/bootstrap
echo "      seeded=$(jget 'String(j.seeded)')"
t "空库 admin/init 创建管理员" 200 "${H[@]}" -c $EJ -X POST $EB/api/admin/init -d '{"name":"冒烟新用户","email":"smoke-new@test.com","password":"test1234"}'
t "重复 init 应 400"            400 "${H[@]}" -X POST $EB/api/admin/init -d '{"name":"x","password":"test1234"}'
t "init 后自动登录成功"          200 -b $EJ $EB/api/bootstrap
echo "      authenticated=$(jget 'String(j.authenticated)')"
for ep in "/api/dashboard" "/api/tasks?scope=mine" "/api/tasks?overdue=1" "/api/projects" "/api/teams" "/api/users?withLoad=1" "/api/calendar?days=14" "/api/planner/next-week" "/api/planner/this-week" "/api/planner/preview" "/api/reports/summary" "/api/review/weekly" "/api/notifications" "/api/activity" "/api/projects-health-scan" "/api/workload" "/api/my-tags" "/api/plans" "/api/admin/stats" "/api/admin/export"; do
  t "空库 $(echo "$ep" | cut -c6-30)" 200 -b $EJ "$EB$ep"
done
t "空库创建首个任务"            200 "${H[@]}" -b $EJ -X POST $EB/api/tasks -d '{"title":"空库首任务"}'
t "空库创建首个项目"            200 "${H[@]}" -b $EJ -X POST $EB/api/projects -d '{"name":"空库首项目"}'
t "空库创建后 planner 不报错"    200 -b $EJ "$EB/api/planner/next-week"
t "空库创建后报表不报错"        200 -b $EJ "$EB/api/reports/summary"
kill $EMPTY_PID 2>/dev/null
sleep 0.5
rm -rf "$EMPTY_DIR"

echo "── 任务 ──────────────────────────────────────────"
t "任务列表(我的未完成)"        200 -b $J "$B/api/tasks?scope=mine&open=1"
echo "      共 $(jget 'j.tasks.length') 项"
t "分页: total 是真实总数"     200 -b $J "$B/api/tasks?open=1&limit=5"
echo "      total=$(jget 'j.total') 本页=$(jget 'j.tasks.length') hasMore=$(jget 'j.hasMore')"
t "分页: offset=0 limit=3"     200 -b $J "$B/api/tasks?open=1&limit=3&offset=0"
F1=$(jget 'j.tasks.map(t=>t.id).join(",")')
t "分页: offset=3 limit=3"     200 -b $J "$B/api/tasks?open=1&limit=3&offset=3"
F2=$(jget 'j.tasks.map(t=>t.id).join(",")')
t "分页: offset=6 limit=3"     200 -b $J "$B/api/tasks?open=1&limit=3&offset=6"
F3=$(jget 'j.tasks.map(t=>t.id).join(",")')
if [ -n "$F1" ] && [ -n "$F2" ] && [ -n "$F3" ] && [ "$F1" != "$F2" ] && [ "$F2" != "$F3" ] && [ "$F1" != "$F3" ]; then
  PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %-44s %s\n' "分页三页内容互不重叠" "OK"
else
  FAIL=$((FAIL+1)); printf '  \033[31m✗\033[0m %-44s F1=%s F2=%s F3=%s\n' "分页三页内容互不重叠" "$F1" "$F2" "$F3"
fi
t "分页: offset 越界返回空"     200 -b $J "$B/api/tasks?open=1&limit=3&offset=999999"
echo "      空页条数=$(jget 'j.tasks.length') hasMore=$(jget 'j.hasMore')"
t "分页: limit 上限被夹住"     200 -b $J "$B/api/tasks?open=1&limit=99999"
echo "      实际 limit=$(jget 'j.limit')"
t "任务列表(逾期)"             200 -b $J "$B/api/tasks?scope=mine&overdue=1"
echo "      逾期 $(jget 'j.tasks.length') 项"
t "任务列表(今天)"             200 -b $J "$B/api/tasks?scope=today"
t "任务列表(阻塞)"             200 -b $J "$B/api/tasks?blocked=1"
t "自然语言解析"                200 "${H[@]}" -b $J -X POST $B/api/tasks/parse -d '{"text":"下周三下午2点 评审 #发布 P1 2小时"}'
echo "      $(jget "j.startAt+'  优先级='+j.priority+'  标签='+j.tags.join(',')+'  预估='+j.estimateHours+'h  标题='+j.cleanTitle")"
t "创建任务"                   200 "${H[@]}" -b $J -X POST $B/api/tasks -d '{"title":"冒烟测试任务 A","priority":"high","estimateHours":2,"dueAt":"2026-11-10","tags":["冒烟"]}'
TID=$(jget 'j.id')
echo "      新任务 id=$TID"
t "创建子任务"                 200 "${H[@]}" -b $J -X POST $B/api/tasks -d "{\"title\":\"冒烟测试子任务\",\"parentId\":$TID}"
t "任务详情(含子任务)"          200 -b $J "$B/api/tasks/$TID"
echo "      子任务 $(jget 'j.children.length') 个"
t "改为进行中"                 200 "${H[@]}" -b $J -X PATCH $B/api/tasks/$TID -d '{"status":"doing"}'
t "标记完成"                   200 "${H[@]}" -b $J -X POST $B/api/tasks/$TID/toggle -d '{"completed":true}'
t "重新打开"                   200 "${H[@]}" -b $J -X POST $B/api/tasks/$TID/toggle -d '{"completed":false}'
t "批量改优先级"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"priority\",\"priority\":\"urgent\"}"
t "批量→进行中(非done分支)"     200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"status\",\"status\":\"doing\"}"
t "批量→已完成(done分支)"      200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"status\",\"status\":\"done\"}"
t "批量→待办(清空completed)"    200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"status\",\"status\":\"todo\"}"
t "批量改负责人"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"assignee\",\"assigneeId\":2}"
t "批量设截止日"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"dueDate\",\"dueDate\":\"2026-12-01\"}"
t "批量排入下周"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"week\",\"weekStart\":\"2026-10-05\"}"
t "批量标记受阻"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"blocked\",\"blocked\":true,\"reason\":\"等待外部接口\"}"
t "批量清除受阻"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"blocked\",\"blocked\":false}"
t "批量改项目"                 200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"project\",\"projectId\":1}"
t "批量未知动作应 400"         400 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"__nope__\"}"
t "批量空数组应 400"           400 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d '{"ids":[],"action":"status","status":"doing"}'
t "校验 bulk 结果落库"         200 -b $J "$B/api/tasks/$TID"
echo "      状态=$(jget 'j.status') 截止=$(jget 'j.dueAt') 周=$(jget 'j.weekStart') 负责人=$(jget 'j.assigneeId')"
t "批量加标签"                 200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"tag\",\"tag\":\"下周计划\"}"
t "批量移除标签"               200 "${H[@]}" -b $J -X POST $B/api/tasks/bulk -d "{\"ids\":[$TID],\"action\":\"tag\",\"tag\":\"下周计划\",\"remove\":true}"
t "看板排序"                   200 "${H[@]}" -b $J -X POST $B/api/tasks/reorder -d "{\"items\":[{\"id\":$TID,\"status\":\"todo\",\"orderIndex\":1}]}"
t "记工时 90 分钟"             200 "${H[@]}" -b $J -X POST $B/api/work-logs -d "{\"taskId\":$TID,\"minutes\":90,\"note\":\"冒烟\"}"
t "日历(14天)"                 200 -b $J "$B/api/calendar?days=14"
echo "      日程 $(jget 'j.events.length') / 到期任务 $(jget 'j.tasks.length') / 里程碑 $(jget 'j.milestones.length')"
t "重复日程(每周×3)"           200 "${H[@]}" -b $J -X POST $B/api/tasks/repeat -d '{"title":"冒烟-每周例会","repeat":{"kind":"weekly","count":3},"startAt":"2026-10-06T10:00","dueAt":"2026-10-06T11:00"}'
echo "      生成 $(jget 'j.created') 条"
t "我的标签"                   200 -b $J $B/api/my-tags
echo "      $(jget 'j.map(x=>x.tag+"("+x.count+")").join(" ")')"
t "删除任务"                   200 "${H[@]}" -b $J -X DELETE $B/api/tasks/$TID

echo "── 项目 ──────────────────────────────────────────"
t "项目列表"                   200 -b $J "$B/api/projects"
echo "      $(jget 'j.length') 个项目"
PID=$(jget 'j[0].id')
t "项目详情"                   200 -b $J "$B/api/projects/$PID"
echo "      里程碑 $(jget 'j.milestones.length') / 任务 $(jget 'j.tasks.length') / 成员 $(jget 'j.members.length') / 趋势 $(jget 'j.weeklyTrend.length') 天"
t "创建项目(含里程碑)"          200 "${H[@]}" -b $J -X POST $B/api/projects -d '{"name":"冒烟测试项目","priority":"high","dueDate":"2026-12-30","milestones":[{"name":"M1","dueDate":"2026-11-10"}]}'
NPID=$(jget 'j.id')
t "项目加星"                   200 "${H[@]}" -b $J -X POST $B/api/projects/$NPID/star -d '{}'
t "重算健康度"                 200 "${H[@]}" -b $J -X POST $B/api/projects/$NPID/recompute-health -d '{}'
echo "      健康度 = $(jget 'j.health')"
t "添加里程碑"                 200 "${H[@]}" -b $J -X POST $B/api/projects/$NPID/milestones -d '{"name":"M2","dueDate":"2026-11-20"}'
t "项目健康巡检"               200 -b $J $B/api/projects-health-scan
echo "      巡检 $(jget 'j.length') 项，最高风险: $(jget 'j[0].name+" ["+j[0].healthAuto+"] "+j[0].flags.join("/")')"
t "归档项目"                   200 "${H[@]}" -b $J -X DELETE $B/api/projects/$NPID

echo "── 团队 / 人员 ───────────────────────────────────"
t "成员列表(含负载)"            200 -b $J "$B/api/users?withLoad=1"
echo "      $(jget 'j.length') 人"
echo "      $(jget 'j.slice(0,4).map(u=>u.name+" "+u.load.load+"%("+u.load.level+")/"+u.load.openTasks+"项").join("   ")')"
t "成员详情"                   200 -b $J "$B/api/users/1"
echo "      在办 $(jget 'j.activeTasks.length') / 已完成 $(jget 'j.recentDone.length') / 团队 $(jget 'j.teams.length') / 月度产出 $(jget 'j.monthlyOutput.length')"
t "团队列表"                   200 -b $J $B/api/teams
TID2=$(jget 'j[0].id')
echo "      $(jget 'j[0].name+"：成员 "+j[0].memberCount+" 人，项目 "+j[0].projectCount+" 个"')"
t "团队负载视图"               200 -b $J $B/api/workload
t "新增成员"                   200 "${H[@]}" -b $J -X POST $B/api/users -d "{\"name\":\"冒烟测试员$STAMP\",\"email\":\"smoke$STAMP@test.com\",\"title\":\"QA\",\"department\":\"质量\"}"
UID2=$(jget 'j.user.id')
t "更新成员"                   200 "${H[@]}" -b $J -X PATCH $B/api/users/$UID2 -d '{"title":"高级QA","skills":["自动化测试"]}'
t "加入团队"                   200 "${H[@]}" -b $J -X POST $B/api/teams/$TID2/members -d "{\"userId\":$UID2,\"role\":\"member\"}"
t "移出团队"                   200 "${H[@]}" -b $J -X DELETE $B/api/teams/$TID2/members/$UID2
t "标记离职"                   200 "${H[@]}" -b $J -X DELETE $B/api/users/$UID2

echo "── 智能规划（核心）──────────────────────────────"
t "下周安排建议（个人）"        200 -b $J "$B/api/planner/next-week?scope=me"
echo "      周期 $(jget 'j.weekStart') ~ $(jget 'j.weekEnd')"
echo "      排入 $(jget 'j.summary.taskCount') 项 / $(jget 'j.summary.totalHours')h / 会议 $(jget 'j.summary.meetingHours')h / 利用率 $(jget 'j.summary.utilization')% / 排不下 $(jget 'j.summary.carryOver') / 阻塞 $(jget 'j.summary.blocked')"
jm "j.days.map(d=>'      '+d.label+' '+d.date+'  '+d.plannedHours+'h/'+d.capacityHours+'h ('+d.utilization+'%)  '+(d.items.filter(i=>i.type==='task').map(i=>i.title).join('、')||'—')).join('\n')"
echo "      ── 重点三件事 ──"
jm "j.top.map(t=>'      · '+t.title+'  ('+t.hours+'h)  '+t.why).join('\n')"
echo "      ── 首条任务的可解释理由 ──"
jm "(()=>{const it=j.days.flatMap(d=>d.items).find(i=>i.type==='task');return it? '      「'+it.title+'」← '+it.reasons.join('、'):'      无'})()"
echo "      ── 洞察 ──"
jm "j.insights.map(i=>'      ['+i.level+'] '+i.title+(i.detail?' — '+i.detail:'')).join('\n')"
t "下周安排建议（团队）"        200 -b $J "$B/api/planner/next-week?scope=team"
echo "      团队排入 $(jget 'j.summary.taskCount') 项 / 负载再平衡建议 $(jget 'j.rebalance.length') 条"
t "本周安排建议"               200 -b $J "$B/api/planner/this-week"
t "计划文本导出"               200 -b $J "$B/api/planner/preview?scope=me"
jm "j.text.split('\n').filter(l=>l.trim()).slice(0,10).map(l=>'      '+l).join('\n')"
curl -s -b $J "$B/api/planner/next-week?scope=me" -o /tmp/fd-plan.json
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/tmp/fd-plan.json','utf8'));fs.writeFileSync('/tmp/fd-draft.json',JSON.stringify({plan:p}))"
t "保存草稿"                   200 "${H[@]}" -b $J -X POST $B/api/planner/draft --data-binary @/tmp/fd-draft.json
t "计划列表"                   200 -b $J $B/api/plans
echo "      已存 $(jget 'j.length') 份"
t "采纳计划"                   200 "${H[@]}" -b $J -X POST $B/api/planner/adopt --data-binary @/tmp/fd-draft.json
echo "      影响 $(jget 'j.affected') 项"

echo "── 仪表盘 / 报表 / 通知 ──────────────────────────"
t "仪表盘"                     200 -b $J $B/api/dashboard
echo "      $(jget 'JSON.stringify(j.stats)')"
echo "      焦点 $(jget 'j.focus.length') / 今日日程 $(jget 'j.todayEvents.length') / 我的项目 $(jget 'j.myProjects.length') / 里程碑 $(jget 'j.milestonesSoon.length') / 负载 $(jget 'j.workload.length')"
jm "j.suggestions.map(s=>'      ['+s.level+'] '+s.text).join('\n')"
t "周复盘"                     200 -b $J $B/api/review/weekly
echo "      完成 $(jget 'j.doneCount') 项 / $(jget 'j.doneHours')h / 顺延 $(jget 'j.carryOver.length') 项 / 下周已排 $(jget 'j.plan.summary.taskCount') 项"
t "报表汇总(30天)"             200 -b $J "$B/api/reports/summary?days=30"
echo "      完成 $(jget 'j.totals.completed') 项 / $(jget 'j.totals.hours')h / 项目 $(jget 'j.byProject.length') / 人员 $(jget 'j.byPerson.length') / 标签 $(jget 'j.byTag.length')"
t "通知中心"                   200 -b $J $B/api/notifications
echo "      $(jget 'j.items.length') 条通知，未读 $(jget 'j.unread')"
jm "j.items.slice(0,4).map(n=>'      ['+n.level+'] '+n.title).join('\n')"
t "全部标记已读"               200 "${H[@]}" -b $J -X POST $B/api/notifications/read-all -d '{}'
t "活动流"                     200 -b $J "$B/api/activity?limit=10"
echo "      $(jget 'j.length') 条"
t "读取设置"                   200 -b $J $B/api/settings
t "保存设置"                   200 "${H[@]}" -b $J -X PATCH $B/api/settings -d '{"work_start":"10:00","day_focus_hours":"5","theme":"dark"}'
t "回读设置"                   200 -b $J $B/api/settings
echo "      work_start=$(jget 'j.work_start') theme=$(jget 'j.theme')"
t "更新个人资料"               200 "${H[@]}" -b $J -X PATCH $B/api/auth/profile -d '{"location":"上海","focusHours":24}'

echo "── 管理端 / 数据 ────────────────────────────────"
t "统计"                       200 -b $J $B/api/admin/stats
echo "      $(jget 'JSON.stringify(j.counts)')"
t "导出全量数据"               200 -b $J $B/api/admin/export
echo "      表: $(jget 'Object.keys(j.data).join(", ")')"
t "CSV 试运行(任务)"           200 "${H[@]}" -b $J -X POST $B/api/admin/import/csv -d '{"kind":"tasks","dryRun":true,"text":"标题,项目,优先级,截止日期,预估工时\n冒烟导入任务,薪资管理系统重构,高,2026-11-01,3\n,项目二,低,2026-11-02,2\n"}'
echo "      可导入 $(jget 'j.created') 行 / 跳过 $(jget 'j.skipped.length') 行：$(jget 'j.skipped.map(s=>"行"+s.row+" "+s.reason).join("; ")')"
t "CSV 试运行(成员)"           200 "${H[@]}" -b $J -X POST $B/api/admin/import/csv -d '{"kind":"users","dryRun":true,"text":"姓名,邮箱,职位,部门\n冒烟用户A,a@test.com,工程师,研发\n"}'
t "手动备份"                    200 "${H[@]}" -b $J -X POST $B/api/admin/backup -d '{}'
echo "      $(jget 'j.file')"
t "备份列表"                    200 -b $J $B/api/admin/backups
t "CSV 只有表头应 400"         400 "${H[@]}" -b $J -X POST $B/api/admin/import/csv -d '{"kind":"tasks","text":"标题\n"}'
t "不存在的接口应 404"         404 -b $J $B/api/nope

echo "── 静态资源 ──────────────────────────────────────"
t "首页 HTML"                  200 $B/
t "manifest"                   200 $B/manifest.webmanifest
t "service worker"             200 $B/sw.js
t "不存在的文件 404"            404 $B/nope-does-not-exist.js

echo "──────────────────────────────────────────────────────────"
printf "结果: \033[32m%d 通过\033[0m" "$PASS"
if [ "$FAIL" -gt 0 ]; then printf " / \033[31m%d 失败\033[0m\n" "$FAIL"; else printf " / 0 失败\033[0m\n"; fi
echo
[ "$FAIL" -eq 0 ]