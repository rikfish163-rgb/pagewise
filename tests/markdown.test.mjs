import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'tsx/esm/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

register();
const { default: MarkdownAnswer } = await import('../components/MarkdownAnswer.tsx');
const { markdownSummary } = await import('../lib/markdown.ts');
const render = content => renderToStaticMarkup(React.createElement(MarkdownAnswer, { content }));

test('actual answer component renders Chinese emphasis beside quotes and punctuation', () => {
  const html = render('这是**“Pure Pursuit 跟踪”**的意思；“**Pure Pursuit 跟踪**”会转弯。');
  assert.match(html, /<strong>“Pure Pursuit 跟踪”<\/strong>/);
  assert.match(html, /“<strong>Pure Pursuit 跟踪<\/strong>”/);
  assert.ok(!html.includes('**'));
});

test('renders semantic headings, paragraphs, nested lists, quotes and escaped code', () => {
  const html = render('# 跟踪控制\n\n先看**目标点**。\n\n1. 选择目标\n   - 前视距离\n2. 计算曲率\n\n> 不等于路径规划\n\n```js\nconst x = "<script>";\n```\n\n行内 `a_b`。');
  for (const tag of ['h1', 'p', 'ol', 'ul', 'blockquote', 'pre', 'code']) assert.match(html, new RegExp(`<${tag}[ >]`));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>a_b<\/code>/);
});

test('renders dollar and LaTeX bracket inline and display math with accessible MathML', () => {
  const html = render(String.raw`曲率 $\kappa = \frac{2\sin\alpha}{L_d}$，或 \(x^2\)。

$$
\begin{bmatrix}1 & 0 \\ 0 & 1\end{bmatrix}
$$

\[E=mc^2\]`);
  assert.equal((html.match(/<math[ >]/g) || []).length, 4);
  assert.equal((html.match(/class="katex-display"/g) || []).length, 2);
});

test('code stays literal, malformed math stays visible, ordinary currency stays text', () => {
  const html = render('`$x^2$`\n\n```text\n\\(x\\)\n```\n\n价格 $20。未完成 $x。\n\n$\\notARealCommand{x}$');
  assert.match(html, /<code>\$x\^2\$<\/code>/);
  assert.match(html, /价格 \$20/);
  assert.match(html, /notARealCommand/);
});

test('never executes raw HTML, unsafe links or Markdown and TeX tracking images', () => {
  const html = render(String.raw`<script>alert(1)</script><img src="https://tracker.test/raw" onerror="alert(1)">

![远程图片](https://tracker.test/pixel.png)

[恶意](javascript:alert%281%29) [安全](https://example.com)

$\includegraphics{https://tracker.test/math.png}$

$\href{javascript:alert(1)}{危险}$`);
  assert.doesNotMatch(html, /<(script|img|iframe)\b/i);
  assert.doesNotMatch(html, /href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /远程图片/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('plain memory summaries remove formatting without cutting Markdown markers', () => {
  assert.equal(markdownSummary('# 标题\n\n这是**“Pure Pursuit 跟踪”**的[说明](https://example.com)。\n\n- `曲率`\n- $x^2$'), '标题 这是“Pure Pursuit 跟踪”的说明。 曲率 x^2');
  assert.equal(markdownSummary('**目标点**和后续解释', 4), '目标点和…');
  assert.equal(markdownSummary('🙂🙂🙂', 2), '🙂🙂…');
  assert.equal(markdownSummary('![图片](https://tracker.test/pixel)\n\n真实内容'), '真实内容');
});

test('legacy standalone bold titles tolerate inner padding, without rewriting code or escaped text', () => {
  const legacy = '**原文含义（背景推断） **\n\n说明。\n\n** 直观理解 **';
  const html = render(legacy);
  assert.match(html, /<strong>原文含义（背景推断）<\/strong>/);
  assert.match(html, /<strong>直观理解<\/strong>/);
  assert.equal(markdownSummary(legacy), '原文含义（背景推断） 说明。 直观理解');
  const literal = render('`**原文含义（背景推断） **`\n\n```md\n**原文含义（背景推断） **\n```\n\n\\*\\*原文含义（背景推断） **');
  assert.doesNotMatch(literal, /<strong>/);
  assert.match(literal, /<code>\*\*原文含义（背景推断） \*\*<\/code>/);
});

test('legacy inline padded strong repairs the exact screenshot sentences and memory summaries', () => {
  const core = '它的核心想法是：**不直接追着当前最近点，而是看前方一个“预瞄点”，然后让车头朝这个点转过去。 **';
  const category = '常见于**路径跟踪/轨迹跟随算法 **，用于移动机器人。';
  assert.match(render(core), /它的核心想法是：<strong>不直接追着当前最近点，而是看前方一个“预瞄点”，然后让车头朝这个点转过去。<\/strong>/);
  assert.match(render(category), /常见于<strong>路径跟踪\/轨迹跟随算法<\/strong>，用于移动机器人。/);
  assert.equal(markdownSummary(core), '它的核心想法是：不直接追着当前最近点，而是看前方一个“预瞄点”，然后让车头朝这个点转过去。');
  assert.equal(markdownSummary(category), '常见于路径跟踪/轨迹跟随算法，用于移动机器人。');
  for (const literal of [String.raw`转义 \*\*路径跟踪 **，保留`, '`**路径跟踪 **`', String.raw`$\text{**路径跟踪 **}$`, String.raw`\(**路径跟踪 **\)`]) {
    assert.doesNotMatch(render(literal), /<strong>/);
  }
});

test('valid adjacent strong spans keep their own closing delimiters and normal joining text', () => {
  const html = render('**采样** 和 **混叠**');
  assert.match(html, /<strong>采样<\/strong> 和 <strong>混叠<\/strong>/);
  assert.equal((html.match(/<strong>/g) || []).length, 2);
  assert.equal(markdownSummary('**采样** 和 **混叠**'), '采样 和 混叠');
});

test('slide pagination respects Markdown code blocks and setext headings',async()=>{
 const {presentationPages}=await import('../lib/markdown.ts');
 const first=['标题','---','','```text','---','```'].join('\n');
 assert.deepEqual(presentationPages(first+'\n\n---\n\n第二页'),[first+'\n','\n第二页']);
 assert.deepEqual(presentationPages(''),['']);
});

test('notebook contents link headings to their actual slide and position',async()=>{
 const {notebookNavigation}=await import('../lib/markdown.ts');
 const {headings}=notebookNavigation('# 回顾\n\n```md\n# 示例\n```\n\n---\n\n## 采样\n\n### 混叠');
 assert.deepEqual(headings.map(({text,slide,position})=>[text,slide,position]),[['回顾',0,0],['采样',1,0],['混叠',1,1]]);
});
