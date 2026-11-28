import type { MessageStreamEvent } from '../api/types.js'
import { getContextRounds } from '../chat/reply.js'
import type { Message, UserMessage } from '../chat/types.js'
import type { Locale } from '../settings.js'
import { getCurrentCanvasBoard, useCanvasStore } from './canvasStore.js'
import { solveCoordinateScene } from './sceneSolver.js'

export type GuidedLesson = {
  id: string
  subject: 'math' | 'english'
  boardType: 'coordinate' | 'flowchart'
  titleZh: string
  titleEn: string
  descZh: string
  descEn: string
  tagZh: string
  tagEn: string
  promptZh: string
  promptEn: string
}

export const GUIDED_LESSONS: GuidedLesson[] = [
  {
    id: 'math-shortest-path',
    subject: 'math',
    boardType: 'coordinate',
    titleZh: '动点最值 · 将军饮马问题',
    titleEn: 'Moving Point · Shortest Path',
    descZh: '拖动 x 轴上的动点 P，一步步作对称辅助线找出 PA + PB 的最小值',
    descEn: 'Drag moving point P on the x-axis and build reflection auxiliary lines step by step',
    tagZh: '坐标系 · 动点辅助线',
    tagEn: 'Coordinate · Moving Aux',
    promptZh:
      '已知点 A(1, 2) 和 B(5, 4)，动点 P 在 x 轴上移动，求 PA + PB 的最小值以及此时 P 的坐标。请一步步引导我思考。',
    promptEn:
      'Given A(1, 2) and B(5, 4), point P moves along the x-axis. Guide me step by step to find P minimizing PA + PB.',
  },
  {
    id: 'math-constrained-ladder',
    subject: 'math',
    boardType: 'coordinate',
    titleZh: '约束求解 · 靠墙定长梯中点轨迹',
    titleEn: 'Constraint Solver · Sliding Ladder Locus',
    descZh: '限定梯长 AB = 5，拖动动点或梯子线段时程序自动维持约束，并画出中点 M 的轨迹',
    descEn: 'Fix ladder length AB = 5; drag endpoints or the rod itself while the solver keeps |AB|=5 and traces midpoint M',
    tagZh: '约束引擎 · 可编程控制',
    tagEn: 'Constraints · Script',
    promptZh:
      '一根长 5 米的梯子 AB 斜靠在直角墙角（A 在 y 轴滑动，B 在 x 轴滑动），请用约束条件限定 AB = 5 并开启中点 M 轨迹留痕，带我探究 M 的运动轨迹！',
    promptEn:
      'A 5m ladder AB slides along the y-axis and x-axis. Constrain |AB| = 5 and trace midpoint M to explore its locus!',
  },
  {
    id: 'math-parabola-area',
    subject: 'math',
    boardType: 'coordinate',
    titleZh: '抛物线动点 · 三角形最大面积',
    titleEn: 'Parabola · Max Triangle Area',
    descZh: '动点 P 沿抛物线滑动，作动态垂直辅助线 PH 实时观察面积变化',
    descEn: 'Slide P along y = -x² + 4x with a live moving altitude PH to maximize triangle area',
    tagZh: '函数图像 · 动态高线',
    tagEn: 'Function · Moving Altitude',
    promptZh:
      '抛物线 y = -x² + 4x 与 x 轴交于 O(0, 0) 和 A(4, 0)，动点 P 在第一象限的抛物线上运动，求 △POA 面积的最大值。请用坐标系一步步带我推导。',
    promptEn:
      'Parabola y = -x^2 + 4x intersects the x-axis at O(0,0) and A(4,0). Point P moves on the arc above the x-axis. Guide me step by step to maximize area of triangle POA.',
  },
  {
    id: 'english-clause-flowchart',
    subject: 'english',
    boardType: 'flowchart',
    titleZh: '英语长难句 · 语法结构拆解',
    titleEn: 'English Complex Sentence Tree',
    descZh: '逐层找主干、拆定语从句，每答对一步就在流程图里生长出一个新分支',
    descEn: 'Peel nested clauses one layer at a time with an incremental syntax flowchart',
    tagZh: '英语教学 · 渐进流程图',
    tagEn: 'English · Step Flowchart',
    promptZh:
      '请用思维流程图一步步带我拆解这个英语长难句的语法结构：The scientist who discovered the method that transformed how students learn mathematics won the award.',
    promptEn:
      'Guide me step by step with an incremental flowchart to parse this English sentence: The scientist who discovered the method that transformed how students learn mathematics won the award.',
  },
]

type DemoTurn = {
  thinking: string
  content: string
  title?: string
}

const toolBlock = (tool: string, summary: string, args: Record<string, unknown>) =>
  `\`\`\`tutor-tool\n${JSON.stringify({ tool, summary, args })}\n\`\`\``

const choicesBlock = (choices: string[]) =>
  `\`\`\`tutor-choices\n${JSON.stringify(choices)}\n\`\`\``

const isHintRequest = (text: string) => /提示|不懂|不会|不确定|hint|help|stuck|不知道/i.test(text)

/** 课程 1：将军饮马（动点 + 对称辅助线 + 动态辅助线段） */
const buildShortestPathTurn = (round: number, userText: string, tutorMode = true): DemoTurn => {
  if (!tutorMode) {
    return {
      title: '动点最值 · 将军饮马问题',
      thinking:
        '当前为直接解答模式（关闭苏格拉底引导），一次性在坐标系画板绘制已知点、对称辅助线、动点与最值点并给出完整推导答案。',
      content: [
        '已为你直接在右侧**坐标系画板**绘制完整几何模型与对称辅助线，并给出完整解答：',
        toolBlock('coord_setup', '初始化坐标系：将军饮马动点问题', {
          title: '动点最值：PA + PB 最小',
          xMin: -1,
          xMax: 7,
          yMin: -3.5,
          yMax: 5.5,
        }),
        toolBlock('coord_plot_point', '标出已知点 A(1, 2)', {
          id: 'A',
          label: 'A(1, 2)',
          x: 1,
          y: 2,
          color: '#3964FE',
        }),
        toolBlock('coord_plot_point', '标出已知点 B(5, 4)', {
          id: 'B',
          label: 'B(5, 4)',
          x: 5,
          y: 4,
          color: '#3964FE',
        }),
        toolBlock('coord_add_moving_point', '在 x 轴上添加动点 P(t, 0)', {
          id: 'P',
          label: 'P',
          pathType: 'segment',
          from: [0, 0],
          to: [6, 0],
          tMin: 0,
          tMax: 6,
          initialT: 7 / 3,
          color: '#EF4444',
        }),
        toolBlock('coord_draw_segment', '连接动态线段 PA', {
          id: 'seg-PA',
          fromId: 'P',
          toId: 'A',
          color: '#2563EB',
          showLength: true,
        }),
        toolBlock('coord_draw_segment', '连接动态线段 PB', {
          id: 'seg-PB',
          fromId: 'P',
          toId: 'B',
          color: '#2563EB',
          showLength: true,
        }),
        toolBlock('coord_draw_auxiliary_line', "作辅助线：点 A 关于 x 轴的对称线 AA'", {
          id: 'aux-sym-A',
          kind: 'symmetry',
          fromId: 'A',
          axis: 'x',
          derivedPointId: 'A_prime',
          derivedPointLabel: "A'(1, -2)",
          label: '对称辅助线',
          color: '#F59E0B',
          showRightAngle: true,
        }),
        toolBlock('coord_draw_auxiliary_line', "作动态辅助线：连接动点 P 与对称点 A'", {
          id: 'aux-P-Aprime',
          kind: 'connect',
          fromId: 'P',
          toId: 'A_prime',
          label: "PA'",
          color: '#F59E0B',
        }),
        toolBlock('coord_draw_auxiliary_line', "作辅助线：连接 A'B 确定最短直线路径", {
          id: 'aux-Aprime-B',
          kind: 'connect',
          fromId: 'A_prime',
          toId: 'B',
          label: "A'B 最短路径",
          color: '#10B981',
        }),
        toolBlock('coord_plot_point', '标出最优位置 P₀(7/3, 0)', {
          id: 'P0',
          label: 'P₀(7/3, 0)',
          x: 7 / 3,
          y: 0,
          color: '#10B981',
        }),
        toolBlock('coord_add_measurement', '实时监测 PA + PB 的长度之和', {
          id: 'm-sum',
          label: 'PA + PB',
          kind: 'sum_distance',
          pairs: [
            ['P', 'A'],
            ['P', 'B'],
          ],
          optimalValue: Math.hypot(4, 6),
          optimalHint: '达到最小值！',
          color: '#10B981',
        }),
        toolBlock('coord_set_t', '将动点 P 置于最优位置 P₀', {
          pointId: 'P',
          t: 7 / 3,
        }),
        "### 完整解题过程\n1. **化同侧为异侧**：作点 $A(1, 2)$ 关于 $x$ 轴的对称点 $A'(1, -2)$。\n2. **等量转化**：由于 $x$ 轴垂直平分 $AA'$，对 $x$ 轴上任意动点 $P$ 都有 $PA = PA'$，因此 $PA + PB = PA' + PB$。\n3. **三点共线取最小**：连接 $A'B$，当 $A'$、$P$、$B$ 三点共线时长度最小：\n   - **最小值**：$A'B = \\sqrt{(5 - 1)^2 + (4 - (-2))^2} = \\sqrt{16 + 36} = 2\\sqrt{13} \\approx 7.21$\n   - **此时点 $P$ 坐标**：直线 $A'B$ 的方程为 $y + 2 = \\frac{3}{2}(x - 1)$，令 $y = 0$ 得 $x = \\frac{7}{3}$，即 $P_0\\left(\\frac{7}{3}, 0\\right)$。\n\n你可以直接拖动右侧画板上的红点 $P$ 验证任意位置下的 $PA + PB$ 变化。",
      ].join('\n\n'),
    }
  }
  if (round === 0) {
    return {
      title: '动点最值 · 将军饮马问题',
      thinking:
        '这是一道经典的「将军饮马」动点最值题。按照苏格拉底教学原则，第一步不能直接讲对称点，而是先在坐标系中画出已知点 A、B 和动点 P，让学生自己拖动 P 感受 PA + PB 的变化，再启发他们思考「如何把折线拉直」。',
      content: [
        '太好了，这是一道非常经典的几何动点问题！我们先把题目里的条件**可视化**到右侧的坐标系里。',
        toolBlock('coord_setup', '初始化坐标系：将军饮马动点问题', {
          title: '动点最值：PA + PB 最小',
          xMin: -1,
          xMax: 7,
          yMin: -3.5,
          yMax: 5.5,
        }),
        toolBlock('coord_plot_point', '标出已知点 A(1, 2)', {
          id: 'A',
          label: 'A(1, 2)',
          x: 1,
          y: 2,
          color: '#3964FE',
        }),
        toolBlock('coord_plot_point', '标出已知点 B(5, 4)', {
          id: 'B',
          label: 'B(5, 4)',
          x: 5,
          y: 4,
          color: '#3964FE',
        }),
        toolBlock('coord_add_moving_point', '在 x 轴上添加动点 P(t, 0)', {
          id: 'P',
          label: 'P',
          pathType: 'segment',
          from: [0, 0],
          to: [6, 0],
          tMin: 0,
          tMax: 6,
          initialT: 4,
          color: '#EF4444',
        }),
        toolBlock('coord_draw_segment', '连接动态线段 PA', {
          id: 'seg-PA',
          fromId: 'P',
          toId: 'A',
          color: '#2563EB',
          showLength: true,
        }),
        toolBlock('coord_draw_segment', '连接动态线段 PB', {
          id: 'seg-PB',
          fromId: 'P',
          toId: 'B',
          color: '#2563EB',
          showLength: true,
        }),
        toolBlock('coord_add_measurement', '实时监测 PA + PB 的长度之和', {
          id: 'm-sum',
          label: 'PA + PB',
          kind: 'sum_distance',
          pairs: [
            ['P', 'A'],
            ['P', 'B'],
          ],
          optimalValue: Math.hypot(4, 6),
          optimalHint: '接近最小值！',
          color: '#10B981',
        }),
        '你看右侧画板：你可以**直接拖动红色的动点 $P$**（或者点击底部播放键 ▶），观察左上角 $PA + PB$ 的实时数值变化。',
        '**第 1 步思考**：现在 $A$ 和 $B$ 都在 $x$ 轴的**同一侧**，$P - A$ 和 $P - B$ 是一条折线。我们学过「两点之间线段最短」，但那要求 $A, B$ 分别在直线的**两侧**。',
        '你觉得我们可以作一条什么**辅助线**，把点 $A(1, 2)$ “搬”到 $x$ 轴的另一侧，同时保证新点到 $P$ 的距离与 $PA$ 相等？',
        choicesBlock([
          "作点 A 关于 x 轴的对称点 A'(1, -2)",
          '直接连接 A 和 B',
          '我不太确定，给我一点提示',
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 1) {
    const wantsHint = isHintRequest(userText)
    const guessedRight = /对称|mirror|reflect|1\s*,\s*-2|-2/i.test(userText)
    const opening = wantsHint
      ? "好提示来啦！想象 $x$ 轴是一面平放的**镜子** 🪞：点 $A(1, 2)$ 在镜子上方 2 个单位，那么它在镜子里的像 $A'$ 在哪里呢？没错，就是关于 $x$ 轴的**对称点** $A'(1, -2)$！"
      : guessedRight
        ? "漂亮！思路一针见血 👏 正是作点 $A(1, 2)$ 关于 $x$ 轴的**对称点** $A'(1, -2)$！"
        : "很好的尝试！不过直接连 $AB$ 还没经过 $x$ 轴上的动点 $P$ 哦。让我们换个角度：如果把 $x$ 轴当作一面**镜子**，把点 $A(1, 2)$ 对称到下方得到 $A'(1, -2)$，会发生什么奇妙的事？"

    return {
      thinking:
        "现在是第 2 步：只画出对称辅助线 AA' 和动态连接辅助线 PA'，让学生拖动动点 P 亲眼验证 PA 和 PA' 的长度始终相等，再引导他们转化 PA + PB。",
      content: [
        opening,
        "我现在让画板 Agent 只作出这一步的**两条辅助线**：先过 $A$ 作 $x$ 轴的对称辅助线得到 $A'(1, -2)$，再把动点 $P$ 和 $A'$ 用虚线连起来。",
        toolBlock('coord_draw_auxiliary_line', "作辅助线：点 A 关于 x 轴的对称线 AA'", {
          id: 'aux-sym-A',
          kind: 'symmetry',
          fromId: 'A',
          axis: 'x',
          derivedPointId: 'A_prime',
          derivedPointLabel: "A'(1, -2)",
          label: '对称辅助线',
          color: '#F59E0B',
          showRightAngle: true,
        }),
        toolBlock('coord_draw_auxiliary_line', "作动态辅助线：连接动点 P 与对称点 A'", {
          id: 'aux-P-Aprime',
          kind: 'connect',
          fromId: 'P',
          toId: 'A_prime',
          label: "PA'",
          color: '#F59E0B',
        }),
        "试着再次**拖动右侧画板上的动点 $P$**，看着橙色虚线 $PA'$ 和蓝色线段 $PA$ 一起动起来！",
        "**第 2 步思考**：无论 $P$ 在 $x$ 轴上怎么移动，因为 $x$ 轴是线段 $AA'$ 的垂直平分线，所以 $PA$ 和 $PA'$ 的长度有什么关系？因此求 $PA + PB$ 的最小值，就转化成了求哪两条线段之和的最小值？",
        choicesBlock([
          "PA = PA'，所以转化为求 PA' + PB 的最小值",
          "当 A'、P、B 三点共线时 PA' + PB 最小",
          "为什么 PA 一定等于 PA'？给我提示",
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 2) {
    const wantsHint = isHintRequest(userText)
    const opening = wantsHint
      ? "因为 $x$ 轴垂直平分 $AA'$，根据「**垂直平分线上的点到线段两端距离相等**」，无论 $P$ 怎么移动，永远都有 $PA = PA'$！所以 $PA + PB = PA' + PB$。"
      : "完全正确！✨ 因为 $PA = PA'$，原来的折线 $PA + PB$ 就完美转化成了 **$PA' + PB$**，而此时 $A'(1, -2)$ 和 $B(5, 4)$ 已经分居 $x$ 轴两侧啦！"

    return {
      thinking:
        "现在是第 3 步：作出连接 A' 和 B 的关键辅助线，让学生自己计算直线 A'B 的长度（勾股定理）以及它与 x 轴的交点 P0。",
      content: [
        opening,
        "接下来我们再进一步——在画板上作出连接 $A'(1, -2)$ 和 $B(5, 4)$ 的辅助线！",
        toolBlock('coord_draw_auxiliary_line', "作辅助线：连接 A'B 确定最短直线路径", {
          id: 'aux-Aprime-B',
          kind: 'connect',
          fromId: 'A_prime',
          toId: 'B',
          label: "A'B 最短路径",
          color: '#10B981',
        }),
        "现在看右侧画板：拖动动点 $P$，让它落到绿色虚线 $A'B$ 与 $x$ 轴的交点上，此时 $A'、P、B$ **三点共线**，$PA' + PB$ 就等于线段 $A'B$ 的长度！",
        "**第 3 步思考**：已知 $A'(1, -2)$ 和 $B(5, 4)$，你能用两点间距离公式算出最小值 $A'B$ 是多少吗？以及直线 $A'B$ 与 $x$ 轴交点 $P$ 的横坐标是多少？",
        choicesBlock([
          '最小值是 √52 = 2√13，交点 P 为 (7/3, 0)',
          '我算出了 √((5-1)² + (4-(-2))²) = 2√13，但交点怎么求？',
          '帮我提示一下直线方程怎么列',
        ]),
      ].join('\n\n'),
    }
  }

  return {
    thinking:
      '学生已经掌握核心推导，现在进行最后一步验证：在坐标系中标出精确最值点 P0(7/3, 0)，并通过 coord_set_t 自动将动点 P 移动到最佳位置，总结方法论。',
    content: [
      '太棒了！你已经自己一步步推导出整道题的核心答案 🎉 让我们在坐标系上把精确的最值点标出来，并把动点 $P$ 自动移到最值位置验证一下：',
      toolBlock('coord_plot_point', '标出最优位置 P₀(7/3, 0)', {
        id: 'P0',
        label: 'P₀(7/3, 0)',
        x: 7 / 3,
        y: 0,
        color: '#10B981',
      }),
      toolBlock('coord_set_t', '将动点 P 平滑移动到最优位置 P₀', {
        pointId: 'P',
        t: 7 / 3,
      }),
      "让我们回顾一下你刚才亲手完成的 **3 步破题法**：\n1. **化同侧为异侧**：作 $A(1, 2)$ 关于 $x$ 轴的对称点 $A'(1, -2)$；\n2. **等量转化**：利用对称性得到 $PA = PA'$，于是 $PA + PB = PA' + PB$；\n3. **三点共线求最值**：\n   - 最小值：$A'B = \\sqrt{(5 - 1)^2 + (4 - (-2))^2} = \\sqrt{16 + 36} = 2\\sqrt{13} \\approx 7.21$\n   - 直线 $A'B$ 斜率 $k = \\frac{4 - (-2)}{5 - 1} = \\frac{3}{2}$，方程为 $y + 2 = \\frac{3}{2}(x - 1)$\n   - 令 $y = 0$，解得 $x = \\frac{7}{3}$，即 $P_0\\left(\\frac{7}{3}, 0\\right)$！",
      '你也可以点击右上方的 **步骤 1 → 2 → 3 → 4** 回放刚才每一步的作图过程。还想挑战一道变式题（比如求 $|PA - PB|$ 的最大值），还是换一道抛物线动点题？',
      choicesBlock(['挑战抛物线动点最大面积问题', '试试英语长难句流程图拆解']),
    ].join('\n\n'),
  }
}

/** 课程 2：抛物线动点最大面积（函数图像 + 动点 + 动态垂直辅助线 PH + 实时面积） */
const buildParabolaAreaTurn = (round: number, userText: string, tutorMode = true): DemoTurn => {
  if (!tutorMode) {
    return {
      title: '抛物线动点 · △POA 最大面积',
      thinking:
        '当前为直接解答模式（关闭苏格拉底引导），直接在坐标系画板绘制抛物线、三角形、动态高线 PH ⊥ x 轴及顶点 B(2, 4)，并输出完整推导与答案。',
      content: [
        '已为你直接在右侧**坐标系画板**绘制抛物线、动态三角形 $\\triangle POA$ 与铅垂高辅助线 $PH$，并给出完整解答：',
        toolBlock('coord_setup', '初始化坐标系：抛物线动点面积问题', {
          title: '抛物线动点：△POA 最大面积',
          xMin: -1,
          xMax: 5.5,
          yMin: -1.5,
          yMax: 5.2,
        }),
        toolBlock('coord_draw_function', '绘制抛物线 y = -x² + 4x', {
          id: 'parabola',
          expr: '-x^2 + 4*x',
          label: 'y = -x² + 4x',
          color: '#3964FE',
          domain: [-0.5, 4.5],
        }),
        toolBlock('coord_plot_point', '标出交点 O(0, 0)', {
          id: 'O',
          label: 'O(0, 0)',
          x: 0,
          y: 0,
          color: '#3964FE',
        }),
        toolBlock('coord_plot_point', '标出交点 A(4, 0)', {
          id: 'A',
          label: 'A(4, 0)',
          x: 4,
          y: 0,
          color: '#3964FE',
        }),
        toolBlock('coord_add_moving_point', '在抛物线弧 OA 上添加动点 P', {
          id: 'P',
          label: 'P',
          pathType: 'function',
          expr: '-x^2 + 4*x',
          tMin: 0.2,
          tMax: 3.8,
          initialT: 2,
          color: '#EF4444',
        }),
        toolBlock('coord_draw_polygon', '绘制动态三角形 △POA', {
          id: 'tri-POA',
          vertexIds: ['P', 'O', 'A'],
          fill: 'rgba(57, 100, 254, 0.16)',
          stroke: '#2563EB',
          showArea: true,
        }),
        toolBlock('coord_draw_auxiliary_line', '作动态辅助线：过动点 P 作 PH ⊥ x 轴', {
          id: 'aux-PH',
          kind: 'perpendicular',
          fromId: 'P',
          axis: 'x',
          derivedPointId: 'H',
          derivedPointLabel: 'H',
          label: '高 PH',
          color: '#F59E0B',
          showRightAngle: true,
        }),
        toolBlock('coord_plot_point', '标出抛物线顶点 B(2, 4)', {
          id: 'B',
          label: '顶点 B(2, 4)',
          x: 2,
          y: 4,
          color: '#10B981',
        }),
        toolBlock('coord_add_measurement', '实时监测 △POA 的面积', {
          id: 'm-area',
          label: 'S△POA',
          kind: 'area',
          pointIds: ['P', 'O', 'A'],
          optimalValue: 8,
          optimalHint: '达到最大面积！',
          color: '#10B981',
        }),
        toolBlock('coord_set_t', '将动点 P 移动到顶点 x = 2 验证最大面积', {
          pointId: 'P',
          t: 2,
        }),
        '### 完整解题过程\n1. **确定底边**：抛物线交 $x$ 轴于 $O(0,0)$ 和 $A(4,0)$，因此底边 $OA = 4$。\n2. **作高建立函数**：过点 $P(x, -x^2 + 4x)\\ (0 < x < 4)$ 作 $PH \\perp x$ 轴于 $H$，则高 $PH = y_P = -x^2 + 4x$。\n3. **面积表达式与配方求最值**：\n   $$S_{\\triangle POA} = \\frac{1}{2} \\cdot OA \\cdot PH = \\frac{1}{2} \\times 4 \\times (-x^2 + 4x) = -2x^2 + 8x = -2(x - 2)^2 + 8$$\n4. **结论**：当 $x = 2$（即 $P$ 运动到顶点 $(2, 4)$）时，$S_{\\triangle POA}$ 取得最大值 **$8$**。',
      ].join('\n\n'),
    }
  }
  if (round === 0) {
    return {
      title: '抛物线动点 · △POA 最大面积',
      thinking:
        '第一步：先画出抛物线 y = -x² + 4x、底边 OA 以及抛物线上的动点 P 和阴影三角形 △POA，让学生直观拖动 P 观察面积变化，再提问三角形面积公式里「底」和「高」分别是谁。',
      content: [
        '这道抛物线动点面积题特别适合用动态坐标系来“看见”变化规律！我们先画出第 1 步的基础图形：',
        toolBlock('coord_setup', '初始化坐标系：抛物线动点面积问题', {
          title: '抛物线动点：△POA 最大面积',
          xMin: -1,
          xMax: 5.5,
          yMin: -1.5,
          yMax: 5.2,
        }),
        toolBlock('coord_draw_function', '绘制抛物线 y = -x² + 4x', {
          id: 'parabola',
          expr: '-x^2 + 4*x',
          label: 'y = -x² + 4x',
          color: '#3964FE',
          domain: [-0.5, 4.5],
        }),
        toolBlock('coord_plot_point', '标出交点 O(0, 0)', {
          id: 'O',
          label: 'O(0, 0)',
          x: 0,
          y: 0,
          color: '#3964FE',
        }),
        toolBlock('coord_plot_point', '标出交点 A(4, 0)', {
          id: 'A',
          label: 'A(4, 0)',
          x: 4,
          y: 0,
          color: '#3964FE',
        }),
        toolBlock('coord_add_moving_point', '在抛物线弧 OA 上添加动点 P', {
          id: 'P',
          label: 'P',
          pathType: 'function',
          expr: '-x^2 + 4*x',
          tMin: 0.2,
          tMax: 3.8,
          initialT: 1.0,
          color: '#EF4444',
        }),
        toolBlock('coord_draw_polygon', '绘制动态三角形 △POA', {
          id: 'tri-POA',
          vertexIds: ['P', 'O', 'A'],
          fill: 'rgba(57, 100, 254, 0.16)',
          stroke: '#2563EB',
          showArea: true,
        }),
        toolBlock('coord_add_measurement', '实时监测 △POA 的面积', {
          id: 'm-area',
          label: 'S△POA',
          kind: 'area',
          pointIds: ['P', 'O', 'A'],
          optimalValue: 8,
          optimalHint: '达到最大面积！',
          color: '#10B981',
        }),
        '试着**拖动右侧抛物线上的红点 $P$**（或点击底部 ▶ 播放按钮），观察蓝色三角形的面积如何随 $P$ 变化！',
        '**第 1 步思考**：要算 $\\triangle POA$ 的面积 $S = \\frac{1}{2} \\times \\text{底} \\times \\text{高}$，如果选固定线段 $OA$ 当作**底**（它的长度是多少？），那我们应该作一条怎样的**辅助线**来表示它的**高**呢？',
        choicesBlock([
          '底 OA = 4，过动点 P 向 x 轴作垂线 PH 当作高',
          '用点 P 的横坐标当作高',
          '我不太确定，给我提示',
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 1) {
    const wantsHint = isHintRequest(userText)
    const opening = wantsHint
      ? '提示一下：底边 $OA$ 躺在 $x$ 轴上，从 $O(0,0)$ 到 $A(4,0)$ 长度固定是 **$4$**；三角形的高就是从顶点 $P$ 向底边（$x$ 轴）作的**垂线段 $PH$**！'
      : '抓得非常准！👏 底边 $OA = 4$ 保持不变，所以我们只需要过动点 $P$ 向 $x$ 轴作一条**会跟着 $P$ 一起移动的垂直辅助线 $PH \\perp x$ 轴**！'

    return {
      thinking:
        '第 2 步：作出动态垂直辅助线 PH ⊥ x轴，带直角符号，且当动点 P 在抛物线上滑动时，垂线 PH 和垂足 H 同步滑动。接着引导用 x 表示高 PH 与面积函数。',
      content: [
        opening,
        '看右侧画板，Agent 现在为动点 $P$ 添加动态高线 $PH \\perp x$ 轴（拖动 $P$ 看看这条橙色辅助线怎么实时联动！）：',
        toolBlock('coord_draw_auxiliary_line', '作动态辅助线：过动点 P 作 PH ⊥ x 轴', {
          id: 'aux-PH',
          kind: 'perpendicular',
          fromId: 'P',
          axis: 'x',
          derivedPointId: 'H',
          derivedPointLabel: 'H',
          label: '高 PH',
          color: '#F59E0B',
          showRightAngle: true,
        }),
        '**第 2 步思考**：设动点 $P$ 的横坐标为 $x$（$0 < x < 4$），因为 $P$ 在抛物线 $y = -x^2 + 4x$ 上，且在第一象限内，那么高 $PH$ 的长度（即 $P$ 的纵坐标 $y_P$）和面积 $S_{\\triangle POA}$ 分别可以用 $x$ 怎么表示？',
        choicesBlock([
          'PH = -x² + 4x，面积 S = 2(-x² + 4x) = -2x² + 8x',
          '面积 S = 4 × (-x² + 4x)',
          '怎么把 PH 代入面积公式？给我提示',
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 2) {
    const wantsHint = isHintRequest(userText)
    const opening = wantsHint
      ? '把底 $OA = 4$ 和高 $PH = y_P = -x^2 + 4x$ 代入 $S = \\frac{1}{2} \\times OA \\times PH$，就能得到 $S = \\frac{1}{2} \\times 4 \\times (-x^2 + 4x) = -2x^2 + 8x$！'
      : '太棒了！完全正确 ✨ 面积公式正是 $S = \\frac{1}{2} \\times 4 \\times (-x^2 + 4x) = -2x^2 + 8x$！'

    return {
      thinking:
        '第 3 步：通过配方法或对称轴引导求出二次函数 S = -2x² + 8x 的最大值，同时在画板上标出对称轴辅助线 x = 2 的视觉线索前先提问学生。',
      content: [
        opening,
        '现在我们把几何最值转化成了二次函数求最值：$S = -2x^2 + 8x = -2(x - ?)^2 + ?$。',
        '**第 3 步思考**：请试着对 $-2x^2 + 8x$ 配方（或者用对称轴 $x = -\\frac{b}{2a}$），当 $x$ 取多少时，高 $PH$ 和面积 $S$ 同时达到最大？最大面积是多少？',
        choicesBlock([
          'x = 2 时（抛物线顶点 (2, 4)），最大面积 S = 8',
          'x = 4 时最大，面积是 16',
          '帮我提示一下怎么配方',
        ]),
      ].join('\n\n'),
    }
  }

  return {
    thinking: '最后一步：标出抛物线顶点 B(2, 4)，并将动点 P 自动移至 x = 2 验证最大面积 8。',
    content: [
      '满分通关！🎉 当 $x = 2$ 时，$-2(x - 2)^2 + 8$ 取得最大值 **$8$**，此时动点 $P$ 恰好位于抛物线的**顶点 $(2, 4)$**！',
      toolBlock('coord_plot_point', '标出抛物线顶点 B(2, 4)', {
        id: 'B',
        label: '顶点 B(2, 4)',
        x: 2,
        y: 4,
        color: '#10B981',
      }),
      toolBlock('coord_set_t', '将动点 P 移动到顶点 x = 2 验证最大面积', {
        pointId: 'P',
        t: 2,
      }),
      '你看右侧画板：此时动态辅助线 $PH$ 达到最长 $4$，$S_{\\triangle POA} = \\frac{1}{2} \\times 4 \\times 4 = 8$，完全吻合！\n\n这就是中考/高考压轴题最核心的**「动点建系 + 铅垂高辅助线 + 二次函数配方」**思维模型。想接着体验英语长难句的渐进式流程图拆解吗？',
      choicesBlock(['试试英语长难句流程图拆解', '挑战将军饮马最短路径问题']),
    ].join('\n\n'),
  }
}

/** 课程 3：英语长难句语法结构渐进式流程图拆解 */
const buildEnglishClauseTurn = (round: number, userText: string, tutorMode = true): DemoTurn => {
  if (!tutorMode) {
    return {
      title: '英语长难句 · 语法拆解流程图',
      thinking: '当前为直接解答模式，一次性在流程图画板绘制完整语法树并给出长难句拆解与翻译。',
      content: [
        '已为你直接在右侧**思维流程图画板**生成完整语法结构树，并附上逐层解析：',
        '原句：\n> *The scientist who discovered the method that transformed how students learn mathematics won the award.*',
        toolBlock('flow_init', '创建英语长难句拆解流程图', {
          title: '英语长难句 · 语法结构图',
          direction: 'TD',
        }),
        toolBlock('flow_add_node', '添加原句根节点', {
          id: 'root',
          label: '原句输入 (Complex Sentence)',
          sublabel: 'The scientist who discovered ... won the award.',
          kind: 'start',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '主句主干', {
          id: 'main_clause',
          label: '主句主干：The scientist won the award',
          sublabel: '这位科学家赢得了奖项',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接主句主干', {
          from: 'root',
          to: 'main_clause',
          label: '剥离主谓宾',
        }),
        toolBlock('flow_add_node', '第一重定语从句', {
          id: 'clause1',
          label: '定语从句 ①：who discovered the method ...',
          sublabel: '修饰主语 scientist（发现某种方法的科学家）',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接第一重定语从句', {
          from: 'main_clause',
          to: 'clause1',
          label: '修饰 scientist',
        }),
        toolBlock('flow_add_node', '第二重定语从句', {
          id: 'clause2',
          label: '定语从句 ②：that transformed ...',
          sublabel: '修饰先行词 the method（改变了……的方法）',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接第二重定语从句', {
          from: 'clause1',
          to: 'clause2',
          label: '修饰 method',
        }),
        toolBlock('flow_add_node', '宾语从句', {
          id: 'clause3',
          label: '宾语从句 ③：how students learn mathematics',
          sublabel: '作 transformed 的宾语（学生如何学习数学）',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接宾语从句', {
          from: 'clause2',
          to: 'clause3',
          label: '作 transformed 宾语',
        }),
        toolBlock('flow_add_node', '完整意译', {
          id: 'result',
          label: '完整意译',
          sublabel: '那位发现了“彻底改变学生数学学习方式之方法”的科学家赢得了该奖项。',
          kind: 'result',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接最终译文', {
          from: 'clause3',
          to: 'result',
          label: '重组整合',
        }),
        '### 语法结构拆解\n1. **主句主干**：*The scientist won the award.*（科学家赢得了奖项）\n2. **定语从句 ①**：*who discovered the method ...* 修饰 *scientist*\n3. **定语从句 ②**：*that transformed ...* 修饰 *the method*\n4. **宾语从句 ③**：*how students learn mathematics* 作 *transformed* 的宾语\n5. **完整参考译文**：**那位发现了“彻底改变学生数学学习方式之方法”的科学家赢得了该奖项。**',
      ].join('\n\n'),
    }
  }
  if (round === 0) {
    return {
      title: '英语长难句 · 语法拆解流程图',
      thinking:
        '用户想用流程图一步步拆解英语长难句。严格遵守「不要一次性画完」，第 1 步只放原句根节点和一个待推导的「？」主句谓语占位节点，引导学生自己找整句话的主干谓语动词。',
      content: [
        '拆解英语长难句就像剥洋葱 🧅，最怕一口气硬译！我们用**渐进式语法流程图**，**每一步只画一层结构**。',
        '原句：\n> *The scientist who discovered the method that transformed how students learn mathematics won the award.*',
        toolBlock('flow_init', '创建英语长难句拆解流程图', {
          title: '英语长难句 · 逐层剥离流程图',
          direction: 'TD',
        }),
        toolBlock('flow_add_node', '添加原句根节点', {
          id: 'root',
          label: '原句输入 (Complex Sentence)',
          sublabel: 'The scientist who discovered ... won the award.',
          kind: 'start',
        }),
        toolBlock('flow_add_node', '添加待推导节点：寻找主干谓语', {
          id: 'main_clause',
          label: '？整句话的主句主干是？',
          sublabel: '先找真正属于 The scientist 的谓语动词',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接步骤 1', {
          from: 'root',
          to: 'main_clause',
          label: '第 1 步：找主谓宾',
        }),
        '**第 1 步思考**：句子里有 4 个动词：`discovered`、`transformed`、`learn`、`won`。但前面三个都被引导词（`who`、`that`、`how`）“圈”在从句里了。你觉得哪一个才是真正属于主语 `The scientist` 的**主句谓语动词**？',
        choicesBlock([
          'won（主干是 The scientist won the award）',
          'discovered（主干是 The scientist discovered the method）',
          '不太分得清哪个是从句动词，给我提示',
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 1) {
    const wantsHint = isHintRequest(userText)
    const guessedRight = /won|award/i.test(userText)
    const opening = wantsHint
      ? '小窍门：`who discovered...` 前面有引导词 `who`，说明 `discovered` 是 `who` 引导的从句里的动词；往后一直找到**没有被引导词管辖**的动词，就是 `won`！'
      : guessedRight
        ? '一找就中！🎯 `won` 才是主句谓语，整句话最核心的主干其实特别简单：**The scientist won the award.**（这位科学家赢得了奖项。）'
        : '差点就对啦！注意 `discovered` 紧跟在引导词 `who` 后面，所以它被困在从句里了。继续往后看，真正属于 `The scientist` 的主句谓语是 **`won`** —— 主干是 **The scientist won the award**！'

    return {
      thinking:
        '第 2 步：把主干节点从问号更新为已解决状态，然后只向下延伸第一层修饰成分（who 引导的定语从句）和一个待确认的嵌套占位节点，继续停下来提问。',
      content: [
        opening,
        '我先把你在第 1 步找到的**主干**填进流程图（绿色解锁 ✓），再向下伸出第一层修饰分支：',
        toolBlock('flow_update_node', '补全主句主干节点', {
          id: 'main_clause',
          label: '主句主干：The scientist won the award',
          sublabel: '这位科学家赢得了奖项',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '添加第 2 层节点：第一重定语从句', {
          id: 'clause1',
          label: '定语从句 ①：who discovered the method ...',
          sublabel: '修饰主语 scientist（发现某种方法的科学家）',
          kind: 'process',
        }),
        toolBlock('flow_add_edge', '连接主句与第一重从句', {
          from: 'main_clause',
          to: 'clause1',
          label: '修饰 scientist',
        }),
        toolBlock('flow_add_node', '添加待拆解节点：that 引导的嵌套从句', {
          id: 'clause2',
          label: '？that transformed ... 修饰谁？',
          sublabel: '判断先行词与从句类型',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接嵌套从句待推导节点', {
          from: 'clause1',
          to: 'clause2',
          label: '第 2 步：继续拆解',
          dashed: true,
        }),
        '**第 2 步思考**：在 `who discovered the method that transformed how students learn mathematics` 里，`that transformed ...` 紧跟在哪个名词后面？它修饰的是 `scientist` 还是 `method`？',
        choicesBlock([
          '修饰 the method（定语从句：改变……的方法）',
          '修饰 the scientist',
          '给我一点提示',
        ]),
      ].join('\n\n'),
    }
  }

  if (round === 2) {
    const wantsHint = isHintRequest(userText)
    const opening = wantsHint
      ? '看 `that` 前面紧挨着的名词是 `the method`（方法），而且逻辑上是“**方法**改变了学生学习数学的方式”，所以先行词是 `the method`！'
      : '完全准确！✨ `that transformed ...` 是嵌套在里面的**第二重定语从句**，用来修饰 `the method`（改变了……的方法）。'

    return {
      thinking:
        '第 3 步：解锁 clause2 节点，再向下伸出最内层的宾语从句 how students learn mathematics 的待回答节点，让学生识别从句类型并尝试组织中文翻译。',
      content: [
        opening,
        '我们更新流程图里的第 2 层分支，再剥开最后一层洋葱：`how students learn mathematics`！',
        toolBlock('flow_update_node', '补全第二重定语从句节点', {
          id: 'clause2',
          label: '定语从句 ②：that transformed ...',
          sublabel: '修饰先行词 the method（改变了……的方法）',
          kind: 'grammar',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '添加最内层待推导节点：how 从句', {
          id: 'clause3',
          label: '？how students learn mathematics 是什么从句？',
          sublabel: '跟在及物动词 transformed 后面',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接最内层从句节点', {
          from: 'clause2',
          to: 'clause3',
          label: '作 transformed 的成分',
          dashed: true,
        }),
        '**第 3 步思考**：`how students learn mathematics` 紧跟在及物动词 `transformed`（彻底改变）后面，它在语法上充当什么从句？结合前两步，你能试着把整句话顺畅地翻译成中文吗？',
        choicesBlock([
          '宾语从句！整句：那位发现了彻底改变学生数学学习方式的方法的科学家赢得了奖项。',
          '它是宾语从句（作 transformed 的宾语），表示“学生如何学习数学”',
          '我不太确定它是什么从句，给我提示',
        ]),
      ].join('\n\n'),
    }
  }

  return {
    thinking: '最后一步：补全宾语从句节点，并添加最终整合翻译结果节点，总结长难句三步法。',
    content: [
      '太出色了！👏 你已经亲手把这句三层嵌套的长难句拆解得清清楚楚！让我们点亮流程图的最后两块拼图：',
      toolBlock('flow_update_node', '补全最内层宾语从句节点', {
        id: 'clause3',
        label: '宾语从句 ③：how students learn mathematics',
        sublabel: '作 transformed 的宾语（学生如何学习数学）',
        kind: 'grammar',
        status: 'solved',
      }),
      toolBlock('flow_add_node', '添加最终意群整合节点', {
        id: 'result',
        label: '完整意译',
        sublabel: '那位发现了“彻底改变学生数学学习方式之方法”的科学家赢得了该奖项。',
        kind: 'result',
        status: 'solved',
      }),
      toolBlock('flow_add_edge', '连接到最终翻译节点', {
        from: 'clause3',
        to: 'result',
        label: '由内而外重组',
      }),
      '你可以点击画板顶部的 **步骤 1 → 2 → 3 → 4** 回顾这棵语法树是如何一层层长出来的！你也可以直接发给我任何一句你想分析的英语考研/雅思/托福长难句，或者试试数学坐标系动点题！',
      choicesBlock(['试试数学动点 · 将军饮马问题', '试试一元二次方程流程图推演']),
    ].join('\n\n'),
  }
}

/** 课程 4：一元二次方程求根逻辑（渐进式决策流程图） */
const buildQuadraticFlowTurn = (round: number, userText: string, tutorMode = true): DemoTurn => {
  if (!tutorMode) {
    return {
      title: '一元二次方程 · 求解流程图',
      thinking:
        '当前为直接解答模式，直接在流程图画板呈现完整的一元二次方程求解决策树并给出结论汇总。',
      content: [
        '已为你直接在右侧**思维流程图画板**绘制完整的一元二次方程 $ax^2 + bx + c = 0\\ (a \\neq 0)$ 求解决策流程图：',
        toolBlock('flow_init', '绘制一元二次方程求解流程图', {
          title: 'ax² + bx + c = 0 求解策略树',
          direction: 'TD',
        }),
        toolBlock('flow_add_node', '标准方程', {
          id: 'start',
          label: '标准形式：ax² + bx + c = 0',
          sublabel: '确认二次项系数 a ≠ 0，提取系数 a, b, c',
          kind: 'start',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '判断判别式', {
          id: 'disc',
          label: '判断 Δ = b² - 4ac 的符号',
          sublabel: '根据 Δ 的正负分三种情况讨论',
          kind: 'decision',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接判别式判断', {
          from: 'start',
          to: 'disc',
          label: '计算判别式',
        }),
        toolBlock('flow_add_node', 'Δ > 0 分支', {
          id: 'gt0',
          label: '两不等实根',
          sublabel: 'x = (-b ± √Δ) / (2a)',
          kind: 'result',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接 Δ > 0', {
          from: 'disc',
          to: 'gt0',
          label: 'Δ > 0',
        }),
        toolBlock('flow_add_node', 'Δ = 0 分支', {
          id: 'eq0',
          label: '两相等实根（重根）',
          sublabel: 'x₁ = x₂ = -b / (2a)',
          kind: 'result',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接 Δ = 0', {
          from: 'disc',
          to: 'eq0',
          label: 'Δ = 0',
        }),
        toolBlock('flow_add_node', 'Δ < 0 分支', {
          id: 'lt0',
          label: '无实数根',
          sublabel: '（在复数范围内有一对共轭虚根）',
          kind: 'result',
          status: 'solved',
        }),
        toolBlock('flow_add_edge', '连接 Δ < 0', {
          from: 'disc',
          to: 'lt0',
          label: 'Δ < 0',
        }),
        '### 核心结论汇总\n对于 $ax^2 + bx + c = 0\\ (a \\neq 0)$，记判别式 $\\Delta = b^2 - 4ac$：\n- **$\\Delta > 0$**：有两个不相等的实数根 $x_{1,2} = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$\n- **$\\Delta = 0$**：有两个相等的实数根 $x_1 = x_2 = -\\frac{b}{2a}$\n- **$\\Delta < 0$**：在实数范围内无实根（在复数范围内有一对共轭虚根）',
      ].join('\n\n'),
    }
  }
  if (round === 0) {
    return {
      title: '一元二次方程 · 求解流程图',
      thinking: '第 1 步：只创建起始方程节点与判别式计算步骤，向学生提问判别式 Δ 的表达式。',
      content: [
        '我们来一起从零搭建一元二次方程 $ax^2 + bx + c = 0\\ (a \\neq 0)$ 的**求解决策流程图**！每次只画一步。',
        toolBlock('flow_init', '初始化一元二次方程求解流程图', {
          title: 'ax² + bx + c = 0 求解策略树',
          direction: 'TD',
        }),
        toolBlock('flow_add_node', '添加起始节点：标准方程', {
          id: 'start',
          label: '标准形式：ax² + bx + c = 0',
          sublabel: '确认二次项系数 a ≠ 0，提取 a, b, c',
          kind: 'start',
        }),
        toolBlock('flow_add_node', '添加待推导节点：计算判别式', {
          id: 'disc',
          label: '？第一步要先计算什么关键指标？',
          sublabel: '用来判断方程有几个实数根',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接步骤 1', {
          from: 'start',
          to: 'disc',
          label: '提取系数后',
        }),
        '**第 1 步思考**：在套用求根公式之前，我们要先算一个决定“有几个实数根”的判别式 $\\Delta$。你还记得 $\\Delta$ 的计算公式吗？',
        choicesBlock(['Δ = b² - 4ac', 'Δ = b² + 4ac', '有点忘了，给我提示']),
      ].join('\n\n'),
    }
  }

  if (round === 1) {
    const guessedRight = /-\s*4ac|b²\s*-\s*4ac|b\^2\s*-\s*4ac/i.test(userText)
    const opening = guessedRight
      ? '记得非常牢靠！🎯 正是 $\\Delta = b^2 - 4ac$！'
      : '小提示：求根公式根号里面是 $b^2 - 4ac$，所以判别式是 **$\\Delta = b^2 - 4ac$**（注意是减号哦！）。'

    return {
      thinking:
        '第 2 步：把判别式节点改为菱形决策节点，先引出 Δ > 0 和 Δ = 0 的待推导分支，问学生 Δ > 0 时的结论。',
      content: [
        opening,
        '我们把 $\\Delta = b^2 - 4ac$ 作为核心判断节点固定到流程图上，先来看第一个分支：当 **$\\Delta > 0$** 时会发生什么？',
        toolBlock('flow_update_node', '确认判别式判断节点', {
          id: 'disc',
          label: '判断 Δ = b² - 4ac 的符号',
          sublabel: '根据 Δ 的正负分三种情况',
          kind: 'decision',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '添加 Δ > 0 待推导分支', {
          id: 'gt0',
          label: '？Δ > 0 时有几个实根？怎么算？',
          sublabel: '代入求根公式',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接 Δ > 0 分支', {
          from: 'disc',
          to: 'gt0',
          label: 'Δ > 0',
        }),
        '**第 2 步思考**：当 $\\Delta > 0$ 时，根号 $\\sqrt{\\Delta}$ 是一个正数，那么方程有几个实数根？求根公式怎么写？',
        choicesBlock(['两个不相等实根：x = (-b ± √Δ) / (2a)', '只有一个实根', '给我一点提示']),
      ].join('\n\n'),
    }
  }

  if (round === 2) {
    return {
      thinking:
        '第 3 步：补全 Δ > 0 分支，接着只添加 Δ = 0 和 Δ < 0 两个待填分支，请学生一次判断完最后两种情况。',
      content: [
        '漂亮！当 $\\Delta > 0$ 时，方程有两个不相等的实数根 $x_{1,2} = \\frac{-b \\pm \\sqrt{\\Delta}}{2a}$！',
        toolBlock('flow_update_node', '补全 Δ > 0 结论节点', {
          id: 'gt0',
          label: '两不等实根',
          sublabel: 'x = (-b ± √Δ) / (2a)',
          kind: 'result',
          status: 'solved',
        }),
        toolBlock('flow_add_node', '添加 Δ = 0 待推导节点', {
          id: 'eq0',
          label: '？Δ = 0 时的根',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接 Δ = 0 分支', {
          from: 'disc',
          to: 'eq0',
          label: 'Δ = 0',
          dashed: true,
        }),
        toolBlock('flow_add_node', '添加 Δ < 0 待推导节点', {
          id: 'lt0',
          label: '？Δ < 0 时的实根情况',
          kind: 'question',
        }),
        toolBlock('flow_add_edge', '连接 Δ < 0 分支', {
          from: 'disc',
          to: 'lt0',
          label: 'Δ < 0',
          dashed: true,
        }),
        '**第 3 步思考**：最后两块拼图交给你！当 $\\Delta = 0$ 以及 $\\Delta < 0$ 时，在**实数范围内**方程分别有几个解？',
        choicesBlock([
          'Δ = 0 有两个相等实根 x = -b/(2a)；Δ < 0 无实数根',
          'Δ = 0 无解；Δ < 0 有两个负根',
          '给我提示',
        ]),
      ].join('\n\n'),
    }
  }

  return {
    thinking: '完成最后两个节点的更新，整棵决策树构建完毕。',
    content: [
      '太棒了！你已经亲手把整棵**一元二次方程求解流程图**完整建出来了 🎉',
      toolBlock('flow_update_node', '补全 Δ = 0 结论节点', {
        id: 'eq0',
        label: '两相等实根（重根）',
        sublabel: 'x₁ = x₂ = -b / (2a)',
        kind: 'result',
        status: 'solved',
      }),
      toolBlock('flow_update_node', '补全 Δ < 0 结论节点', {
        id: 'lt0',
        label: '无实数根',
        sublabel: '（在复数范围内有一对共轭虚根）',
        kind: 'result',
        status: 'solved',
      }),
      '以后遇到任何含参数 $k$ 的一元二次方程“讨论根的个数”，只要脑海里浮现你刚才一步步建出的这棵树，就不会漏讨论啦！要不要试试把抛物线画到动态坐标系里看看？',
      choicesBlock(['挑战抛物线动点最大面积问题', '挑战将军饮马最短路径问题']),
    ].join('\n\n'),
  }
}

/** 自由输入智能响应（在演示模式下，根据用户输入的数学表达式或英语文本动态生成画板可视化） */
const buildCustomDemoTurn = (
  round: number,
  userText: string,
  firstText: string,
  tutorMode = true
): DemoTurn => {
  // 尝试识别简单函数表达式，例如 y = 2x + 1 或 y = x^2 - 4x + 3
  const fnMatch = firstText.match(/y\s*=\s*([0-9a-zA-Z\s+\-*/^().²³]+)/i)
  if (fnMatch) {
    const expr = fnMatch[1].trim()
    if (!tutorMode) {
      return {
        title: `函数图像：y = ${expr}`,
        thinking: `当前为直接解答模式，直接绘制函数 y = ${expr}、可拖动点 P 及垂直辅助线 PH ⊥ x 轴。`,
        content: [
          `已为你直接在右侧**坐标系画板**绘制函数 $y = ${expr}$ 的图像，并附上可拖动点 $P$ 与坐标垂线 $PH \\perp x$ 轴：`,
          toolBlock('coord_setup', `初始化坐标系：y = ${expr}`, {
            title: `函数图像：y = ${expr}`,
            xMin: -5,
            xMax: 7,
            yMin: -5,
            yMax: 7,
          }),
          toolBlock('coord_draw_function', `绘制函数 y = ${expr}`, {
            id: 'custom-fn',
            expr,
            label: `y = ${expr}`,
            color: '#3964FE',
          }),
          toolBlock('coord_add_moving_point', '在图像上添加可拖动观察点 P', {
            id: 'P',
            label: 'P',
            pathType: 'function',
            expr,
            tMin: -3,
            tMax: 5,
            initialT: 1,
            color: '#EF4444',
          }),
          toolBlock('coord_draw_auxiliary_line', '作动态辅助线：PH ⊥ x 轴', {
            id: 'aux-custom-PH',
            kind: 'perpendicular',
            fromId: 'P',
            axis: 'x',
            derivedPointId: 'H',
            derivedPointLabel: 'H',
            label: 'PH ⊥ x轴',
            color: '#F59E0B',
            showRightAngle: true,
          }),
          toolBlock('coord_add_measurement', '实时显示点 P 坐标', {
            id: 'm-coord',
            label: '动点 P 坐标',
            kind: 'coord',
            pointIds: ['P'],
            color: '#10B981',
          }),
          '你可以拖动红色点 $P$ 沿曲线滑动查看任意横纵坐标与图像走势；也可以点击右上角模型选择器接入 DeepSeek / OpenAI / Claude / Gemini 获取任意题目的深度解析。',
        ].join('\n\n'),
      }
    }
    if (round === 0) {
      return {
        title: `函数探究：y = ${expr}`,
        thinking: `检测到用户输入了函数表达式 y = ${expr}。先绘制函数图像与一个可拖动观察点 P，引导学生观察图像性质。`,
        content: [
          `好问题！我们先在右侧坐标系里把函数 $y = ${expr}$ 画出来，并放上一个可拖动的观察点 $P$：`,
          toolBlock('coord_setup', `初始化坐标系：y = ${expr}`, {
            title: `函数探究：y = ${expr}`,
            xMin: -5,
            xMax: 7,
            yMin: -5,
            yMax: 7,
          }),
          toolBlock('coord_draw_function', `绘制函数 y = ${expr}`, {
            id: 'custom-fn',
            expr,
            label: `y = ${expr}`,
            color: '#3964FE',
          }),
          toolBlock('coord_add_moving_point', '在图像上添加可拖动观察点 P', {
            id: 'P',
            label: 'P',
            pathType: 'function',
            expr,
            tMin: -3,
            tMax: 5,
            initialT: 1,
            color: '#EF4444',
          }),
          toolBlock('coord_add_measurement', '实时显示点 P 坐标', {
            id: 'm-coord',
            label: '动点 P 坐标',
            kind: 'coord',
            pointIds: ['P'],
            color: '#10B981',
          }),
          '**第 1 步思考**：试着拖动曲线上的红点 $P$，观察它经过 $x$ 轴或 $y$ 轴时的位置。你能先说出当 $x = 0$ 时，图像与 $y$ 轴的交点纵坐标是多少吗？',
          '> 💡 当前处于**免 API Key 演示模式**，你可以随时在顶部模型选择器中接入 DeepSeek / OpenAI / Claude / Gemini 等真实大模型，解锁任意难题的无限步深度苏格拉底辅导！',
          choicesBlock([
            '当 x = 0 时我算出来了',
            '请继续作一条辅助线帮我分析',
            '我想试试经典的将军饮马动点题',
          ]),
        ].join('\n\n'),
      }
    }
    return {
      thinking:
        '在用户自由输入的函数探究第 2 步，添加动态垂直辅助线 PH ⊥ x轴 帮助观察横纵坐标关系。',
      content: [
        '干得漂亮！为了把横坐标 $x$ 和纵坐标 $y$ 看得更直观，我再给动点 $P$ 加一条动态垂线辅助线 $PH \\perp x$ 轴：',
        toolBlock('coord_draw_auxiliary_line', '作动态辅助线：PH ⊥ x 轴', {
          id: 'aux-custom-PH',
          kind: 'perpendicular',
          fromId: 'P',
          axis: 'x',
          derivedPointId: 'H',
          derivedPointLabel: 'H',
          label: 'PH ⊥ x轴',
          color: '#F59E0B',
          showRightAngle: true,
        }),
        '拖动点 $P$ 感受一下 $PH$ 的长短变化！如果你想对任意复杂题目进行完整多轮 AI 推导，点击页面上方模型名称即可一键配置 DeepSeek / ChatGPT / Claude / Gemini API Key。',
        choicesBlock([
          '挑战将军饮马最短路径问题',
          '挑战抛物线动点最大面积问题',
          '试试英语长难句流程图拆解',
        ]),
      ].join('\n\n'),
    }
  }

  // 判断是否偏英语 / 流程图问题
  const looksEnglish =
    /[a-zA-Z]{4,}/.test(firstText) && !/坐标|动点|抛物线|几何|三角形/.test(firstText)
  if (looksEnglish) {
    if (!tutorMode) {
      return {
        title: '英语结构 · 流程图拆解',
        thinking: '当前为直接解答模式，使用流程图画板直接梳理输入英语内容的结构框架。',
        content: [
          '已为你直接在右侧**思维流程图画板**生成英语结构拆解框架：',
          toolBlock('flow_init', '创建英语结构流程图', {
            title: '英语文本结构分析',
            direction: 'TD',
          }),
          toolBlock('flow_add_node', '原文输入', {
            id: 'e-start',
            label: '原文片段',
            sublabel: firstText.slice(0, 60),
            kind: 'start',
            status: 'solved',
          }),
          toolBlock('flow_add_node', '抓主句主干', {
            id: 'e-step1',
            label: '步骤 1：定位主语与谓语动词',
            sublabel: '先剥离介词短语、非谓语及从句引导词',
            kind: 'grammar',
            status: 'solved',
          }),
          toolBlock('flow_add_edge', '连接步骤 1', {
            from: 'e-start',
            to: 'e-step1',
            label: '找主干',
          }),
          toolBlock('flow_add_node', '理清修饰与语义', {
            id: 'e-step2',
            label: '步骤 2：还原从句与逻辑关系',
            sublabel: '确定先行词与逻辑连接词后重组语序',
            kind: 'result',
            status: 'solved',
          }),
          toolBlock('flow_add_edge', '连接步骤 2', {
            from: 'e-step1',
            to: 'e-step2',
            label: '重组译文',
          }),
          '> 💡 当前为免 Key 演示模式；点击顶部模型选择器接入 DeepSeek / GPT-4o / Claude / Gemini 后，即可针对任意英语长难句或文章生成完整逐词句法流程图与精准解析。',
        ].join('\n\n'),
      }
    }
    if (round === 0) {
      return {
        title: '英语思考 · 渐进拆解',
        thinking: '检测到英语学习问题，使用渐进式流程图建立第 1 步分析节点，不一次性给出完整答案。',
        content: [
          '很好的英语问题！我们用**渐进式思维流程图**一步步拆解，不急着看最终答案：',
          toolBlock('flow_init', '创建英语思路流程图', {
            title: '英语问题渐进拆解',
            direction: 'TD',
          }),
          toolBlock('flow_add_node', '添加题目起始节点', {
            id: 'e-start',
            label: '待分析英语内容',
            sublabel: firstText.slice(0, 48),
            kind: 'start',
          }),
          toolBlock('flow_add_node', '添加第 1 步思考节点', {
            id: 'e-step1',
            label: '？核心动词 / 关键主干是什么？',
            sublabel: '先抓骨架，再看修饰',
            kind: 'question',
          }),
          toolBlock('flow_add_edge', '连接第 1 步', {
            from: 'e-start',
            to: 'e-step1',
            label: '第 1 步',
          }),
          '**第 1 步思考**：在这段英语里，你第一眼觉得最核心的**主干动词（或核心关键词）**是哪一个？试着写出来，我们一起把流程图往下推演！',
          '> 💡 提示：当前为免 Key 演示模式；点击顶部模型选择器接入 DeepSeek / GPT-4o / Claude / Gemini 后，即可针对任意英语文章、写作、语法题进行完整苏格拉底教学。',
          choicesBlock(['试试内置完整课程：英语长难句拆解', '给我一点提示']),
        ].join('\n\n'),
      }
    }
    return {
      thinking: '更新第 1 步节点并给出下一步引导。',
      content: [
        `收到你的想法：**「${userText.slice(0, 40)}」** 👍 非常好的切入点！我把它记录到流程图里：`,
        toolBlock('flow_update_node', '记录学生的思路', {
          id: 'e-step1',
          label: `学生发现：${userText.slice(0, 28)}`,
          sublabel: '已锁定关键线索',
          kind: 'grammar',
          status: 'solved',
        }),
        '想体验更完整的 4 轮互动教学，可以点击下方试试内置精品课，或在顶部切换至你自己的 DeepSeek / ChatGPT / Claude / Gemini API！',
        choicesBlock(['试试英语长难句流程图拆解', '试试将军饮马最短路径问题']),
      ].join('\n\n'),
    }
  }

  // 默认引导至坐标系或直接演示完整画板解答
  return buildShortestPathTurn(round, userText, tutorMode)
}

const buildConstrainedLadderTurn = (round: number, _userText: string, tutorMode = true): DemoTurn => {
  const baseTools = [
    toolBlock('coord_setup', '初始化坐标系：靠墙定长梯模型', {
      title: '定长约束：|AB| = 5 梯子中点轨迹',
      xMin: -1,
      xMax: 6.5,
      yMin: -1,
      yMax: 6.5,
    }),
    toolBlock('coord_plot_point', '标出墙角原点 O(0, 0)', {
      id: 'O',
      label: 'O(0, 0)',
      x: 0,
      y: 0,
      color: '#64748B',
      pinned: true,
    }),
    toolBlock('coord_add_moving_point', '在 y 轴上添加动点 A（梯顶）', {
      id: 'A',
      label: 'A',
      pathType: 'segment',
      from: [0, 0],
      to: [0, 5],
      tMin: 0,
      tMax: 5,
      initialT: 4,
      color: '#EF4444',
    }),
    toolBlock('coord_add_moving_point', '在 x 轴上添加动点 B（梯脚）', {
      id: 'B',
      label: 'B',
      pathType: 'segment',
      from: [0, 0],
      to: [5, 0],
      tMin: 0,
      tMax: 5,
      initialT: 3,
      color: '#3964FE',
    }),
    toolBlock('coord_draw_segment', '连接定长梯子 AB', {
      id: 'seg-AB',
      fromId: 'A',
      toId: 'B',
      color: '#2563EB',
      label: '梯子 AB',
      showLength: true,
    }),
    toolBlock('coord_add_constraint', '限定梯长恒为 |AB| = 5', {
      id: 'con-ladder-len',
      kind: 'fixed_length',
      pointIds: ['A', 'B'],
      value: 5,
      label: '定长约束 |AB| = 5',
    }),
    toolBlock('coord_add_derived_point', '构造梯子中点 M 并开启轨迹留痕', {
      id: 'M',
      label: 'M',
      kind: 'midpoint',
      fromId: 'A',
      toId: 'B',
      color: '#10B981',
      trace: true,
    }),
    toolBlock('coord_draw_segment', '连接斜边中线 OM', {
      id: 'seg-OM',
      fromId: 'O',
      toId: 'M',
      color: '#10B981',
      dashed: true,
      showLength: true,
    }),
    toolBlock('coord_draw_angle', '标出直角墙角 ∠AOB', {
      id: 'ang-O',
      fromId: 'A',
      vertexId: 'O',
      toId: 'B',
      rightAngle: true,
      color: '#F59E0B',
    }),
    toolBlock('coord_add_measurement', '实时监测 OM 长度', {
      id: 'm-om',
      label: 'OM',
      kind: 'distance',
      pointIds: ['O', 'M'],
      optimalValue: 2.5,
      optimalHint: '恒等于 2.5！',
      color: '#10B981',
    }),
  ]

  if (!tutorMode || round >= 1) {
    const scriptCode = [
      'if (ctx.isTimelineDriven) {',
      '  const theta = 0.12 + ctx.progress * (Math.PI / 2 - 0.24);',
      '  ctx.setPoint("A", 0, 5 * Math.sin(theta));',
      '  ctx.setPoint("B", 5 * Math.cos(theta), 0);',
      '}',
      'const a = ctx.getPoint("A");',
      'const b = ctx.getPoint("B");',
      'if (a && b) {',
      '  const len = ctx.math.dist(a, b);',
      '  ctx.setStatus("梯长 |AB|=" + len.toFixed(2) + " | 倾斜角=" + (Math.atan2(a.y, b.x) * 180 / Math.PI).toFixed(1) + "°");',
      '}',
    ].join('\n')

    return {
      title: '约束求解 · 靠墙定长梯中点轨迹',
      thinking:
        '展示完整的约束求解 + 中点轨迹圆验证，并附上可编程动点控制脚本，让用户既可以点击播放自动演示，也可以随时手动拖动 A、B 或梯子 AB 线段！',
      content: [
        ...(round === 0 ? baseTools : []),
        toolBlock('coord_draw_circle', '绘制以 O 为圆心、半径 2.5 的验证圆', {
          id: 'circle-locus',
          centerId: 'O',
          radius: 2.5,
          color: '#10B981',
          dashed: true,
          label: '轨迹圆 r = 2.5',
        }),
        toolBlock('coord_set_script', '编写平滑滑梯演示程序（不锁定手动拖拽）', {
          id: 'script-ladder',
          title: '定长滑梯平滑运动控制',
          description: '自动按角度均匀滑动梯子，且允许随时手动拖动 A、B 或梯子线段',
          duration: 5,
          loopMode: 'bounce',
          autoPlay: false,
          code: scriptCode,
        }),
        '### 核心几何结论\n1. **直角三角形斜边中线定理**：由于 $\\angle AOB = 90^\\circ$ 且 $M$ 是斜边 $AB$ 的中点，无论梯子滑到什么位置，恒有：\n   $$OM = \\frac{1}{2} AB = \\frac{5}{2} = 2.5$$\n2. **轨迹方程**：点 $M$ 到定点 $O(0,0)$ 的距离恒等于 $2.5$，因此中点 $M$ 的运动轨迹是以原点 $O$ 为圆心、半径为 $2.5$ 的**四分之一圆弧**（$x^2 + y^2 = 6.25,\\ x \\ge 0, y \\ge 0$）。\n\n你可以**直接拖动红点 $A$、蓝点 $B$ 或直接抓住梯子线段 $AB$ 拖动**，也可以点击顶部 **「约束 1/1」** 或 **「⚡ 程序」** 查看/修改实时约束与控制代码！',
      ].join('\n\n'),
    }
  }

  return {
    title: '约束求解 · 靠墙定长梯中点轨迹',
    thinking:
      '第一步：利用 coord_add_constraint 设定 |AB| = 5，让用户亲自拖动 A、B 或梯子线段 AB 观察程序自动维持定长，并看着绿色中点 M 留下的轨迹猜想其几何形状。',
    content: [
      '太棒了！我已在右侧画板建好靠墙梯子模型，并开启了**实时定长约束 `|AB| = 5`** 和中点 $M$ 的**轨迹留痕**：',
      ...baseTools,
      '试着用鼠标**直接拖动红点 $A$、蓝点 $B$，甚至直接抓住梯子线段 $AB$ 滑动**！你会发现程序会自动维持梯子长度恒为 $5$，同时绿色中点 $M$ 会自动画出它的运动轨迹。',
      '**第 1 步观察**：盯着左上角的实时度量 $OM$ 和绿色轨迹曲线——当梯子滑动时，$OM$ 的长度有什么变化？你觉得点 $M$ 走出来的轨迹是一条直线、抛物线，还是圆弧？为什么？',
      choicesBlock([
        'OM 恒等于 2.5，轨迹是以 O 为圆心、半径 2.5 的四分之一圆弧！',
        '轨迹是一条斜向直线',
        '用直角三角形性质给我一点提示',
      ]),
    ].join('\n\n'),
  }
}

const detectLesson = (firstPrompt: string, latestPrompt: string): string => {
  const combined = `${firstPrompt}\n${latestPrompt}`
  if (/梯子|定长|约束|滑梯|ladder|constraint/i.test(latestPrompt)) {
    return 'math-constrained-ladder'
  }
  if (/英语长难句|The scientist who discovered|complex sentence/i.test(latestPrompt)) {
    return 'english-clause-flowchart'
  }
  if (/抛物线|y\s*=\s*-x|POA|parabola/i.test(latestPrompt)) {
    return 'math-parabola-area'
  }
  if (/一元二次方程|判别式|ax²|ax\^2|quadratic/i.test(latestPrompt)) {
    return 'math-quadratic-flowchart'
  }
  if (/将军饮马|A\(1,\s*2\)|PA\s*\+\s*PB|shortest path/i.test(latestPrompt)) {
    return 'math-shortest-path'
  }

  if (/梯子|定长|约束|滑梯|ladder|constraint/i.test(combined)) {
    return 'math-constrained-ladder'
  }
  if (/英语长难句|The scientist who discovered|complex sentence/i.test(combined)) {
    return 'english-clause-flowchart'
  }
  if (/抛物线|y\s*=\s*-x|POA|parabola/i.test(combined)) {
    return 'math-parabola-area'
  }
  if (/一元二次方程|判别式|ax²|ax\^2|quadratic/i.test(combined)) {
    return 'math-quadratic-flowchart'
  }
  if (/将军饮马|A\(1,\s*2\)|PA\s*\+\s*PB|shortest path/i.test(combined)) {
    return 'math-shortest-path'
  }
  return 'custom'
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

const buildLiveCanvasProbeTurn = (userText: string, tutorMode = true): DemoTurn | null => {
  const isCoordProbe = /结合我现在坐标系画板上的/.test(userText)
  const flowMatch = userText.match(/(?:待推导节点|流程图中的)「([^」]+)」/)
  if (!isCoordProbe && !flowMatch) {
    return null
  }
  const state = useCanvasStore.getState()
  const board = getCurrentCanvasBoard(state)
  const hasUserCoord =
    state.userPoints.length > 0 || state.userSegments.length > 0 || state.userFunctions.length > 0

  if (isCoordProbe && (board.hasCoordinate || hasUserCoord)) {
    const solved = solveCoordinateScene({
      coord: board.coordinate,
      tValues: state.tValues,
      freePositions: state.freePositions,
      paramValues: state.paramValues,
      userPoints: state.userPoints,
      draggedId: state.draggedPointId,
      disabledConstraintIds: state.disabledConstraintIds,
      scriptEnabled: state.scriptEnabled,
      scriptTime: state.scriptTime,
      scriptCodeOverride: state.scriptCodeOverride,
    })
    const mp = board.coordinate.movingPoints[0]
    const pos = mp ? solved.points[mp.id] : null
    const coordText = pos ? `$(${pos.x.toFixed(2)}, ${pos.y.toFixed(2)})$` : '当前位置'
    const userNote = hasUserCoord
      ? `\n\n我同时看到你在画板上自己添加了 ${state.userPoints.length} 个探索点、${state.userSegments.length} 条探索线段和 ${state.userFunctions.length} 条函数曲线。`
      : ''

    if (!tutorMode) {
      const pointSummary = mp
        ? `当前动点 $${mp.label}$ 位于 ${coordText}。`
        : '已读取你当前坐标系画板上的元素。'
      return {
        thinking: '当前为直接解答模式，读取画板实时坐标与自绘元素并给出直接分析。',
        content: [
          `${pointSummary}${userNote}`,
          '你可以在顶部模型选择器接入真实大模型 API 后，直接针对画板上任意自绘点、约束条件、控制程序或函数曲线获得精确解析。',
        ].join('\n\n'),
      }
    }

    return {
      thinking: '读取学生当前画板上的动点实时坐标与自绘元素，给出针对性苏格拉底反馈。',
      content: [
        `我看到你把动点${mp ? ` $${mp.label}$ ` : ''}拖到了 ${coordText}！${userNote}`,
        '试着对比一下左上角实时测量指标的数值变化：当你微调它时，指标是变大、变小还是保持不变？这说明几何图形背后藏着什么规律？',
        choicesBlock(['继续下一步推导', '给我一点提示']),
      ].join('\n\n'),
    }
  }

  if (flowMatch) {
    const nodeLabel = flowMatch[1]
    const node = board.flowchart.nodes.find((n) => n.label === nodeLabel)
    if (!tutorMode) {
      return {
        thinking: `针对用户在流程图上点选的节点「${nodeLabel}」给出直接解释。`,
        content: [
          `你点选了流程图中的节点：**「${nodeLabel}」**${node?.sublabel ? `（${node.sublabel}）` : ''}。`,
          '该节点代表整体推理链路中的这一关键步骤；若接入顶部模型选择器中的真实大模型 API，还可以继续针对该节点做任意深度的展开与补充。',
        ].join('\n\n'),
      }
    }
    return {
      thinking: `针对学生在流程图上点选的节点「${nodeLabel}」提供聚焦引导。`,
      content: [
        `你点选了流程图里的节点：**「${nodeLabel}」**${node?.sublabel ? `（${node.sublabel}）` : ''}。`,
        node?.kind === 'question' &&
        (state.flowStatusOverrides[node.id] ?? node.status) !== 'solved'
          ? '这是一个待你破解的关键问题节点！试着回顾上一步给出的已知条件，写出你的判断或点击下方思路继续推进。'
          : '这一步承接了前面节点的推导条件，把核心结论固定下来后，才能继续向下一层分支推进。你想对这一步再确认什么细节，还是继续往下推导？',
        choicesBlock(['给我一点提示', '继续推进下一步']),
      ].join('\n\n'),
    }
  }
  return null
}

/**
 * 流式输出内置演示回复：支持苏格拉底分步引导模式与直接解答模式，两种模式下均支持实时调用画板工具。
 */
export async function* streamDemoTutorReply(
  history: Message[],
  question: UserMessage,
  thinking: boolean,
  _locale: Locale,
  signal: AbortSignal,
  tutorMode = true
): AsyncGenerator<MessageStreamEvent> {
  const rounds = getContextRounds(history)
  const firstUserText = rounds[0]?.[0].content ?? question.content
  const lessonId = detectLesson(firstUserText, question.content)

  // 若用户在会话中途点击切换到另一个精品课程，重置轮次为 0
  const switchedMidSession =
    rounds.length > 0 &&
    detectLesson(firstUserText, firstUserText) !== lessonId &&
    lessonId !== 'custom'
  const roundIndex = switchedMidSession ? 0 : rounds.length

  const probeTurn = buildLiveCanvasProbeTurn(question.content, tutorMode)
  let turn: DemoTurn
  if (probeTurn) {
    turn = probeTurn
  } else {
    switch (lessonId) {
      case 'math-shortest-path':
        turn = buildShortestPathTurn(roundIndex, question.content, tutorMode)
        break
      case 'math-constrained-ladder':
        turn = buildConstrainedLadderTurn(roundIndex, question.content, tutorMode)
        break
      case 'math-parabola-area':
        turn = buildParabolaAreaTurn(roundIndex, question.content, tutorMode)
        break
      case 'english-clause-flowchart':
        turn = buildEnglishClauseTurn(roundIndex, question.content, tutorMode)
        break
      case 'math-quadratic-flowchart':
        turn = buildQuadraticFlowTurn(roundIndex, question.content, tutorMode)
        break
      default:
        turn = buildCustomDemoTurn(roundIndex, question.content, firstUserText, tutorMode)
        break
    }
  }

  yield {
    type: 'message_start',
    message: { id: `demo-${Date.now()}`, model: 'socratic-demo-v1' },
  }

  let blockIdx = 0
  if (thinking && turn.thinking) {
    const idx = blockIdx++
    yield {
      type: 'content_block_start',
      index: idx,
      content_block: { type: 'thinking', thinking: '', signature: '' },
    }
    const chunkSize = 8
    for (let i = 0; i < turn.thinking.length; i += chunkSize) {
      await sleep(14, signal)
      yield {
        type: 'content_block_delta',
        index: idx,
        delta: { type: 'thinking_delta', thinking: turn.thinking.slice(i, i + chunkSize) },
      }
    }
    yield { type: 'content_block_stop', index: idx }
  }

  const textIdx = blockIdx++
  yield {
    type: 'content_block_start',
    index: textIdx,
    content_block: { type: 'text', text: '' },
  }

  // 把正文与工具块拆开流式输出：正文逐字平滑流式，每个工具块快速整块吐出以实现清晰的「边讲边画」实时动画感
  const segments = turn.content.split(/(```tutor-(?:tool|choices)\n[\s\S]*?```)/g)
  for (const seg of segments) {
    if (!seg) {
      continue
    }
    if (seg.startsWith('```tutor-tool')) {
      await sleep(180, signal)
      yield {
        type: 'content_block_delta',
        index: textIdx,
        delta: { type: 'text_delta', text: seg },
      }
      await sleep(220, signal)
    } else if (seg.startsWith('```tutor-choices')) {
      yield {
        type: 'content_block_delta',
        index: textIdx,
        delta: { type: 'text_delta', text: seg },
      }
    } else {
      const step = 6
      for (let i = 0; i < seg.length; i += step) {
        await sleep(16, signal)
        yield {
          type: 'content_block_delta',
          index: textIdx,
          delta: { type: 'text_delta', text: seg.slice(i, i + step) },
        }
      }
    }
  }

  yield { type: 'content_block_stop', index: textIdx }
  yield {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: null,
      ...(turn.title ? { title: turn.title } : {}),
    },
  }
  yield { type: 'message_stop' }
}
