# dsh-study-tutor

[English](README.md) | 中文

DeepSeek Harness（DSH）的学习模式插件：面向物理、数学和工程的教学 Agent 预设。作答、判分和学习证据由 Host 掌握，而不是由模型决定。插件同时提供经验证的富视觉：函数曲线、统计图、示意图、热力图、经过净化的 SVG 绘图、工作区图片、确定性物理演示，以及受限的 Mermaid 流程图子集。图可以插在回答正文中，紧挨着讲解它的文字。

> **状态：0.3.0。** 已在 DSH `0.2.2-rc.1` 和 `0.2.1-rc.5` 上用确定性的模拟模型、真实的 Host 和浏览器进程完成测试。此前的版本也在 DSH 桌面版中接入真实模型使用过（讲授、图片行插图、模型出题卡片）。0.3.0 新增的正文内图形和正文题卡**尚未**接入真实模型使用；教学效果和真实模型出题的质量也尚无系统评估。
>
> 0.3.0 在 DSH 0.2.2 上把图形和题卡直接画进**回答正文**：模型在需要图的位置写受限的 ` ```svg `、` ```mermaid `、` ```dsh-plot `、` ```dsh-heatmap ` 或 ` ```dsh-physics ` 代码块，图会随回答流式输出在原位画出，带“查看源码”开关并适配浅色/深色主题；Study 题卡出现在调用工具的位置。DSH 0.2.1 上行为不变，仍使用 0.2.x 的图文件方式（见[回答中的图形](#回答中的图形)）。原生工具呈现仍由 Study 预设自己的 `@deepseek-ai/dsh-agent-tool-presentation` 行声明（自 0.2.2 起）。支持范围为 `>=0.2.1-rc.3 <0.2.3`。
>
> npm 包名为 **`dsh-study-tutor`**（npm 上的 `dsh-study-mode` 是另一个无关项目）。本仓库仍叫 `dsh-study-mode`。

## 安装

需要 DSH `>=0.2.1-rc.3 <0.2.3` 和 Node.js `>=24.13.0`。

```sh
dsh plugin --profile <profile> add dsh-study-tutor
# 或从 GitHub 固定版本安装：
dsh plugin --profile <profile> add github:HaowenCang/dsh-study-mode#v0.3.0
```

**从 0.2.x 升级：** 先完全退出 DSH 桌面版，运行 `dsh plugin --profile <profile> add dsh-study-tutor@0.3.0`（或上面的 GitHub 标签），再新建会话。数据库结构没有变化。

**从 0.1.0 或预览版（包名 `dsh-study-mode`）升级：** 先完全退出 DSH 桌面版，执行 `dsh plugin --profile <profile> remove dsh-study-mode`，再添加 `dsh-study-tutor`，然后新建会话。桌面版运行时安装，可能让 Study 预设继续使用旧代码。学习数据仍在 `$DSH_HOME/study-core/study.db`；插件行的 id 仍是 `dsh-study-mode`，已有的 `cordis.patch.yml` 覆盖照样生效。0.2.0 会把数据库升级到 schema 3，0.1.0 无法打开；如果可能回退，请先备份 `study.db`。

仓库已提交构建好的 `lib/`，从 Git 安装不会运行构建脚本，也不需要在 `allowBuilds` 里放行。请固定标签或提交，避免之后的推送改变你实际运行的代码。打包好的 tarball 也可以这样安装：`dsh plugin --profile <profile> add ./dsh-study-tutor-<version>.tgz`。卸载：`dsh plugin --profile <profile> remove dsh-study-tutor`。

## 提供的功能

**学习模式预设**（Agent 选择器中的 `Study Mode`）。Agent 加载内置的 `study-systematic-teaching` Skill，按顺序讲授：概念与适用条件 → 建模 → 逐行推导 → 完整例题示范 → 一次一步的引导练习 → 独立测评 → 反馈与复习。预设内只开放教学和可视化工具，拒绝切换工作目录。

**Agent 工具**

| 工具 | 作用 |
|---|---|
| `study_get_state` | 读取 Host 记录的课程、讲授阶段、作答和证据 |
| `study_get_plan` | 读取已导入的课程计划（只是排期，不是完成证据） |
| `study_teaching_step` | 记录实际完成的讲授阶段，不会设置掌握度 |
| `study_issue_question` | 从 Host 可信题库发放题目，显示为作答卡片 |
| `study_author_question` | 模型自己出题并显示为作答卡片：单选、多选、判断、填空或简答/推导，附 H1–H4 提示 |
| `study_model_review` | 对照参考答案评阅已提交的简答，单独记录，不是判分 |
| `rich_render` | 渲染经验证的函数曲线、统计图、示意图或消息卡片 |
| `rich_physics_demo` | 显示可调参数的确定性物理演示（无限深势阱、谐振子、有限 Ising 模型），可导出 SVG |
| `rich_mermaid` | 用受限的 Mermaid 子集画流程图（见下文） |
| `rich_heatmap` | 把数值矩阵画成热力图（顺序或发散配色，最多 128 x 128、4,096 格），可导出 SVG |
| `rich_image` | 把会话工作目录中已有的 PNG、JPEG、GIF 或 WebP 图片展示给学生（见下文） |
| `rich_svg` | 用白名单内的 SVG 子集画示意图（受力图、几何图、电路、实验装置，见下文） |
| `rich_check_figure` | DSH 0.2.2：在正文中写图形代码块之前先检查；只返回通过或带行号的问题，不绘图也不保存 |

**命令**：`/study-mode` 切换教学模式，不清空历史；`/study-attempt` 供作答卡片使用；`/study-review`（人工复核）只在开启 `enableHumanReview` 时注册；`rich-interaction` 把卡片按钮操作记录到原会话。

## 学习证据

- 作答、提示、已看解析、判分和复核都只追加、不修改。模型不能通过任何工具代学生提交答案、做人工复核或设置掌握度；学生要在卡片上亲自作答。
- 帮助强度记为 H0–H4（只有题面 → 完整解答），按该题此前出现过的最高帮助计。能力证据按维度（概念、建模、推导、运算、迁移）分别记录：U 未测，N 未通过，S 提示后完成，P 独立通过，R 至少 24 小时后在新情境中再次独立通过。
- 客观题确定性判分；没有可靠核验手段的开放推导保持待复核。
- 模型出的题在卡片上标注“模型出题”。答案键、提示和参考答案在发题时锁定，不显示在卡片上；Host 只检查结构，不检查模型的答案是否正确。这些题与题库题按同样规则计入能力证据。对于没有配置课程或课题的内容，模型会用简短的小写 id 新建课题（如 `math` / `laplace-pde`），`study_get_state` 中标为 `modelCreated`。填空题逐空按规范化文本或容差内的数值判分。学生提交后显示参考答案。模型评阅标注“不计入判分”，不改变判分、待人工复核状态或能力等级。答案键在模型的工具调用参数里，因此会出现在会话记录中。
- 数据存放在 SQLite：`$DSH_HOME/study-core/study.db`（默认 `~/.dsh/study-core/study.db`），事件哈希链、请求幂等，并拒绝未知的未来版本数据库。0.2.0 会把数据库升级到 schema 3，旧版本会拒绝打开；如果可能回退，升级前先备份 `study.db`。

## 受限 Mermaid

插件从不运行 Mermaid 本身。`rich_mermaid`（以及 DSH 0.2.2 上回答里的 ```` ```mermaid ```` 代码块）把严格子集编译给内置的示意图渲染器；DSH 自带的 Markdown 只会把这种代码块显示为普通代码：

- `flowchart` / `graph`，方向 `TD`、`TB`、`BT`、`LR`、`RL`；最多 5 层，同一层大约 5 个节点。
- 节点 `A`、`A[方框]`、`A(圆角)`、`A([体育场形])`（画成圆角）、`A{判断}`、`A((圆))`；连线 `-->`、`-.->`、`-->|标签|`、`-- 标签 -->`，可以链式书写。
- 标签是纯文本：HTML、实体和 markdown 会被拒绝（平均值写成 ⟨p⟩）。
- 子集之外的写法，以及连线会穿过节点、标签会被遮挡或重叠、箭头看不见的布局，都会返回带行号的错误，而不是勉强画出来。

## 回答中的图形

### DSH 0.2.2：正文内绘制图形代码块

插件通过 DSH 文档化的 slot 优先级机制接管助手回复的渲染（该契约变化时会自动退回 DSH 自带的渲染器）。回答中的顶层代码块会在原位画出：

| 代码块 | 内容 |
|---|---|
| ` ```svg `、` ```dsh-svg ` | 一个 `<svg viewBox=…>`，元素范围同下文 `rich_svg` 白名单；流式输出时逐个元素画出 |
| ` ```mermaid `、` ```dsh-mermaid ` | 上文的受限 Mermaid 子集；`%% title: …` 设置图名 |
| ` ```dsh-plot ` | `rich_render` 的折线/散点图 JSON，或 `{"title","fns":[{"expr","label"}],"x":[a,b]}`，表达式只能用 `x`、数字、`+ - * / ^`、括号和 `sin cos tan exp log sqrt abs pi e`（最多 8 条曲线） |
| ` ```dsh-heatmap ` | `rich_heatmap` 的内容 JSON |
| ` ```dsh-physics ` | `{"demo":"infinite_well"}`、`"harmonic_oscillator"` 或 `"ising"` |

每张图都有“查看源码”开关。被拒绝的 ` ```svg ` 或 ` ```mermaid ` 代码块按普通代码显示；被拒绝的 `dsh-*` 代码块显示带行号的问题。不写任何文件，回答里也不会出现本机路径。颜色跟随浅色/深色主题（近黑的线条改为文字颜色，近白的填充改为页面底色）。这对所有会话生效，普通会话里的 ` ```svg ` 和 ` ```mermaid ` 代码块也会被画出。正文图形开启时，Study 提示词会说明代码块语法和 `rich_check_figure`。

Study 题卡（`study_issue_question`、`study_author_question`）出现在回答中调用该工具的位置。题卡向 Host 只读查询这次调用在本会话发出的题目，不信任会话记录；作答、提示和判分与以前完全相同，工具记录里显示指向题卡的链接，不再重复一份。

由 `rich.inline` 控制：`auto`（默认；DSH 0.2.2 及以上开启，0.2.1 关闭）、`on` 或 `off`。在浏览器中设置 `localStorage['dsh-rich-inline'] = 'off'` 可以只对该浏览器关闭正文渲染。

### DSH 0.2.1（或 `rich.inline: off`）：图片行

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

其他配置：`rich.inline`（`auto`、`on` 或 `off`，默认 `auto`，见[回答中的图形](#回答中的图形)）、`core.learnerId`（默认 `local-learner`）、`core.enableHumanReview`（默认 `false`）、`rich.maxTrackedAttempts`（默认 `512`）、`rich.maxImageBytes`（默认 `524288`）、`rich.figuresDir`（默认 `$DSH_HOME/rich-response/figures`）。

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
- 正文内图形（DSH 0.2.2）：真实模型能否正确书写这些代码块尚未验证；较短的左右方向 Mermaid 流程图会画在一个偏高、大部分空白的画布里；没有全屏查看；被拒绝的代码块不会自动反馈给模型（由 `rich_check_figure` 和提示词弥补）。该渲染器镜像了 DSH 自带的回复视图，DSH 未来的版本可能需要随之更新（契约变化时会退回 DSH 的渲染器）。
- 正文题卡会向 Host 查询题目，会在会话里多出几行“学习记录已同步”。
- 图片行（DSH 0.2.1）：DSH 的 Markdown 预览把图片高度限制在 360px，较高的图会被缩小（点击可放大）。图文件不会自动清理。

## 许可证

[MIT](LICENSE)
