import { renderMarkdown } from '../lib/markdown';

/** Import markdown-answer.css and katex/dist/katex.min.css in the consuming UI. */
export default function MarkdownAnswer({ content }: { content: string }) {
  return <div className="markdown-answer" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
}
