import MarkdownIt from 'markdown-it';
import { cjkFriendly } from '@mdit/plugin-cjk-friendly';
import { katex } from '@mdit/plugin-katex';

// Model output is untrusted: never enable raw HTML or trusted TeX extensions.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false })
  .use(cjkFriendly)
  .use(katex, {
    delimiters: 'all',
    mathFence: true,
    trust: false,
    throwOnError: false,
    maxExpand: 1000,
    maxSize: 10,
    logger: () => 'ignore' as const,
  });

markdown.inline.ruler.before('emphasis','highlight',(state,silent)=>{
  if(!state.src.startsWith('==',state.pos))return false;
  const end=state.src.indexOf('==',state.pos+2);
  if(end<=state.pos+2||end>=state.posMax)return false;
  if(!silent){state.push('mark_open','mark',1);state.push('text','',0).content=state.src.slice(state.pos+2,end);state.push('mark_close','mark',-1);}
  state.pos=end+2;return true;
});

// Older answers padded their strong delimiters: `**标题 **` / `**解释。 **`.
// Accept only a plain-text, same-line pair. The normal inline parser has already
// consumed code, math and escapes before visiting an unescaped opening `**`.
// Nested markup and TeX are deliberately left to their original parser rules.
markdown.inline.ruler.before('emphasis', 'legacy_padded_strong', (state, silent) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '**') return false;
  const delimiters = state.scanDelims(state.pos, true);
  // A closing delimiter in `**采样** 和 **混叠**` must remain a closing
  // delimiter. Leading inner padding is accepted only at the start of a line.
  const lineStart = state.src.lastIndexOf('\n', state.pos - 1) + 1;
  if (!delimiters.can_open && !/^[ \t]*$/.test(state.src.slice(lineStart, state.pos))) return false;
  const match = state.src.slice(state.pos + 2, state.posMax).match(/^([^*\\\n`$]+?)\*\*/);
  if (!match || !/[ \t]$/.test(match[1]) || !match[1].trim()) return false;
  if (!silent) {
    state.push('strong_open', 'strong', 1).markup = '**';
    state.push('text', '', 0).content = match[1].trim();
    state.push('strong_close', 'strong', -1).markup = '**';
  }
  state.pos += match[0].length + 2;
  return true;
});

// Images in a response must not make requests to model-supplied tracking URLs.
markdown.renderer.rules.image = (tokens, index) =>
  markdown.utils.escapeHtml(markdown.renderer.renderInlineAsText(tokens[index].children || [], markdown.options, {}));
const defaultLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet('rel', 'noopener noreferrer');
  tokens[index].attrSet('referrerpolicy', 'no-referrer');
  return defaultLink ? defaultLink(tokens, index, options, env, renderer) : renderer.renderToken(tokens, index, options);
};

export function renderMarkdown(content: string): string {
  return markdown.render(content);
}

// Derive previews from parsed content, rather than slicing syntax mid-delimiter.
export function markdownSummary(content: string, limit = 100): string {
  type TextToken = { type: string; content: string; children?: TextToken[] | null; block: boolean };
  function text(tokens: TextToken[]): string {
    return tokens.map(token => {
      if (token.type === 'image') return '';
      if (token.children) return text(token.children);
      if (token.type === 'softbreak' || token.type === 'hardbreak') return ' ';
      if (token.type === 'text' || token.type === 'code_inline' || token.type.startsWith('math_')) return token.content;
      if (token.type === 'fence' || token.type === 'code_block') return ` ${token.content} `;
      return token.block ? ' ' : '';
    }).join('');
  }
  const plain = text(markdown.parse(content, {})).replace(/\s+/g, ' ').trim();
  const characters = Array.from(plain);
  const length = Math.max(0, limit);
  return characters.length > length ? `${characters.slice(0, length).join('')}…` : plain;
}

// Only top-level thematic breaks start a new slide. Fenced code and quoted
// examples can contain the same characters without interrupting the page.
export function notebookNavigation(content: string) {
  const lines = content.split(/\r\n?|\n/);
  const pages: string[] = [];
  const headings: {text:string;level:number;slide:number;position:number}[] = [];
  const tokens = markdown.parse(content, {});
  let start = 0;
  let position = 0;
  for (const [index, token] of tokens.entries()) {
    if (token.type === 'heading_open') {
      headings.push({text:tokens[index+1]?.content || '无标题', level:Number(token.tag.slice(1)), slide:pages.length, position:position++});
    }
    if (token.type === 'hr' && token.level === 0 && token.map) {
      pages.push(lines.slice(start, token.map[0]).join('\n'));
      start = token.map[1];
      position = 0;
    }
  }
  pages.push(lines.slice(start).join('\n'));
  return {pages, headings};
}

export function presentationPages(content: string): string[] {
  return notebookNavigation(content).pages;
}
