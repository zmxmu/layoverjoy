#!/bin/sh
# 城市目录单一事实源同步：shared/catalog → Android assets 与后端 src。
# 禁止手工编辑后两份副本；改目录只改 shared/catalog 后运行本脚本。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/shared/catalog/city-airport-catalog.zh-en.json"
cp "$SRC" "$ROOT/android/app/src/main/assets/catalog/city-airport-catalog.zh-en.json"
cp "$SRC" "$ROOT/backend/src/airports/city-airport-catalog.zh-en.json"
# 城市体验资料库（AI 中转价值解读，14 号方案）
EXP="$ROOT/shared/catalog/city-experience-catalog.zh-en.json"
mkdir -p "$ROOT/backend/src/explanations/data"
cp "$EXP" "$ROOT/backend/src/explanations/data/city-experience-catalog.zh-en.json"
echo "catalog synced: $(python3 -c "import json;print(json.load(open('$SRC'))['schemaVersion'])") + experience $(python3 -c "import json;print(json.load(open('$EXP'))['schemaVersion'])")"
