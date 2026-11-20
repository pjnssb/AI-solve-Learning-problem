# AI Solve Learning Problem

[简体中文](README.zh-CN.md) | English

A Socratic AI Tutoring Web Application built on top of the open-source [DeepSeek ChatDemo](https://github.com/deepseek-ai/chat-demo) UI, enhanced with a **ChatGPT-style Multi-Provider Model Switcher**, **Agent Tool-Driven Interactive Coordinate Plane**, **Moving Points & Dynamic Auxiliary Lines**, and an **Incremental Step-by-Step Flowchart Engine**.

## Highlights

- **Socratic Step-by-Step Tutoring**: Guides students one step at a time instead of dumping the final answer at once, pausing after each step to ask a thoughtful question.
- **Full AI Whiteboard Freedom (22 Agent Tools)**:
  - **Dual-Board Free Switching (`board_switch`)**: Coordinate Plane and Flowchart maintain independent persistent state — AI can switch freely back and forth between them during a single problem without losing anything.
  - **Granular Creation, Editing & Deletion (`coord_remove`, `flow_remove`, `coord_annotate`)**: AI can plot points/functions/circles/polygons/vectors/annotations, update any element in place by ID, or erase specific exploratory lines, auxiliary lines, or flowchart nodes/edges on demand.
  - **Step Replay Timeline (`Step 1 -> 2 -> 3...`)**: Replay every incremental drawing step at any time.
- **Interactive Coordinate Plane**:
  - Pan/zoom, adaptive grid, safe math expression plotting, **directly draggable moving points** + Play/Pause animation slider dock, **dynamic auxiliary lines** (`perpendicular` with live right-angle `∟`, `symmetry`, `parallel`, `connect`) that move continuously with moving points, and a live measurement HUD.
- **Incremental Step-by-Step Flowchart Canvas**:
  - Built node-by-node for English complex sentence parsing and math/logic reasoning with dashed `?` pending nodes that unlock into green `✓` solved nodes, plus **Copy Mermaid** & **Export SVG**.
- **Mobile & Desktop Ergonomics**:
  - Desktop right-hand resizable split pane; **Mobile top-bottom live split-screen** with a draggable divider so you watch the whiteboard animate above while reading & replying below.
- **ChatGPT-Style Multi-Provider & Multi-API Switcher**:
  - Works out of the box via the Built-in Socratic Demo Engine (no API key required).
  - Supports **DeepSeek**, **OpenAI**, **Anthropic Claude**, **Google Gemini**, **OpenRouter**, **Qwen**, **Ollama**, and **Custom Gateways** with one-click `/models` fetching and plain-text API key editing.

## Quick Start

```bash
git clone https://github.com/pjnssb/AI-solve-Learning-problem.git
cd AI-solve-Learning-problem
pnpm install
pnpm dev
```

## License

UI foundation adapted from [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) (MIT License). Licensed under [MIT](LICENSE).
