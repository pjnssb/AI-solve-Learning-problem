# AI Solve Learning Problem · 苏格拉底 AI 启发式教学平台

English: [README.md](README.md) | 简体中文

基于开源 [DeepSeek ChatDemo](https://github.com/deepseek-ai/chat-demo) UI 深度改造的 **AI 苏格拉底启发式互动教学网站**。融合 **仿 ChatGPT 多服务商模型选择器**、**Agent 工具驱动的动态数学坐标系（含动点与联动辅助线）** 以及 **渐进式思维流程图**，桌面端左右分屏、手机端上下实时分屏，界面简洁顺手。

## 核心特性

- **苏格拉底一步步启发教学**：AI 每轮只推进一小步，边讲边调用画板工具增量呈现，随后停下来向学生提问，不一口气剧透答案。
- **给予 AI 充分创作自由的 22 个 Agent 画板工具**：
  - **坐标系 ↔ 流程图随时自由切换（`board_switch`）**：两块画板独立持久化保存内容，AI 可以在同一道题里自由来回切换，互不覆盖。
  - **精准增删改与自由标注（`coord_remove`、`flow_remove`、`coord_annotate`）**：AI 可随时擦除某条试探性辅助线、线段、曲线或流程图分支节点，也可同 ID 原地修改样式或自由添加文字/公式标注，不再束手束脚。
  - **分步回放时间轴（第 1 步 → 第 2 步 → …）**：每一步作图变化随时可点击回看。
- **动态数学坐标系画板**：
  - 纯内置零依赖高清 SVG 引擎，离线零延迟；支持平移缩放、安全数学表达式绘图、**画板直接拖拽动点 + 底部播放/倍速滑块**、**随动点实时联动的虚线辅助线**（垂线自动带直角符号 `∟`、对称轴反射、平行线、连线）以及实时度量 HUD。
- **渐进式思维流程图**：
  - 逐个节点生长，绝不一次性画完；支持虚线「？」待推导节点在学生答对后解锁为绿色「✓」结论节点，支持一键**复制 Mermaid**与**导出 SVG**。
- **桌面端 & 手机端原生分屏优化**：
  - 桌面端左右可调宽分屏；**手机端「上画板 + 下对话」实时上下分屏**（支持手指拖动中间横条自由调高、右上角一键全屏/分屏切换）。
- **仿 ChatGPT 多服务商模型选择器**：
  - 免 API Key 开箱体验内置苏格拉底演示引擎；支持 **DeepSeek / OpenAI / Claude / Gemini / OpenRouter / 通义千问 / Ollama / 自定义聚合网关**（支持顶部一键拉取 `/models`、明文填写 API Key、模型列表自动隐藏未配置服务商）。

## 本地运行

```bash
git clone https://github.com/pjnssb/AI-solve-Learning-problem.git
cd AI-solve-Learning-problem
pnpm install
pnpm dev
```

## 许可证

界面基础源自 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT 许可证），本项目以 [MIT](LICENSE) 开源。
