# dsh-study-mode

[English](README.md) | 中文

DeepSeek Harness（DSH）的学习模式插件：面向物理、数学和工程的教学 Agent 预设。作答、判分和学习证据由 Host 掌握，而不是由模型决定。插件同时提供经验证的富视觉：函数曲线、统计图、示意图、热力图、经过净化的 SVG 绘图、工作区图片、确定性物理演示，以及受限的 Mermaid 流程图子集。图可以插在回答正文中，紧挨着讲解它的文字。

> **状态：0.2.0-preview.1，本地预览构建。** 已在 DSH `0.2.1-rc.3` 上，用确定性的模拟模型、真实的 Host 和浏览器进程完成测试。接入真实模型后的教学效果和图的插入位置尚未验证。

## 安装

需要 DSH `>=0.2.1-rc.3 <0.2.2` 和 Node.js `>=24.13.0`。

```sh
dsh plugin --profile <profile> add github:HaowenCang/dsh-study-mode#v0.1.0
```

仓库已提交构建好的 `lib/`，从 Git 安装不会运行构建脚本，也不需要在 `allowBuilds` 里放行。请固定标签或提交，避免之后的推送改变你实际运行的代码。打包好的 tarball 也可以这样安装：`dsh plugin --profile <profile> add ./dsh-study-mode-<version>.tgz`。卸载：`dsh plugin --profile <profile> remove dsh-study-mode`。

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
| `rich_heatmap` | 把数值矩阵画成热力图（顺序或发散配色，最多 128 x 128、4,096 格），可导出 SVG |
| `rich_image` | 把会话工作目录中已有的 PNG、JPEG、GIF 或 WebP 图片展示给学生（见下文） |
| `rich_svg` | 用白名单内的 SVG 子集画示意图（受力图、几何图、电路、实验装置，见下文） |

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

## 正文内插图

`rich_render`、`rich_mermaid`、`rich_heatmap`、`rich_svg` 和 `rich_image` 会把图的静态副本写到 `$DSH_HOME/rich-response/figures/<会话>/`（默认 `~/.dsh/...`，也可用 `rich.figuresDir` 指定），并返回一行 Markdown 图片：`![标题](<绝对路径>)`。模型把这一行原样复制到回答中需要放图的位置，DSH 的 Markdown 就通过带鉴权的文件接口在那里显示图片。可交互的卡片仍保留在工具记录里。文件按内容寻址、从不覆盖，已经显示过的回答会一直保留原图。

`rich_svg` 只接受 `g`、`defs`、`marker`、`line`、`polyline`、`polygon`、`rect`、`circle`、`ellipse`、`path`、`text`、`tspan`、`title`、`desc`，以及表现属性和字面颜色；脚本、样式、链接、图片、`use`、`foreignObject`、渐变、`url()` 填充和未知实体都会被拒绝。Host 根据解析出的记号在浅色图卡里重建绘图，从不展示模型写的源文本。

图片行里是本机的绝对路径，因此这个路径会成为回答和会话日志的一部分。

## 图片

`rich_image` 只负责展示：学生能看到图片，模型拿不到图片字节。它只读取会话工作目录内的文件（不接受 URL、UNC 或设备路径，也不接受指向目录外的符号链接或目录联接），只接受按文件头和结构核验过的 PNG/JPEG/GIF/WebP，默认不超过 512 KiB（`rich.maxImageBytes`，最多 2 MiB）、单边 8,192 像素、总计 4,000 万像素。浏览器只有在 SHA-256 与 Host 记录一致时才显示图片。不提供生成图片的功能。

图片字节保存在工具结果里，因此也在会话日志中；DSH 的 `session-log-deepseek` 会随官方 DeepSeek API 请求上传这份日志。不想上传的图片请不要展示。

## 配置

`dsh-study-mode` 这一行从启动环境变量读取以下配置；也可以在 profile 的 `cordis.patch.yml` 里覆盖这一行直接写值（覆盖会替换整个 `config`）。

| 环境变量 | 配置键 | 含义 |
|---|---|---|
| `DSH_STUDY_DATABASE` | `core.databasePath` | 数据库文件；必须在 `$DSH_HOME` 内，且路径上不能有符号链接 |
| `DSH_STUDY_CATALOG` | `core.catalogPath` | 可信题库 JSON；默认使用合成示例 `data/synthetic.json` |
| `DSH_STUDY_PLANS` | `core.plansPath` | 课程计划定义 JSON（可选） |
| `DSH_RICH_RESPONSE_AUDIT_LOG` | `rich.auditLog` | 卡片交互的 JSONL 审计日志（可选） |

其他配置：`core.learnerId`（默认 `local-learner`）、`core.enableHumanReview`（默认 `false`）、`rich.maxTrackedAttempts`（默认 `512`）、`rich.maxImageBytes`（默认 `524288`）、`rich.figuresDir`（默认 `$DSH_HOME/rich-response/figures`）。

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
- 示意图采用固定布局；窗口窄于 680px 时改为横向滚动，而不是把文字缩小。
- 图片：只支持工作区内的文件；不支持外部 URL，也不提供生成图片。
- 正文内插图：DSH 的 Markdown 预览把图片高度限制在 360px，较高的图会被缩小（点击可放大）。图文件不会自动清理。

## 许可证

[MIT](LICENSE)
