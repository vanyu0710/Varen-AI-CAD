# 发布检查清单（每次 Release 必走）

单一版本源：仓库根 `VERSION`（`backend/version.py` 读取，UI 经 `/api/health` 展示）。
本清单任何一步失败即停止发布，不带病出包。

## 1. 版本一致性
- [ ] `VERSION` 已更新，git tag 与其一致（`v<VERSION>`）
- [ ] `backend/version.py` 读到正确值（跑 `python -c "from backend.version import APP_VERSION; print(APP_VERSION)"`）
- [ ] 前端 `package.json` version 与 `VERSION` 一致（人工同步，禁止引入第四处版本源）
- [ ] 落地页 status chip、README 状态段落与本次版本一致

## 2. 质量门
- [ ] 后端全量测试绿：`.\.venv\Scripts\python.exe -m unittest discover -s tests`
- [ ] 内核仓测试绿（mechcad-kernel 仓内执行）
- [ ] 前端：`npm test && npm run build`
- [ ] `python -m compileall -q backend cad_worker` 通过
- [ ] benchmark 冒烟：`scripts/run_benchmark.py --dry-run` 通过 + 至少 1 个真实任务跑通

## 3. 打包与校验
- [ ] `pyinstaller packaging/varen_cad.spec --noconfirm`
- [ ] `bash packaging/assemble_release.sh`（自动读 VERSION，生成 zip + .sha256，剥离开发机 .env）
- [ ] 干净 Windows 机器（非开发账号）安装 zip：首启 ≤ 3 分钟，能完成"120 法兰"最小任务
- [ ] 记录 zip SHA256

## 4. 合规与文案
- [ ] LICENSE / 双许可口径无变化（变化须先更新 docs/license-strategy.md）
- [ ] 发布说明不含禁用词（首个/唯一/工业级/生产就绪/直接投产，见 docs/launch/positioning.md）
- [ ] KNOWN_ISSUES.md 增删与本次版本相符
- [ ] CHANGELOG.md 补齐本版本段落（当前落后于 git，见 §6）

## 5. 发布
- [ ] GitHub Release：zip + .sha256 + release notes；prerelease 标记（beta 期）
- [ ] 落地页/README 下载链接指向新 Release
- [ ] tag 推送：`git tag v<VERSION> && git push origin v<VERSION>`

## 6. 已知债务（发布时如实标注）
- 桌面快捷方式仍显示旧名 "MechCAD IDE"（更名排期中）
- 安装包未代码签名（SmartScreen 提示已在安装指引说明）
- CHANGELOG 落后于 git 提交（v0.17–v0.21 待补）
