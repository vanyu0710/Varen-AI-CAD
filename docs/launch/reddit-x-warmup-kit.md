# Reddit + X 预热发射包（2026-09-17 · 已扫禁用词 · 数字均有 benchmark/CHANGELOG 依据）

> ⛔ **r4 状态（同日）：本文件第 2 节（Reddit 产品型主帖）作废，暂停使用 7–14 天。**
> 复盘：新号低信用 + 产品型帖 = 低质量推广信号叠加，继续跨版发相似内容会伤害账号。
> Reddit 现行策略：只做无链接的社区参与（回答 CAD/B-Rep/STEP/参数化问题、评论 AI CAD 局限）；
> 未来首发形态改**问题型/实验型/开放基准型**（如 "I'm building an open benchmark for AI-generated
> mechanical assemblies — what failure cases should it include?"），产品链接沉到评论、不作主要 CTA。
> 第 1 节 X build-in-public 素材保留（5% 实验线，不设 KPI）。本文件的精力配额已让位给
> `定向触达名册-第一层.md`（高接触设计伙伴）。

> 用法：复制粘贴即用。X 今天可发；Reddit 按第 2 节的节奏表执行（新号先养 3–5 天）。
> 配图位置见文末素材表；发任何一帖前最后自查一次 positioning.md 禁用词。

---

## 1. X —— 今天可发的预热线程（5 条）

**主线程（间隔 2–5 分钟逐条发，1 号条带配图 1）**

> 1/ An LLM once told me it "successfully created 6 bolt holes" in a CAD part.
> We measured the B-rep: 3 cylindrical faces. It had undone its own holes mid-run, then lied in the summary.
> That lie is the reason Varen CAD exists. 🧵

> 2/ So in our agent, "done" is not a sentence the model writes — it's a program:
> • part declares its holes ({through_hole, Ø8, ×6}) → kernel counts actual faces, mismatch = NOT archived
> • multi-body = rejected · hard collisions block export (INTERFERENCE_BLOCKED)
> • unsupported ops (threads, 2D drawings) are refused, never faked

> 3/ Our flagship run: "design a 1:100 three-stage gearbox" → research calcs → BOM plan → 8 parts → assembly STEP.
> 53 steps, 758s.
> First attempt was blocked by the interference gate. The agent redid shaft poses and only then shipped: 0 unexempted collisions.
> The gate earned its keep.

> 4/ It runs on your machine: local-first, real OpenCascade (build123d) geometry, parametric history you can actually edit.
> Cloud vendors charge ~$399/user/mo just to exclude your drawings from their training data.
> We don't have your drawings. That's the point.

> 5/ Open source (AGPL), Windows beta now recruiting 30 design partners — real tasks welcome, failure samples get published as benchmark data.
> github.com/vanyu0710/aicad

**次条（今天晚些，配变速箱四视图）**

> A 26-part 5-speed manual transmission — real involute helical gears (β=15°), housing back-derived from the envelope + per-item program audit — generated end-to-end by our CAD agent. 325 interference pairs checked, 0 hard collisions, every step replayable.
> (assembly STEP + run logs in repo)

**第三条（本周内，build-in-public 素材）**

> Day 2 of our closed beta. We started publishing a weekly failure report — first issue filed against ourselves: our benchmark judge reported 2 false FAILs and deleted 2 real PASSes before we caught it.
> Failing honestly is the product. The gates are, too.

**X 操作备注**
- 线程首条置顶；bio 按 accounts-prep-checklist.md 先改完再发
- 回复区自己补一条：Show HN 计划 + 试用端点申请入口（beta_application 链接）
- 不要一天发超过 2 帖；被问参数细节一律甩 benchmark JSON

---

## 2. Reddit —— 节奏表 + 首发文案

**为什么先养**：新号 + 带链接 = shadowban 高危；r/MechanicalEngineering 禁自推。

| 天 | 动作 |
|---|---|
| D0–D3 | 只评论不发帖。每天 2–3 条真实评论攒 karma（目标 ≥10）。目标帖：①"AI CAD Harness" Show HN 讨论区（谈验证门控，自然带出你做了什么，不贴链接）②r/LocalLLaMA 的 agent 工具帖（谈"LLM 谎报完成"这个通病，最对味）③r/OpenSourceCAD 里 build123d/cadquery 讨论 |
| D3–D5 | 发首发主帖（下面文案 A），账号 karma≥10 后；同一时间只在**一个**子版 |
| D7+ | 有回复后：把 thread 里的提问转成失败周报素材；D10 才考虑第二子版 |

**文案 A — 主帖（r/LocalLLaMA 的 Show and Tell 或 r/OpenSourceCAD；纯文本+仓库链接）**

> **Title:** We built a CAD agent that refuses to ship its own output — and we think that's the only interesting part
>
> **Body:**
> Context: we're building Varen CAD, an open-source local agent that drives a real OpenCascade kernel (build123d) to model parametric mechanical assemblies from natural language.
>
> The honest reason it exists: LLMs will confidently lie about geometry. Our real example — the model undid 4 bolt holes + 1 bearing hole mid-run, then summarized "all features created". The B-rep had 3 cylindrical faces.
>
> So "success" is decided by code, not prose:
> - **Feature contracts**: parts declare holes ({through_hole, Ø30, ×6}); the kernel measures actual cylindrical faces by radius/count. Mismatch → FEATURE_CONTRACT_MISMATCH, archiving refused.
> - **Single-body gate**: floating features are machine-rejected (this caught a real "floating gear tooth" bug).
> - **Interference gate**: full pairwise collision check before assembly export; gear-mesh overlaps need an explicit exemption, everything else → INTERFERENCE_BLOCKED.
>
> We're now running a 30-person closed beta and publishing a **negative-control benchmark**: tasks where we deliberately instruct the model to fake features (e.g. "represent a through-hole as an external boss"), to test whether the gates actually bite — including on our own agent. Failures are published alongside successes, weekly.
>
> Not claims: no 2D drawings, no constraint solver, `production_ready` is permanently false; outputs are concept/prototype stage, human-checked before manufacturing.
>
> If you're a mechanical engineer, I'd love to hear: what's the one part family you keep redrawing (brackets? shafts? flanges?) — that's what we're tuning next. Repo: github.com/vanyu0710/aicad (AGPL)

**为什么这个文案合规**：帖子主体是技术故事+一个向社区提问的钩子（"你重复画什么"），链接在末尾一句——这是 r/LocalLLaMA 可接受的 Show and Tell 形态；若版主嫌推广，删链接重发（评论区补）。**绝不在 r/MechanicalEngineering 首发带链接**——那边先用分析帖姿势。

**评论模板（养号用，别复制粘贴同一句到多处）**

> （对 AI CAD harness 帖）The validation story is where this all lives or dies. We keep hitting the same wall with agents claiming completion they can't back up — in our CAD work we ended up gating every "done" on measured B-rep facts (face counts vs declared feature contracts). Curious whether the text-to-CAD crowd is converging on programmatic checks or staying with visual self-review.

---

## 3. 配图素材（本地已有，发前导出 PNG）

| 用途 | 文件 |
|---|---|
| X 1/ | `aicad/docs/images/varen-gearbox-assembly.png`（减速器四视图） |
| X 次条 | `aicad/docs/images/varen-transmission-visual.png`（26 件总成） |
| Reddit（若用图） | `aicad/docs/images/render-before-after.png`（证据渲染前后，讨论度最高的一张） |
| 门控截图（缺） | 跑 `--task negative-interference` 截 INTERFERENCE_BLOCKED 红卡——发 Reddit 主帖前补上，线程可先不带 |

## 4. 发布后 30 分钟动作

- [ ] X：置顶线程；回复所有含问题的评论（数字问题一律链 benchmark/results）
- [ ] Reddit：不编辑已发正文（会触发再审核）；回复带批判性的评论比删评更赚信任
- [ ] 两平台各截图留存 → 数据填进失败周报 #2 的传播指标行（只算兴趣指标，别当进展）
