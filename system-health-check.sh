#!/bin/bash
echo "=================================="
echo "🔍 SYSTEM HEALTH CHECK"
echo "=================================="
echo ""

# 1. Project Structure
echo "📁 1. PROJECT STRUCTURE CHECK"
echo "   Checking critical files..."
files_ok=0
files_missing=0

critical_files=(
    "package.json"
    "wrangler.jsonc"
    "ecosystem.config.cjs"
    "src/index.tsx"
    "migrations/0001_initial_schema.sql"
)

for file in "${critical_files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✅ $file"
        ((files_ok++))
    else
        echo "   ❌ MISSING: $file"
        ((files_missing++))
    fi
done
echo "   Result: $files_ok OK, $files_missing missing"
echo ""

# 2. Dependencies
echo "📦 2. DEPENDENCIES CHECK"
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules exists"
    pkg_count=$(ls -1 node_modules 2>/dev/null | wc -l)
    echo "   📊 Installed packages: $pkg_count"
else
    echo "   ❌ node_modules missing"
fi
echo ""

# 3. Git Status
echo "🔧 3. GIT STATUS"
git_branch=$(git branch --show-current 2>/dev/null)
if [ -n "$git_branch" ]; then
    echo "   ✅ Git initialized"
    echo "   📍 Current branch: $git_branch"
    git_status=$(git status --porcelain 2>/dev/null | wc -l)
    echo "   📊 Uncommitted changes: $git_status files"
else
    echo "   ❌ Git not initialized"
fi
echo ""

# 4. Database
echo "💾 4. DATABASE CHECK"
if [ -d ".wrangler/state/v3/d1" ]; then
    echo "   ✅ Local D1 database exists"
    db_count=$(ls -1 .wrangler/state/v3/d1/*.sqlite 2>/dev/null | wc -l)
    echo "   📊 Database files: $db_count"
else
    echo "   ⚠️  Local D1 not initialized yet"
fi
echo ""

# 5. Build Output
echo "🏗️  5. BUILD OUTPUT CHECK"
if [ -d "dist" ]; then
    echo "   ✅ dist/ directory exists"
    if [ -f "dist/_worker.js" ]; then
        worker_size=$(du -h dist/_worker.js | cut -f1)
        echo "   ✅ _worker.js: $worker_size"
    else
        echo "   ⚠️  _worker.js not built yet"
    fi
else
    echo "   ⚠️  dist/ not built yet"
fi
echo ""

# 6. Code Quality
echo "📝 6. CODE QUALITY SCAN"
echo "   Checking for common issues..."
src_lines=$(find src -name "*.tsx" -o -name "*.ts" 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
echo "   📊 Source lines of code: $src_lines"

# Check for console.log (should be minimal in production)
console_logs=$(grep -r "console.log" src/ 2>/dev/null | wc -l)
echo "   🔍 console.log statements: $console_logs"

# Check for TODO comments
todos=$(grep -r "TODO\|FIXME" src/ 2>/dev/null | wc -l)
echo "   📝 TODO/FIXME comments: $todos"
echo ""

# 7. Security Check
echo "🔒 7. SECURITY SCAN"
echo "   Checking for sensitive data..."
if [ -f ".env" ]; then
    echo "   ⚠️  .env file exists (should not be in repo)"
else
    echo "   ✅ No .env file in root"
fi

if [ -f ".dev.vars" ]; then
    echo "   ✅ .dev.vars exists (local dev only)"
fi

# Check .gitignore
if grep -q "\.env" .gitignore 2>/dev/null; then
    echo "   ✅ .env in .gitignore"
else
    echo "   ⚠️  .env not in .gitignore"
fi
echo ""

# 8. Performance Metrics
echo "⚡ 8. PERFORMANCE METRICS"
if [ -f "dist/_worker.js" ]; then
    worker_size_kb=$(du -k dist/_worker.js | cut -f1)
    echo "   📊 Worker bundle size: ${worker_size_kb}KB"
    if [ $worker_size_kb -lt 1024 ]; then
        echo "   ✅ Under 1MB limit"
    else
        echo "   ⚠️  Large bundle size"
    fi
fi
echo ""

# Summary
echo "=================================="
echo "📊 HEALTH CHECK SUMMARY"
echo "=================================="
echo "   Files: $files_ok/$((files_ok + files_missing)) OK"
echo "   Git: $([ -n "$git_branch" ] && echo "✅ Initialized" || echo "❌ Missing")"
echo "   Dependencies: $([ -d "node_modules" ] && echo "✅ Installed" || echo "❌ Missing")"
echo "   Build: $([ -f "dist/_worker.js" ] && echo "✅ Ready" || echo "⚠️  Needs build")"
echo ""
echo "Status: $([ $files_missing -eq 0 ] && echo "✅ HEALTHY" || echo "⚠️  NEEDS ATTENTION")"
echo "=================================="
