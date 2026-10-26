# dsh-study-mode

[English](README.md) | 中文

DeepSeek Harness（DSH）的学习模式插件：面向物理、数学和工程的教学 Agent 预设。作答、判分和学习证据由 Host 掌握，而不是由模型决定。插件同时提供经验证的富视觉：函数曲线、统计图、示意图、确定性物理演示，以及受限的 Mermaid 流程图子集。

> **状态：0.1.0 预发布。** 已在 DSH `0.2.1-rc.3` 上，用确定性的模拟模型、真实的 Host 和浏览器进程完成测试。接入真实模型后的教学效果尚未验证。

## 安装

需要 DSH `>=0.2.1-rc.3 <0.2.2` 和 Node.js `>=24.13.0`。

```sh
dsh plugin --profile <profile> add github:HaowenCang/dsh-study-mode#v0.1.0
```

仓库已提交构建好的 `lib/`，从 Git 安装不会运行构建脚本，也不需要在 `allowBuilds` 里放行。请固定标签或提交，避免之后的推送改变你实际运行的代码。卸载：`dsh plugin --profile <profile> remove dsh-study-mode`。

## 提供的功能

**学习模式预设**（Agent 选择器中的 `Study Mode`）。Agent 加载内置的 `study-systematic-teaching` Skill，按顺序讲授：概念与适用条件 → 建模 → 逐行推导 → 完整例题示范 → 一次一步的引导练习 → 独立测评 → 反馈与复习。预设内只开放教学和可视化工具，拒绝切换工作目录。

**Agent 工具**

| 工具 | 作用 |
|---|---|
| `study_get_state` | 读取 Host 记录的课程、讲授阶段、作答和证据 |
| `study_get_plan` | 读取已导入的课程计划（只是排期，不是完成证据） |
| `study_teaching_step` | 记录实际完成的讲授阶段，不会设置掌握度 |
| `study_issue_question` | 从 Host 可信题库发放题目，显示为作答卡片 |
| `rich_render` | 渲染经验证的函数曲线、统计图、示意图或消息卡片 |
| `rich_physics_demo` | 显示可调参数的确定性物理演示（无限深势阱、谐振子、有限 Ising 模型），可导出 SVG |
| `rich_mermaid` | 用受限的 Mermaid 子集画流程图（见下文） |

**命令**：`/study-mode` 切换教学模式，不清空历史；`/study-attempt` 供作答卡片使用；`/study-review`（人工复核）只在开启 `enableHumanReview` 时注册；`rich-interaction` 把卡片按钮操作记录到原会话。

## 学习证据

- 作答、提示、已看解析、判分和复核都只追加、不修改。模型不能通过任何工具代学生提交答案、做人工复核或设置掌握度；学生要在卡片上亲自作答。
- 帮助强度记为 H0–H4（只有题面 → 完整解答），按该题此前出现过的最高帮助计。能力证据按维度（概念、建模、推导、运算、迁移）分别记录：U 未测，N 未通过，S 提示后完成，P 独立通过，R 至少 24 小时后在新情境中再次独立通过。
- 客观题确定性判分；没有可靠核验手段的开放推导保持待复核。
- 数据存放在 SQLite：`$DSH_HOME/study-core/study.db`（默认 `~/.dsh/study-core/study.db`），事件哈希链、请求幂等，并拒绝未知的未来版本数据库。

## 受限 Mermaid

DSH 聊天里的 ```` ```mermaid ```` 代码块只显示为普通代码。`rich_mermaid` 不运行 Mermaid，而是把严格子集编译给内置的示意图渲染器：

- `flowchart` / `graph`，方向 `TD`、`TB`、`BT`、`LR`、`RL`；最多 5 层，同一层大约 5 个节点。
- 节点 `A`、`A[方框]`、`A(圆角)`、`A([体育场形])`（画成圆角）、`A{判断}`、`A((圆))`；连线 `-->`、`-.->`、`-->|标签|`、`-- 标签 -->`，可以链式书写。
- 标签是纯文本：HTML、实体和 markdown 会被拒绝（平均值写成 ⟨p⟩）。
- 子集之外的写法，以及连线会穿过节点、标签会被遮挡或重叠、箭头看不见的布局，都会返回带行号的错误，而不是勉强画出来。

## 配置

`dsh-study-mode` 这一行从启动环境变量读取以下配置；也可以在 profile 的 `cordis.patch.yml` 里覆盖这一行直接写值（覆盖会替换整个 `config`）。

| 环境变量 | 配置键 | 含义 |
|---|---|---|
| `DSH_STUDY_DATABASE` | `core.databasePath` | 数据库文件；必须在 `$DSH_HOME` 内，且路径上不能有符号链接 |
| `DSH_STUDY_CATALOG` | `core.catalogPath` | 可信题库 JSON；默认使用合成示例 `data/synthetic.json` |
| `DSH_STUDY_PLANS` | `core.plansPath` | 课程计划定义 JSON（可选） |
| `DSH_RICH_RESPONSE_AUDIT_LOG` | `rich.auditLog` | 卡片交互的 JSONL 审计日志（可选） |

其他配置：`core.learnerId`（默认 `local-learner`）、`core.enableHumanReview`（默认 `false`）、`rich.maxTrackedAttempts`（默认 `512`）。

**题库**是带版本的题目数组（`id`、`version`、`courseId`、`topicId`、`familyId`、`kind`、`prompt`、选项或期望数值、`answer`、`dimensions`、`coverage`、`hints.H1`…`H4`），示例见 `data/synthetic.json`。**课程计划**是 `{ courseId, title, version, startDate, endDate, evidenceStatus: "not_imported", sources: [{ path, sha256 }], days: [{ day, unit, title, topics, tasks: [{ id, kind, title, minutes }] }] }` 的数组。计划只导入定义，从不导入学生成绩。

## 仓库结构

| 路径 | 内容 |
|---|---|
| `src/host.ts`、`src/client.ts` | 包入口：一个 Loader 行和一个浏览器模块，挂载两个插件 |
| `core/` | Study Core：领域模型、SQLite 存储、Host 工具与命令、作答卡片、学习模式 Agent |
| `rich/` | Rich Response：数据校验、渲染器、物理计算、Mermaid 编译器、工具视图 |
| `data/`、`skills/` | 合成示例题库和教学 Skill，由构建后的入口读取 |
| `lib/` | 已提交的构建产物（`index.js`、`client.js`、`agent.js`） |

## 开发

```sh
npm install
npm run verify   # 类型检查、构建 lib/、运行 Study Core、Rich Response 和包测试
```

`lib/` 必须与源码重新构建的结果一致；不一致时包测试会失败。修改源码后请运行 `npm run build` 并一起提交 `lib/`。

## 已知限制

- 真实模型下的教学行为（教学方法、工具选择、是否遵守 Skill）尚未验证。
- Mermaid：交叉且都带标签的连线会被拒绝；三层带标签的嵌套判断需要用 `LR`；不支持 subgraph、样式、点击和其他图表类型。
- 示意图画布比例固定，窗口很窄时文字会变小。
- 暂不支持图像资产（计算生成、外部或 AI 生成的图片）。

## 许可证

[MIT](LICENSE)
