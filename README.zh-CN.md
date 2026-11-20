# AI Solve Learning Problem · 苏格拉底 AI 启发式教学平台

English: [README.md](README.md) | 简体中文

基于开源 [DeepSeek ChatDemo](https://github.com/deepseek-ai/chat-demo) UI 深度改造的 **AI 苏格拉底启发式互动教学网站**。融合 **仿 ChatGPT 多服务商模型选择器**、**Agent 工具驱动的动态数学坐标系与 GeoGebra 双引擎**、**动点与联动辅助线** 以及 **渐进式思维流程图**，让界面顺手、舒心、符合人类学习直觉。

## 核心特性

- **苏格拉底一步步启发教学（绝不一口气给答案）**：
  - AI 每轮只推进一小步、只调用工具绘制当前这一步的图形或流程节点，然后停下来提出一个清晰的引导问题，引导学生自己推导出正确答案（同时附带快捷思考选项，既可一键回应也可自由输入）。
- **Agent 工具调用实时作图架构**：
  - AI 边回答边流式输出结构化 `tutor-tool` 工具调用，右侧画板实时增量绘制；每条消息内嵌可点击的「Agent 工具调用卡片」，画板顶部自带 **分步回放时间轴（第 1 步 → 第 2 步 → 第 3 步…）**，随时回顾每一步作图变化。
- **动态数学坐标系 + 官方 GeoGebra 双引擎**：
  - **内置极速 SVG 坐标引擎（离线零延迟）**：支持平移缩放、自适应网格、安全函数求值绘制、**画板上直接拖拽动点 + 底部播放/倍速动画滑块**、**动态辅助线**（垂线自动带实时直角符号 `∟`、对称轴反射、平行线、连线，**随动点移动实时同步联动**）以及实时度量 HUD（如 `PA + PB` 长度和、`S△POA` 动态面积、接近最值自动高亮）。
  - **一键切换官方 GeoGebra 引擎**：基于 GeoGebra Apps JavaScript API (`deployggb.js`)，自动将 AI Agent 每一步发出的点、函数、动点滑块与辅助线翻译为原生 GeoGebra 指令，并支持底部 GeoGebra 命令行交互。
- **渐进式思维流程图（英语长难句 + 数学逻辑）**：
  - 严格按步骤逐个节点生长，**绝不一次性画完**！支持用虚线「？」待推导节点邀请学生思考，学生答对后自动解锁为绿色「✓」结论节点；支持一键 **复制 Mermaid** 与 **导出 SVG**。
- **仿 ChatGPT 多服务商 / 多 API / 多协议模型选择器**：
  - **免 API Key 开箱体验**：内置苏格拉底交互演示引擎（包含将军饮马动点最值、抛物线动点最大面积、英语长难句语法树、一元二次方程求根策略 4 套完整互动课程）。
  - **多服务商自由切换**：支持 **DeepSeek**（原生与 OpenAI 兼容）、**OpenAI (ChatGPT)**、**Anthropic (Claude)**、**Google Gemini**、**OpenRouter**、**通义千问 (DashScope)**、**本地 Ollama** 以及 **自定义接口**（支持 `/models` 自动拉取模型列表）。

## 本地运行

需要 Node.js 22.12+ 与 pnpm：

```bash
git clone https://github.com/pjnssb/AI-solve-Learning-problem.git
cd AI-solve-Learning-problem
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:8090` 即可体验。

构建静态产物：

```bash
pnpm build
```

## 常用命令

| 命令          | 说明                 |
| ------------- | -------------------- |
| `pnpm dev`    | 启动开发服务器       |
| `pnpm build`  | 构建生产包到 `dist/` |
| `pnpm type`   | TypeScript 类型检查  |
| `pnpm lint`   | oxlint 静态检查      |
| `pnpm format` | oxfmt 代码格式化     |

## 致谢与许可证

- 界面基础源自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT 许可证）。
- 可选 GeoGebra 画板基于 [GeoGebra Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/)。
- 本项目采用 [MIT](LICENSE) 许可证开源。
