#!/bin/bash

# debug-checkpoint.sh
# Comprehensive system stability check after every 4 feature upgrades

CHECKPOINT_NUM=$1
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
REPORT_FILE="debug-checkpoint-${CHECKPOINT_NUM}-${TIMESTAMP}.md"

echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                     DEBUG CHECKPOINT #${CHECKPOINT_NUM}                                    ║"
echo "║                     Timestamp: ${TIMESTAMP}                          ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""

# Create report file
cat > "$REPORT_FILE" << EOF
# Debug Checkpoint #${CHECKPOINT_NUM}
**Date**: $(date)  
**Project**: In The House Productions  
**Status**: Testing...

---

## 🔍 System Health Checks

EOF

echo "📊 1. SERVICE HEALTH CHECK"
echo "─────────────────────────────────────────────────────────────────────────────"
echo "" | tee -a "$REPORT_FILE"

# Check if service is running
pm2 list | grep webapp
if [ $? -eq 0 ]; then
    echo "✅ Service Status: ONLINE" | tee -a "$REPORT_FILE"
else
    echo "❌ Service Status: OFFLINE" | tee -a "$REPORT_FILE"
fi

# Health endpoint check
HEALTH_CHECK=$(curl -s -w "\n%{http_code}" http://localhost:3000/api/health 2>/dev/null)
HTTP_CODE=$(echo "$HEALTH_CHECK" | tail -n1)
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Health Endpoint: OK (200)" | tee -a "$REPORT_FILE"
else
    echo "⚠️  Health Endpoint: Failed ($HTTP_CODE)" | tee -a "$REPORT_FILE"
fi

echo "" | tee -a "$REPORT_FILE"
echo "🗄️  2. DATABASE INTEGRITY CHECK" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Database tables check
echo "Checking database tables..." | tee -a "$REPORT_FILE"
TABLES=$(npx wrangler d1 execute webapp-production --local --command="SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null | grep -v "^─" | grep -v "name" | grep -v "^$")
echo "$TABLES" | tee -a "$REPORT_FILE"

# Row counts
echo "" | tee -a "$REPORT_FILE"
echo "Row counts:" | tee -a "$REPORT_FILE"
npx wrangler d1 execute webapp-production --local --command="
  SELECT 'users' as table_name, COUNT(*) as count FROM users
  UNION ALL SELECT 'bookings', COUNT(*) FROM bookings
  UNION ALL SELECT 'provider_contacts', COUNT(*) FROM provider_contacts
  UNION ALL SELECT 'event_details', COUNT(*) FROM event_details
  UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
" 2>/dev/null | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "🌐 3. API ENDPOINT VALIDATION" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Test critical endpoints
ENDPOINTS=(
    "/"
    "/dj-services"
    "/photobooth"
    "/calendar"
    "/admin"
    "/api/health"
    "/api/admin/stats"
    "/api/admin/bookings"
    "/api/admin/providers"
)

for endpoint in "${ENDPOINTS[@]}"; do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000$endpoint 2>/dev/null)
    if [ "$STATUS" = "200" ]; then
        echo "✅ $endpoint → 200 OK" | tee -a "$REPORT_FILE"
    elif [ "$STATUS" = "302" ]; then
        echo "✅ $endpoint → 302 Redirect" | tee -a "$REPORT_FILE"
    else
        echo "⚠️  $endpoint → $STATUS" | tee -a "$REPORT_FILE"
    fi
done

echo "" | tee -a "$REPORT_FILE"
echo "🏗️  4. BUILD VALIDATION" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Check dist directory
if [ -f "dist/_worker.js" ]; then
    BUILD_SIZE=$(ls -lh dist/_worker.js | awk '{print $5}')
    echo "✅ Build File Exists: dist/_worker.js ($BUILD_SIZE)" | tee -a "$REPORT_FILE"
else
    echo "❌ Build File Missing: dist/_worker.js" | tee -a "$REPORT_FILE"
fi

# Test build command
echo "Testing build command..." | tee -a "$REPORT_FILE"
BUILD_OUTPUT=$(npm run build 2>&1)
if [ $? -eq 0 ]; then
    echo "✅ Build Command: SUCCESS" | tee -a "$REPORT_FILE"
    echo "$BUILD_OUTPUT" | grep "dist/_worker.js" | tee -a "$REPORT_FILE"
else
    echo "❌ Build Command: FAILED" | tee -a "$REPORT_FILE"
fi

echo "" | tee -a "$REPORT_FILE"
echo "🧹 5. CODE QUALITY CHECK" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Count console.error statements
ERROR_COUNT=$(grep -r "console.error" src/index.tsx 2>/dev/null | wc -l)
echo "Console Errors: $ERROR_COUNT" | tee -a "$REPORT_FILE"

# Count TODOs/FIXMEs
TODO_COUNT=$(grep -r "TODO\|FIXME\|HACK" src/index.tsx 2>/dev/null | wc -l)
echo "TODOs/FIXMEs: $TODO_COUNT" | tee -a "$REPORT_FILE"

# Count raw alert/confirm calls
ALERT_COUNT=$(grep -r "^[^/]*alert(" src/index.tsx 2>/dev/null | grep -v "showAlert" | wc -l)
echo "Raw alert() calls: $ALERT_COUNT" | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "⚡ 6. PERFORMANCE CHECK" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# PM2 status
pm2 list 2>/dev/null | tee -a "$REPORT_FILE"

# Memory usage
echo "" | tee -a "$REPORT_FILE"
echo "Memory usage:" | tee -a "$REPORT_FILE"
pm2 info webapp 2>/dev/null | grep -E "memory|cpu|uptime" | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "📝 7. RECENT ERROR LOGS" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Check recent errors
pm2 logs webapp --nostream --lines 20 --err 2>/dev/null | tail -20 | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "🔐 8. ENVIRONMENT VARIABLES CHECK" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Check .dev.vars file exists
if [ -f ".dev.vars" ]; then
    echo "✅ .dev.vars file exists" | tee -a "$REPORT_FILE"
    echo "Environment variables configured:" | tee -a "$REPORT_FILE"
    cat .dev.vars | grep -E "^[A-Z_]+=" | sed 's/=.*/=***HIDDEN***/' | tee -a "$REPORT_FILE"
else
    echo "⚠️  .dev.vars file not found" | tee -a "$REPORT_FILE"
fi

echo "" | tee -a "$REPORT_FILE"
echo "🎯 9. GIT STATUS" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Git branch and commit info
echo "Current branch: $(git branch --show-current)" | tee -a "$REPORT_FILE"
echo "Latest commit: $(git log -1 --oneline)" | tee -a "$REPORT_FILE"
echo "" | tee -a "$REPORT_FILE"
git status --short | tee -a "$REPORT_FILE"

echo "" | tee -a "$REPORT_FILE"
echo "📊 10. SUMMARY" | tee -a "$REPORT_FILE"
echo "─────────────────────────────────────────────────────────────────────────────" | tee -a "$REPORT_FILE"

# Calculate success rate
TOTAL_CHECKS=9
PASSED_CHECKS=0

# Check each major component
[ "$HTTP_CODE" = "200" ] && ((PASSED_CHECKS++))
[ -f "dist/_worker.js" ] && ((PASSED_CHECKS++))
[ "$ERROR_COUNT" -lt 50 ] && ((PASSED_CHECKS++))
[ "$TODO_COUNT" -lt 10 ] && ((PASSED_CHECKS++))
[ "$ALERT_COUNT" -eq 0 ] && ((PASSED_CHECKS++))
pm2 list | grep -q "online" && ((PASSED_CHECKS++))
[ -f ".dev.vars" ] && ((PASSED_CHECKS++))
[ -n "$TABLES" ] && ((PASSED_CHECKS++))

SUCCESS_RATE=$((PASSED_CHECKS * 100 / TOTAL_CHECKS))

echo "" | tee -a "$REPORT_FILE"
echo "System Health: $SUCCESS_RATE%" | tee -a "$REPORT_FILE"
if [ $SUCCESS_RATE -ge 90 ]; then
    echo "Status: 🟢 EXCELLENT - Ready to proceed" | tee -a "$REPORT_FILE"
elif [ $SUCCESS_RATE -ge 75 ]; then
    echo "Status: 🟡 GOOD - Minor issues to address" | tee -a "$REPORT_FILE"
else
    echo "Status: 🔴 NEEDS ATTENTION - Issues must be fixed" | tee -a "$REPORT_FILE"
fi

echo "" | tee -a "$REPORT_FILE"
echo "Report saved to: $REPORT_FILE" | tee -a "$REPORT_FILE"

echo ""
echo "╔════════════════════════════════════════════════════════════════════════════╗"
echo "║                     DEBUG CHECKPOINT #${CHECKPOINT_NUM} COMPLETE                           ║"
echo "║                     Health Score: $SUCCESS_RATE%                                      ║"
echo "╚════════════════════════════════════════════════════════════════════════════╝"
echo ""
echo "📄 Full report: $REPORT_FILE"
echo ""

# Exit with appropriate code
if [ $SUCCESS_RATE -ge 75 ]; then
    exit 0
else
    exit 1
fi
