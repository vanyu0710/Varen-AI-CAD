# Varen 失败周报 #1

**周期**：2026-09-15 → 09-21（进行中）· **产品版本**：v0.21.0-beta · **数据**：`benchmark/results/` + 发布基础设施搭建记录

> 周报立场：**失败样本与成功样本同权重**。第一期收的失败还不多——那就从我们自己犯的错误记起。

## 1. 数字

| 指标 | 本周 |
|---|---|
| benchmark 真实 LLM 完成任务（外部用户） | 0（封闭 Beta 未开闸） |
| 内部冒烟任务通过全部门控 | **2/2（PASS）** |
| 被门控拦下的"谎报"次数 | 0（负例任务未跑） |
| 工具链自身缺陷发现并修复 | 2 起（见 §2，这是本周主要的"失败"） |

冒烟明细（deepseek 级 planner，真实 MechKernel worker）：
- `flange-basic`：15 步 / 163.9s / STEP 导出 ✅（`results/20260916T102140Z/flange-basic.json`）
- `tube-groove`：15 步 / 230.4s / STEP 导出 ✅（同上目录）

## 2. 本周失败样本 #1、#2：失败的是我们的判定器

**#1 单件任务被误判 FAIL。**
首轮冒烟两个任务产品侧全部 SUCCESS，runner 却判 FAIL，理由 `PARTS_SHORT: 0 < 1`。
**归因**：benchmark 判定器设计缺陷——`min_parts` 判据只适用于走 `finish_part` 归档的装配任务；
单件任务产物在 run 目录（`model.step`），`result.parts` 恒为空。判定器错把"路径不同"当"没交付"。
**处置**：改为按 run 目录 STEP 文件计数（`step_outputs`）；单件任务删除 `min_parts` 判据；
两份误报记录删除重跑，本条故事留档。**教训入规**：判定器的错误比产品的错误更危险——它会污染我们对产品的信任度量。这条将进入 benchmark 的元测试。

**#2 181MB 的"失败"上传。**
首次发布上传在 25 分钟处断流，GitHub 留下 `starter` 半截 asset，下载 400。
**归因**：代理链路速率 ~130KB/s × 181MB 恰好卡在超时边缘，curl 静默死亡。
**处置**：测速 → 定超时余量 → 删除脏 asset → 重传成功（HTTP 201）→ 下载可达复核 + 字节数比对。
**教训入规**：发布检查清单补充"大文件上传必须带完成态复核，禁止只信响应码"。

## 3. 本周通过样本

见 §1 表。两份记录含完整 prompt、模型、版本、耗时、事件流——全部可 `scripts/run_benchmark.py --task <id>` 复跑。

## 4. 下周焦点

**跑通第一个负例**：`negative-hole-fraud`（教唆模型用外凸台冒充通孔，验证孔语义契约门是否拦截）。
它回答的问题是"门是不是只拦好人"——这是本产品的立身之本，优先级高于任何新功能。

## 5. 参与

失败任务提交：[task_failure 模板](https://github.com/vanyu0710/aicad/issues/new?template=task_failure.yml) · 设计伙伴申请：[beta_application](https://github.com/vanyu0710/aicad/issues/new?template=beta_application.yml)
