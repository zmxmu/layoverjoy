#!/bin/bash
# LayoverJoy 后端剩余链路冒烟：注册→证件→搜索→方案→解释→监控→预订状态机→退款→webhook→planning-jobs→通知
set -u
B=http://localhost:8080
jq() { python3 -c "import json,sys;d=json.load(sys.stdin);$1"; }

echo "== 1. 注册 =="
EMAIL="smoke2+$(date +%s)@example.com"
REG=$(curl -s -X POST $B/v1/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Password123!\",\"nickname\":\"冒烟二号\"}")
T=$(echo "$REG" | jq "print(d['accessToken'])") || { echo "注册失败: $REG"; exit 1; }
AUTH="Authorization: Bearer $T"
echo "token ok"

echo "== 2. 添加护照 =="
curl -s -X POST $B/v1/me/documents -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"kind":"PASSPORT","countryCode":"CN","passportType":"ORDINARY","expiresOn":"2032-01-01","isPrimary":true}' | jq "print('doc id=',d['id'])"

echo "== 3. 创建搜索（demoFixture）=="
RUN=$(curl -s -X POST $B/v1/searches -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"origin":"SIN","destination":"PVG","departureDate":"2026-09-20","minStopDays":1,"maxStopDays":3,"preferences":{"interests":["美食"],"demoFixture":true}}' \
  | jq "print(d['searchRunId'])")
echo "runId=$RUN"

echo "== 4. 轮询搜索状态 =="
for i in $(seq 1 40); do
  ST=$(curl -s -H "$AUTH" $B/v1/searches/$RUN | jq "print(d['status'])")
  [ "$ST" = "COMPLETED" ] && break
  [ "$ST" = "FAILED" ] && { echo "搜索失败"; exit 1; }
  sleep 2
done
echo "status=$ST"

echo "== 5. 方案列表 =="
PLANS=$(curl -s -H "$AUTH" $B/v1/searches/$RUN/plans)
echo "$PLANS" | jq "print('funnel=',d['funnel']); [print(p['planId'], p['stopoverCityId'], 'joy=',p.get('joyScore'), 'total=',p.get('airfareTotal')) for p in d['plans']]"
PLAN=$(echo "$PLANS" | jq "print(d['plans'][0]['planId'])")

echo "== 6. 方案详情 =="
curl -s -H "$AUTH" $B/v1/plans/$PLAN | jq "print('city=',d['stopoverCity']['cityNameZh'],'elig=',d['eligibility']['status'],'legs=',len(d['legs']),'pack=',len(d['cityPack']['attractions']))"

echo "== 7. Nosana 解释 =="
curl -s -X POST -H "$AUTH" $B/v1/plans/$PLAN/explanation | jq "print('provider=',d['provider'],'summary=',d['payload']['summary'][:40])"
curl -s -H "$AUTH" $B/v1/plans/$PLAN/explanation | jq "print('cached provider=',d['provider'])"

echo "== 8. 监控 =="
MON=$(curl -s -X POST $B/v1/monitors -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$PLAN\",\"targetAirfare\":9999,\"notifyApp\":true,\"notifyEmail\":false}")
echo "$MON" | jq "print('monitorId=',d['monitorId'],'status=',d['status'])"
curl -s -H "$AUTH" $B/v1/monitors | jq "print('list count=',len(d['monitors']))"

echo "== 9. 预订（注入 legB 失败）=="
BK=$(curl -s -X POST $B/api/orders/composite -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$PLAN\",\"riskAckVersion\":1,\"passengers\":[{\"givenName\":\"SAN\",\"familyName\":\"ZHANG\"}],\"legBFailure\":true}")
BID=$(echo "$BK" | jq "print(d['bookingId'])")
echo "$BK" | jq "print('status=',d['status'],'orders=',[(o['legNo'],o['status']) for o in d['orders']])"

echo "== 10. 模拟支付（应只付 legA，进入 PARTIAL_ORDER）=="
curl -s -X POST -H "$AUTH" $B/api/orders/$BID/mock-pay | jq "print('status=',d['status'])"
curl -s -H "$AUTH" $B/api/orders/$BID | jq "print('after pay status=',d['status'])"

echo "== 11. 模拟退款 =="
curl -s -X POST -H "$AUTH" $B/api/orders/$BID/mock-refund | jq "print('status=',d['status'])"

echo "== 12. 正常链路（无注入）=="
BK2=$(curl -s -X POST $B/api/orders/composite -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"planId\":\"$PLAN\",\"riskAckVersion\":1,\"passengers\":[{\"givenName\":\"SAN\",\"familyName\":\"ZHANG\"}]}")
BID2=$(echo "$BK2" | jq "print(d['bookingId'])")
curl -s -X POST -H "$AUTH" $B/api/orders/$BID2/mock-pay | jq "print('status=',d['status'])"

echo "== 13. Atlas webhook（sharedToken）=="
WH_TOKEN=$(grep ATLAS_WEBHOOK_SHARED_TOKEN /Users/zhengmin/Documents/黑客松/alibaba/.secrets/layoverjoy.env | cut -d= -f2)
curl -s -X POST $B/api/webhooks/atlas/$WH_TOKEN -H 'Content-Type: application/json' \
  -d '{"type":"order.ticketed","notificationId":"smoke-notify-001","data":{"orderNo":"ATLAS-DEMO-0001"}}' | jq "print('webhook=',d)"

echo "== 14. Daytona planning-jobs =="
JOB=$(curl -s -X POST $B/api/v1/planning-jobs -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"origin":"SIN","destination":"PVG","departureDate":"2026-09-20","stayDays":[1,2],"passportCountry":"CN","passportType":"ORDINARY","visas":[{"country":"MY","validUntil":"2027-06-30"}]}')
JID=$(echo "$JOB" | jq "print(d['jobId'])")
echo "jobId=$JID status=$(echo "$JOB" | jq "print(d['status'])")"
sleep 3
curl -s -H "$AUTH" $B/api/v1/planning-jobs/$JID | jq "print('job status=',d['status'])"
curl -s -H "$AUTH" $B/api/v1/planning-jobs/$JID/evidence | jq "print('evidence keys=',list(d.keys()))"

echo "== 15. 通知 =="
sleep 2
curl -s -H "$AUTH" $B/v1/notifications | jq "print('notifications=',len(d['notifications']))"

echo "== SMOKE DONE =="
