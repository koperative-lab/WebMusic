# `<analysis-view>` 和弦工作台设计（终稿）

> Chordio design and implementation history, retained during documentation
> synchronization on 2026-09-06. Proposed steps, counts and source-line citations
> describe the recorded work; they are not the current work queue or proof that
> each proposed surface shipped. [STATUS.md](../STATUS.md) owns branch readiness,
> [DECISIONS.md](../DECISIONS.md) owns shared accepted choices, and
> [DOCUMENTATION-MAP.md](../DOCUMENTATION-MAP.md) routes to current references.
> Preserve the recorded body below when updating present-day guidance.

<!-- docs:historical-body -->

> 目标形态对标 [chordio.co.uk](https://chordio.co.uk)、[chordieapp.com](https://chordieapp.com)，参考开源实现 [shriramters/chordcat](https://github.com/shriramters/chordcat)。
> 本轮交付**设计 + 可点原型**（`dev/prototypes/harmony-workbench.html`），不改生产代码。
> 本文是两份独立设计方案（app 外壳式 / 图元优先式）经对比评审后的合成稿，所有门禁事实已逐条核实（见 §11）。

## 0. 这一版为什么是「活的」

> **用户的原话，本轮设计的唯一起点**：
> “Score/Analyze 这边现在全是静态的。我要这里的**所有**组件都像 chordio 那样是活的、会 pop 的视觉组件。
> 那些只把和弦列出来的东西太静态了，一点交互都没有——**那种事情该是后台的 headless 计算，
> 不该是一个 web component 上台表演。**”

这不是配色或动效的意见，是一次**分层修正**。它可以写成一条判据，本文此后每一节都服从它：

> **把结果列出来是数据的事，`createAnalysisSession` / `useScoreAnalysis` 已经在做；
> Web Component 的工作是演出。**

一个 `score/analyze` 的标签只有做到下面三件事之一，才配拥有自定义元素：
**(a)** 它随时间变化；**(b)** 它随指针 / 键盘输入变化；**(c)** 它画出一个列表画不出的几何
（传送带、键盘、五线谱、指板、轮盘）。三条全否的，它是一张**报告**——报告要么住在调用方自己的
markup 里、由一次 headless 调用喂，要么老老实实做一张不假装自己在动的静态卡片。

### 0.1 今天的实现，也就是被反对的那个东西

| 位置 | 今天的形态 |
|---|---|
| `renderChordTimeline` | `<ol>` 的行 |
| `renderRomanStrip` | 一排静态芯片 |
| `renderMotifList` / `renderVoiceLeadingList` | `<ol>` |
| `renderKeyView` / `renderHistogram` | 静态条 |
| `createAnalysisPlayhead` | **全族唯一的运动**：给当前 quarter 所在那一行加一个 `outline`（`ui/src/analysis.ts:147-219`） |

也就是：**静态列表 + 一个会动的高亮框**。这不是「有点静」，是**类型错了**——四个视图在重做
`useScoreAnalysis()` 已经做完的事，还多花了一层 DOM。

**运动不等于活。** 一个在静态 `<ol>` 上滑动的 `outline` 框，是以最弱的方式满足判据 (a)，
而它正是用户口中的「静态」。及格线是 D2。

### 0.2 三条已定的决定：不再重开，只在其中做设计

| | 决定 | 它排除了什么 |
|---|---|---|
| **D1** | **六个视图仍是六个 tab**（`key` / `chords` / `roman` / `motifs` / `voice-leading` / `live-chord`），每一个**在内部**变活 | 不把六个合并成一个场景 |
| **D2** | 运动模型是**固定 now 线、材料滚动**：一条竖线钉在固定 x 上，和弦带、级数、动机从右往左流过它 | 不是「整曲固定、播放头移动」。**看得见下一个和弦正在逼近——这份预期就是全部理由** |
| **D3** | 范围是 score/analyze 的**五个元素**：`<analysis-view>` `<analysis-timeline>` `<score-analysis>` `<analysis-histogram>` `<rhythm-patterns>` | audio 的元素与 score/view 不在本轮 |

**D2 与 `mountTimeline` 是两种时间显示，别搞混，也别互相冒充：**

| | 问的问题 | 框固定的是 | 动的是 | 谁在用 |
|---|---|---|---|---|
| **地图（map）** | 我在整首曲子的哪儿？ | 整首的量程 | 播放头标记 | `<analysis-timeline>` / `mountTimeline`（`ui/src/timeline.ts:581-589`） |
| **传送带（transport）** | 此刻在发生什么？下一件事是什么？ | **now 线** | **材料** | `<analysis-view>` 的六个舞台 |

两者都对。一个 now 线**看不见整首曲子**，而那正是地图的全部价值；两种模型是一个设计，
同一种模型做两遍是一次重复。所以 `<analysis-timeline>` **保持地图模型**（§5.9 / §7.5），
本文的传送带只发生在 `<analysis-view>` 里。

### 0.3 「活」不等于「动」

四条反廉价的硬规矩，写进图元测试，全设计不许违反：

1. **band 的几何永不做动画。** 宽度就是时长，时长不可协商。会动的只有颜色、不透明度、字号；
   **位移被滚动垄断**。
2. **同一个时间尺度里只有一样东西在动，而且永远是材料。** 唯一的例外是 now 线自己 90ms 的加粗——
   闪的是线，不是材料，所以连续同名和弦不会让整个舞台频闪。
3. **停靠不是空白。** 一个停着的工作台是一件**乐器**，不是骨架：整首曲子已经画完，可以拖、可以用键盘走，
   线下读到什么就报什么。「活」的意思是**会响应**，不是「会动」；没有走带却发明运动，是对时钟撒谎。
4. **一个用户想关掉的动效等于没做。** 所以「错误指示器」不闪、不抖、不响，它做的是**注意力收窄**（§5.6）；
   所以名牌换符号是纯淡换，因为那是用户唯一真的在读的那行字（§3.5）。

### 0.4 已确认的范围（不变）

1. **六个视图全部重做**：`key` / `chords` / `roman` / `motifs` / `voice-leading` / `live-chord` 统一到一套视觉语言。
2. **全部可视功能都要**：钢琴键盘（音级角色着色）、大谱表五线谱、吉他指板、备选和弦命名。
3. **全部先抽象进 uikit**：图元落在 `packages/ui`，域中立、可复用；`packages/score` 的元素只做薄壳。
4. **输入源不变**：仍通过 `player="#p"` 绑定 `webscore:noteon/noteoff/timeupdate/end`。

### 0.5 四路设计意见的分歧裁决表

本节之后的内容由四份独立设计（motion / views / kitapi / family）合成。它们冲突的地方在这里一次裁完，
**输的那一方连同理由一并记下，不要再重开**：

| # | 分歧 | 决定 | 输的一方及其理由为何不成立 |
|---|---|---|---|
| 1 | 传送带图元叫什么 | **`mountFlowLane`**，住进 `harmony.ts`，与 `mountNameplate` / `mountChipStrip` / `mountWheel` 并列 | `mountLanes`（复数）输——复数由 `FlowLaneState.tracks` 承担，仓内既有词是单数的 `TimelineHandle.lane`，改名买不到任何东西 |
| 2 | 它是否吞掉 `mountChipStrip` | **不吞。** `mountChipStrip` 原样保留，服务「没有时间轴的排行/明细」（`key` 候选榜、`<analysis-histogram>` 的双轨条） | `shape:'row'` 退化态输——把一个静态 `<ol>` 藏进一个自带帧循环、自由表和指针捕获的 mount 里，是在第一份实现里藏第二份实现；而那个 `<ol>` 正是 `analysis.test.ts` 与 `elements.test.ts` 逐字节钉住的东西 |
| 3 | 谁持有时钟 | **三层**：`internal/frame.ts` 持有**每 document 一个** rAF 循环；`mountWorkbench` 持有**每帧唯一的那次读数**并以 `FrameClock` 发给插槽图元；**预测（20Hz→60Hz 插值）住在 score 的 `headless/transport-clock.ts`** | 「每个 mount 各开一个 rAF」输——六个循环六次唤醒、且没有共享预算；「外壳持有循环」输——文档站会单独 mount 一个孤零零的图元，够不到外壳，而 `pitch.ts` 与 `harmony.ts` 互相不许 import；「lane 自己按 anchor+rate 插值」输——那把速率与 seek 判定塞进了 kit，也就是把域知识塞进了 kit |
| 4 | 六个 `render*` 函数是加动效还是变薄壳 | **既不加动效也不变薄壳：原样保留为静态一次性画笔，且不标 `@deprecated`**（§7.1） | 「委托给活体 mount」输——签名 `(data, root) => void` 不返回任何可驱动的东西；而且 `analysis.test.ts:29-30` 钉死「2 段和弦 = 恰好 2 个跨度节点、再无其他」，一个活体 lane 只要给 now 线打上 `data-start-quarters` 就变 3 个：**为了让薄壳的节点预算成立，活体 mount 必须变得更不活**。尾巴摇狗 |
| 5 | lane 的横轴单位 | **名义秒（nominal seconds）**；`data-start-quarters` 由 `FlowBand.stampStart/stampEnd` 单独承载 | 「用 quarters 做横轴」输——传送带是**真实时间**的画像，渐慢必须看得见地把 band 拉长，用 quarters 画会把一段 rubato 画成节拍器，那正是「静态」在几何上的复述；而且 `TimeMap.secondsToQuarters`（`core/time/TimeMap.ts:479-486`）每次调用都 `new Rational` 并量化到 1/480，逐帧×六个 lane 是每秒 360 次分配 |
| 6 | 离屏 band 摘不摘 | **永不摘。** 用 `content-visibility: auto` + `contain-intrinsic-size` 省渲染；超过 ~2000 个 item 时正确做法是**在 headless 侧合并数据** | 「自由表回收 + 硬节点上限」输——`createAnalysisPlayhead` 靠 `root.querySelectorAll(ANALYSIS_SPAN_SELECTOR)` 发现节点，被虚拟化掉的 band 是一段**静默死掉的高亮**，而且被回收的恰好是 now 线附近那些；`analysis.test.ts` 与 `new-elements.test.ts` 还把跨度节点数钉成常数，虚拟化会让它变成滚动位置的函数。它的**理由**保留：`will-change: transform` 只许给 reel 一个节点，画区边界由 viewport 的 `contain` 兜住 |
| 7 | 怎么防 `scrollIntoView` 打架 | **两道**：viewport 写 `overflow: hidden; overflow: clip;`（`clip` 根本不产生滚动盒），**且** `createPlayheadHighlighter` 新增 `{scroll?: boolean}`、只有工作台传 `false` | 「直接把 `playhead.ts` 改成 `createAnalysisPlayhead(root, {scroll:false})`」输——`packages/score/test/analyze/playhead.test.ts:61,66,69` 逐字节钉着滚动次数，改默认值当场变红，而且会顺手拿走旧列表元素的自动滚动 |
| 8 | `<analysis-histogram>` 变不变 | **变活，但只有一份 DOM**：双轨（整曲 ghost + 已听到的填充），由 `mountChipStrip` 画，`new-elements.test.ts:146-165` 在同一笔提交里改写 | 「没绑 player 时逐像素等于今天」输——那是两份实现，而且测试会因为走了旧那份而**为了错误的理由**变绿；「新开第八个 mount `.wui-harmony-meters`」也输——那只是 `mountChipStrip` 加一个可选数字 |
| 9 | 减动效的开关叫什么 | 根节点 `data-motion="continuous \| stepped \| none \| degraded"` | `data-flow` 输——全族一个属性名就够，而且帧循环自我降频时还需要第四个值（`degraded`），它落在同一个属性上 |
| 10 | now 线的位置怎么表达 | 选项名 `anchor`（对齐 `mountStaff.anchor`），token `--wui-harmony-flow-now`，默认 **0.33** | `nowOffset` 输——同一个概念在两个 mount 里两个名字 |
| 11 | 轮盘的指针动效 | 一个 token `--wui-harmony-motion-turn`（320ms）同时管圈的旋转与置信度扇面 | 独立的 `--wui-harmony-motion-sweep` 输——圈已经把主音转到 12 点，再画一根独立的针是同一个事实的第二个通道 |

---

## 1. 设计论点

> **工作台把任何一种分析都拆成同一对读数：舞台（stage）回答「这首曲子正在怎么走」，坞位（dock）回答「此刻在响的是什么」。六个视图只换舞台上流过的证据，坞位永远是同一套音高读数。**
>
> **（§0 的转向改了这句话的前半。）** 旧稿写的是「舞台回答『整首曲子长什么样』」——
> 那是一张**排好的表**该回答的问题，而排表是 `AnalysisResult` 自己的事。
> 舞台回答的是**时间上的**问题，所以舞台是一条传送带（D2），不是一张清单。

六个视图问的是同一个问题的六个时间尺度：

| 视图 | 问的问题 | 时间尺度 | 舞台上流过的证据 |
|---|---|---|---|
| `live-chord` | 现在响的这坨音叫什么？ | 此刻 | hero 名牌 + 往左流走的尾流带（右侧是空场） |
| `key` | 听到现在，这段在什么调上？ | 累积 | 会转的五度圈 + 调判定流 + 会跳的音级权重列 |
| `chords` | 和声怎么走的？ | 全曲、按时长 | 和弦带传送过 now 线 + 发声刻痕 |
| `roman` | 这些和声在调内是什么功能？ | 全曲、按顺序 | 共享一根 now 线的功能带 + 级数带 |
| `motifs` | 哪些音型在重复？ | 全曲、按出现 | 每动机一条轨；一次出现越线时**全部**出现同时亮起 |
| `voice-leading` | 声部之间哪里出事了？ | 全曲、按事件 | 滚动的声部折线 + 画在对位**上**的问题括号 |

而**四个坞位在六个视图里逐字节相同**：它们只吃一次 `projectSounding()` 的结果。同一个 C♯ 在键盘、谱表、指板、名牌上是同一个颜色、同一个拼写、同一个角色——这不是靠约定，是靠**只有一个真值来源**。chordio / chordie 的「成熟感」就来自这里。

三条硬规矩：

1. **图元不认识彼此。** 任何 `mountX` 的入参里都不出现另一个图元的 handle / state。组合只发生在「外壳给插槽、元素往插槽里 mount」这一层。
2. **图元不认识乐理。** 图元收到的是「第 3 根弦第 5 品有一个 `role:'third'` 的点」，不是「Cmaj7 的三音」。
3. **图元共享同一张角色调色板。** 视觉统一不靠「大家都用一个 CSS 文件」，靠八个 mount 读同一组 `--wm-degree-*` token，且都从同一个函数取色。
4. **图元不认识时钟，只认识一个被拉取的数。**（live 转向新增，展开在 §3.0.1 R1–R3。）内容与位置是两个端口、两种速率；帧循环只有一个，且它不属于任何一个图元。

第二条不是审美选择，是门禁事实：`scripts/check-architecture.mjs:784` 的 `checkUiDomainVocabulary()` 用 `/[♩-♯]|[\u{1D100}-\u{1D1FF}]/gu` 扫 `packages/ui/src/**`，任何写进 ui 的乐谱字形直接挂 CI，错误信息原话是 “take a formatter callback instead”。

---

## 2. 视觉语言

### 2.1 版式网格

基准单位 `4px`；间距只取 `4 / 8 / 12 / 16 / 24`。外壳栅格：

```
grid-template-areas: "header header" "main rail" "strip strip" "status status";
grid-template-columns: minmax(0, 1fr) clamp(228px, 28%, 312px);
grid-template-rows: auto minmax(0, 1fr) auto auto;
```

**响应用容器查询（`container-type: inline-size`），不用媒体查询**——`<analysis-view>` 常被塞进文档站 16rem 高的小盒子，视口宽度和它无关。

| 档位 | 宽度 | 布局 |
|---|---|---|
| `lg` / `md` | ≥ 720px | main + rail |
| `sm` | 440–719px | rail 落到 main 下方，横向滚动 |
| `xs` | < 440px | 单列；tabs 横滚；identity 隐藏 |

无 rail 的视图（`motifs` / `voice-leading` 关掉全部坞位时）栅格塌成单列——由 `data-rail="false"` 驱动，不靠 JS 改样式。

### 2.2 字号阶梯

五级，密度切换只改这五个值 + 三个几何 token。**不做流体缩放**：谱表与指板要求像素稳定。

| Token | comfortable | compact | 用途 |
|---|---|---|---|
| `--wm-harmony-size-display` | `2.75rem` | `1.75rem` | 和弦名、调名（唯一的大字） |
| `--wm-harmony-size-title` | `1.0625rem` | `.9375rem` | 罗马数字、区块标题 |
| `--wm-harmony-size-body` | `.875rem` | `.8125rem` | 行文本、chip 主标签 |
| `--wm-harmony-size-label` | `.75rem` | `.6875rem` | 副标签、beat 标注 |
| `--wm-harmony-size-micro` | `.6875rem` | `.625rem` | 键面音名、品位号、角色缩写 |

几何：`--wm-keyboard-height`（92 → 68px）、`--wm-staff-space`（9 → 7）、`--wm-fretboard-height`（104 → 80px）。**等比缩小会让指板品记糊掉，所以几何单独给 token。**

字族三套：`--wm-harmony-font`、`--wm-harmony-font-mono`（一切音名/数字，`font-variant-numeric: tabular-nums`）、`--wm-harmony-font-display`（和弦符号）。kit 不带字体依赖；原型里演示用的是 IBM Plex + Newsreader，那是 token 覆写的示范，不是包的依赖。

> **正文字族默认 `inherit`，不是 `system-ui`（已按实现修订，commit C.2）。** 旧的 `createAnalysisRoot` 写的是 `font: inherit`，
> 一个不请自来就改掉宿主正文字体的卡片会是页面上最吵的东西。落地链是
> `var(--wm-harmony-font, var(--wm-font-family, inherit))`：宿主写了 harmony 的就用它，写了 kit 的就用 kit 的，
> 都没写就继续跟页面。等宽与 display 两族同理（display 回退到正文族）。
> **只有字号阶梯是绝对值**——卡片根节点自己写 `font-size: var(--wui-harmony-size-body)` 与 `line-height: 1.45`，
> 这是 §7.4.1 承诺给 audio 五个元素的「免费拿到字号阶梯」的落点，也是唯一一处根节点不再继承页面的属性。

### 2.3 颜色角色

两组，正交。**A 组界面骨架**（`--wm-harmony-*`）保持中性、克制；**B 组音级角色**（`--wm-degree-*`）是这套设计的视觉签名。

| Token | light | dark | 语义 | 缩写 |
|---|---|---|---|---|
| `--wm-degree-root` | `#c2410c` | `#fb923c` | 根音 | `R` |
| `--wm-degree-third` | `#0369a1` | `#38bdf8` | 三音 | `3` |
| `--wm-degree-fifth` | `#15803d` | `#4ade80` | 五音 | `5` |
| `--wm-degree-seventh` | `#6d28d9` | `#a78bfa` | 七音 | `7` |
| `--wm-degree-extension` | `#a16207` | `#facc15` | 9/11/13 与改变音 | `9` |
| `--wm-degree-bass` | `#9f1239` | `#fb7185` | 最低音且非根音（slash bass） | `B` |
| `--wm-degree-other` | `#6b7280` | `#94a3b8` | 不属于该和弦的响音 | `·` |
| `--wm-degree-ghost` | `rgba(20,22,26,.10)` | `rgba(232,234,237,.14)` | 调内但未响（调式提示） | — |

**颜色永不单独承载信息**：每个带角色的读数同时印出缩写（`R / 3 / 5 / 7 / 9 / B`），compact 档下也不许省。这既是无障碍底线，也让截图在灰度打印下仍可读——实测七个 fill 在灰度下两两最小差只有 1.01:1，所以缩写不是补充，是**唯一**能过灰度的通道。

> **缩写列已按实现修订（commit C.2）。** 表里 `other` 的 `·` 与 `ghost` 的 `—` 都不是 ASCII，
> 而 `toneMark()` 的返回值会被印进 `packages/ui/src`（乐谱字形门禁扫的是源码文本，不是运行时输出，
> 但保持返回值 ASCII 才能让门禁与视觉两边都不用例外）。落地取 `.`，两个角色暂时共用。
> **两处已知不足，留给第一个真正印出缩写的 mount（C.6 `pitch.ts`）**：
> (a) `other`（响了但不在和弦里）与 `ghost`（在调内但没响）是相反的事实，却印同一个字符；
> (b) `extension` 一律印 `9`，但这个角色覆盖 9/11/13 与所有改变音，`#11` 印成 `9` 是**假信息**。
> 两者的正确解都是同一个：调用方知道真实级数，`toneMark()` 该收一个 override，或 `PitchMark` 该带 `mark?: string`。
> 现在不加，是因为还没有调用方能提供它——加一个没人传的参数只会让八个 mount 各自猜默认值。

**A 组（`--wm-harmony-*`）亮侧字面量 = 旧默认值。** 见 §2.4：这一族的八个旧 token 默认值印在五个文档页上，
所以 A 组每条链的 `light-dark()` 亮侧原样保留旧字节，暗侧才是新的。B 组是全新概念，没有旧值要守。

### 2.4 明暗主题的落地机制

> **已按实现修订（commit C.2）。** 本节原方案是「`--wui-*-lit` 字面量层 + `@media (prefers-color-scheme)` 双写」，
> 并断言内联模式只能拿亮色。**实现没有采用，因为那个断言是错的。** 下面是落地的写法。

kit 现有写法是 `var(--wm-x, 字面量)`，字面量写死在 JS 字符串里，媒体查询改不动它。但**媒体查询不是唯一的入口**：
`light-dark()` 把明暗选择放进**值**里，而值在两条路径上都原样成立。

```css
/* packages/ui/src/harmony-style.ts 生成的形状 */
.wui-analysis {
  /* 注意这里没有 color-scheme：由宿主页面继承 */
  --wui-harmony-ink: var(--cp-foreground, var(--wm-harmony-foreground,
                     var(--wm-analysis-foreground, var(--webscore-analyze-color,
                     var(--wm-foreground, inherit)))));
  --wui-harmony-track: var(--cp-track, var(--wm-harmony-track,
                       var(--wm-analysis-track, var(--webscore-analyze-track,
                       var(--wm-surface-muted, light-dark(#eeeeee, #23272f))))));
}
.wui-analysis[data-scheme="system"] { color-scheme: light dark }   /* 显式跟随系统 */
.wui-analysis[data-scheme="light"]  { color-scheme: light }
.wui-analysis[data-scheme="dark"]   { color-scheme: dark }
```

顺序保证不变：宿主写了 `--wm-*` 永远赢；没写就走 `light-dark()`；显式 `data-scheme` 覆盖一切。
**变的是内联模式也拿得到暗色**——在本仓 jsdom 24 / cssstyle 上实测，
`el.style.cssText = "color:var(--wui-x, light-dark(#14161a,#e8eaed));--wui-x:light-dark(#14161a,#e8eaed);"`
**逐字节原样回读**（自定义属性与 `var()` 回退整体不解析）。所以同一份值同时服务样式表路径与 `stylesheet:false` 内联路径。

**根节点不写 `color-scheme`（已按实现修订，commit C.2）。** 初稿在根上无条件写 `color-scheme: light dark`，
实测（Chrome 148）这会造成两种错读，两种都是这一族最常见的宿主：

| 宿主 | 无条件 `light dark` | 继承（落地写法） |
|---|---|---|
| 亮色页 + 用户 OS 偏暗 | 卡片自己翻暗：白底页上一层浅灰字 | 跟着页面留在亮色 |
| 深色 app（`color-scheme: dark`）但 OS 偏亮 | 深色 app 里一张纯白卡 | 跟着 app 变暗 |

`color-scheme` 本来就是继承属性，**不写就是跟着页面走**——这正是想要的语义：卡片坐在宿主的底色上，
就该和宿主同进退，而不是替宿主决定。于是 `harmonyScheme` 是四条记录（`inherit` / `system` / `light` / `dark`），
默认 `inherit`（空记录，一条声明都不写）；`createAnalysisRoot` 用它，
只有**自带底色的外壳**（§3.8 的 workbench）才有资格 paint `system`。

这条决定还有一个副作用，它比暗色本身更重要：**因为卡片继续继承页面，A 组每个 `light-dark()` 的亮侧
就可以原样保留旧字面量**——`--webscore-analyze-*` 那八个默认值（`transparent` / `inherit` / `#777` / `#eee` /
`#111` / `#d8d8d8` / `.75rem` / 活动芯片的 `#fff`）在五个文档页上白纸黑字写着。落地实现把它们逐字节钉在
`token-chain.test.ts` 的 `LIGHT_DEFAULT` 表里：**亮色模式下这次重构不动一个像素**，暗色是纯增量。
唯一故意挪动的亮色字面量是 `--wui-harmony-warning`（`#d98c00` → `#a86a00`）：前者在白底上只有 2.73:1，
低于图形 3:1 的下限，而这个色点是 `renderVoiceLeadingList` 里区分 warning 与 error 的**唯一**通道。

诚实的代价：不支持 `light-dark()` 的浏览器会**整条声明失效**，该属性变成未设置（继承页面），而不是取到错的颜色。
这也是为什么每条链都把宿主自己的 token 排在字面量前面——有主题的页面永远不依赖那个字面量。
本仓没有 browserslist，`packages/*/src` 里 `prefers-color-scheme` / `color-scheme` 零命中，所以不存在要保的旧契约。

### 2.5 状态与动效

> **本节因 §0 的转向整体重写。** 旧稿只有一份「时长预算」，那份预算描述的是**状态变化**；
> 一条滚动的 now 线不是状态变化，它是一个**被连续驱动的位置**，而旧稿没有一个字说谁来驱动它。
> 这一节补的就是那个缺口。

#### 2.5.1 五态，与每一态的驱动

五态仍写在外壳根节点的 `data-phase` 上，舞台与状态条同时响应。新增的是**驱动**一列——
它决定这一态到底烧不烧 rAF：

| phase | 触发 | 舞台 | 驱动 | 交互 | 状态条 |
|---|---|---|---|---|---|
| `idle`（无 score、无 player） | — | ruler 画出、now 线变淡、空态句坐在 now 线**正下方**（形状先立住） | **关** | 可聚焦；空态句说明该装什么 | 灰点 · “Load a score or bind a player” |
| `idle`（有 score、无 player） | — | **整首曲子已经画完**，停靠在 `now = 0` | 只在拖拽/惯性期间开 | **完全可 scrub**：拖、滚轮、`←/→`、`[`/`]`、`Home`/`End`；线下读到什么，名牌/谱表/键盘就报什么 | 灰点 · “bar 1 · beat 1” |
| `listening`（绑了 player 未收到音） | — | 同上；键盘画 ghost 音域 | 关，直到第一个 sample | 同上 | accent 点**呼吸** 1.6s（CSS animation，不走时钟）· “live · N notes heard” |
| `playing` | note-on or time update received | The now line stays fixed while material moves | On | Scrubbing takes local authority (`clock.hold`) | A solid dot; stable status message, position in `detail` |
| `empty` | A score exists but this view has no results | Empty-state copy belongs in the shell (brief B14) | Off | — | View-specific empty-state detail |
| `error` | Loading or analysis failed | Danger state with the original message | Off | — | Error message |

Playback position belongs in the non-live `detail` field. The `message` field uses
`role="status"` and `aria-live="polite"`; changing it on every transport update
would repeatedly announce the position through the whole performance.

**「停靠」这一行是本设计最容易被做丢的一行。** 一个可以拖过去、把每个和弦在线下读出名字的 lane，
比一个空转的滚动条更活。见 §0.3 第 3 条。

#### 2.5.2 动效预算：时长管状态变化，位置由时钟驱动

两类东西，别混：

- **状态变化**用 CSS transition，时长从 token 取。
- **位置**每帧写一次 `transform`，来自帧循环（§3.0.2）。它没有「时长」，它有速率。

`harmonyMotion.full` / `.reduced` 两份记录**都要**加下面五条（reduced 一律 `0s`）。
C.2 只落了前两条：

| token | full | 管什么 |
|---|---|---|
| `--wui-harmony-motion-tone` | `90ms linear` | 音级角色换色（再长就跟不上演奏）——**四个坞位同时换色，这才是真正被感觉到的那次 pop** |
| `--wui-harmony-motion-chip` | `120ms ease-out` | band 落定：填充 18% → 100% |
| `--wui-harmony-motion-flow` | `120ms` | lane 重锚缓动、缩放过渡 |
| `--wui-harmony-motion-pop` | `180ms` | 名牌换符号（WAAPI，见 §3.5 的「一个时长写两遍」） |
| `--wui-harmony-motion-release` | `140ms` | 键 / 指板圆点的松开余音 |
| `--wui-harmony-motion-column` | `200ms` | 谱表进列、指板滑把 |
| `--wui-harmony-motion-turn` | `320ms` | 五度圈旋转与置信度扇面 |

不做动画的东西，逐条写下来，因为每一条都有理由：符头**只做 `opacity 120ms`，绝不做位移**
（符头的 y 是拼写的函数，一个会滑的 y 等于在动画「拼写正在改变」，那是假话）；
tab 切换无动画；band 的宽高无动画（§0.3 第 1 条）；名牌主符号只做 opacity，不做位移不做缩放
（那是用户唯一真的在读的那行字）。

#### 2.5.3 `prefers-reduced-motion`：换驱动方式，不是关掉动效

**关掉动效会让 lane 退回一张静止的表，等于把这次重做撤销。** 正确的落法是换驱动、不换布局：

| | `data-motion="continuous"` | `data-motion="stepped"`（reduce） |
|---|---|---|
| 驱动 | rAF，60Hz | **rAF 根本不开**，由 20Hz 的 `timeupdate` 自己步进 |
| reel | 逐帧 `transform` | 只在**当前 band 变更**时重锚，`transition: none`，让当前 band 的前缘落在 now 线上 |
| 颜色 / 字号过渡 | 上表的 token | `0s`（`harmonyMotion.reduced`） |
| 排空渐变 | 跟随 now | 关闭（band 满填充） |
| now 线跳变的脉冲 | 120ms 淡入淡出 | 瞬时换 class |
| 布局 | — | **逐像素相同** |
| 没有丢掉的 | — | **整个空间布局。** 你依然看得见下一个和弦在逼近——**预期是布局的属性，不是补间的属性** |

两种模式下截图是同一张图。**减动效不是另一个视图。** 它同时是一次真实的省电：
六个 lane 从每秒 360 次样式写降到每秒 6 次。

**为什么必须由 JS 去问，而不是一条媒体查询。** `@media (prefers-reduced-motion: reduce) { transition: none }`
只能杀掉过渡，杀不掉一个由 rAF 驱动的 `transform`；而且这一族元素渲染进调用方的亮 DOM，
`analysisStyle` **导出但从不安装**（`packages/ui/README.md:422`），内联 `cssText` 里带不了 `@media`。
所以每个跑循环的 mount 都要在 JS 里读一次偏好并 `addEventListener('change')` 跟随它——
用户在系统里拨开关时页面必须**当场**变。这正是 `harmonyMotion.reduced` 当初被做成 data 记录的理由：
内联路径够得着它。

> **`light-dark()` 没有运动版的对应物，而且不可能有。** `light-dark()` 之所以成立，是因为
> `color-scheme` 是一个**可继承的 CSS 属性**，媒体查询被搬进了一个值函数能读到的属性里。
> `prefers-reduced-motion` **没有属性镜像**，也没有 `motion-safe()` 值函数。所以只能由 JS 问 `matchMedia`。
> 落点是 `packages/ui/src/internal/motion.ts` 的 `watchReducedMotion(view, onChange)`——
> 内部管线，和 `./dom`、`./lifecycle` 同级，跟着 import 它的模块走，不是新子路径。
> `harmony-style.ts` 保持 data-only：它自己的文件头承诺过「这里不读任何浏览器全局」。

---

## 3. uikit 图元清单

### 3.0 子路径分组决定：新增 **3 个**，不是 8 个

核实结果（`scripts/check-architecture.mjs`）：新增一个 `@webmusic/ui/<name>` 子路径要**同时**改 11 处，其中 4 处是 `compareExactSet` 强等值、1 处是**硬编码计数** `if (publishedUiSubpaths.length !== 18)`（:1048），还有一处要求**至少一个元素静态 import 它**（“30-element UI import closure”）。也就是说「先发 ui 子路径、后接元素」做不到，每个子路径都必须原子落地。（brief A.1.4 把 11 更正为 **13 处、跨 9 个文件**。）

而 `packages/ui/src/stage.ts` 已确立先例：**一个子路径可以承载多个 mount**（`mountStage` / `mountSurfaceSlider` / `mountCanvasStage`）。所以：

| 子路径 | 源模块 | 承载的 mount | 分类 |
|---|---|---|---|
| `@webmusic/ui/pitch` | `packages/ui/src/pitch.ts` | `mountKeyboard`、`mountStaff`、`mountFretboard` | `views-analysis` |
| `@webmusic/ui/harmony` | `packages/ui/src/harmony.ts` | `mountNameplate`、`mountChipStrip`、`mountWheel`、**`mountFlowLane`** | `views-analysis` |
| `@webmusic/ui/workbench` | `packages/ui/src/workbench.ts` | `mountWorkbench` | `views-analysis` |

`views-analysis` 由 4 个变 7 个，**不新增第六个 presenter class**（省掉导航、`UI_PRESENTER_CLASSES`、README 类目的变更）。硬编码计数 18 → 21。

> **live 转向没有增加子路径。** `mountFlowLane` 是第四个住进 `harmony.ts` 的 mount——
> 一个新子路径是 13 处原子登记加一个硬编码计数，代价与收益完全不成比例，而 `stage.ts` 的三 mount 先例就在那儿。
> 计数仍是 **21**，§3.0 的登记清单一处都不动。要动的只有两张**手写**表：
> `packages/ui/test/ssr.test.ts` 的 import 清单与 `stylesheet-option.test.ts` 的 `MOUNTS` 表（brief A.3.12），各加一行。

> 若日后觉得三次登记仍嫌重，可退化为**一个** `@webmusic/ui/harmony` 承载全部八个 mount；代价是文档站只有一页、图元发现性下降。本设计选 3，是「可复用性」与「门禁churn」的折中。

不发布的内部共享模块（`checkInternalSourceReachability` 的「可达即合法」）：

- `packages/ui/src/harmony-style.ts` —— 角色调色板与 token-as-data 的**唯一来源**。
- `packages/ui/src/internal/pitch-geometry.ts` —— 谱表 y 坐标、键盘几何、指板品格几何，纯函数。
- `packages/ui/src/internal/spans.ts` —— **只有写**：`stampSpans()` / `stampIdleStyle()`。
- `packages/ui/src/internal/frame.ts` —— **新增**：每 document 一个的帧循环 `joinFrameLoop()`，以及 `FrameTick` / `FrameClock` / `MotionMode` 三个类型。
- `packages/ui/src/internal/motion.ts` —— **新增**：`watchReducedMotion()`，唯一一处读 `matchMedia` 的地方。

> **`internal/frame.ts` 必须从三条构建入口都可达**（`checkInternalSourceReachability`，`:954-972`），
> 并且 `pitch.ts` / `harmony.ts` / `workbench.ts` 三个子路径各自**以类型形式** re-export
> `FrameTick` / `FrameClock` / `MotionMode`，否则公开签名里会出现一个用户命名不了的类型。
> 三处 re-export 的是**同一个原始绑定**，`packages/ui/src/index.ts` 的三条 `export *` 不会因此冲突。

```ts
// harmony-style.ts —— 八个 mount 对「根音是什么颜色」只有一个答案来源
// （已按实现修订，commit C.2：无 harmonyLiterals，明暗由 §2.4 的 light-dark() 承担）
export type ToneRole = 'root'|'third'|'fifth'|'seventh'|'extension'|'bass'|'other'|'ghost';
// 三个 tone 函数返回的是**整条链**，不是裸 var()：mount 可能画在没有 token 的宿主节点上
export function toneFill(role: ToneRole | undefined): string;   // -> 'var(--wui-degree-root, var(--wm-degree-root, light-dark(#c2410c, #fb923c)))'
export function toneInk(role: ToneRole | undefined): string;
export function toneMark(role: ToneRole | undefined): string;   // -> 'R' | '3' | '5' | '7' | '9' | 'B' | '.'
export function severityFill(severity: Severity | undefined): string;
export function progressionTone(pitchClass: number): string;    // 0…11，越界回绕
export const harmonyTokens: Declarations;                       // --wui-harmony-* / --wui-degree-* / --wui-progression-tone-0..11
export const harmonyDensity: Record<'comfortable'|'compact', Declarations>;
export const harmonyMotion: Record<'full'|'reduced', Declarations>;          // 内联路径也够得着的减动效开关
export const harmonyScheme: Record<'inherit'|'system'|'light'|'dark', Declarations>;  // 只有一条 color-scheme；默认 inherit = 空记录
export function harmonyRootDeclarations(o?: {scheme?; density?; motion?}): Declarations;  // 唯一正确的合成顺序
export const harmonyParts: Record<string, Declarations>;        // 可内联绘制的每部件盒子
export const harmonyValues: Record<string, string>;             // 声明块之外要用的值（SVG stroke 等），只放 paint
export const harmonyRule: (selector: string, ...groups: Declarations[]) => string;
export const harmonyInline: (...groups: Declarations[]) => string;           // 永远以 ';' 结尾
export const harmonySheet: (selector: string) => string;        // 状态选择器跟着根类名走
export const harmonyStyle: string;                              // = harmonySheet('.wui-harmony')
```

`toneMark()` 返回 ASCII（未命名的音是 `.`，不是中点或任何乐谱字形），不触碰乐谱字符禁令。
**改一次调色板，八个图元一起变**——这是「图元多了如何保持视觉统一」的答案。

`harmonyInline()` 的「永远以 `;` 结尾」不是洁癖：`ANALYSIS_ACTIVE_STYLE` 是**拼**在各 renderer 写下的 idle 串后面的，
没有那个分号，浏览器会把接缝读成一条畸形声明，同时吞掉 idle 串的最后一条和高亮的 `background`（见 brief §A.3.15）。

`harmonySheet(selector)` 收选择器而不是写死 `.wui-harmony`，是因为**状态规则必须指向真实存在的根类名**：
`createAnalysisRoot` 盖的是 `.wui-analysis`，一张把 `[data-density]` / `[data-scheme]` 挂在 `.wui-harmony` 上的
`analysisStyle` 会「看起来装上了、其实一条都不匹配」。`token-chain.test.ts` 直接拿 `createAnalysisRoot()` 的
`className` 和 `analysisStyle` 的选择器对拍。

`harmonyRootDeclarations()` 是为了堵一个必然会踩的坑：`harmonyTokens` 内含 comfortable 一档（这样它单独用也完整），
于是 `harmonyInline(harmonyDensity.compact, harmonyTokens)` 会**静默**退回 comfortable。合成顺序只有一个是对的，
所以把它写成函数，别让八个 mount 各自记。

### 3.0.1 分层判据：什么该上台，什么该回后台

> 这一节是 §0 那条判据在图元层的落地，全章服从它。

| 问题 | 归属 | 落点 |
|---|---|---|
| 「有哪些和弦、它们叫什么、一共几段」 | **headless** | `createAnalysisSession` / `useScoreAnalysis` / `headless/workbench.ts` |
| 「现在到哪儿了、下一个还有多远、它是怎么到的」 | **图元** | 本章八个 mount |

推论，三条不可违反的规则：

- **R1 · 内容与位置是两个端口、两种速率。** `snapshot()` 只在域事件时被拉（内容），`now()` / `position()` **每帧**被拉一次（位置）。
  没有任何图元要求调用方以 60fps 重算一份 state——那正是「静态列表 + 移动高亮框」的镜像陷阱。
  仓内先例：`mountCanvasStage` 的 `draw(frame)`（帧率）与 `status()`/`subscribe`（域率）；
  `mountSurfaceSlider` 的 `valueAt`/`commit`（指针率）与 `snapshot()`（域率）。
- **R2 · 有帧循环的只有两个东西**：`mountFlowLane` 的连续平移，和 `mountNameplate` 的逼近度。
  键盘的按下、谱表的进列、指板的滑把、轮盘的旋转**全部是 CSS transition + 一次属性写**，不占帧。
  「什么在动」不等于「什么需要时钟」。
- **R3 · 相位由 kit 推导，不由调用方声明。** 调用方说「现在响着 60、64、67」，kit 与上一帧的集合做差集就知道
  「60 是新来的」。attack / release / past / next 全是**集合成员变化**，不是乐理，所以留在 kit；
  「60 是不是根音」是乐理，所以必须由调用方给。

一句可以贴在 PR 描述里的话：

> **一次性把 `AnalysisResult` 摊平成 DOM，是 `useScoreAnalysis()` 的工作再做一遍，还多花一层 DOM。
> Web Component 拿到这份数据之后该做的唯一一件事，是把它随时间演出来。**

### 3.0.2 时钟：三层，各自只做一件事

```
webscore:timeupdate (20Hz)                 rAF (60Hz)
        |                                        |
        v                                        v
  [元素] clock.sample(...)          [kit] internal/frame.ts 的唯一循环
        |                                        |
        +--> [headless] createTransportClock()  <-- clock.readAt(frameMs)
                   纯算术、DOM-free                （经 mountWorkbench 的 FrameClock）
```

**第 1 层 —— `packages/score/src/analyze/headless/transport-clock.ts`（新增，DOM-free）。**
全部预测住在这里。时间进、时间出，不读任何浏览器全局，所以整套逻辑可以拿整数毫秒测。
它的存在理由是一组量出来的事实：

| 事实 | 出处 | 后果 |
|---|---|---|
| `cursorIntervalMs ?? 50` | `play/headless/score-player.ts:135` | `webscore:timeupdate` 是 **20Hz**，不是每帧 |
| cursor 发射被该间隔节流 | `score-player-scheduler.ts:554-560` | 60Hz 的屏幕**每 3 帧**才拿到一个新数 |
| `pause()` **不发**任何 cursor | `score-player-scheduler.ts:175-189` | **暂停是不可见的**，只是 tick 停了。没有 `webscore:pause` |
| `seek()` 立刻发一个 cursor | `:216-229`（`emitCursor()` 在 `:223`） | seek 是带外通告的，位置不连续 |
| `retune()` 在变速处立刻发一个 cursor | `:455-457` | **速率可以直接读，永远不要用差分估计**——差分分不清变速与 seek |
| `wrapLoop()` 绕过节流发 cursor，`armBoundaryTimer()` 在边界上打一枪 | `:845`、`:922-932` | 循环回卷基本准时（抖动来自定时器，不是 50ms） |
| detail 已经带着 `nominalSeconds` / `transportSeconds` / `transportDurationSeconds` / `progress` | `play/element/simple-score-player.ts:570-587` | 预测器要的东西全在线上了 |
| `bindAnalysisPlayer` 只转发 `detail.seconds` | `analyze/element/internal/player-binding.ts:26-28` | **今天把速率扔掉了。这一处必须改**（§4.3） |

**判读的算术**：64px/quarter、120bpm 时 lane 每秒走 128px，一帧 2.13px，而一个 50ms 的事件是 **6.4px**。
不插值就是「停两帧、第三帧跳 6.4px」，永远如此。这就是**加了滚动之后「静态」长什么样**。

- **coast（滑行）**：一个 expected interval 之内线性外推；之后速度**线性衰减**到 cap（观测间隔的两倍，
  夹在 60–140ms）处归零。于是交接点 C1 连续，暂停后的过冲有界：120bpm / 64px 每 quarter 下 ≤ 3.2px 且在减速，
  读起来是走带在落定，不是一次故障。硬停在 fresh 会在每个迟到 tick 上打嗝；不设上限则会在后台标签页里跑飞。
- **epoch**：任何不连续（seek、循环回卷、stop、scrub）都让 epoch +1。**presenter 在 epoch 变化时吸附，否则滑动**；
  没有它，一次向后 seek 会补间出一段 400px 的滑行，滑过听者根本没听到的材料。
- **EWMA**：观测间隔用 EWMA 跟踪，而不是写死 50——`cursorIntervalMs` 是一个选项，
  借来的外部控制器可以按任意频率 tick，被节流的标签页会把它拉长。一次减法的成本。

**第 2 层 —— 元素。** 把一个 DOM 事件变成一次 `sample()`，并回答 kit 的拉取。**每帧零工作**：
它在 20Hz（事件）和按需（投影）两个节奏上工作。这就是用户要的分层——列清单是数据，演出是组件，
而组件的演出只靠一个被拉取的浮点数。

**第 3 层 —— kit。** 只知道**一根它从未被告知含义的轴上的一个数**。
它绝不听见 seconds / quarters / tempo / player 这些词。

**帧循环只有一个，住在 `internal/frame.ts`，按 document 分组。**

```ts
// packages/ui/src/internal/frame.ts
// 每个 view 一个循环。六个 lane 是一个 rAF 里的六个回调，不是六次 rAF 注册；
// 没有订阅者时循环自己停掉，一个闲置页面一分钱都不花。
export function joinFrameLoop(
  view: (Window & typeof globalThis) | null | undefined,
  draw: (atMs: number) => void,
): () => void;
```

循环强制的五条：

1. **订阅者为 0 → 根本不开 rAF。** 一页停着的工作台不花钱。
2. **离屏的 lane 不动。** 每个 viewport 一个 `IntersectionObserver`；不相交就退出循环，
   重新进入视口时一帧追上——因为位置是 `atMs` 的纯函数。
3. **`document.visibilityState === 'hidden'` 退出循环。** rAF 本身在隐藏标签页已被节流，这条另外覆盖「元素被藏起来」。
4. **自我降频。** 循环自己的回调在最近 60 帧里有 30 帧超过 4ms，就降到隔帧（30Hz）
   并在每个根节点盖上 `data-motion="degraded"`。**看得见、查得到**，好过一次神秘的卡顿。
5. **循环自己绝不碰 DOM。** 它只发 `atMs`，每个 lane 自己决定。这让它可以拿一个假 `view` 测。

被否掉的形状正是两个既有先例：`meter.ts:245-249` 与 `stage.ts:667-674` 各自持有一个私有 rAF。
对一个电平表是对的；一页上六个独立循环就是六次唤醒且没有共享预算。
`mountFlowLane` 是第一个必须协调的 mount，所以调度器跟它一起落地。

**而「每帧唯一的那次读数」由外壳负责**（§3.8）：`mountWorkbench` 订阅一次共享循环，
每帧调**一次** `binding.now()`，把结果存进 `FrameTick.now`；同一帧里插槽图元的 `clock.now()`
叫多少次都返回这一个数。没有它，名牌会预览一个 now 线已经走过的和弦——
这不是理论洁癖，它表现为两个本该咬合的东西之间的抖动。

### 3.1 共享数据类型

```ts
/** 一个可被任何音高面绘制的标记。拼写与角色都是调用方的答案。 */
export interface PitchMark {
  midi: number;
  /** 调用方拼写的音名，例如 'F#4'。kit 从不拼写一个音。 */
  label?: string;
  /** 角色缩写，例如 'R'。颜色之外的第二通道。 */
  mark?: string;
  role?: ToneRole;
  /** 0…1 强调度：力度 / 权重 / 置信度。默认 1。**live 修订**：它同时是 attack 的深度。 */
  weight?: number;
  active?: boolean;
  id?: string;
  /**
   * **新增。** 这个标记从何时起响着，域单位（与该面收到的 `now` 同一把尺）。
   * 给了它，音高面就能画出「响了多久」——衰减、拖影、由亮转暗。
   * 不给，面就只有二值的响/不响，也完全可用。kit 只做减法，不知道这是秒还是四分音符。
   */
  since?: number;
}

/**
 * **新增。** 一帧的读数。字段名对齐既有的 `CanvasStageFrame`。
 * 定义在 `packages/ui/src/internal/frame.ts`，三个子路径各自以**类型**形式 re-export。
 */
export interface FrameTick {
  /** 这一帧的**唯一**域位置。同一帧里被画的每个图元都看见这一个数。 */
  now: number;
  /** 宿主 window 时钟的时间戳（ms）。 */
  time: number;
  /** 距上一帧的 ms；首帧为 0。 */
  delta: number;
  /** false = 这是一次「步进」而非连续帧（减动效档）。 */
  continuous: boolean;
  /**
   * 由调用方在任何不连续处（seek / 循环回卷 / stop / scrub）+1。
   * **变了就吸附，没变就滑。** 没有它，一次向后 seek 会补间出一段没人听过的滑行。
   */
  epoch: number;
}

/** 一个可被共享的帧时钟。外壳持有它，插槽图元收它。 */
export interface FrameClock {
  /** 本帧的域位置。同一帧内多次调用返回同一个数。 */
  now(): number;
  /** 每帧回调；返回退订函数。 */
  subscribe(listener: (tick: FrameTick) => void): () => void;
  readonly running: boolean;
}

/** 每个 live 图元都收这一个动效开关。 */
export type MotionMode =
  | 'auto'        // 默认：读 prefers-reduced-motion，并监听它的变化
  | 'continuous'  // 连续
  | 'stepped'     // 只在域事件时步进一格；位置仍然正确，只是不滑
  | 'none';       // 不跑循环，位置只在 update() 时落一次
```

解算结果写在根节点的 `data-motion` 上：`continuous` / `stepped` / `none` / `degraded`（§2.5.3、§3.0.2 第 4 条）。

### 3.2 `mountKeyboard` —— 从快照变成活体

复用既有 `pianoKeyLayout(startMidi, endMidi, labels?)`（`packages/ui/src/note.ts`），**不重写几何**。`note.ts` 的 `mountNoteSurface` 是**输入**面（指针、QWERTY、`aria-pressed`）；本图元是**只读读数**面。变的是**时间维**。

```ts
export interface KeyboardState {
  low?: number;                                   // 默认 48
  high?: number;                                  // 默认 84
  marks: readonly PitchMark[];
  /** 调内但未响的音级，画成 ghost。用于 key 视图的调式提示。 */
  ghostPitchClasses?: readonly number[];
  labels?: 'none' | 'marked' | 'white' | 'all';   // 默认 'marked'
  /** 八度尺文本，调用方给 —— 'C4' 还是 'C3' 是命名约定，不是布局事实。 */
  octaveLabels?: ReadonlyMap<number, string>;
  /** **新增。** 当前域位置。只用来把 `PitchMark.since` 换算成「响了多久」。 */
  now?: number;
}
export interface KeyboardOptions {
  label?: string;
  motion?: MotionMode;                            // **新增**
  /** **新增。** 松键余音（ms）。默认取 `--wui-harmony-motion-release`；`stepped`/`none` 档为 0。 */
  release?: number;
  /** **新增。** 松开的键留一道正在淡出的角色色拖影。默认 false。 */
  trail?: boolean;
  classNames?; parts?; stylesheet?: boolean; onError?;
}
export interface KeyboardHandle {
  element: HTMLElement;
  board: HTMLElement;
  key(midi: number): HTMLElement | undefined;
  update(): void;
  destroy(): void;
}
export function mountKeyboard(host, binding: {snapshot(): KeyboardState; subscribe?}, options?): KeyboardHandle;
```

DOM：`<div class="wui-pitch-keyboard" role="img" aria-label="Sounding: C4, E4, G4">` → `__board` → 每键 `<div class="wui-pitch-keyboard__key wui-pitch-keyboard__key--white" data-midi data-role data-active data-phase style="left:%;width:%">` + `__label`；下方 `__ruler`（`aria-hidden`）。

**新的 `data-*` 词汇**（与既有的 `data-midi` / `data-role` / `data-active` 并存）：

| 属性 | 值 | 来源 |
|---|---|---|
| `data-phase` | `attack` → `sustain` → `release` | **R3 的集合差集**。新出现的键先落 `attack`，下一帧改 `sustain`，CSS transition 完成「按下去」 |
| `--wui-harmony-age` | `0…1` | `(now − since) / ageSpan`，仅当 `state.now` 与 `mark.since` 都在时写；否则不写这个自定义属性 |

**内部状态（不进公开 state）**：`sounding: Map<midi, {role, weight, since}>`（上一次的集合）、
`releasing: Map<midi, number>`（松开时刻）。余音清扫是**一个** `setTimeout` 扫全表，不是每键一个。

**不占帧**（R2）：按下与松开都是一次 `data-phase` 属性写加一条 transition。

Token：`--wui-harmony-keyboard-height`、`--wui-harmony-keyboard-key-white/black/border/label/radius`（第二层回退到既有 `--wm-note-*`，让调过 `<keyboard-view>` 皮肤的页面免费一致）、`--wui-degree-*`。

ARIA：整块 `role="img"` + 调用方给的整句 label。**不给每个键单独语义**——49 个可聚焦节点是读屏灾难。无键盘交互（被动读数）。

测试要点：`key(midi)` 越界返回 `undefined`；`data-role` / `data-active` 落在正确的 `data-midi` 上；重复 `update()` **按 `data-midi` diff 复用键节点**——这一条在快照时代只是效率问题，**在 live 时代是功能问题**：`replaceChildren` 会每帧打断 transition，整块重建等于永远停在 attack 的第一帧；范围外 mark 被忽略而不抛；`data-phase` 的写入次数 ≤ 集合变化次数（不是每帧一次）。

### 3.3 `mountStaff` —— 固定小节线，列往左走

边界最吃紧的图元。**一句话：kit 画线和形状，调用方说每个形状在第几阶。**

- 五线、加线、符头、连谱号、**升降记号** = kit 的 SVG 几何（`<path>` / `<ellipse>`，源码里没有一个乐谱字符）；
- **谱号** = 调用方传入的字形串（`clefs: {upper, lower}`），kit 只定位。缺省则不画谱号。

> 这条是两份方案的合并点：升降号/符头是可以精确用几何画出来的（原型已验证），而谱号形状复杂、值得让调用方决定用哪套字形；同时它也满足 `checkUiDomainVocabulary` 的 “formatter callback” 要求。

live 之后谱表也吃 D2 的运动模型，只是它的时间是**离散的列**而不是连续的位置：

```ts
export type StaffAccidental = 'sharp' | 'flat' | 'natural' | 'double-sharp' | 'double-flat';

export interface StaffMark extends PitchMark {
  /**
   * 全音阶阶数，C0 = 0，D0 = 1 … B0 = 6，C1 = 7，中央 C(C4) = 28。
   * 必填且由调用方算：音符坐在哪条线上跟**拼写**走 —— F#4 与 Gb4 同键不同线。
   */
  diatonic: number;
  accidental?: StaffAccidental;
  /** 同 column 的 marks 竖直叠成一个和弦。默认 0。 */
  column?: number;
}
export interface StaffState {
  marks: readonly StaffMark[];
  system?: 'grand' | 'treble' | 'bass';      // 默认 'grand'
  clefs?: {upper?: string; lower?: string};  // 调用方字形
  keySignature?: readonly {diatonic: number; accidental: StaffAccidental}[];
  columns?: number;
  activeColumn?: number;
  emptyLabel?: string;
  /**
   * **新增。** 列跟随：`'anchor'` = 让 `activeColumn` 停在固定 x，列从右往左流过它（D2）；
   * `'none'`（默认）= 全部列固定，只有高亮在动（旧行为）。
   */
  follow?: 'anchor' | 'none';
}
/** 纯函数：该阶数在 viewBox 里的 y（半线间为单位）与需要的加线。 */
export function staffPlacement(diatonic: number, system?: 'grand'|'treble'|'bass'):
  {y: number; ledgers: readonly number[]};
export interface StaffOptions {
  /** **新增。** 固定线的位置，0…1。默认 .35。仅 `follow:'anchor'` 时有意义。 */
  anchor?: number;
  motion?: MotionMode;                       // **新增**
  label?: string; classNames?; parts?; stylesheet?: boolean; onError?;
}
export function mountStaff(host, binding, options?): StaffHandle;
```

**几何约定**（`internal/pitch-geometry.ts`，原型已按此实现并验证）：大谱表是一条连续的全音阶梯子，`y = (38 − diatonic) × 半线间`；高音谱五线落在 diatonic 38/36/34/32/30，低音谱落在 26/24/22/20/18，中央 C（28）正好落在两谱表正中并带一条加线。

kit 自己算的（全是几何，不是乐理）：加线、**二度错位**（同 column 内相邻阶的上方符头右移一个符头宽）、**变音记号阶梯排布**（同 column 记号按阶降序向左错开）、viewBox 尺寸。

**kit 还自己推导出一样调用方不用给的东西**（R3）：每个符头拿一个 `data-when`，值域 `past | now | next | far`，由 `column` 与 `activeColumn` 相减得到。样式表据此把未来的列画成 ghost——**这就是「看得见下一个和弦正在过来」在谱表上的形态**，而调用方一个字段都没多给。

**列的推进只有一次属性写**：整条 `__reel` 的 `transform: translate3d(−activeColumn·colWidth + anchor·W, 0, 0)`，配一条 `--wui-harmony-motion-column` 的 transition。**不占帧**（R2）。

**符头入场**：`opacity 120ms`，**且绝对不做位移动画**——机制上的理由见 §2.5.2。入场由 diff 触发，键是 `column:diatonic`。

调用方必须给的（全是乐理）：`diatonic`、`accidental`、`clefs`、`keySignature`、`label`、`role`。

测试要点：`staffPlacement(28)` 给出中央 C 的一条加线，`staffPlacement(42)`（C6）给出 **2** 条上加线 `[40, 42]`——**加线只落在线位上，一线隔一个全音阶步**：高音谱最上一线是 F5（diatonic 38），其上的线位就是 A5（40）与 C6（42），两条封顶。（初稿写的「4 条」是把半线间当成了加线间距，别照着改回去。）缺 `diatonic` 的 mark 跳过并 `onError` 而不抛；`clefs` 缺省时 DOM 里**没有** `<text>` 谱号节点（证明 ui 不自带字形）；`follow:'anchor'` 与 `'none'` 的**符头节点集合与 `data-*` 完全相同**，只有 `__reel` 的 transform 不同；**包内重复一遍门禁**：`packages/ui/test/no-notation-glyphs.test.ts` 扫 `packages/ui/src/**` 断言无乐谱字符。

### 3.4 `mountFretboard` —— 把位会自己滑过去

```ts
export interface FretMark {
  stringIndex: number;    // 0 = 画在最边上的那根弦
  fret: number;           // 0 = 空弦
  role?: ToneRole;
  label?: string;         // 调用方拼写的音名，或角色缩写
  finger?: string;
  active?: boolean;
  since?: number;         // **新增**，同 PitchMark.since
}
export interface FretboardState {
  strings?: number;                     // 默认 6
  /**
   * **修订。** 允许 `'auto'`：窗口起点由 marks 的最小/最大品**算**出来，留一格余量，并滞回一格以免在边界抖。
   * 这是算术不是乐理——「哪一把位好按」仍然是调用方的答案，kit 只是把已经选好的把位框进视野。
   * 换窗口时琴颈**滑**过去（`--wui-harmony-motion-column` 的 transition），不是跳过去：一次 transform 写，不占帧。
   */
  firstFret?: number | 'auto';
  fretCount?: number;                   // 默认 5
  marks: readonly FretMark[];
  muted?: readonly number[];
  stringLabels?: readonly string[];     // 调用方给（调弦是乐理）
  inlays?: readonly number[];
  orientation?: 'horizontal' | 'vertical';
  emptyLabel?: string;
  /** **新增。** 横按：几何，不是乐理——调用方说横杠从哪根弦到哪根弦、在第几品。 */
  barre?: readonly {fret: number; fromString: number; toString: number}[];
  now?: number;                         // **新增**，同 KeyboardState.now
}
export interface FretboardOptions {
  motion?: MotionMode;                  // **新增**
  release?: number;                     // **新增**，同键盘
  label?: string; classNames?; parts?; stylesheet?: boolean; onError?;
}
/** 算术，不是乐理：窗口内所有能发出该 midi 的 (弦, 品)。哪一个手能按，是调用方的答案。 */
export function fretPositionsFor(midi: number, tuning: readonly number[],
  options?: {firstFret?: number; fretCount?: number}): readonly {stringIndex: number; fret: number}[];
export function mountFretboard(host, binding, options?): FretboardHandle;
```

**内部状态**：`placed: Map<'s:f', FretMark>`（上一次的圆点集合）、`window`（`'auto'` 解算后的当前窗口）。
**新的 `data-*`**：圆点上 `data-phase`（`attack|sustain|release`，键是 `stringIndex:fret`）——
指板 live 化的全部内容就是「圆点会长出来、会消失」，而这来自 R3 的差集，不需要新的输入字段。

`×`（U+00D7 拉丁乘号）与 `○` 不在禁用字符范围内，可由 kit 直接绘制。

测试要点：`orientation:'vertical'` 只换 viewBox 与坐标映射，DOM 节点集合与 `data-*` 完全相同（同一份断言跑两遍）；`firstFret > 0` 时不画琴枕、改画首品编号；`muted` 与 `marks` 同弦冲突时 `marks` 赢；`firstFret:'auto'` 在两个相邻窗口边界上来回给 mark 时**不来回换窗口**（滞回）。

### 3.5 `mountNameplate` —— pop 与逼近

这是「popping」四个字最直接的落点，也是 ARIA 约束最紧的一处。

```ts
export interface ChordNameCandidate {
  symbol: string;                 // 'Cmaj7'、'Am7/C'（调用方拼写）
  full?: string;                  // 'C major seventh'
  note?: string;                  // 'inversion' | 'rootless' | 'enharmonic' | 'alias'
  weight?: number;
  /**
   * **新增。** 这次命名的**不透明身份**。变了就 pop，哪怕 `symbol` 一个字符没变。
   * 它解决的是「C → G → C」和「同一个和弦被重新击发」：symbol 相同但事件不同。
   * kit 只做 `!==`，它不知道自己比的是和弦。调用方懒得造 id 就塞一个递增计数器
   * ——`live-trackers.ts:26` 的 `revision` 就是这个惯例。
   */
  key?: string;
}
export interface NameplateState {
  primary?: ChordNameCandidate;
  alternates?: readonly ChordNameCandidate[];
  voicing?: readonly PitchMark[];
  caption?: string;               // 'Imaj7 in C major'
  history?: readonly string[];
  confidence?: number;
  emphasis?: 'hero' | 'display';
  emptyLabel?: string;
  /**
   * **新增。** 下一个即将到来的命名，画成 ghost 预览。
   * D2 的「能看见下一个和弦正在靠近」在名牌上的形态。调用方给字符串，kit 只排版。
   */
  next?: ChordNameCandidate;
}
export interface NameplateBinding {
  snapshot(): NameplateState;
  subscribe?(notify: () => void): () => void;
  /** 选了另一个读法。省略则备选渲染为纯文本，不给「可聚焦但无行为」的按钮。 */
  selectAlternate?(index: number, candidate: ChordNameCandidate): void;
  /**
   * **新增（R1 的帧端口）。** 0…1，`next` 有多近；1 = 就在眼前。每帧被拉一次。
   * 省略就没有帧循环，`next` 只是个静态 ghost。
   * 「多近」是域知识（取决于速度、拍号、你认为多远算近），所以它是一个回调返回的数，
   * 不是 kit 从 lane 数据里推的——名牌与 lane 是两个 mount，让名牌去读 lane 的数据
   * 等于让 kit 推断和弦的先后关系。
   */
  approach?(tick: FrameTick): number | undefined;
}
export interface NameplateHandle {
  element: HTMLElement;
  /** 主符号节点。**身份终身不变**，暴露它是为了让调用方能确认这一点（测试用）。 */
  readonly symbol: HTMLElement;
  /** 手动触发一次 pop。给 kit 看不见的原因用——比如用户点了一个备选命名。 */
  pop(intent?: 'change' | 'stress'): void;
  /** 只重画位置（逼近度），不重读 snapshot。对齐 `CanvasStageHandle.redraw`。 */
  tick(): void;
  update(): void;
  destroy(): void;
}
export interface NameplateOptions {
  motion?: MotionMode;
  /** pop 时长（ms）。默认 180，`stepped`/`none` 档为 0。见下方「一个时长写两遍」。 */
  popDuration?: number;
  /** 该 mount 自跑帧循环；给了 `clock` 就强制 false。默认 = `binding.approach` 是否存在。 */
  animate?: boolean;
  /** **外壳的钟**。给了它，本 mount 不开自己的循环（§3.8）。 */
  clock?: FrameClock;
  label?: string; classNames?; parts?; stylesheet?: boolean; onError?;
}
```

**换符号时调用方什么都不用做**：`update()` 里 kit 把 `primary.key ?? primary.symbol` 与自己正显示的那个比一次，
不等就 pop。pop 是数据变化的**后果**，不是一条额外的命令——「和弦变了」这件事调用方已经用数据说过一遍，
再让它说第二遍就是在两个地方各存一份真相。`handle.pop()` 是逃生口。

**pop 不能是「换节点」，因为主符号节点的身份必须活过 `update()`**（换节点会让读屏漏播）。DOM：

```
.wui-harmony-nameplate                              role="group"
  __live      role="status" aria-live="polite" aria-atomic="true"
    __symbol  ← 终身同一个节点，update() 只写 textContent
    __full    ← 视觉隐藏的全称，同样终身同一个节点
  __next      aria-hidden="true"     ← ghost 预览，**不进** live region
  __caption
  __alternates  <ul> → 真 <button>（仅当 selectAlternate 存在）
  __history   aria-hidden="true"     ← **不进** live region（每次换和弦读两遍）
```

- `__symbol` 在 `full` 存在时挂 `aria-hidden="true"`，让语音只念全称一遍；`full` 缺席时它自己发声。
  `aria-atomic="true"` 保证这一对被当成一句念。备选是真 `<button>`，Tab 可达。
- **pop 的实现是 Web Animations API**：`symbol.animate(keyframes, popDuration)`。理由是排除法——
  ① 换节点被 ARIA 否掉；② 加/去 class 在同一个节点上不会重启一个已经跑过的 CSS animation，要靠强制回流那种把戏；
  ③ `@keyframes` 进不了内联路径，而 `stylesheet-option.test.ts` 要求每个 mount 在 `stylesheet:false` 下也能用。
  WAAPI 三条全过，每次调用返回一个新 `Animation`，重触发是天然的，`destroy()` 里 `cancel()` 干净。
- **必须特性检测** `typeof symbol.animate === 'function'`：jsdom 没有它，`ssr.test.ts` 会先撞上。没有就静默不 pop。
- **keyframes 只许写 `opacity`。** 主符号是用户唯一真的在读的那行字，一个会跳会缩的字读不了；
  位移与缩放的 pop 归 now 线和 band（§0.3 第 1、2 条）。pop 不动可访问性树，也不动布局。
- `next` 的逼近度写成根节点上的一个自定义属性 `--wui-harmony-approach: 0…1`，由 `tick()` 每帧写一次。
  **一次自定义属性写**，不是一堆样式写。

**一个时长写两遍（诚实标注）。** WAAPI 收数字，收不了 `var()`。所以 pop 时长同时存在于
`--wui-harmony-motion-pop`（管样式表那半）和 `popDuration` 的默认值（管 WAAPI 那半）。
这是全章唯一一处，**用一条测试钉住**：`harmonyMotion.full['--wui-harmony-motion-pop']` 解析出来的毫秒数 === `DEFAULT_POP_MS`。

### 3.6 `mountFlowLane` —— 传送带，六个舞台的同一台机器

> **本节取代旧 §3.6 的三种静态量度。** `mountChipStrip` 的 `'flow' | 'ribbon' | 'stack'`
> 是按「把结果排出来」设计的规格，在固定 now 线下是错的。
> **`mountChipStrip` 本身保留**，见 §3.6.6。

#### 3.6.1 几何与运动

```
viewport 宽 W ── now 线固定在 anchor·W（默认 .33：右侧 67% 是未来，这就是 D2 的全部理由）
x(u) = (u − now) · pxPerUnit + anchor·W        u = lane 轴上的位置（名义秒，§0.5 第 5 条）
reel.transform = translate3d(anchor·W − now·pxPerUnit, 0, 0)
```

**每帧只有一个节点被写 `transform`，就是 `__reel`。** 分两层，这是整个 lane 设计的地基：

- **item 的盒子**：`left: X%` / `width: Y%`，X/Y 是 item 自己的时间跨度占 `axis.span` 的比例。
  它是 **item 自身字段的纯函数**——与 `now` 无关，与视口宽度无关。只在内容变化时写一次。
- **reel 的宽度**：`axis.span` 的时长 × `pxPerUnit`，一次样式写。窗口变了、容器 resize 了、密度切了，
  只改这一个数，所有 item 的百分比自动跟着走（`mountTimeline` 的 `positionPercent` 就是这个惯例）。
- **每帧唯一变化的东西**：`reel.style.transform`。一次，合成器友好。

> **不变式（不是性能偏好，是正确性）**
>
> **一个 item 节点的内联样式，是它自己字段的纯函数，永远不是 `now` 的函数。**
>
> 因为 `createAnalysisPlayhead` 会用 `data-webscore-idle-style` **整条覆写** `style.cssText`
> （`analysis.ts:150-159`）。任何逐帧写在 item 上的内联样式，都会在它抵达 now 线的那一刻被抹掉——
> 而抵达 now 线的那一个，恰好是唯一重要的那一个。

`pxPerUnit` 由 `--wui-harmony-flow-scale` 定：comfortable `44px`/quarter 等价刻度、compact `32px`。
**不做流体缩放**——和谱表、指板同理，像素要稳。

#### 3.6.2 三个区，与「排空」

lane 只在**穿越发生时**改 band 的 `data-zone`，不逐帧改：

| `data-zone` | 条件 | 画法 |
|---|---|---|
| `ahead` | `now < start` | tone 18% 填充，主标签 body 字号，无描边 |
| `now` | `start ≤ now < end` | tone 100%，accent 描边（全 lane 唯一）——**且只填到 now 线为止**，线右侧是同色 40% 的轮廓 |
| `wake` | `end ≤ now` | tone 12%，标签降到 micro 字号 |

第三行那半句是这台机器里最便宜也最诚实的一个活物：**当前 band 的填充随播放一格格排空**。
线右边那段是你还没听到的时间，把它画成已经发生过的实心色是撒谎。
实现是 reel 上一个把停止点钉在 now 线的 `linear-gradient`，零额外节点、零额外动画。

#### 3.6.3 pop：一次「落定」，不是一次闪烁

band 的前缘触到 now 线的那一刻，`--wui-harmony-motion-chip`（120ms `ease-out`）内同时发生四件事，
同时**屏幕上没有任何别的东西移动**：

1. band 填充 tone 18% → 100%（**颜色阶跃，不是尺寸阶跃**）；
2. 主标签从 body 淡换到 display 字号——但这个大字是**钉在 now 线上的**，不跟着材料走。
   会滚动又同时在变大的文字读不了，钉住它才没有拖影；
3. now 线自身 1px → 2px → 1px，90ms。**全设计里唯一的一次「闪」，而且闪的是线，不是材料**；
4. 四个坞位在 `--wui-harmony-motion-tone`（90ms linear）内换角色色。
   **真正被感觉到的 pop 在这里**：键盘上六个点同时换色，比舞台上任何动画都响。

#### 3.6.4 与 `createAnalysisPlayhead` 的契约（硬约束）

lane 的每个 band 仍由 `internal/spans.ts` 的 `stampSpans()` 写下
`data-start-quarters` / `data-end-quarters` / `data-spans` / `data-webscore-idle-style`，
`element/internal/playhead.ts` 一行不改，白名单（`check-architecture.mjs:1269-1285`）继续成立。
五条随之而来的规矩：

1. **逐帧状态绝不写进 band 的内联样式**（§3.6.1 的不变式）。运动只住在 `__reel` 一个节点上。
2. **`data-webscore-idle-style` 必须与刚写下的 `cssText` 逐字节相同，且每次几何改变都要重写一遍。**
   `stampIdleStyle` **最后调用**，读 `node.style.cssText` 原样存下，末尾没有 `;` 就补一个
   （brief A.3.15 的 bug 类别）。既有渲染器盖的是一个**共享的、无几何**的 idle 串，安全是运气；
   带 `left`/`width` 的 band 不重写就会在第一次取消高亮时塌回 `left:0`。
3. **`createAnalysisPlayhead` 是任何带 `data-start-quarters` 的节点上「活动态」的唯一所有者。**
   `mountFlowLane` 只画几何与色调，**绝不加 active class、绝不写 `aria-current`**。
   冗余是真的（kit 从几何上就知道哪个 band 在线下），但它值这个代价：
   一次 20Hz 的、对 ≤64 个 band 的 `querySelectorAll`，**比今天对 900 个节点的那次更便宜**。
4. 🔴 **viewport 必须 `overflow: hidden; overflow: clip;`**（两条都写，老引擎取第一条，transform 照样成立）。
   理由：`overflow: hidden` 的盒子在编程意义上**是**滚动容器，`createAnalysisPlayhead` 默认
   `scroll !== false` 会对新激活的节点调 `scrollIntoView`，把 reel 相对视口永久推歪、anchor 报废。
   `overflow: clip` 根本不产生滚动盒，`scrollIntoView` 在里面是空操作。
   **第二道保险**：`createPlayheadHighlighter` 新增 `{scroll?: boolean}`，工作台传 `false`；
   **默认不变**，因为 `packages/score/test/analyze/playhead.test.ts:61,66,69` 逐字节钉着滚动次数。
   另加一条：viewport 监听 `scroll` 事件，一旦触发就把 `scrollLeft`/`scrollTop` 归零——
   只在真的被滚了时才有开销，不是每帧读一次（读 `scrollLeft` 会强制回流）。
5. **永不摘掉离屏的 item 节点**（§0.5 第 6 条）。离屏成本用 `content-visibility: auto` +
   `contain-intrinsic-size` 解决。`will-change: transform` 只给 `__reel` 一个节点，
   **绝不给 band**——300 个被提升的 band 是一次图层树爆炸。画区由 viewport 的 `contain: layout paint` 兜住。
   **超过 ~2000 个 item 时正确的做法是在 headless 侧合并数据**，那正是用户这次的原话所指的地方。

**横向跑飞是一个诊断，不是一个 bug。** 被 `scrollIntoView` 的永远是「跨度包含 `now`」的那个 item，
也就是恰好停在 anchor 上的那个，天然在视野里。**如果页面开始横向滚动，说明 lane 的轴和
`stampStart/stampEnd` 不是同一把尺**——页面会当场用横滚告诉你。

#### 3.6.5 接口

```ts
// packages/ui/src/harmony.ts —— 域中立：lane 不认识拍子、不认识和弦、不认识声部
export interface FlowBand {
  id: string;
  /** **lane 轴**上的位置（六视图里是名义秒）。lane 只比较它们。 */
  start: number; end: number;
  /**
   * **打点用的位置**，也就是 `data-start-quarters` / `data-end-quarters` 收到的数。
   * 缺省 = `start`/`end`。轴是秒而打点是 quarters，两把尺必须能分开表达——
   * 见 §0.5 第 5 条。`quarters` 这个词对 kit 是**不透明字节**。
   */
  stampStart?: number; stampEnd?: number;
  /** 同一个 item 的多次出现（动机）。给了它就**只**写 `data-spans`，不写 start/end 对。 */
  spans?: readonly {start: number; end: number}[];
  track?: number;                                    // 0 基行号，默认 0
  primary?: string;                                  // 上线时钉在线上的大字
  secondary?: string;
  trailing?: string;
  /** 纯几何的一段 SVG path（轮廓 sparkline）。点由 score 给，kit 只放进 viewBox。 */
  glyph?: string;
  /** band 内的归一化轮廓，纯几何（声部折线）。 */
  points?: readonly {at: number; y: number}[];
  /** 三个正交的颜色通道，画三样不同的东西，所以不存在优先级问题： */
  tone?: number;        // 0…11 → --wui-progression-tone-<n>，画**块的填充**
  role?: ToneRole;      // → --wui-degree-*，画 band 左侧的**角色条**与 toneMark()
  severity?: Severity;  // → severityFill()，画一颗**圆点**
  weight?: number;                                   // 0…1 → band 高度占比
  group?: string;                                    // 同 group 的兄弟一起亮（动机复现）
  disabled?: boolean;
}
export interface FlowTrack   {id: string; label?: string; sublabel?: string; weight?: number; muted?: boolean}
export interface FlowFlag    {id: string; at: number; track?: number; severity?: Severity; label?: string}
export interface FlowBracket {id: string; start: number; end: number; from: number; to: number; severity?: Severity; label?: string}

export interface FlowLaneState {
  bands: readonly FlowBand[];
  /** 多条轨共享**一根** now 线、**一个** reel、**一个** anchor：共享轴是结构上被强制的，不靠纪律维持。 */
  tracks?: readonly FlowTrack[];
  flags?: readonly FlowFlag[];
  brackets?: readonly FlowBracket[];                 // 跨 track 连接（声部问题）
  ruler?: readonly {at: number; label: string; major?: boolean}[];
  span?: {start: number; end: number};               // 材料量程，reel 宽度与 scrub 都夹在这里
  /** 当前域位置。`binding.position()` 在时，这里的值只是首帧的种子。 */
  now: number;
  /** 视野时长（lane 单位）。它是「缩放」——放进 state 是因为调用方可能给用户一个缩放控件。 */
  window?: number;
  playing?: boolean;
  future?: boolean;                                  // false ⇒ 右侧画成空场（live-chord）
  pinned?: {primary?: string; secondary?: string; caption?: string};
  focusGroup?: string;                               // 该 group 的所有 band 提亮
  emptyLabel?: string;
  disabled?: boolean;
}

export interface FlowLaneBinding {
  /** 内容。域事件时被拉，**不是每帧**。 */
  snapshot(): FlowLaneState;
  /**
   * 位置。**每帧**被拉一次。给了它，本 mount 就是活的；不给，位置只来自 `state.now`。
   * 收 `FrameTick` 是为了让调用方能在稀疏的 timeupdate 之间自己插值——插值是域知识
   * （取决于是否在播、速率多少、有没有 seek），所以是调用方返回一个数，不是 kit 猜。
   */
  position?(tick: FrameTick): number;
  /** `phase` 让调用方能节流一场 seek 风暴：拖拽时预览，松手时提交。 */
  seek?(position: number, phase: 'drag' | 'commit'): Promise<void> | void;
  selectBand?(id: string, band: FlowBand, options: {additive: boolean}): Promise<void> | void;
  focusBand?(id: string | undefined): void;
  subscribe?(notify: () => void): () => void;
}

export interface FlowLaneOptions {
  label?: string;
  /** now 线的位置，0…1。默认 **.33**：身后 33%、身前 67%，因为 D2 要的是预期。 */
  anchor?: number;
  /** px / lane 单位；默认取 `--wui-harmony-flow-scale`。 */
  scale?: number;
  motion?: MotionMode;                               // 默认 'auto'
  /** 自跑帧循环。默认 = `binding.position` 是否存在；给了 `clock` 则强制 false。 */
  animate?: boolean;
  /** 外壳的钟（§3.8）。给了它，本 mount 不开自己的循环。 */
  clock?: FrameClock;
  /**
   * 是否写 `data-start-quarters` / `data-spans` 跨度契约。默认 **true**。
   * 只在「本 lane 的打点单位与该 root 上 playhead 被喂的单位不一致」时关掉。
   */
  spans?: boolean;
  keyboardStep?: number;   // 默认 1
  keyboardPage?: number;   // 默认 4
  classNames?; parts?; stylesheet?: boolean; onError?;
}

export interface FlowLaneHandle {
  element: HTMLElement;
  readonly viewport: HTMLElement;
  readonly reel: HTMLElement;
  readonly nowLine: HTMLElement;
  /** 视觉隐藏的语义孪生体（§3.6.7）。 */
  readonly index: HTMLOListElement;
  track(id: string): HTMLElement | undefined;
  band(id: string): HTMLElement | undefined;
  /** 只重排位置，不重读 snapshot。对齐 `CanvasStageHandle.redraw`。 */
  tick(): void;
  /** 重读 snapshot，复用/重建 band 节点。**永远不由帧循环调用。** */
  update(): void;
  destroy(): void;
}
export function mountFlowLane(host, binding: FlowLaneBinding, options?: FlowLaneOptions): FlowLaneHandle;
```

根类名 `.wui-harmony-flow`，子部件 `__viewport` / `__reel` / `__band` / `__track` / `__gutter` /
`__now` / `__tick` / `__flag` / `__bracket` / `__index`。
**内部滚动层叫 `__reel`，不叫 `track`**——`wui-track` 在那 43 个被占名字里，
而 `check-docs.mjs:611-637` 连**注释**里的 `wui-…` 都要扫（brief A.3.1）。

新 token：`--wui-harmony-flow-scale`、`--wui-harmony-flow-height`（viewport，96 / 72px）、
`--wui-harmony-lane-height`（一条 track，48 / 36px）、`--wui-harmony-flow-now`（now 线颜色，链到 `--wui-harmony-accent`）、
以及 §2.5.2 的五条 motion token。**元素层不许 `setProperty('--wm-…')`（brief A.3.4）**——
`scale`、`density`、`scheme` 全部走 mount options 与 `data-*`。

`harmony.ts` **不许 import `pitch.ts`**（`checkInternalCycles`，`:974-1000`）。所以 `voice-leading` 的声部轮廓由 lane 用 `FlowBand.points` 的归一化几何画，不借 `mountStaff`。
**也不要复用 `mountSurfaceSlider` 去拿 seek 语义**：`harmony.ts → stage.ts` 不构成环，
但它会把 `mountSurfaceSlider` 的 `WeakMap` 拖进 harmony 的 tsup 分块；一旦分出两份副本，
`claimHost` 的单宿主认领会静默失效——和 §7.1 把 `createAnalysisPlayhead` 钉在 `analysis.ts` 是同一个机关。

#### 3.6.6 交互与无障碍（六个视图共享）

| 操作 | 行为 | 事件 |
|---|---|---|
| 横向拖 reel | 材料在固定线下滑动（**永远不拖那条线**） | 拖拽中 `seek(p,'drag')`（节流 ≥120ms），松手 `seek(p,'commit')` |
| 触控板横向滚 | 同上 | 同上 |
| `⌘/Ctrl` + 滚轮 | `scale` 缩放 0.5×–4× | 无 |
| 单击 band | seek 到该 band 起点 | `webscore:seek` |
| 悬停 band | 显示 `secondary` 行，不 seek | 无 |
| `←` / `→` | ±1 拍 | `webscore:seek` |
| `⇧←` / `⇧→` | ±1 小节 | `webscore:seek` |
| `[` / `]` | **上一个 / 下一个 band 边界**（按和声走，不按时间走——这是列表给不了的导航） | `webscore:seek` |
| `↑` / `↓` | 跳到相邻 track 上时间最近的那个 band | 无 |
| `Home` / `End` | 曲首 / 曲尾 | `webscore:seek` |

`↑`/`↓` 是共享时间轴白送的可访问性：「这个和弦下面的级数是什么」= 按一下 `↓`。

lane 是**一个** tab stop，`role="slider"` + `aria-valuenow`（打点单位）+ `aria-valuetext`
（`"bar 4, beat 1 — G7"`），沿用 `mountTimeline` 的 seek handle 先例；band 在语义孪生体里是
`role="option"`，当前那个挂 `aria-current="true"`。没有 `selectBand` 时 band **不是** `<button>`，
不制造「可聚焦但无行为」的节点（沿用 §3.5 的既有规矩）。

**scrub 的两条纪律**（元素侧，见 §4.3）：拖拽期间 `clock.hold()` 夺取本地权威，
否则 player 20Hz 的回声会跟手指打架 250ms、lane 橡皮筋；且拖拽必须节流，
因为每一次 seek 都**暂停并重启**走带（`score-player-scheduler.ts:216-229`）。

**不新增任何事件。** §6 的四个（`chordchange` / `viewchange` / `chordpick` / `seek`）够用；
开关行、缩放、pin 全部走属性回写或视图内状态。新事件要动 `params/score-analyze.ts`、文档表和 `check-docs`，代价不成比例。

#### 3.6.7 语义孪生体，以及它救下的一条已钉死的测试

滚动画布必须有一份不滚动的语义体，同 §3.7 给轮盘的做法：`FlowLaneHandle.index` 是一个视觉隐藏
（clip，**不是 `display:none`**）的 `<ol>`，每 `<li>` 一条 band：`primary · secondary · 起止小节`，
当前 band 带 `aria-current="true"`。这既是读屏通道，也是**没有 CSS 时这个视图仍然可读**的保证（SSR 路径靠它）。

它顺带解掉一颗地雷。`packages/score/test/analyze/elements.test.ts:296-299` 断言 `chords` 视图下
**`<ol>` 是分析根节点的直接子节点且有子元素**。工作台外壳一进来，lane 就在 `.wui-workbench` 深处，这条会红。
**解法：`mountWorkbench` 增一个 `index` 插槽**（§3.8），把当前视图的语义 `<ol>` 渲染成**它自己宿主的直接子节点、
与工作台框架同级**。于是分析根的 children = `[<ol>, .wui-workbench]`，`find(OL)` 照样命中，
而 `host.children.length === 1`（`:339`）也照样成立。**这在语义上本来就更对——这份索引属于视图，不属于舞台。**
测试逐字节不动。

（备选方案是改那条断言。不推荐：它是本轮唯一一条真正在保护「这个视图有结构化输出」的结构断言。）

#### 3.6.8 `mountChipStrip` 保留，它有自己的活干

`mountChipStrip` 原样保留，服务**没有时间轴**的读数——按 §0 的判据，没有时间轴的东西不该假装自己在演出：

- `key` 视图的调候选排行（`layout:'stack'`，`meter` 驱动条）：它确实是一张榜单；
- `<analysis-histogram>` 的双轨条（§5.9）：`ChipItem` 因此新增一个 `meterGhost?: number`
  ——整曲答案画成条后面的幽灵轮廓，已听到的部分填在前面。**一份 DOM，两条轨**；
- `chrome:'bare'` 的兼容卡片（§6.1）。

```ts
export interface ChipItem {
  id: string;
  start: number; end: number;                       // 域中立位置，strip 只比较它们
  primary: string;
  secondary?: string;
  roman?: string;
  trailing?: string;
  meter?: number;                                   // 0…1，比例条
  meterGhost?: number;                              // **新增**，0…1，条后面的幽灵轮廓
  occurrences?: readonly number[];
  spans?: readonly {start: number; end: number}[];
  tone?: number;
  severity?: 'info' | 'warning' | 'error';
}
export interface ChipStripState {
  items: readonly ChipItem[];
  layout?: 'flow' | 'ribbon' | 'stack';             // 默认 'flow'
  span?: {start: number; end: number};
  ruler?: readonly {at: number; label: string}[];
  emptyLabel?: string;
}
```

它与 `mountFlowLane` **只共享皮肤（`harmony-style.ts`）与打点（`internal/spans.ts`），不共享实现**。
把静态 `<ol>` 做成活体 lane 的一个退化模式，是在第一份实现里藏第二份实现——理由见 §0.5 第 2 条。

### 3.7 `mountWheel` —— 五度圈 / 径向权重盘

```ts
export interface WheelSegment {id: string; label: string; weight?: number; active?: boolean}
export interface WheelState {
  /** 外环，**按给定顺序**顺时针画。五度圈的顺序是调用方的答案，kit 只把圆等分。 */
  outer: readonly WheelSegment[];
  inner?: readonly WheelSegment[];
  centre?: {primary: string; secondary?: string};
  /**
   * **新增。指针 / 扇面。**
   * `at` 是**段 id**，或者**分数下标**（2.5 = 第 2 段与第 3 段正中间）。
   * kit 把下标换算成角度；**调用方永远不写一个度数**——那才是域中立的写法。
   */
  needle?: {
    at: string | number;
    ring?: 'outer' | 'inner';                       // 默认 'outer'
    /**
     * 以段为单位的张角。0（默认）= 一根发丝；>0 = 一个楔形。
     * 这是「置信度 40%」唯一诚实的画法——不确定就画得胖一点，而不是画一根假装很确定的针。
     */
    spread?: number;
    label?: string;                                 // 调用方给的整句 aria 文本
  };
  /** **新增。** 近期指针位置，旧→新：彗尾。 */
  trail?: readonly {at: string | number; weight?: number}[];
}
```

**必须在 kit 里加的那个内部状态：`unwrappedAngle`。**
指针从第 11 段走到第 0 段，必须转 **+1 段**，不是 **−11 段**。所以 mount 保留一个累计的未卷绕角度：
`unwrapped += shortestDelta(previous, next)`，写进 `transform: rotate(${unwrapped}deg)`。
这是算术，但它是那种忘了就会得到一个「沿着圈倒着甩回去」的轮盘的算术，所以点名。

**不占帧**（R2）：圈的旋转与扇面都是一次 transform / width 写 + 一条 `--wui-harmony-motion-turn` 的 transition。
减动效档下 transition 归零，指针**跳**过去——位置仍然正确。

ARIA：SVG `aria-hidden`，语义在一份视觉隐藏的 `<ol>` 孪生体里（每项带百分比与 current 标记）。
**live 化带来的后果**：中心读数现在是会变的，所以它要进一个 `role="status" aria-live="polite"` 区域，
并且遵守 §3.5 那条同样的规矩——**中心文本节点身份终身不变，只写 `textContent`**；
指针指向的那一段在孪生列表里挂 `aria-current="true"`。

测试：给 5 段也能画（不假设 12）；隐藏列表与 `outer`+`inner` 逐项对应；
从第 11 段走到第 0 段时 `rotate` 的值**增加**而不是减少（unwrap）。空态仍画 12 个空扇区——形状先立住。

### 3.8 `mountWorkbench` —— 外壳持有那一帧的读数

```ts
export interface WorkbenchView {id: string; label: string; description?: string; docks?: readonly string[]}
export interface WorkbenchDock {id: string; label: string; placement?: 'rail' | 'strip'; toggleable?: boolean}
export interface WorkbenchState {
  views: readonly WorkbenchView[];
  activeViewId: string;
  docks: readonly WorkbenchDock[];
  dockVisibility?: Readonly<Record<string, boolean>>;
  title?: string; subtitle?: string;
  density?: 'comfortable' | 'compact';
  scheme?: 'light' | 'dark';
  /** **修订**：phase 现在**闸住时钟**（见下）。 */
  phase?: 'idle' | 'listening' | 'playing' | 'empty' | 'error';
  status?: {message?: string; detail?: string};
}
export interface WorkbenchBinding {
  snapshot(): WorkbenchState;
  /** **新增。** 这一帧的**唯一**域位置。省略 = 外壳不跑帧循环。 */
  now?(frame: {time: number; delta: number}): number;
  /** **新增。** 不连续计数器，原样进 `FrameTick.epoch`。 */
  epoch?(): number;
  activateView?(id: string): void;
  toggleDock?(id: string, next: boolean): void;
  subscribe?(notify: () => void): () => void;
}
export interface WorkbenchHandle {
  element: HTMLElement;
  readonly stage: HTMLElement;                 // 调用方往这里 mount 自己的图元
  dock(id: string): HTMLElement | undefined;   // 隐藏或未知 → undefined
  /** **新增。** 当前视图的语义 `<ol>`，渲染成**宿主的直接子节点**，与工作台框架同级（§3.6.7）。 */
  readonly index: HTMLElement;
  readonly statusMessage: HTMLElement;
  /** **新增。** 传给每个槽位图元的那一个钟。 */
  readonly clock: FrameClock;
  /** **新增。** 强制走一帧。**测试用的确定性缝**——不必依赖 jsdom 的 rAF。 */
  tick(): void;
  update(): void;
  destroy(): void;
}
export interface WorkbenchOptions {
  /** 'full'（默认）= header + rail + strip + status；'bare' = 只有 stage，无 chrome。 */
  chrome?: 'full' | 'bare';
  motion?: MotionMode;                         // **新增**，默认 'auto'
  label?: string; classNames?; parts?; stylesheet?: boolean; onError?;
}
```

调用方的接线（score 侧，`element/internal/recipes.ts` 之下）：

```ts
const shell = mountWorkbench(host, binding, {chrome: 'full'});
const lane  = mountFlowLane(shell.stage, laneBinding, {clock: shell.clock});
const plate = mountNameplate(shell.dock('nameplate')!, plateBinding, {clock: shell.clock});
```

**外壳持钟的具体职责**：

- **一帧一次读数。** 每帧调**一次** `binding.now()` / `binding.epoch()`，结果存进 `FrameTick`；
  同一帧里 `clock.now()` 被叫多少次都返回这一个数。**共享轴只有在共享读数时才真的共享**——
  否则名牌会预览一个 now 线已经走过的和弦。
- **闸门。** `phase` 不是 `playing` 也不是 `listening` 时**停钟**——一个 idle 的工作台在后台烧一个 rAF 是真 bug。
  `document.hidden` 时也停（`internal/frame.ts` 已经做了一遍，这是双保险）。
- **减动效 = 不跑循环。** `motion` 解算为 `stepped` 时外壳**根本不开帧循环**，
  改为在每次 `subscribe` 通知时发一个 `continuous: false` 的 tick。位置照样正确，只是一格一格地走，
  而且不耗电。这比「跑循环但把时长设成 0」诚实。
- **`clock.subscribe` 的 tick 只调 `tick()`，绝不调 `update()`。**
  「`update()` 幂等且不重建 slot 节点」这条测试在 live 之后有了第二重含义：
  一个每帧被调用的 `update()` 会每帧静默卸载一次所有子图元。**两条路径必须彻底分开。**
- `motion === 'auto'` 时用 `internal/motion.ts` 的 `watchReducedMotion` 监听 `matchMedia` 的 `change`，
  把结果同时 ① 刷 `harmonyMotion.reduced` 到根节点、② 写进 `data-motion`、③ 传进 `FrameTick.continuous`。
- 状态条 `listening` 的 1.6s 呼吸点是一条 CSS animation，**不走钟**。

**反过来，每个图元仍然必须能单独活**（文档站上一个孤零零的 `mountFlowLane` demo）。
规则是：**图元总是能自跑（`animate` + `binding.position()`），但给了 `clock` 就一定让位。**
这也是「循环住在 `internal/frame.ts` 而不是住在外壳里」的理由——`pitch.ts` 与 `harmony.ts`
互相不许 import，一个没有外壳的图元也必须够得着那个循环。

ARIA / 键盘：tablist **手动激活**（`←/→` 只移焦点，`Enter`/`Space` 才切换——自动激活会在快速扫过时触发三次分析投影）；roving tabindex；`Home`/`End` 跳首尾；切换后焦点**不**自动移入 tabpanel。坞位开关 `role="switch"`。状态条 message 是 `role="status" aria-live="polite"`，detail **不进** live region（每 60ms 变一次会淹没读屏）。

`update()` 必须**幂等且不重建 slot 节点**——否则挂在坞位里的子 presenter 被静默卸载。这是外壳最重要的一条测试。

---

## 4. 域数据契约：谁算什么

| 图元 | ui 只做（布局/几何） | score 必须给（乐理/拼写） | 落点 |
|---|---|---|---|
| `mountKeyboard` | 键的 left/width、黑白、角色上色、按下态、**attack/release 差集** | 哪个 MIDI 是 root/third/…、键面印什么字、`since` | `core/chord-spelling.ts` |
| `mountStaff` | 线、加线、二度错位、记号阶梯、符头几何、**`data-when` 差集** | `diatonic`（跟拼写走）、`accidental`、谱号字形、调号、`activeColumn` | `core/staff-placement.ts` |
| `mountFretboard` | 品格/弦线几何、圆点定位、`fretPositionsFor` 的算术、窗口滞回 | 选**哪一个**把位（可弹性）、弦名、圆点里的字、横按范围 | `core/fretboard-voicing.ts` |
| `mountNameplate` | 排版、live region、备选交互、WAAPI pop | 全部符号、全称、`note`、`caption`、`confidence`、`next`、**逼近度那个数** | `core/chord-spelling.ts` + 既有 `core/roman.ts` |
| `mountFlowLane` | 时间→百分比、`data-spans` 打点、tone→token、三区穿越、scrub 算术 | 文本、跨度数值（**秒**）、打点数值（**quarters**）、tone 槽位、ruler 标签、**每帧那一个位置** | `headless/workbench.ts` + `headless/transport-clock.ts` |
| `mountChipStrip` | 同上的静态子集，`meter` / `meterGhost` 的比例条 | 同上，减去时间轴 | `headless/workbench.ts` |
| `mountWheel` | 圆分扇、权重混色、unwrap 角度 | 12 扇区的**顺序**与权重、中心文字、`needle.at` 与 `spread` | `core/key-wheel.ts` |
| `mountWorkbench` | 栅格、tablist、坞位显隐、状态样式、**每帧唯一那次读数** | 视图 id/label、状态文案、`now()`、`epoch()` | `element/internal/recipes.ts` |

**最后一列右边那半格是 live 转向唯一改变的东西**：kit 多收了一个「每帧被拉一次的数」，
少收了一堆「已经排好的行」。

### 4.1 score 侧新增

**`core/chord-spelling.ts`** —— 命名与角色的唯一来源。

```ts
export interface SpelledPitch {
  midi: number; name: string;        // 'Eb4'
  step: string; alter: number; octave: number; pitchClass: number;
  diatonic: number;                  // 给谱表：C4 = 28
  role: ToneRole; degreeLabel: string;  // 'R' | '3' | '5' | '7' | '9' | 'B' | '.'
  interval?: string;                 // '1P' '3M' '5P' '7m' '9M'
}
export interface ChordNaming {
  id: string; symbol: string; root: string; bass?: string;
  quality: string; fullName: string;
  kind: 'primary' | 'inversion' | 'enharmonic' | 'rootless' | 'alias';
  rank: number;                      // 序数，不是 0…1 —— detect() 不返回权重（brief A.1.1）
}
export interface ChordSpelling {pitches: readonly SpelledPitch[]; namings: readonly ChordNaming[]; primary?: ChordNaming}

export function spellChord(midis: readonly number[], options?: SpellChordOptions): ChordSpelling;
export function spellChordNotes(notes: readonly Note[], options?: SpellChordOptions): ChordSpelling;
```

实现要点（已核实依赖能力，**不需要任何新依赖**）：

1. `@tonaljs/chord-detect` 的 `detect()` 返回的是一个**已排序的候选字符串数组**（不是带权重的对象——
   brief A.1.1 更正了旧稿）。现有 `core/chords.ts:182` 只取 `detected[0]`，其余全被丢弃——**备选命名的顺序本来就在手里**。
2. `@tonaljs/chord` 的 `get(symbol)` 给 `name`（全称）、`symbol`（记号）、`intervals`、`notes`、`tonic`、`bass`、`rootDegree`。
   **UI 要显示的是 `symbol` 不是 `name`**；`rootDegree` 实测为 `NaN`（不是 `null`），`??` 抓不住，
   必须 `Number.isFinite` 守（brief A.1.2）。
3. 角色：`(pc − rootPc + 12) % 12` 查表 → `0:root, 3|4:third, 6|7|8:fifth, 10|11:seventh, 1|2|5|9:extension`，其余 `other`；**最低音若音级不是根音，角色覆盖为 `bass`**（slash bass 一眼可见）。
4. 拼写：`'auto'` 跟随 primary 的 `notes` 拼写；`'sharp'`/`'flat'` 强制。**必须新写 `SHARP_NAMES` / `FLAT_NAMES` 两张 12 项表**——
   既有 `pcName()` 是一张固定混合升降的表，实现不了 `spelling`（brief A.2.7 / B13）。仍然零新依赖。
5. **记忆化**：`Map<string, ChordSpelling>`，key = `midis.join(',') + '|' + policy`。
   live 追踪每个 note-on 都调它，实测 `detect()` ≈ 59–62µs/次，这是刚需不是优化。

**`core/staff-placement.ts`**：`diatonic` 计算（跟拼写走）、高低音谱分配、调号记号位置、谱号字形常量（`CLEF_GLYPHS`，字形住在 score 这边）。加线只出现在**线位**上，所以 `staffPlacement(42)` 是 `ledgers: [40, 42]` 两条。

**`core/fretboard-voicing.ts`**：调弦表 + 把位搜索。**`core/key-wheel.ts`**：五度圈顺序 + 相关度归一。

**`headless/transport-clock.ts`（新增，DOM-free）—— live 转向带来的唯一一个新 headless 模块。**

```ts
export interface TransportSample {
  /** 名义乐谱秒——与速率无关的分析轴。 */
  readonly nominalSeconds: number;
  /** 每真实秒推进多少名义秒。1 = 写下的速度。 */
  readonly rate: number;
  /** 收到这个 sample 时的墙钟。与 readAt() 同源。 */
  readonly atMs: number;
}
export interface TransportReading {
  readonly seconds: number;   // 插值到请求时刻的名义秒
  readonly held: boolean;     // 越过滑行地平线：暂停，或饿死
  readonly epoch: number;     // 每次不连续 +1
  readonly rate: number;
}
export function createTransportClock(options?: {
  durationSeconds?: number;
  expectedIntervalMs?: number;   // 提示；时钟自己用 EWMA 重新测
}): {
  readAt(atMs: number): TransportReading;
  sample(next: TransportSample): void;
  stop(atMs: number, seconds?: number): void;   // webscore:end —— 停住，不滑行
  hold(seconds: number): void;                  // 拖拽夺权
  release(atMs: number): void;                  // 松手后 250ms 宽限，忽略 player 的回声
};
```

它必须处理的五件事，以及每一件的残差（机制与量出来的事实见 §3.0.2）：

| 事件 | 线上发生什么 | 修正 | 残差 |
|---|---|---|---|
| **向前/向后 seek** | `emitCursor()` 立刻发一个不连续的位置 | `sample()` 与预测比对，超出容差就 `epoch += 1`。lane **吸附并重建窗口**，绝不补间穿过一次 seek | 0（同步通告） |
| **暂停** | **什么都不发**。tick 停了 | 饿死是唯一的信号。`travel()` 把速度衰减到 0（60–140ms 的 cap），`held` 转真；恢复时新 sample 重锚 | ≤ 3.2px 的滑行，且在减速，读起来是走带在落定 |
| **变速 / 变速度** | `retune()` 在变速处发一个 cursor | 速率**从 detail 读**，永远不用差分（差分分不清变速与 seek） | 0 |
| **谱内速度曲线** | 什么都不发（它已经烘进 `nominalSeconds`） | 白拿：轴是秒，投影已经把速度表积分过一次 | 0 |
| **循环回卷** | `wrapLoop()` 绕过节流发 cursor，`armBoundaryTimer()` 在边界打一枪 | 与 seek 同一条路径：向后残差 → epoch → 吸附 + now 线 120ms 的强调脉冲，让跳跃可读而不是神秘 | ≤ 1 帧 |
| **结束** | `webscore:end` | `stop(atMs, duration)`：停住、rate 0、epoch +1、rAF 停 | 0 |

**两个诚实的限制，写出来而不是藏起来：**

1. **循环区间读不到。** `ScorePlayer` 有 `setLoop`/`clearLoop`（`play/headless/score-player.ts:260-266`）而**没有 getter**；
   `<simple-score-player>` 只会整曲循环。所以 lane 能**检出**一次回卷，不能**预测**它。
   这没关系，因为回卷的 cursor 是准时的。知道自己区间的宿主可以走
   `FlowLaneState.span` 之外的一个可选 `loop?: {start, end}`（形状照抄 `TimelineState.loop`，`ui/src/timeline.ts:33`）。
   **本轮不给 play 包加 getter**——D3 把它排除在外。
2. **`noteOn` 是一个比 20Hz 更密的活性信号。** 一个可选的精修：`held` 期间来了音符就提前一 tick 解除 hold。
   便宜，而且让恢复播放显得即时。不是必需。

**`headless/live-trackers.ts` 新增 `createLiveDistributionTracker`。**
这是 `<analysis-histogram>` 变活的**前提**，不是锦上添花：
`createLiveKeyTracker`（`:82-103`）按**音符个数**加权且从不暴露它的 12 个 bin；
`distributions().pitchClasses`（`core/distributions.ts:87`）按**发声时长**加权。
把一条计数加权的「已听到」条画在一条时长加权的「整曲」幽灵条上面，是把两种单位画在一根轴上。
新 tracker 按时长加权（`noteOn`/`noteOff` 成对给出长度），暴露 `bins()` 与 `heard`，
同文件、同形状、同一个 `validateMidi` 守卫，从 `headless/index.ts` 导出。

**`headless/workbench.ts`（投影层，DOM-free）**：

```ts
/** 整套设计的枢纽：六个视图的坞位全部只调它一次，参数不同而已。 */
export function projectSounding(
  midis: readonly number[],
  context: {key?: Key; tuning?: readonly number[]; spelling?: SpellingPreference},
): SoundingProjection;   // {marks, staff, fret, naming, description}

/** **签名按 brief B7 收 Score**：ChordSegment 只有音级，没有八度。 */
export function projectProgression(result: AnalysisResult, score: Score, mode: 'chords'|'roman'): FlowLaneView;
export function projectKeyFlow(score: Score, options?: {windowQuarters?: number}): FlowLaneView;
export function projectMotifFlow(result: AnalysisResult, score: Score): FlowLaneView;
export function projectVoiceFlow(result: AnalysisResult, score: Score): FlowLaneView;
export function projectTonality(key: KeyResult): {outer: readonly WheelSegmentView[]; inner: readonly WheelSegmentView[]; needle?: WheelNeedleView};
/** 没有时间轴的那一张榜：调候选排行。 */
export function projectKeyCandidates(key: KeyResult): readonly ChipItemView[];
```

**五个投影现在返回 `FlowLaneView`（bands / tracks / brackets / flags / ruler / span），不再返回 `ChipItemView[]`。**
每个 band 同时带 `start`/`end`（**秒**，lane 轴）与 `stampStart`/`stampEnd`（**quarters**，打点）——
两把尺必须能分开表达，理由见 §0.5 第 5 条。quarters→秒的换算在**投影时做一次**，
绝不放进帧循环：`TimeMap.secondsToQuarters`（`core/time/TimeMap.ts:479-486`）每次都 `new Rational` 并量化到 1/480。

「此刻在响的是什么」按 player 状态分三支：有 `noteon/noteoff` → 当前按住的音（`createLiveChordTracker` 已有）；只有 `timeupdate` → playhead 所在 `ChordSegment` 的代表音（**必须经 `notesOverlapping(score, …)` 取，不许由音级合成八度**，brief R7）；都没有 → 坞位进 `idle`。

score 的投影类型与 kit 的渲染类型是**结构兼容**而非同一份（score 不能 import ui —— ui 是可选 peer，headless 层必须 DOM-free，`checkFeatureLayers` 连 `HTMLElement` 类型标注都禁）。用一个纯类型测试把两边钉在一起：

```ts
// packages/score/test/analyze/ui-contract.test.ts —— 编译得过，或者两边已经漂移
import type {PitchMark, StaffMark} from '@webmusic/ui/pitch';
import type {ChipItem, FlowBand, FlowLaneState} from '@webmusic/ui/harmony';
const _mark: PitchMark = {} as PitchMarkView;
const _staff: StaffMark = {} as StaffMarkView;
const _item: ChipItem = {} as ChipItemView;
const _band: FlowBand = {} as FlowBandView;
```

### 4.2 六视图 = 一张配方表

```ts
// packages/score/src/analyze/element/internal/recipes.ts
export interface ViewRecipe {
  id: AnalysisViewType;
  label: string;                                  // tab 文字
  stage: readonly SlotSpec[];                     // 舞台里的图元；SlotSpec 多一个 'flow' 类型
  docks: readonly DockId[];                       // 该视图默认打开的坞位
  toggles: Readonly<Partial<Record<ToggleId, boolean>>>;
  needsScore: boolean; needsPlayer: boolean;
  emptyLabel: string;
}
export const VIEW_RECIPES: Readonly<Record<AnalysisViewType, ViewRecipe>>;
```

元素类本身只剩：解析属性 → 选配方 → 插槽对齐（新增的 mount、消失的 destroy、留下的 update）→ 重算模型。**这是把「六个视图」压回「一张表」的地方。**

一个视图 = 一份 state，一次全量重算：每个**域**事件重算整份普通对象，图元的 `update()` 只改属性不重建 DOM。
**帧事件不走这条路**——它只经 `clock` 到 `tick()`（§3.8）。
不给域层任何命令式绘制入口（现有 `LiveChordPanel.paint()` 这种形状只作为兼容层保留，不再扩展）。

### 4.3 元素侧的两处接线改动

**(1) `bindAnalysisPlayer` 必须停止丢掉 detail。** 今天它只转发 `detail.seconds`
（`element/internal/player-binding.ts:26-28`），于是速率被扔掉，而速率是**唯一**不能靠差分恢复的东西。
`seconds` 仍排第一，所以 `score-map.ts:240` 与 `analysis-timeline.ts:196` 两个既有调用点一个字不改：

```ts
export interface AnalysisTimeUpdate {
  /** 名义乐谱秒——分析轴。 */
  nominalSeconds: number;
  /** 按速率缩放的走带秒。player 不报时为 0。 */
  transportSeconds: number;
  /** 按速率缩放的总长。不报时为 0。 */
  transportDurationSeconds: number;
}
export interface AnalysisPlayerHandlers {
  // …noteOn / noteOff / end 不变
  timeUpdate?(seconds: number, update: AnalysisTimeUpdate): void;
}
```

速率**精确读出**，不估计：`rate = nominalDuration / transportDurationSeconds`
（在位置 0 也有定义，而 `nominal/transport` 在那里是 0/0）。

**(2) 🔴 `<analysis-timeline>` 在 `rate ≠ 1` 时 seek 到错的地方——一个被顺手发现的既有 bug。**
`analysis-timeline.ts:#seek` 用 `score.timeMap.quartersToSeconds(...)` 算出**名义**秒，
然后交给 `player.seek(seconds)`；而 `seek()` 收的是**按速率缩放的走带**秒——
`score-player-scheduler.ts:216-229` 先对 `duration = timeline.duration / rate` 夹取，再 `seekTo(clamped * rate)`，
`simple-score-player.ts:410-416` 原样转发。`rate = 1` 时两者重合，所以没有测试抓到它；`rate = 2` 时点一下会跳到两倍远处。

修法：`player?.seekNominal?.(seconds) ?? player?.seek?.(seconds / rate)`。
**事件 detail 保持名义秒**——它是文档化过的，而且名义秒就是分析轴。
`<analysis-timeline>` 与工作台两处都要修，各自一笔独立提交（brief C.10a）。

---

## 5. 六个视图：活的舞台

> **本节因 §0 的转向整体重写。** 旧 §5 是一张「哪个视图放哪几个图元」的布置表，
> 它默认了一件现在不成立的事：视图的工作是把 `AnalysisResult` 摆出来。
> 修正后的前提是——**摆出来是 `AnalysisResult` 自己的事，Web Component 的工作是演出。**
>
> 全节的具体例子是同一段 **16 小节 4/4 的谱例**（下称「样例」）：
>
> | bar | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15–16 |
> |---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
> | chord | C | Am | F | G7 | C | A7 | Dm | G7 | C | D7 | G | Em | Am7 | D7 | G |
> | quarters | 0–4 | 4–8 | 8–12 | 12–16 | 16–20 | 20–24 | 24–28 | 28–32 | 32–36 | 36–40 | 40–44 | 44–48 | 48–52 | 52–56 | 56–64 |
> | roman | I | vi | IV | V7 | I | V7/ii | ii | V7 | **IV** | V7 | I | vi | ii7 | V7 | I |
>
> 第 9 小节转到 G 大调（`I → IV` 的重解释）。动机 **M1 = E–D–C–D**（`intervals [-2,-2,+2]`）出现在 q0 / q16 / q26。
> 声部问题：**T 与 B 在 q10→q11 平行五度**（T `C4→D4`、B `F2→G2`）——`voiceLeading()` 给出
> `{type:'parallel-fifth', startQuarters:10, endQuarters:11, voices:['T','B'], severity:'error'}`，
> `severity` 是源码钉死的 `'error'`（`core/voice-leading.ts:197-201`），不是推测。

### 5.0 判据与坞位

一个读数够格站上舞台，要同时过三问（§0 判据的可操作版）：

1. 它在演奏过程中**会变**吗？（不变 = 表）
2. 它变的那一下**有意义**吗？（变但无意义 = 噪声）
3. 在它变的那一刻，用户**能对它做点什么**吗？（不能 = 注解）

三问全否 → 它是一张表，表的名字叫 `AnalysisResult`，取法见 §5.8。
三问有一条为是 → 它上台，并且**它变的那一下必须被演出来**，否则不如不上台。

**坞位在六个视图里逐字节相同**（这一条不变）：

| dock id | 位置 | 图元 | 数据 |
|---|---|---|---|
| `nameplate` | rail | `mountNameplate` | `projectSounding().naming` |
| `staff` | rail | `mountStaff` | `projectSounding().staff` |
| `fretboard` | rail | `mountFretboard` | `projectSounding().fret` |
| `keyboard` | strip | `mountKeyboard` | `projectSounding().marks` |

样例 q12（G7 上线）那一瞬，四个坞位读的是同一次 `projectSounding([43,59,62,65], {key:{tonic:'C',mode:'major'}})`：
名牌 `G7` / `G dominant seventh`，备选 `Bø7/G`；谱表四个符头 `G2 B3 D4 F4`，`diatonic` 21/34/35/38，无变音记号；
指板 `3-x-0-0-0-1`；键盘四个着色键 `R 3 5 7`。**同一个 F4 在四个面上是同一个紫色、同一个 `7`。**


> Integration note (2026-09-06): this worked example is preserved from the
> original design. The parallel workbench implementation reported different
> alternate-chord and diatonic-position results. Validate it against the merged
> domain algorithms; do not change those algorithms merely to reproduce this
> illustrative text.

全族只有两处真差异，且都不是例外，是同一个坞位吃了不同形状的投影：

- `voice-leading`：`staff` 坞位吃 **2 列**（涉事两声部的前后两个和声位置）而不是 1 列——
  `StaffState.columns = 2, activeColumn = 1`，同一个 `mountStaff`，没有新参数。
- `live-chord`：`nameplate` 坞位隐藏（舞台上已有一块 hero 名牌，同屏两块名牌是错的）。

下文每个视图给五件事：**(a) 舞台 · (b) 坞位 · (c) pop · (d) 静止态 · (e) 交互**，
并在末尾写清**台上删掉了什么**。全部由 §3.6 的**同一台机器** `mountFlowLane` 驱动。

### 5.1 帧图：机器本身，也就是 `chords` 的舞台

样例，1 拍 = 3 字符，now 线在第 20 列。`░` 尾流 · `█` 已听过 · `▓` 已落定但未听到 · `▒` 待来。

```
                     ╷ now = 11.4q  ·  bar 3, beat 3.4      —— 接近
           pinned ▸ F
┌──────────┬─────────┼─┬───────────┬───────────┬───────────┬───┐
│    Am          F   │      G7           C          A7      Dm │
│░░░░░░░░░░██████████┃▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│              R 3 5 ┃    R 3 5 7      R 3 5      R 3 5 7  R 3 │
└          3         ┴ 4           5           6           7   ┘
   F 已排空到只剩线右一格；G7 的前缘还有 0.6 拍到线，坞位仍在 F 上

                     ╷ now = 12.0q  ·  bar 4, beat 1        —— 上线
          pinned ▸ G7
┌────────┬───────────┼───────────┬───────────┬───────────┬─────┐
│   Am         F     │    G7           C          A7       Dm  │
│░░░░░░░░░░░░░░░░░░░░┃▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│                    ┃  R 3 5 7      R 3 5      R 3 5 7   R 3 5│
└        3           ┴           5           6           7     ┘
   120ms：G7 填充 18%→100%，钉住的大字 F→G7 淡换；90ms：四个坞位换到 G B D F
   now 线 1px→2px→1px（90ms）。band 一个像素都没有移动位置或改变宽度。
```

### 5.2 `key` —— 证据在累积，不是事件在流过

**(a) 舞台。** 三块，三个时间尺度，各自只动自己的：

- **五度圈**（钉住，居左，`mountWheel`）：外环 12 大调、内环关系小调，权重混色。
  **它不滚动，它转**：检出主音永远在 12 点方向。样例第 9 小节 C→G 时整个圈转 30°（`--wui-harmony-motion-turn`，320ms）并重排标签。
  置信度画成指针的**扇面张角**，不是一根假装很确定的针（§3.7）。
- **判定流**（滚动，圈下方，`mountFlowLane`）：band 是**逐段稳定的调判定**，`weight = confidence` 决定 band 高度。
  样例读出来是：一条很长的 C 大调 band（q0–q34）、一段矮而碎的摇摆（q34–q40，D7 让 C/G 打架）、一条 G 大调 band（q40–q64）。
  **这是这首曲子的调性叙事，一行文字给不了。**
- **音级权重列**（钉住，圈右，`mountChipStrip` 的 `meter`）：12 根条，随音符到达**逐根改高**（90ms）。
  播放中它是一台均衡器，不是一张直方图。

**(b) 坞位。** 无差异。

**(c) pop。** 转调是这个视图唯一值得演的事件，也是全设计里唯一一次旋转——**读数的参照系变了，所以框架转了**。
三个动画**嵌套**，短的先结束：音级条 90ms → 判定 band 落定 120ms → 圈转 320ms。
眼睛读到的是**一个有头有尾的事件**，不是三个各跑各的动画。
这条嵌套规则是 §0.3 第 2 条的推论：三块本来分属三个时间尺度，只有在转调这一刻它们必须同意。

**(d) 静止态。** 有谱无 player：圈按 `detectKey(score)` 画满、判定流按整曲窗口分析停靠在 q0、
权重列按 `distributions(score).pitchClasses` 画满——**已经在回答问题了**。
有 player 无谱：圈画 12 个空扇区（形状先立住），权重列归零，状态条 `listening — press play`。
加载中：只画圈的 12 条分隔线与 lane 的 ruler，band 轨道 8% 幽灵。

**(e) 交互。** 点扇区 → 把该调设为**参照**重画关系（一次「如果是它呢」），`Esc` 复位；方向键沿环走，`Enter` 参照。
**不发事件**（参照是视图内状态）。判定流上的拖/点/`[`/`]` 同 §3.6.6，发 `webscore:seek`。

**落幕。** 台上删掉：前 5 名候选的静态排行**列表**改由 `mountChipStrip` 承担（它确实是一张榜单，没有时间轴）；
`confidence 78%` 那一行**文本**没了，它变成圈中心的副读数与指针扇面。

### 5.3 `chords` —— 和声节奏本身

**(a) 舞台。** §5.1 的机器原样，band 宽度 = `ChordSegment` 的真实时长。
**band 的宽窄就是和声节奏**，这是列表永远说不出的一句话：样例前 8 小节每 4 拍一换（等宽），
第 15 小节 G 拖 8 拍（双倍宽），你一眼看见它在收束。
band 下方第二行是**发声刻痕**：band 内每个响着的音高一道 2px 刻线，纵向位置按音高——
一条随材料滚过的微型钢琴卷帘。它不是装饰，它是名字下面的**证据**。

**(b) 坞位。** 无差异。

**(c) pop。** §3.6.3 的四件事，外加 `chords` 专有的一件：**根音运动弧**。
新 band 落定时，在刻痕行上从**前一个** band 的根音刻线到新 band 的根音刻线画一道细弧，
`--wui-degree-root` 色，120ms 淡入，**然后不动**——它属于尾流，不是闪光。
弧的高度直接读出根音走了多远：样例 `F→G7`（二度）是一道浅弧，`G7→C`（四度）明显更高。
kit 只收 `{fromY, toY, atX}`，不认识「四度」。默认开，`show="-root-motion"` 可关。

**(d) 静止态。** 整条进行铺满并停靠在 `now = 0`：C（0–4）的 `start ≤ 0 < end` 已经成立，
所以**停靠态就是「第 1 小节已被回答」**——名牌写 `C`，谱表画 `C E G`，键盘三个色点，
钉住的读数是 `bar 1 · beat 1`。**停靠 ≠ 空白。**
加载中：只画 ruler 的小节号 + 8% 的幽灵 band 轨。空态：ruler + 幽灵轨 + 外壳的空态句。

**(e) 交互。** §3.6.6 全套。额外一条：点刻痕行的某一道刻线 → 四个坞位只强调那一个音，
**不发事件**（纯视图内强调），`Esc` 释放。

**落幕。** 台上删掉：`<ol>` 的每一行「和弦名 + beat N」、段数统计、行内的 beat 读数。
**注意 `'beat 1'` 是 `elements.test.ts:300,338` 钉死的字符串**——它活在钉住读数 `bar 1 · beat 1` 里（停靠态就成立），见 §7.6。

### 5.4 `roman` —— 张力在呼吸

**(a) 舞台。** 同一台机器，**两条 track 耦合 + 一条顶带**，三者共享**一根** now 线、**一个** reel
（这就是「六个视图像一件乐器」的物理实现）：

- 顶带（4px）：**调带**。样例前 8 小节一色，第 9 小节换色。
- track A（高）：**功能带 T / S / D**。**相邻同功能的段会合并成一个 band**——样例
  `I vi` 合成一条 T（q0–8）、`IV` 一条 S（8–12）、`V7` 一条 D（12–16）、`I` T（16–20）、
  `V7/ii` D（20–24）、`ii` S（24–28）、`V7` D（28–32）。
  于是舞台上是 `T——— S— D— T— D— S— D—`：**你看见的是乐句的呼吸**，不是 8 个等宽芯片。
- track B（低）：级数 band，`primary` = 级数（`V7`），`secondary` = 记号（`G7`）。

**(b) 坞位。** 无差异。

**(c) pop。** 级数按 §3.6.3 落定；此外 **D→T 的终止式是一个整体手势**：
进来的 T band 18%→100% 与出去的 D band 100%→12% 在**同一个 120ms** 里完成，
读作「张力释放」这一件事，不是两件。钉住区在 D 上线时预告 `V7 → ?`，在 T 落定时定格成
`V7 → I  authentic`（这串字由 score 判定并给出，kit 只显示）。
转调时：调带换色，钉住的 caption 在 200ms 内 `in C major` → `in G major` 淡换——
**全设计里最长的一次淡换，因为转调是这块表能报告的最大事件**。

诚实标注保留：`key.confidence === 0` 时功能行隐藏，caption 改为
`Key unknown — numerals are relative to C major.`

**(d) 静止态。** 停靠时功能带已经把整首曲子的张力形状画完了——
**那本身就是一张有用的静态读数，而且它是一幅图，不是一张表**。加载中：ruler + 两条 8% 幽灵轨。

**(e) 交互。** §3.6.6 全套；`[` / `]` 按级数走；`↓` 从功能带跳到它下面的级数。
按 `f` 开关功能行 → **回写 `show` 属性**（`show="-function"`），不发新事件——
属性回写本来就是 §6 定的反射规则，DOM 检查器里看得见、复制 HTML 能复现。

```
                     ╷ now = 32.0q · bar 9, beat 1        —— 终止 + 转调，一个手势
          pinned ▸ V7 → I   authentic        in C major ⇢ in G major
┌────────┬───────────┼───────────┬───────────┬───────────┬─────┐
│ key: C major       │ key: G major                            │  调带换色
│    D          (释放)│     T ←落定                              │  D 100→12% ┐同一个
│░░░░░░░░░░░░░░░░░░░░┃▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│  T 18→100% ┘ 120ms
│    V7              │     I(=IV)      V7          I           │  caption 200ms 淡换
└        8           ┴          10          11          12     ┘
```

**落幕。** 台上删掉：整首曲子的级数芯片墙（一次性把 16 个芯片摊开）、静态的 `in C major` 行。
**`'in C major'` 是 `elements.test.ts:308` 钉死的**——它活在钉住 caption 里。

### 5.5 `motifs` —— 复现本身就是那个事件

这是六个视图里改动最大的一个，因为**动机不是一个时刻，它是一组时刻**。
静态列表写 `×3  intervals [-2, -2, 2]`——它把这个视图唯一有意思的事实
（这些时刻**之间**的关系）压成了一个数字。

**(a) 舞台。** 一条 lane，**每个动机一条 track**（前 4 条按出现次数排，其余折成 `+N more` 一条）。
track 上是该动机的出现 band，落在真实时间上。**四条平行轨在同一条线下滚过 = 这首曲子的重复结构**，
像一台自己在走的鼓机。band 内画该动机的**轮廓折线**（score 给归一化点，kit 画 path），
所以同一个动机的每次出现是**同一个形状**——视觉押韵瞬间成立。
四条轨共享**同一个** `transform`：它们绝不允许错位。左侧 gutter 是钉住的图例（`M1 ×3` + 轮廓字形），**不滚动**。

**(b) 坞位。** 无差异。

**(c) pop —— 全设计最好的一个。** M1 的某次出现越线时，**屏幕上 M1 的其它每一次出现同时描边 160ms、40% 不透明度**，
包括还在右边、还没发生的那些。你**看见**「这就是你第 1 小节听过的东西」在前方亮起来。
**复现是事件，所以复现才是该被演的东西。** 没有任何东西移动，只有描边的 alpha 在变。
两个动机同时响就亮两条轨、两种颜色。机制是 `FlowBand.group` + `FlowLaneState.focusGroup`，kit 不认识「动机」。

**(d) 静止态。** 四条轨全部铺开、停靠在 q0，M1 的第一次出现正在线上。
加载中：四条 8% 的空轨 + gutter 写 `—`（**形状先立住**）。
空态（4 音长度下没有 ≥2 次的重复）：**一条**幽灵轨 + 这句话——

> `No figure repeats at 4 notes. Try motif-length 3.`

——它指名了那个旋钮。比 `No repeated motifs found.` 有用一个数量级。空态文案住在外壳里，不在渲染器里（brief B14）。

**(e) 交互。** 悬停一条轨 → 该动机全部出现提亮到 `now` 级描边（等于把 pop 预演一遍），不发事件。
点某次出现 → seek 到它。`↑`/`↓` 换焦点轨；**`[` / `]` 在焦点轨内跳到该动机的上/下一次出现**——
这是真正有用的导航，而且**列表做不到**。全部发 `webscore:seek`。

```
                           ╷ now = 16.4q · bar 5, beat 1.4      —— 上线
        ┌──────────────────┼─────────────────────────────────────┐
▶M1 ×3  │·················█┃▓▓▓▓▓▓▓▓▓▓··················▚╲╱▚▚▚▚▚▚│
 M2 ×2  │░░················┃······················▒╲╱▒▒▒▒▒▒······│
 M3 ×4  │··················┃··········▒╲╱▒▒▒·····················│
 M4 ×2  │··················┃·····································│
        └     4           5┴          6           7           8  ┘
        M1 越线 → 同 group 的 q26（▚，还没发生）同时描边 160ms。没有一样东西移动。
```

**落幕。** 台上删掉：`×N + intervals[…] + 节奏字形` 的整行。
**`intervals: [-2, -2, 2]` 是数据，不是演出**，它从来就不该上台；节奏字形列同理。
**`'intervals'` 是 `elements.test.ts:317` 钉死的**——它活在语义孪生体 `<ol>` 的每条 `<li>` 里（§7.6）。

### 5.6 `voice-leading` —— 在对位上标错，不是在旁边列错

**(a) 舞台。** 不是 issue 的列表，是**声部本身**：`buildVoiceLanes()` 找到的每个声部一条 track，
画成滚动的音高折线（`FlowBand.points`，归一化到该声部自己的音域）。
issue 画成**连接涉事两条 track 的括号**（`FlowBracket`）——样例 q10→q11 的平行五度就是
T 与 B 之间一道跨一拍的 severity 色括号。

**错被画在对位上，不是画在对位旁边的表里。** 这是 chordie 作为教学工具的做法，也是唯一对的做法。

**(b) 坞位。** `staff` 吃 2 列（`F2/C4 → G2/D4`），其余三个无差异。

**(c) pop —— 全设计最克制的一次。** 一个会跳的错误指示器是吓人的，用户第一件事就是把它关掉。
所以 issue 上线时发生的是**注意力收窄**：其余声部带在 120ms 内降到 25% 不透明度，
涉事两条留在 100%，括号从 40% 走到 100%。issue 过线后 200ms 恢复。
**没有闪、没有抖、没有声音。屏幕只是把注意力收窄了。** 这读起来是贵的；闪一下读起来是廉价的。

**(d) 静止态。** 停靠时全部声部带与全部 issue 括号（40%）已经画完——
**一眼就能看出「一共 3 个错，其中 2 个挤在第 3 小节」**。12 行的列表说不出这句话。
加载中：4 条 8% 幽灵带。空态：一对幽灵带 + `No parallel motion, crossings or leaps over an octave — clean.`

**(e) 交互。** 点括号 → seek 到 `startQuarters` 并把该 issue 钉进读数（`staff` 坞位切到 2 列）。
`[` / `]` 在 **issue** 之间跳（不是在拍之间跳）——这是审校这份谱子时你真正想按的键。
悬停一条声部带 → 只提亮该声部涉及的括号。全部发 `webscore:seek`。

**落幕。** 台上删掉：severity 圆点 + `parallel fifth` + `T / B · beat 11` 的整张行表。
**`'clean'` 是 `elements.test.ts:325` 钉死的**——它活在空态句里。

### 5.7 `live-chord` —— 未来是空的，而且要看得出来

**(a) 舞台。** 唯一一个「现在」就是全部时间的视图。now 线还在原处，
但**材料是从线里流出去，不是流进来**：右侧 67% 画成**空场**（`future: false`：无 ruler、无幽灵轨、无刻度）。

> 四个乐谱视图右边是满的（未来已知）；`live-chord` 右边是空的（未来未知）。**同一个框，相反的填充。**
> 用户要的是「能看见下一个和弦逼近」——在这里诚实的回答是「没有东西可以逼近」，把它画出来比假装有更好。

- 钉在线上：**hero 名牌**（`emphasis:'hero'`，display 字号 × 1.6），下面是备选命名（真 `<button>`，Tab 可达）；
- 线左：**尾流带**——每个已经结束的和弦按它**实际响了多久**的宽度往左流。
  历史条不再是 8 个等宽芯片，它是**一条自己长出来的时间线**。
  lane 单位在这里是**秒**（无谱、无 tempo），`spans:false`（没有 quarters 可打点）。

**(b) 坞位。** `nameplate` 坞位隐藏（舞台上已有 hero），其余三个无差异。

**(c) pop。** `chordchange` 时：hero 符号 180ms 的 WAAPI **纯 opacity 淡换**
（**不位移、不缩放**——这是用户唯一真的在读的那行字，跳一下就读不了了，§3.5）；
上一个符号在线上**生成**为一个尾流 band 并开始左移；四个坞位 90ms 换角色色。

外加一个零成本的活状态：当按下的音还没构成一个能命名的和弦（`identifyChordFromMidi` 返回 `''`，
而 `detect()` 对 1 音、2 音和 12 音簇都返回 `[]`——brief A.2.9）时，**now 线画成虚线**，名牌只显示 voicing。
名字一出现，线变实。「还在听」和「听懂了」被区分开了。

**(d) 静止态。** caption `sounding now`、名牌 `—`（`NO_CHORD_LABEL`）、voicing 行 `waiting for playback…`、
尾流带空、只有一条虚的 now 线、键盘画 ghost 音域。
**这是六个视图里唯一一个 `needsScore: false` 的**——它没有「加载中」这个态。

**(e) 交互。** 点备选命名 → `webscore:chordpick {symbol, kind, midis}`，四个坞位**整体重算**角色。
点尾流 band → 无处可 seek（没有谱），所以**把那个和弦钉回坞位**供检视，`Esc` 释放。
键盘：`↓`/`↑` 走备选、`Enter` 选中、`p` 钉住/释放线上的 band。

> **原型里那个 `Cmaj7 → Am9 (no root)` 的旗舰演示不成立**：`detect(['C','E','G','B'])` 只返回**一个**候选，
> `detect()` 结构上加不出一个没响的音级（brief A.2.10 / B12）。**角色重算的算术是对的**
> （`rootPc = 9` → `48:bass 64:fifth 67:seventh 71:extension`），缺的是命名来源。
> 要么从演示文案里拿掉，要么在 C.4 里预算一次超集搜索。别把它当成「数据本来就在手里」。

**落幕。** 台上删掉：`history` 那一排 8 个字符串芯片作为**持久列表**的形态（它变成了尾流里带真实时长的 band）。
**`'sounding now'` / `'waiting for playback'` / `'—'` / `'CM'` / `'C4'` / `'G4'` 全是 `elements.test.ts` 钉死的**，
逐个在上面还活着，见 §7.6。

### 5.8 落幕清单：删掉的表，和取回它的真实函数

> 全部来自 `packages/score/src/analyze/{api,headless,core}/*.ts` 的现有导出，没有一个是杜撰的。入口：
> `@webmusic/score/analyze/api`（无状态，纯函数进出）· `@webmusic/score/analyze/headless`（有状态、DOM-free）· `@webmusic/score/react`（hook）。

| 视图 | 台上删掉的（因为它是表，不是演出） | 消费者改用什么 |
|---|---|---|
| `key` | 前 5 名候选的**文本**排行；`confidence 78%` 那一行 | `detectKey(score)` → `KeyResult {tonic, mode, confidence, scores}`——**`scores` 里是全部 24 个候选、排好序，比台上那 5 行多**；自带直方图时 `keyFromHistogram(histogram, total)`；证据条 `distributions(score).pitchClasses`；实时 `createLiveKeyTracker(onUpdate)` 的 `.result()` / `.heard` |
| `chords` | 「和弦名 + beat N」的 `<ol>`；段数统计；行内 beat 读数 | `segmentChords(score, {windowQuarters})` → `ChordSegment[]`；要秒和音符对象时 `chordTimeline(score, …)` → `ChordTimelineSegment {startSeconds, endSeconds, notes, pitchClasses, chord, root, quality}`（**严格多于那一行印过的东西**）；编辑中 `createAnalysisSession(score).result.chords`；React `useScoreAnalysis().chords` |
| `roman` | 全曲级数芯片墙；静态 `in C major` 行 | `romanNumerals(score, options)` → `RNAResult {startQuarters, endQuarters, chord, roman}[]`；单个和弦 `romanNumeralForChord(chordSymbol, key)`；`createAnalysisSession(score).result.roman` |
| `motifs` | `×N + intervals[…] + 节奏字形` 的 `<ol>` | `findMotifs(score, {length, minOccurrences})` → `Motif {id, intervals, rhythm, occurrences[{partId, startQuarters, noteIndexes}]}`——**`partId` 和 `noteIndexes` 本来就在数据里，台上从来没印过**；节奏侧 `rhythmPatterns(score, length)` → `RhythmPattern {pattern, count, onsets}`；音程普查 `distributions(score).intervals` |
| `voice-leading` | severity 圆点行表 | `voiceLeading(score)` → `VoiceLeadingIssue {type, startQuarters, endQuarters, voices, severity}[]`；`createAnalysisSession(score).result.issues`；大谱离线批处理 `createAnalysisWorker(...).analyze(score)`（返回同一个 `AnalysisResult`，且已 `freezeAnalysisResult`） |
| `live-chord` | 8 个字符串的 history 芯片行 | `createLiveChordTracker({onUpdate, onChordChange})` → `LiveChordState {chord, midis, history}`；一次性命名 `identifyChordFromMidi(midis)` / `identifyChord(notes)`；角色与备选命名 `spellChord(midis, {spelling, key})` |
| 全局 | （本来就不在这六个视图里） | `createScoreReport(score)` → `ScoreReport {title, composer, rows}`；`summarizeScore(score)` → `ScoreSummary` |

**每个元素页都要写上这一列。** 把印出来的表从组件里拿掉，只有在同一句话里告诉读者去哪儿拿它，
才是诚实的，而不是有损的。

### 5.9 另外三个元素（D3 范围内的其余两个半）

同一把判据对着 §6.1 的表再走一遍。结论**不是**「全都做成传送带」：

| 元素 | 判据 | 结论 |
|---|---|---|
| `<analysis-histogram>` | 有隐藏的时间维度 | **变活。** 一份 DOM、**两条轨**：整曲答案是条后面的**幽灵轮廓**，已听到的部分在前面填 accent——你看着这首曲子把自己的音级侧写攒出来。由 `mountChipStrip` 的 `meter` + `meterGhost` 画。🔴 **行永不重排**（播放中互换位置的条形图读不了），bin 顺序在首次渲染时定死，`type` 切换也不动。**它需要一个新 headless 函数**：`createLiveDistributionTracker`（§4.1，单位必须与 `distributions()` 一致）。**并且它需要 `player` 属性**——今天 `observedAttributes` 是 `['src','format','type']`，它**根本绑不了 player** |
| `<rhythm-patterns>` | 有隐藏的时间维度（`RhythmPattern.onsets`） | **变活，且 `<ol>`/`<li>` 结构原样保留**（它是跨度载体，四条测试钉着它）。三件事：① 节奏型本身变成**按真实时值排布的比例带**，`[1, 1, .5, .5]` 一眼可读，而不是解四个字形——kit 只收到四个数字，没有乐理进 `packages/ui`；② 每行一条横跨全曲的出现轨，一条 now 线**贯穿整叠**，逼近时**预亮**、到线时**点火**；③ `×3` 变成 `2 / 3`，**边听边数**。几何进 `<li>` 内部，`data-spans` 留在 `<li>` 上 |
| `<score-analysis>` | 三问全否 | **保持报告，不假装**（§7.5）。**一个工作台需要有一个不动的面。** 硬给它加动效才是廉价 |
| `<analysis-timeline>` | 它是**地图**，不是传送带 | **保持 `mountTimeline`**（§0.2）。四件便宜的活化见 §7.5 |

🔴 **一条贯穿这三个元素的硬规矩：逼近/预亮**绝不能用字符串 `outline`。
`elements.test.ts:583,586,607,639,645` 与 `analysis.test.ts:89` 都用 `cssText.includes('outline')` 判「亮没亮」，
而 `outline-offset` / `outline-color` 也含这个子串。
**`createAnalysisPlayhead` 独占 `outline` 属性**（`harmonyParts.activeSpan`，`harmony-style.ts:681`）；
这一族其它每一处 live 高亮都只用 `background` / `opacity` / `border-color`。
这一条规矩白送地保住 ~7 条断言，其中包括最危险的那条：`elements.test.ts:639-641`
断言**恰好 1 个** active 段——一个同时高亮「正在响的」和「正在逼近的」的滚动带，
只要逼近态碰了 `outline`，这条当场变 2。

---

## 6. 元素 API

```ts
// <analysis-view>
static get observedAttributes(): string[] {
  return ['src', 'format', 'type', 'player', 'show', 'density', 'scheme',
          'range', 'tuning', 'spelling', 'shell', 'motion', 'window'];
}
```

> **顺序即 `apps/doc/webmusic/src/lib/params/score-analyze.ts` 里的顺序** ——
> `check-docs.mjs:126-149` 先比集合、再比顺序。**追加到末尾是允许的**（brief A.2.13 更正了旧稿的
> 「不能追加到末尾」），可操作的规矩只有一条：**两张表逐字节同序**。
> 数组必须**内联**并以字面量 `];` 收尾，否则解析器读不到它（brief A.3.11）。

| 名称 | 默认 | 说明 |
|---|---|---|
| `src` / `format` / `type` / `player` | — | **不变** |
| `show` | 配方默认 | 空格分隔的展示开关：`staff keyboard fretboard alternates wheel function root-motion`；`none` 全关；前缀 `-` 做减法（`show="-fretboard"`） |
| `density` | `comfortable` | `compact` / `comfortable` |
| `scheme` | 跟随系统 | `light` / `dark`，写到工作台的 `data-scheme` |
| `range` | `48-84` | 键盘音域 `low-high`；`auto` 跟随乐谱 |
| `tuning` | `standard` | 预设名或逗号分隔 MIDI；解析失败回落默认并 `console.warn` 一次 |
| `spelling` | `auto` | `auto` / `sharp` / `flat` |
| `shell` | `full` | `full` = 带 tabs/状态条；`bare` = 只有舞台（嵌入用） |
| `motion` | `auto` | **新增。** `auto`（读 `prefers-reduced-motion` 并跟随它变化）/ `continuous` / `stepped` / `none`。写到工作台的 `data-motion`，并解算成每个 mount 的 `MotionMode`（§3.1） |
| `window` | `auto` | **新增。** 传送带的视野时长，秒；`auto` = 8 小节。它就是「缩放」，`⌘`+滚轮也改它并**回写这个属性** |

**`follow` 不是元素属性。** 它是 `StaffState` 的一个字段（§3.3），由配方表决定——
`live-chord` 与 `voice-leading` 用 `'none'`（谱表上没有一条时间线可跟），
其余四个视图用 `'anchor'`。给它一个属性等于让用户去调一个只有配方知道对错的开关。

属性：`.score`（不变）、`.type`（反射，不变）、`.show`（`string[]`）、
`.density` / `.spelling` / `.scheme` / `.motion`（反射）、`.window`（`number | 'auto'`，反射）、
`.chord`（新增只读，当前主命名）。

**其它四个元素的属性变化，只有一处：**

```ts
// <analysis-histogram> —— 今天它根本绑不了 player
static get observedAttributes(): string[] { return ['src', 'format', 'type', 'player']; }
```

`params/score-analyze.ts:113-131` 的 `<analysis-histogram>` 条目必须在**同一笔提交**里
从 `[SRC, FORMAT, type]` 变成 `[SRC, FORMAT, type, PLAYER]`——同名、同序（brief 表 #40）。
`<rhythm-patterns>` / `<score-analysis>` / `<analysis-timeline>` 的属性集**不变**。

事件（全部 `bubbles + composed`）：

| 名称 | 何时 | detail |
|---|---|---|
| `webscore:chordchange` | 不变 | `{chord, midis}` —— **形状不变**，既有测试已钉 |
| `webscore:viewchange` | 点 tab（`shell="full"`） | `{type}`；元素已把 `type` 写回属性 |
| `webscore:chordpick` | 选了另一个命名 | `{symbol, kind, midis}` |
| `webscore:seek` | 点/拖传送带、点 issue 括号、点动机出现 | `{quarters, seconds}`，与 `<analysis-timeline>` 的 `AnalysisSeekDetail` **同形**。**四个视图都发它** |

**live 转向没有增加任何事件类型。** 缩放、开关行、pin、scrub 全部走属性回写或视图内状态。
一个新事件要动 `params/score-analyze.ts`、文档表与 `check-docs`，代价与收益不成比例。

**`webscore:seek` 的两条纪律**（`dev/plans/score-analyze-elements.md:132` 已经写过第一条）：

1. **只发事件什么也不会发生**——player 不监听。元素**必须同时**调 `seek()`。
2. 🔴 **`seek()` 收的是走带秒，不是名义秒**（§4.3(2)）。
   `player?.seekNominal?.(seconds) ?? player?.seek?.(seconds / rate)`。事件 detail 保持名义秒。

**属性反射规则**：用户在 header 里点 tab / 拨开关 / 缩放时，元素**写回属性**——所以 DOM 检查器里能看到状态、
复制 HTML 能复现，这也是文档站 `ElementPlayground` 的 markup readout 能工作的前提。
**属性回写会重入 `attributeChangedCallback`，而今天没有任何守卫**——必须加一个
（`live-trackers.ts:26` 的 `revision` 计数器是本子系统唯一的先例）。

**CSS 契约**：`<analysis-view>` 是 light DOM（沿用现状），所以 `::part()` 对它无效。对外造型契约是
① token（`--wm-harmony-*` / `--wm-degree-*` / 各图元 token）、② 状态属性
（`[data-phase]` / `[data-density]` / `[data-motion]` / `[data-role]` / `[data-zone]` / `[data-when]` / `[data-phase]`）、
③ 旧 token 继续生效。`.wui-*` 类名是内部实现（`checkWuiInternalNamespace` 禁止 score/audio 写死它们，文档站也不得教用户选它）。

### 6.1 同族元素：不合并标签，只共享皮肤

`EXPECTED_ELEMENTS['Score Analyze'] = 5`（`check-architecture.mjs:29-37`）是被显式评审过的架构数字，合并会同时打破元素数、文档分组与五个已发布的元素页。做的是**表现层归并**，而 live 转向给每个元素派了不同的活：

| 元素 | 处理 | 判据落点 |
|---|---|---|
| `<analysis-view>` | 完整工作台（`chrome:'full'`）+ `mountFlowLane` 六个舞台 | (a)(b)(c) 全中 |
| `<analysis-histogram>` | `chrome:'bare'` + **双轨 `mountChipStrip`** + `player` 属性 + `createLiveDistributionTracker` | (a) 累积；(c) 条形几何 |
| `<rhythm-patterns>` | `chrome:'bare'` + **比例带 + 出现轨 + 贯穿的 now 线**；`<ol>`/`<li>` 与 `data-spans` 原样 | (a)(b)(c) 全中 |
| `<score-analysis>` | `chrome:'bare'` 包住既有 `renderSummaryCard`；**报告仍然是报告**，只加 `idle`/`error` 骨架、把已经是范围的事实画成几何、一次 120ms 的载入过渡 | 三问全否 → 不假装 |
| `<analysis-timeline>` | 保持 `mountTimeline` 的**地图模型**；换 12 色 tone 表 + 四件便宜的活化（§7.5） | 它是另一种时间显示，不是同一种的第二遍 |

---

## 7. 兼容与迁移

> **live 转向让这一章变重了，并且推翻了它原来最核心的一条承诺。** 先说那一条。

### 7.1 六个 `render*` 函数：**不委托、不动、也不标 deprecated**

旧 §7.1 与 brief C.9/C.10 承诺：六个带跨度的渲染函数保持签名，**实现改为委托新图元**。
**这条承诺活不过 live 转向，而且它是全计划里代价最高的一个隐藏假设。**

**为什么做不到。** 签名是 `(data, root) => void`——它画一次，然后什么都不返回。
一个活体表面需要 `update(state)`、`destroy()` 和一次宿主认领。
**你没法通过一个不返回任何可驱动之物的 API 交付运动**——这正是 `createAnalysisPlayhead`
从一开始就是一个独立函数、并且带一个 `WeakMap` 认领的理由。三个具体的失败：

1. **C.9 自己的硬门槛变得不可达。** `analysis.test.ts:29-30` 要求 2 段和弦下**恰好 2 个**带跨度的节点，
   且该 root 下**再无其他**跨度节点。一个活体 lane 想要 ruler、now 线和一条跨度轨；
   只要其中任何一个带上 `data-start-quarters`——而一条 now 线为了定位自己，最自然的做法就是带上它——
   计数变 3，门槛失败。**委托会逼着活体 mount 变得更不活，只为让薄壳的节点预算成立。** 尾巴摇狗。
2. **一个属性两个主人。** `createAnalysisPlayhead` 做 `root.querySelectorAll(ANALYSIS_SPAN_SELECTOR)`
   并**整条覆写 `style.cssText`**（`analysis.ts:150-159`）。一个在同一批节点上拥有自己 transition 的 mount，
   每次 playhead 走一步就丢一次。**两棵分开的节点树是唯一能让两者都正确的安排。**
3. **`@deprecated` 会是一句假话。** 它们不是被一个同形状的替代品取代了，它们是**另一类 API**。
   而且按 C.10 自己的注记，标它只买到 `ts(6385)` 的噪声。

**写进计划的决定：**

| 分组 | 去留 |
|---|---|
| `ANALYSIS_SPAN_SELECTOR` / `readAnalysisSpans` / `readAnalysisIdleStyle` / `AnalysisSpan` / `AnalysisPlayhead*` | **原样保留** |
| `createAnalysisPlayhead` | **原样保留，且只住在 `analysis.ts`**（它有 `WeakMap` 状态；跨子路径 re-export 可能让 tsup 多入口分块各拿一份，`claimHost` 的单宿主认领会静默失效） |
| `createAnalysisRoot` / `analysisStyle` | 保留，内部改为额外 stamp 新 token 层 |
| `renderHistogram` / `renderSummaryCard` / `appendSummaryRow` / `renderRhythmPatternList` / `renderAudioAnalysisCard` | **永远原样保留，不标 deprecated。** 诚实的一次性画笔。audio 的五个元素与 `packages/audio/test/analyze/analyze-elements.test.ts:353,367,377` 逐字节依赖它们的 DOM，而 audio 在 D3 之外 |
| `renderChordTimeline` / `renderRomanStrip` / `renderKeyView` / `renderMotifList` / `renderVoiceLeadingList` / `renderLiveChordPanel` | **保留、不改、也不标 deprecated——作为活体 mount *旁边*的静态薄片。** 它们与新 mount **只共享 `harmony-style.ts`（皮肤）与 `internal/spans.ts`（打点），不共享实现**。文档写成「一次性；要活的表面请用 `mount*`」 |
| 全部 `Analysis*` 数据类型 | 原样保留 |

**收益很大：`packages/ui/test/analysis.test.ts` 一个字符都不用改就是绿的**——
不是作为一道要跨过的门槛，而是作为分层的**后果**。
**brief 里最危险的两笔提交 C.9 / C.10 因此塌成一笔很小的**：抽出 `stampSpans`/`stampIdleStyle`、
六个渲染器改用它。活体表面搬去 `@webmusic/ui/harmony` + `/pitch` + `/workbench`——它们本来就要去那儿。

### 7.2 旧 token 兼容层

新 token 的解析链把旧名放在**最内层回退**，既有页面零改动继续生效：

| 旧 token | 新链条位置 |
|---|---|
| `--webscore-analyze-color` / `-bg` / `-border` / `-padding` | `--wui-harmony-ink` / `-surface` / `-line` / `-pad` 的第 4 层回退 |
| `--webscore-analyze-muted` / `-rule` / `-accent` / `-track` | `--wui-harmony-ink-muted` / `-line` / `-accent` / `-track` |
| `--wm-analysis-*` | 同上，位于 `--wm-harmony-*` 与 `--webscore-analyze-*` 之间 |

`--wm-degree-*` 与全部 `--wui-harmony-flow-*` / `-motion-*` 没有旧名对应（全新概念），默认值直接写在 tokens 记录里。

🔴 **A.3.3 双向陷阱**：一个 `--wui-*` 名字在文档页上被反引号引用**之前**，必须先在
`packages/{score,audio,ui}/src` 里真的存在；反过来，`analysis-view.mdx:64` 现在反引号引着八个
`--webscore-analyze-*`，**兼容层从源码里消失的那一刻**它就红。同一笔提交里两头对齐。

### 7.3 会破的东西（live 转向后的完整清单）

**完整的逐行清单在 brief §G.1**（42 条，按 🔴 必破 / 🟡 守住规矩才不破 / 🟢 被本章的决定保住 分级）。
这里只留结论：

| # | 破坏点 | 处置 |
|---|---|---|
| 1 | `elements.test.ts`（648 行）用手写 `StubNode` 假 document，活体 mount 的 `createElementNS` / `setAttribute` 会当场抛 | **迁 jsdom，但不是「零成本删 143 行」**：60 处引用会断、6 条断言会挂、5 条结构上无法表达（jsdom 没有监听器计数）。**拆文件**，见 brief C.5 / A.2.1 |
| 2 | 该文件钉住的 **35 条英文微文案 + 3 条否定断言** | **逐条保留**，落点见 §7.6。断言走深度拼接的 `text()`，所以只要字符串还在新结构里就成立 |
| 3 | `elements.test.ts:296-299`：chords 视图根下必须有直接 `<ol>` 子节点且非空 | **`mountWorkbench` 的 `index` 插槽**（§3.6.7）——语义孪生 `<ol>` 渲染成宿主的直接子节点、与工作台框架同级。**测试逐字节不动**，而且这在语义上本来就更对 |
| 4 | `elements.test.ts:339`：`host.children.length === 1` | 外壳是**一个**根节点；`disconnect` / 换 type 必须 `destroy()` 掉上一个 mount |
| 5 | `elements.test.ts:639-641`：**恰好 1 个** active 段 | 🔴 **逼近/预亮绝不许用字符串 `outline`**（§5.9）。`createAnalysisPlayhead` 独占该属性 |
| 6 | 🔴 **`elements.test.ts:264`：`<score-analysis>` 无 score 时 `host.children` 长度 0** | **必破，而且这正是重点。** `idle` 阶段意味着没有 score 也要渲染点什么；今天它渲染**字面意义上的什么都没有**，读者分不清它和一个拼错的标签。**改写成断言 idle 阶段**（`[data-phase="idle"]` 在、`<dl>` 不在），并在 commit message 里说明理由 |
| 7 | 🔴 **`new-elements.test.ts:146-165`：`<analysis-histogram>` 的 `.wui-analysis__histogram > div` = 12 / ≠12 / 未知 type 回落** | **必破，重写。** 双轨 mount 换了根类名。改写成新类名下的 12 行、每行一条 ghost 轨与一条 heard 填充、`type` 切换时 bin 顺序稳定。**同一笔提交里改** |
| 8 | `new-elements.test.ts:104-136`：`<rhythm-patterns>` 的五条 | 🟡 **五条都能保住，而且必须保住**：`<ol class="wui-analysis__rhythms">` 与直接 `<li>` 子节点保留、`data-spans` 留在 `<li>` 上、比例带不许写出负数或指数形式的数（正则拒绝）、加了 `2 / 3` 计数器后 `×N` 仍在文本里 |
| 9 | `analysis.test.ts`（236 行） | 🟢 **一个字符都不改**——这是 §7.1 决定的直接后果，不是一道门槛 |
| 10 | `packages/audio/test/analyze/analyze-elements.test.ts` | 🟢 audio 继续调 `renderHistogram`，且新 mount 取新类名。**audio 跑 vitest ^2.1.9，不是 ^3.2.6** |
| 11 | `playhead.test.ts:61,66,69` 钉着 `scrollIntoView` 次数 | 🟡 `createPlayheadHighlighter` 的 `scroll` **默认不变**，只有工作台传 `false`（§3.6.4） |
| 12 | `scripts/element-composition-policy.mjs:21-25` | 🔴 `analysis-view` → `['analysis','pitch','harmony','workbench']`；`analysis-timeline` / `analysis-histogram` / `rhythm-patterns` 若静态 import 了 `harmony`，就在**同一笔提交**里加 `'harmony'` |
| 13 | `params/score-analyze.ts` 与 `observedAttributes` 的**同序**等值 | 两处各加两个（view）与一个（histogram），**同一笔提交** |
| 14 | 三个新子路径的 13 处登记（硬编码计数 18 → 21） | 每个子路径**原子提交**。**live 转向没有增加子路径**（§3.0） |
| 15 | `packages/ui/test/ssr.test.ts` 与 `stylesheet-option.test.ts` 两张**手写**表 | 每个新 mount 各加一行，否则它静默地没有 SSR 与双路径覆盖 |
| 16 | 文档页 | `analysis-view.mdx` / `analysis-histogram.mdx` / `rhythm-patterns.mdx` / `analysis-timeline.mdx` / `score-analysis.mdx` / `uikit/views-analysis/analysis.mdx` 都要改，清单在 brief §G.3 |

**不破坏**：`@webmusic/score` 的任何公开 API、`AnalysisResult`、worker 协议、`useScoreAnalysis`、
`createAnalysisSession`、`bindAnalysisPlayer` 的**既有调用形态**（新参数是可选的第二个）、
`createPlayheadHighlighter` 的默认行为、`createLiveChordTracker` / `createLiveKeyTracker`；
`dist-exports.test.ts` 只要求 barrel 非空，不锁渲染形状。

### 7.4 audio 姊妹卡片

1. **步骤 1 落地即免费（已按实现修订，commit C.2）**：`renderAudioAnalysisCard` 与 `createAnalysisRoot`
   换用新 token 链，audio 的 5 个元素**一行不改**就拿到新的字号阶梯，以及一个**在宿主页面支持暗色时**
   才生效的暗色皮肤——这条走的是**内联路径**，不是样式表。

   **两处诚实的限定**：暗色是**继承来的**，不是强加的（§2.4）；
   `packages/audio/src/analyze/element/internal/theme.ts` 在 `createAnalysisRoot` **之后**
   用 `setProperty` 无条件写死 `--wm-analysis-accent/-muted/-track`，那三条正卡在新链中段，
   所以 audio 五个元素今天实际拿到的是新的**字号阶梯与几何**，颜色仍是 `--waa-*` 桥那一套。

2. **步骤 15（C.14）**：`<audio-analysis-view>` / `<audio-clip-summary>` / `<audio-histogram>` 套 `chrome:'bare'`；
   `<audio-analysis-timeline>` 换 12 色 tone 表；`--waa-*` 桥的四条形状属性改为在 `--wui-harmony-*` 之前回退。
3. **不做**：audio 不引入 `pitch` / `harmony` 图元，**也不做 live 转向**（D3）——
   音频侧的 key 检测没有拼写、没有和弦、没有指板，硬套会造出假精度。

### 7.5 两个元素的定性：一个是地图，一个是报告

**`<analysis-timeline>` 是地图，保持地图模型。**
它是全族**唯一**已经有真运动的元素，而它的运动模型恰好是 D2 排除的那一种。
把它改成 now 线，会让它与 `<analysis-view type="chords">` 无法区分，
同时撞上 `EXPECTED_ELEMENTS['Score Analyze'] = 5` 与 D1。**两种互补的模型是一个设计，同一种做两遍是一次重复。**
把这对配对写进 `analysis-timeline.mdx` 与 `analysis-view.mdx`，让读者能选对。

它在**自己的模型里**的四件活化，全都便宜，且一件都不碰 `AnalysisSeekDetail`：

1. **region 对 playhead 有反应。** `TimelineRegion` 本来就有 `selected`；今天 `#snapshot()`（`:155-165`）
   从不设它，于是线扫过时 region 是死的。一个表达式：`selected: playhead >= region.start && playhead < region.end`。
2. **逼近着色**：处在前瞻窗口里的 region 随线靠近而变亮，走 `--wui-harmony-motion-chip`。
   **这是 D2 的预期，用地图的布局交付。**（🔴 不许碰 `outline`，§5.9。）
3. **12 色定表取代字符串 hash。** `rootColor`（`analysis-timeline.ts:24-29`）让**同名和弦在两个元素里颜色不同**，
   这是缺陷不是风格：改为 `progressionTone(pitchClass)`。
4. **lane 切换用交叉淡入**，不是今天的整块拆建（`#handle?.update()` 已经避免了 remount）。

**`<score-analysis>` 是报告，保持报告。** 反对给它加动效的理由，按分量：

1. **每一行都是全曲标量**：parts / measures / notes / tempo / meter / key / confidence / range / 和弦段数
   （`headless/report.ts:31-46`）。没有一个是时间的函数。硬做动效只剩两条路，两条都坏：
   **(a)** 数到一个开播之前就已知的数——一条没有进度的进度条，「廉价」的定义；
   **(b)** 按已听到的前缀重算，于是这张卡**报告的数字和它文档里的不一样**。
   播放中「Notes: 544」变成「Notes: 137」是一个**错误答案**，不是一个活的答案。
2. **它被以这些字眼文档化为静态的**：`score-analysis.mdx:33`——“The card is static”。那是关于一个已发布元素的已发布承诺。
3. **实时的调读数已经有主人了。** `<analysis-view type="key">` 跑 `createLiveKeyTracker` 并印 `'live · N notes heard'`。
   在一张页面上放两个组件、用不同的数字宣称同一个事实，正是本仓门禁注释自己写过的那类分歧
   （`check-architecture.mjs:766-772`）。

**它得到的是「会响应」，不是「有动画」**：`chrome:'bare'` 外壳（同一套 token、同样的暗色行为、一个真的 `data-phase`）；
`idle` 骨架与 `error` 卡（今天没有 score 就渲染**字面意义上的什么都没有**，`:49` 静默 return）；
本来就是范围的事实变成几何（`Range: C4–C6` 画成键盘宽度的轨上两个标记，`Confidence 82%` 画成 meter——
`harmonyParts.meterTrack` / `meterFill` 已经存在）；一次 120ms 的载入过渡；
以及**至多一个**实时读数：走带位置（`bar 12 · beat 3`）在状态条里。那是关于**走带**的事实，不是关于乐谱的，所以不撞车。

**文档后果**：把 `score-analysis.mdx:33` 从「The card is static」改写成
「The card states whole-piece facts; they do not change while the piece plays —
the live key read-out is `<analysis-view type="key">`.」**说出为什么，比它替换掉的那句更值钱。**

`ScoreReport` 的一处诚实缺口：`rows` 返回的是显示**字符串**（`report.ts:19`），
想自己画一条置信度 meter 的消费者得去反解 `'82%'`。**加性修复：`rows[].value?: number`。** 不破坏任何东西。

### 7.6 13 个被钉死的字符串，现在各自住在哪

`elements.test.ts` 里这些 `toContain` 在活化之后必须继续成立。**这不是巧合，是照着它们设计的**：

| 字符串 | 行 | 新住处 |
|---|---|---|
| `'C major'` | 286, 347, 457, 478 | `key` 轮盘中心读数 + 语义孪生 `<ol>` |
| `'confidence'` | 287, 333（且 337 `not.toContain`） | 轮盘中心副读数；切走后整块被 destroy → 否定断言照旧成立 |
| `'beat 1'` | 300, 338 | `chords` 钉住读数 `bar 1 · beat 1`（**停靠态就成立，不需要播放**） |
| `'in C major'` | 308 | `roman` 钉住 caption |
| `'intervals'` | 317 | `motifs` 语义孪生 `<ol>` 的每条 `<li>`（台上不再印它） |
| `'clean'` | 325 | `voice-leading` 空态句 |
| `'A minor'` | 351 | 轮盘内环 + 语义孪生 `<ol>`（用 clip 隐藏，**不是 `display:none`**） |
| `'sounding now'` | 380 | `live-chord` caption |
| `'waiting for playback'` | 381, 421, 543 | `live-chord` voicing 行空态 |
| `'—'` | 382, 396 | 名牌空值 = `NO_CHORD_LABEL`（`core/chord-spelling.ts:55`，已落地） |
| `'CM'` | 391, 537 | 名牌主符号 |
| `'C4'` / `'G4'` | 392, 393 | 名牌 voicing 行（`formatPitch` 回调仍由 score 提供） |
| `'listening'` | 450, 505 | 状态条 `listening — press play` |
| `'live · N notes heard'` | 458, 473, 496（且 477, 504 `not.toContain`） | 状态条，**不复数化**，原样 |
| `'Key'` / `'C major'` / `'Notes'` / `'13'` | 253-257 | `<score-analysis>` 的 `renderSummaryCard`，**bare 外壳包住它、不替换它** |
| `<ol>` 是根的直接子节点且非空 | 296-299 | `mountWorkbench` 的 `index` 插槽（§3.6.7） |

> 这张表是动手前要先读的那一张。上面每一条都有确定落点——
> **唯一需要新机关的是最后一行**，而那个机关（语义孪生 `<ol>`）本来就是滚动画布的无障碍必需品，
> 不是为了过测试硬造的。

---

## 8. 实施顺序（一段一 commit，每步门禁独立绿）

> **live 转向把序列从 13 笔变成 16 笔**，但**不是**因为多了工作：
> 它删掉了一整笔（旧 C.10 的「三个读数委托」——§7.1 撤销了委托），又拆出四笔更小更安全的。
> 编号与 brief §C 一一对应，方括号里是 brief 的标签。

| # | commit | 内容 | 验收 |
|---|---|---|---|
| 0 | `chore: the probe scratch is not part of the repo` **[C.1]** | 删 `.probe/` | `eslint .` 退出 0 |
| 1 | `refactor(ui): the analysis skin is one token record, not eight literals` **[C.2]** ✅ 已落地 `344df6e` | `harmony-style.ts`；`analysis.ts` 内联样式改从记录取值；旧 token 进回退链最内层；修 A.3.15 的 idle 串缺分号 | `analysis.test.ts` 一字未改仍绿；`token-chain.test.ts` |
| 2 | `feat(score): a pitch knows how it is spelled before it knows where it sits` **[C.3]** ✅ 已落地 `816bb21` | `core/chord-spelling.ts` + `core/staff-placement.ts` | 转位/rootless/enharmonic 各一例；`staffPlacement(42)` 给 **2** 条加线 |
| 3 | `feat(score): a chord knows where a hand can reach it` **[C.4]** | `core/fretboard-voicing.ts` + `core/key-wheel.ts` | `Cmaj7` → `3-2-2-4-1-3`；ukulele → `0-0-0-2` |
| 4 | `test(score): the analysis elements run in a real document` **[C.5]** | `elements.test.ts` 拆成 jsdom + `elements-ssr.test.ts`；**不删断言，只重新表达** | 测试数不减；`npm test -w @webmusic/score` 全绿。**这是 5–13 的前置**（活体 mount 会在 StubNode 上抛） |
| 5 | `feat(ui): pitch surfaces — keyboard, staff, fretboard` **[C.6]** | `pitch.ts` + 13 处子路径登记（18→19）+ 页 + demo + `no-notation-glyphs.test.ts`；`internal/pitch-geometry.ts` | 5 处 `compareExactSet` 绿；重复 `update()` **按 `data-midi` diff 复用**；`clefs` 缺省时 DOM 无 `<text>` |
| 6 | `feat(ui): harmony read-outs — nameplate, chip-strip, wheel` **[C.7]** | `harmony.ts`（三个 mount）+ `internal/spans.ts` + 登记（19→20）+ 页 + demo | `spans-contract.test.ts`：`stampSpans` 产物被既有 `readAnalysisSpans` 原样读回，且 `data-webscore-idle-style` 序列化的是**画完之后的完整**内联样式 |
| 7 | `feat(ui): one frame loop, and the lane that rides it` **[C.7b]** | `internal/frame.ts` + `internal/motion.ts` + **`mountFlowLane`**（住进已登记的 `harmony.ts`，**零登记 churn**）；`ssr.test.ts` 与 `stylesheet-option.test.ts` 各加一行 | `flow-lane.test.ts`：`data-zone` 只在穿越时变（连续 60 帧 `tick()` 后属性写次数 ≤ 穿越次数）· band 节点在播放期间**身份不变** · `stepped` 与 `continuous` 的布局**逐像素相同** · `index` 的 `<li>` 与 `bands` 逐项对应 · 订阅者为 0 时 rAF 从未被调用 |
| 8 | `feat(ui): the workbench is the shell every analysis view sits in` **[C.8]** | `workbench.ts` + 登记（20→21）+ 页 + demo；`index` 插槽 + `FrameClock` | roving tabindex + 手动激活；`dock()` 隐藏返回 undefined；**`update()` 幂等且不重建 slot**；`clock` tick **只调 `tick()` 绝不调 `update()`**；`phase` 非播放态**不开 rAF** |
| 9 | `refactor(ui): the span-carrying renderers share the stamp and the skin` **[C.9]** | 六个渲染器改用 `stampSpans`/`stampIdleStyle` 与 `harmonyParts`。**不委托、不加动效、不标 deprecated**（§7.1） | **`packages/ui/test/analysis.test.ts` 一个字符都不改仍绿**——这次是分层的后果，不是一道门槛。旧 C.10 **撤销** |
| 10 | `fix(score): a seek at rate != 1 lands where it was clicked` **[C.10a]** | `analysis-timeline.ts` 的 `#seek`：`player.seek()` 收走带秒（§4.3(2)） | 一条 `rate = 2` 的 jsdom 回归；事件 detail 仍是名义秒 |
| 11 | `feat(score): the transport clock is arithmetic, not a DOM event` **[C.10b]** | `headless/transport-clock.ts` + `headless/index.ts` barrel + `player-binding.ts` 加宽（第二个可选参数）+ `createLiveDistributionTracker` | `transport-clock.test.ts` **全程整数毫秒、不 mount 任何东西**：暂停滑行有界、seek 撞 epoch、变速从 detail 读、循环回卷同 seek 路径。`score-map.ts:240` 与 `analysis-timeline.ts:196` **一字未改** |
| 12 | `feat(score): six views, one workbench` **[C.11]** | `headless/workbench.ts`（五个投影返回 `FlowLaneView`，签名收 `Score`）+ `internal/recipes.ts`；`analysis-view.ts` 瘦身为壳；`score-source.ts` 的 error 通道 | 每视图一条 jsdom 测试：切 type → 舞台图元正确、坞位集合正确、空态文案不变；`elements.test.ts` 与 `elements-ssr.test.ts` 全绿（§7.6 的落点全部命中） |
| 13 | `feat(score): the view says how dense it is and how it moves` **[C.12]** | 13 个属性（含 `motion` / `window`）+ 三个新事件 + params 目录同序 + mdx 重写 + `attributeChangedCallback` 重入守卫 | `check:docs` 的 params↔`observedAttributes` 同序等值；`ElementPlayground` 自动生成 **13** 个控件 |
| 14 | `feat(score): the histogram accumulates and the figures fire` **[C.13]** | `<analysis-histogram>` 双轨 + `player` 属性 + params 同步；`<rhythm-patterns>` 比例带 + 出现轨 + now 线 + `2 / 3` 计数 | `new-elements.test.ts` 的 histogram 五条**在本笔提交里改写**；rhythm 的五条**逐字节保住**；🔴 逼近态不含 `outline` |
| 15 | `feat(score,audio): the analysis family shares one skin` **[C.14]** | `<score-analysis>` 的 bare 外壳 + idle/error 骨架（`:264` 在本笔改写）；`<analysis-timeline>` 12 色 tone 表 + 四件活化；audio 四元素；`element-composition-policy.mjs` 与 21 子路径的散文清扫 | `analyze-elements.test.ts` 逐字节不变且绿；`npm run check && npm run docs:build` |

**风险最高的三笔**：4（648 行测试拆写）、5/6/8（每个子路径 13 处登记必须同 commit 全对）、
12（六个视图 + 投影 + error 通道一起落）。
**风险最低的两笔是新加的**：7 与 11——它们各自只有一个新概念，且都能用整数与假 `view` 测。

**依赖（brief §D.4 的补充）**：

| 需要先有 | 因为 |
|---|---|
| 1 早于三个子路径提交 | `harmony-style.ts` 是八个 mount 唯一的调色板来源 |
| 4（jsdom）早于 5–15 | 活体 mount 的 `createElementNS` / `setAttribute` 在 StubNode 上抛；`mountFlowLane` 两样都用 |
| 6 早于 7 | `mountFlowLane` 与 `internal/spans.ts` 住同一个已登记的子路径 |
| 7 早于 8 | 外壳的 `FrameClock` 包的是 `internal/frame.ts` |
| 11 早于 12 | 六个视图的 `binding.position()` 是 `transport-clock` 的两行适配器 |
| 12 早于 13、14、15 | 属性、投影与配方表是后三笔的地基 |
| 构建 ui 早于跑 score/audio 测试 | score 源码 import `@webmusic/ui/analysis`，exports map 指向 `dist/` |

---

## 9. 文档站计划

**新增**：`uikit/views-analysis/{pitch,harmony,workbench}.mdx`（标题必须是 `'@webmusic/ui/<name>'`，顺序 LiveDemo → `## Import` → `<summary>API</summary>` → `<summary>Styling</summary>` → Related，文件以 Related 结尾——`check-architecture.mjs:1409-1449` 逐条校验）。

**改动**：`apps/doc/shared/ui-presenter-catalog.ts`（`UiPresenterName` 三项 + 三条目录条目，`consumerTags: ['analysis-view']`）、`ui-presenter-demos/views-analysis.ts`（三个 **`if (presenter === '…')` 分支**，**不是 `switch`**——brief A.3.2：带字符串 case 的 `switch` 会被门禁盲扫成幽灵 presenter）、`scripts/check-architecture.mjs`（`uiPresenterClassPolicy` + 计数 18→21）、`scripts/package-policy.mjs`、`scripts/element-composition-policy.mjs`（`analysis-view` 的 ui 数组 → `['analysis','pitch','harmony','workbench']`）、`packages/ui/package.json`（exports + build entry）、`packages/ui/src/index.ts`、`packages/ui/README.md` §10、`uikit/api.mdx`、`score/element/analyze/analysis-view.mdx`、`lib/params/score-analyze.ts`。

**demo 怎么驱动**：沿用既有两套机制，不发明第三套。元素页用 `ElementPlayground` + `LiveDemoCanvas`（控制条按 `ELEMENT_PARAMS` 自动生成 **13** 个属性开关，拨动即写到真元素上——这也是 §6 要求属性反射的直接理由）；uikit 页用 `UiPresenterLiveDemo`，三个 presenter 的 mock 数据集中放一份 `WORKBENCH_FIXTURE`，**三页展示同一段音乐**，读者能对上号。

**harmony 页的 demo 必须演出滚动**：`UiPresenterLiveDemo` 里给 `mountFlowLane` 接一个假时钟
（`binding.position(tick)` 返回 `tick.time / 1000` 之类），并在页面上放一个减动效开关，
让读者当场看见 `continuous` 与 `stepped` 的**布局逐像素相同**。一个静止截图卖不掉这个设计。

**顺带修一个文档 bug**：`apps/doc/.../score/api/analyze.mdx:15` 声称使用 `@tonaljs/progression`，而该包既不在依赖也不在 node_modules。

---

## 10. 可点原型（已交付，**先于 live 转向**）

> **原型早于 §0 的转向，它的舞台仍然是静态清单。** 它证明的是**坞位的单一真值来源**
> （下面那两条验证实验），那一部分照旧成立；它**没有**证明传送带。
> 别拿它当 §3.6 的参考实现，也别照着它的舞台写代码。

`dev/prototypes/harmony-workbench.html` —— 单文件、零构建、零网络、双击即开；已发布为 Artifact 便于在别的设备上看。

七屏：`live-chord` / `key` / `chords` / `roman` / `motifs` / `voice-leading` / **图元墙**（六个图元各自单独一块，证明它们能脱离视图存在）。

十项可操作：tab 手动激活（`←/→` 移焦点、`Enter` 切换）、五个展示开关、密度、明暗、拼写（♯/♭/auto）、调弦（standard / drop-D / ukulele）、五态强制、宿主宽度滑块（320 → full，验容器查询三档）、走带模拟、**点备选命名**。

已用 jsdom 跑过全部交互（0 运行时错误），其中两条是设计的验证实验：

- 点 `Cmaj7` 的备选 `Am9 (no root)` → 键盘角色由 `48:root 64:third 67:fifth 71:seventh` **整体重算**为 `48:bass 64:fifth 67:seventh 71:extension`，谱表符头同步换色。**（角色算术成立；`Am9 (no root)` 这个命名本身 `detect()` 给不出来——见 §5.7 与 brief A.2.10。）**
- 切 ♭ → `E7` 的 `E2 G♯3 B3 D4` 变成 `E2 A♭3 B3 D4`，名牌与谱面记号同步。任何一处不同步都说明设计里混进了第二个拼写来源。

**原型与实现的差异边界**（原型页首也写了）：和弦命名/拼写/把位在原型里是内联的最小替身，实现里由 score 的四个 core 模块实时算；原型没有 `Score` 解析、worker、增量 session；播放是 `setInterval` 假事件；样式是一个 `<style>` 块而非 token-as-data 双路径；没有 `destroy()` / `claimHost` / SSR；谱号用 Unicode 字形，实现里由 score 传入。

---

## 11. 核实过的门禁事实（设计据此成立）

| 事实 | 出处 |
|---|---|
| ui 源码禁止乐谱字符 `/[♩-♯]\|[\u{1D100}-\u{1D1FF}]/gu`，范围 `packages/ui/src/**`（不含 test，**含注释**） | `scripts/check-architecture.mjs:784-798` |
| 新增 ui 子路径 = **13 处登记、跨 9 个文件**（旧稿写 11），含 5 处 `compareExactSet` + 硬编码计数 `!== 18` **两行**（条件与消息串）+ 必须被元素**运行时、非 type、非 dynamic** 地静态 import | `check-architecture.mjs:1048-1049, 1288-1293, 1327-1350, 1385-1398, 1409-1476`、`package-policy.mjs:38-59`（**不是** `check-package-exports.mjs`）；brief A.1.4 |
| 一个子路径可承载多个 mount（`stage.ts` 有 3 个） | `packages/ui/src/stage.ts:195, 308, 577` |
| `EXPECTED_ELEMENTS['Score Analyze'] = 5` | `check-architecture.mjs:29-37` |
| `internal/playhead.ts` 专项白名单：禁 `querySelector`/`.style`/`.cssText`/`ANALYSIS_SPAN_SELECTOR`，必须调 `createAnalysisPlayhead(`；**纯文本扫描，含注释**，且按硬编码路径读文件 | `check-architecture.mjs:1269-1285` |
| params ↔ `observedAttributes` **含顺序**等值；**追加到末尾是允许的**，规矩只是两张表同序 | `check-docs.mjs:126-149`；brief A.2.13 |
| `createAnalysisPlayhead` **有一个 `scroll` 选项**，默认 `true`；`createPlayheadHighlighter` 今天不传它 | `ui/src/analysis.ts:168-171`、`score/src/analyze/element/internal/playhead.ts:21` |
| `playhead.test.ts` 逐字节钉着 `scrollIntoView` 的**次数**——改默认值当场变红 | `packages/score/test/analyze/playhead.test.ts:61, 66, 69` |
| `webscore:timeupdate` 是 **20Hz**（`cursorIntervalMs ?? 50`），并被同一间隔节流 | `play/headless/score-player.ts:135`、`score-player-scheduler.ts:554-560` |
| `pause()` **不发**任何 cursor（没有 `webscore:pause`）；`seek()` / `retune()` / `wrapLoop()` **都立刻发**一个 | `score-player-scheduler.ts:175-189, 216-229, 455-457, 845, 922-932` |
| timeupdate 的 detail 已经带 `nominalSeconds` / `transportSeconds` / `transportDurationSeconds` / `progress`；`bindAnalysisPlayer` **只转发 `seconds`** | `play/element/simple-score-player.ts:570-587`、`analyze/element/internal/player-binding.ts:26-28` |
| 🔴 `player.seek()` 收的是**走带秒**：先按 `duration = timeline.duration / rate` 夹取，再 `seekTo(clamped * rate)`。`<analysis-timeline>` 传的是**名义秒** | `score-player-scheduler.ts:216-229`、`analysis-timeline.ts` 的 `#seek` |
| `TimeMap.secondsToQuarters` 每次调用 `new Rational` 并量化到 1/480 —— 不许放进帧循环 | `packages/score/src/core/time/TimeMap.ts:479-486` |
| `createLiveKeyTracker` 按**音符个数**加权且不暴露 bin；`distributions()` 按**发声时长**加权 —— 两者不可混画 | `headless/live-trackers.ts:82-103`、`core/distributions.ts:83-99` |
| `ScorePlayer` 有 `setLoop`/`clearLoop` 而**没有 getter** —— lane 只能检出回卷，不能预测 | `play/headless/score-player.ts:260-266` |
| `TimelineState.loop` 已有可选形状，可照抄给 `FlowLaneState` | `packages/ui/src/timeline.ts:33` |
| `detect()` 返回**已排序的字符串数组**，不返回权重（旧稿的 `score: 0…1` 无数据源）；对 1 音、2 音、12 音簇返回 `[]` | `@tonaljs/chord-detect@4.9.1`；brief A.1.1 / A.2.9 |
| `chord.get()` 的 `rootDegree` 实测是 **`NaN`** 不是 `null`，`??` 抓不住 | `@tonaljs/chord@6.1.2`；brief A.1.2 |
| 既有 `pcName()` 是一张固定混合升降的表，**实现不了 `spelling:'sharp'\|'flat'`** | `analyze/core/pitch-class.ts:1`；brief A.2.7 |
| score 直接依赖只有 `abc-notation` / `chord` / `chord-detect`（外加 `@tonejs/midi` / `fast-xml-parser` / `fflate` / `staffrender`）；`pitch-note` 是**传递**依赖 | `packages/score/package.json:280-286` |
| **ui 零运行时依赖**（连 `peerDependencies` 键都没有） | `packages/ui/package.json` |
| 43 个 `.wui-*` 根名已被 `apps/doc/shared/ui.css` 占用，**注释也算**；本设计的自然候选几乎全被占 | `check-docs.mjs:611-637`；brief A.3.1 |
| `apps/doc/.../ui-presenter-demos/*.ts` 里**不许写带字符串 case 的 `switch`** —— 门禁盲扫会造出幽灵 presenter | `check-architecture.mjs:1385-1393`；brief A.3.2 |
| `packages/ui/test/{ssr,stylesheet-option}.test.ts` 是**手写清单**，没有自动发现 | brief A.3.12 |
| `elements.test.ts` 的 StubNode 假 document 只有 `createElement`，**没有 `createElementNS` / `setAttribute`**；迁 jsdom 会断 60 处引用、挂 6 条断言、5 条结构上无法表达 | `elements.test.ts:12-154`；brief A.2.1 |
| `analysis.test.ts:29-30` 钉「2 段和弦 = 恰好 2 个跨度节点，且再无其他」 —— 这是 §7.1 撤销委托的直接原因 | `packages/ui/test/analysis.test.ts:29-30` |
| `elements.test.ts:639-641` 钉「**恰好 1 个** active 段」，判定方式是 `cssText.includes('outline')`（`outline-offset` / `-color` 也含该子串） | `elements.test.ts:583, 586, 607, 639, 645`、`analysis.test.ts:89` |
| `<analysis-histogram>` 的 `observedAttributes` 今天是 `['src','format','type']` —— **它绑不了 player** | `analyze/element/analysis-histogram.ts:33-35` |
| `<score-analysis>` 无 score 时静默 return，渲染**字面意义上的什么都没有** | `analyze/element/score-analysis.ts:49`；`elements.test.ts:260-264` |
| `analysisStyle` **导出但从不安装**，`cssText` / `paint()` 带不了 `@media` —— 减动效必须由 JS 读 `matchMedia` | `packages/ui/README.md:422`；brief A.2.3 |

## 12. 已拍板的与仍待拍板的

**已拍板（本轮不再重开）：**

1. **子路径数 = 3**（`pitch` / `harmony` / `workbench`），硬编码计数 18 → 21。
   **live 转向没有增加它**——`mountFlowLane` 是第四个住进 `harmony.ts` 的 mount（§3.0）。
2. **传送带图元叫 `mountFlowLane`，且不吞掉 `mountChipStrip`**（§0.5 第 1、2 条）。
3. **时钟三层**：kit 的 `internal/frame.ts` 持循环、外壳持每帧那一次读数、score 的 `headless/transport-clock.ts` 持预测（§0.5 第 3 条）。
4. **六个 `render*` 保持静态、不委托、不标 deprecated**（§7.1）。
5. **lane 轴是名义秒，打点走 `stampStart`/`stampEnd`**（§0.5 第 5 条）。
6. **离屏 band 永不摘**（§0.5 第 6 条）。
7. **`live-chord` 的历史条**：保留，但改为尾流带（按实际时长的 band），不再是 8 个等宽芯片（§5.7）。
   它与 `chords` 视图的信息重复问题因此消失——一个是无谱的实时，一个是有谱的全曲。

**仍待你拍板：**

1. **指板默认是否开**：本稿在 `chords` / `key` / `live-chord` 三个视图默认开、
   `roman` / `motifs` / `voice-leading` 默认关。chordie 是默认开且可在偏好里关掉。
2. **`elements.test.ts:264` 的改写**（§7.3 第 6 行）：`<score-analysis>` 没有 score 时到底渲染
   `idle` 骨架（要改那条断言），还是继续渲染空（保住断言、放弃这个元素唯一诚实的升级）。
   本稿选前者，理由写在 §7.5。
3. **`Am9 (no root)` 那个旗舰演示**（§5.7 的告示框）：从文案里拿掉，还是在 C.4 里预算一次
   `extended()`/`reduced()` 的超集搜索。本稿倾向拿掉——它不是「数据本来就在手里」。
