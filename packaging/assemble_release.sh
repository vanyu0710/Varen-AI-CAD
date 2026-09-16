#!/usr/bin/env bash
# 组装 Varen CAD 打包版发行目录 + zip
# 版本号单一来源：aicad/VERSION（第一个参数可覆盖，仅限发版演练）
set -euo pipefail
cd "$(dirname "$0")"

VER="${1:-$(tr -d '[:space:]' < ../VERSION)}"
OUT="release/VarenCAD-win64-$VER"

rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT"

cp -r dist/VarenCAD/* "$OUT/"
mkdir -p "$OUT/runtime"
cp -r runtime/python "$OUT/runtime/python"
cp release_assets/.env.example "$OUT/.env.example"
cp release_assets/README-发行说明.txt "$OUT/README-发行说明.txt"

# 绝不随包携带开发机 .env（含 API key）
rm -f "$OUT/.env"

cd release
zip -q -r "VarenCAD-win64-$VER.zip" "VarenCAD-win64-$VER"
sha256sum "VarenCAD-win64-$VER.zip" > "VarenCAD-win64-$VER.sha256"
echo "done: $OUT.zip"
echo "sha256: $(cat "VarenCAD-win64-$VER.sha256")"
du -sh "$OUT" "$OUT.zip" 2>/dev/null | cat
