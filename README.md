# AI Solve Learning Problem

[简体中文](README.zh-CN.md) | English

A Socratic AI Tutoring Web Application built on top of the open-source [DeepSeek ChatDemo](https://github.com/deepseek-ai/chat-demo) UI, enhanced with a **ChatGPT-style Multi-Provider Model Switcher**, **Agent Tool-Driven Interactive Coordinate Plane & GeoGebra Engine**, **Moving Points & Dynamic Auxiliary Lines**, and an **Incremental Step-by-Step Flowchart Engine**.

## Highlights

- **Strict Socratic Step-by-Step Tutoring**: Never dumps the final answer at once. In every turn, the AI Tutor explains only one small step, calls canvas tools to draw only that step, and pauses to ask a focused guiding question (with optional quick-thought chips).
- **Agent Tool-Calling Whiteboard Architecture**:
  - AI explains 1 step -> Agent emits structured `tutor-tool` calls in real time -> Whiteboard renders that exact step immediately, with inline clickable tool-call cards and a **Step Replay Timeline (`Step 1 -> 2 -> 3...`)**.
- **Interactive Coordinate Plane + Official GeoGebra Dual Engine**:
  - **Built-in High-Speed SVG Engine**: Pan/zoom, adaptive grid, safe math function plotting, **directly draggable moving points** + Play/Pause animation dock, **dynamic auxiliary lines** (`perpendicular` with live right-angle `∟` symbol, `symmetry` reflection, `parallel`, `connect`) that move continuously with moving points, and a live measurement HUD (`PA + PB`, `S△POA`, optimal value highlight).
  - **One-Click GeoGebra Engine**: Powered by the official GeoGebra Apps JavaScript API (`deployggb.js`), automatically syncing every Agent coordinate step into live GeoGebra geometry commands & animated sliders.
- **Incremental Step-by-Step Flowchart Canvas**:
  - Built node-by-node for English complex sentence parsing, essay/reading structure, and math logic branching — never drawn all at once! Uses dashed `?` pending nodes that unlock into green `✓` solved nodes as the student answers, plus one-click **Copy Mermaid** & **Export SVG**.
- **ChatGPT-Style Multi-Provider & Multi-API Switcher**:
  - Works **out of the box** via the Built-in Socratic Demo Engine (4 complete interactive lessons, zero API key required).
  - Seamlessly connect **DeepSeek** (Native & OpenAI-compatible), **OpenAI (ChatGPT)**, **Anthropic (Claude)**, **Google Gemini**, **OpenRouter**, **Qwen (DashScope)**, **Local Ollama**, or any **Custom Provider** with `/models` auto-fetch.
- **Intuitive Human-Centered UX**:
  - Clean DeepSeek ChatDemo light/dark themes, resizable split-screen whiteboard, Chinese & English i18n, Markdown + KaTeX math rendering, conversation branching, and local IndexedDB persistence.

## Quick Start

Requires Node.js 22.12+ and pnpm:

```bash
git clone https://github.com/pjnssb/AI-solve-Learning-problem.git
cd AI-solve-Learning-problem
pnpm install
pnpm dev
```

Open `http://localhost:8090` in your browser.

Build static bundle (`dist/`):

```bash
pnpm build
```

## Scripts

| Command       | Description             |
| ------------- | ----------------------- |
| `pnpm dev`    | Start Rspack dev server |
| `pnpm build`  | Build production bundle |
| `pnpm type`   | TypeScript type check   |
| `pnpm lint`   | oxlint static checks    |
| `pnpm format` | oxfmt code formatting   |

## Credits & License

- UI foundation adapted from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) (MIT License).
- Optional GeoGebra engine powered by [GeoGebra Apps API](https://geogebra.github.io/docs/reference/en/GeoGebra_Apps_API/).
- Licensed under [MIT](LICENSE).
