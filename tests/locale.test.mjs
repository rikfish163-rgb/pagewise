import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { register } from 'tsx/esm/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { resolveLocale, translate } from '../lib/i18n.ts';
import { englishMessages } from '../lib/messages-en.ts';
import { searchStudy } from '../lib/study-search.ts';
import { evidencePageLabel } from '../lib/learning-memory.ts';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('.css')) return { url: 'data:text/javascript,export {};', shortCircuit: true };
    return next(specifier, context);
  },
});
register();

const { default: LocaleProvider } = await import('../components/LocaleProvider.tsx');
const { default: LanguageSwitcher } = await import('../components/LanguageSwitcher.tsx');
const { default: StudyHome } = await import('../components/StudyHome.tsx');
const { CitationChips } = await import('../components/Workspace.tsx');
const { default: NotebookEditor } = await import('../components/NotebookEditor.tsx');
const { default: StudyAccount } = await import('../components/StudyAccount.tsx');

function render(element, locale = 'en') {
  return renderToStaticMarkup(React.createElement(LocaleProvider, { initialLocale: locale }, element));
}

test('Chinese is the default and stored language values are validated', () => {
  assert.equal(resolveLocale(undefined), 'zh-CN');
  assert.equal(resolveLocale('fr'), 'zh-CN');
  assert.equal(resolveLocale('en'), 'en');
  assert.equal(resolveLocale('zh-CN'), 'zh-CN');
});

test('translated page labels preserve interpolated text and both languages', () => {
  assert.equal(translate('en', '第 {page} 页', { page: 5 }), 'Page 5');
  assert.equal(translate('zh-CN', '第 {page} 页', { page: 5 }), '第 5 页');
  assert.equal(translate('en', '定位第 {0} 页：{1}', { 0: 3, 1: '傅里叶 {page} 定义' }),
    'Go to page 3 — 傅里叶 {page} 定义');
});

test('language controls expose the selected language to assistive technology', () => {
  const english = render(React.createElement(LanguageSwitcher));
  assert.match(english, /role="group" aria-label="Interface language"/);
  assert.match(english, /lang="en"[^>]*aria-pressed="true"/);
  assert.match(english, /lang="zh-CN"[^>]*aria-pressed="false"/);
  const chinese = render(React.createElement(LanguageSwitcher), 'zh-CN');
  assert.match(chinese, /aria-label="界面语言"/);
  assert.match(chinese, /lang="zh-CN"[^>]*aria-pressed="true"/);
});

test('home navigation switches language while saved document and project names retain their text', () => {
  const props = {
    docs: [{ id: 'doc-a', name: '傅里叶变换.pdf', kind: 'pdf', course: '信号与系统', visited: 1 }],
    active: true,
    backgroundPaused: true,
    onCreateProject() {}, onManageProject() {}, onMoveDoc() {}, onPinDoc() {},
    onRemoveDoc() {}, onOpenDoc() {}, onImport() {}, onOpenNotebook() {},
  };
  const english = render(React.createElement(StudyHome, props));
  assert.match(english, /All projects/);
  assert.match(english, /Notebook/);
  assert.match(english, /Import materials/);
  assert.match(english, /傅里叶变换/);
  assert.match(english, /信号与系统/);
  assert.doesNotMatch(english, />全部项目</);
  const chinese = render(React.createElement(StudyHome, props), 'zh-CN');
  assert.match(chinese, /全部项目/);
  assert.match(chinese, /导入资料/);
});

test('English citation controls retain the selected lecture text and source page', () => {
  const html = render(React.createElement(CitationChips, {
    items: [{ page: 3, text: '傅里叶变换的定义', attachmentId: 'a' }],
    onLocate() {}, onRemove() {}, onPreview() {},
  }));
  assert.match(html, /aria-label="Go to page 3 — 傅里叶变换的定义"/);
  assert.match(html, /aria-label="Remove citation — 傅里叶变换的定义"/);
  assert.match(html, />傅里叶变换的定义</);
});

test('formatted notices from the existing API translate while retaining counts and credit precision', () => {
  assert.equal(translate('en', '已添加 2 个引用 · 共 3 个（最多 12 个）'),
    'Added 2 sources · 3 total (up to 12)');
  assert.equal(translate('en', '回答已保存 · 本次扣 0.125 积分'),
    'Answer saved · 0.125 credits charged');
  assert.equal(translate('en', '模型服务商的原始消息'), '模型服务商的原始消息');
});

test('note editing uses English tools while even text matching interface labels is preserved', () => {
  const body = '导入资料\n笔记本\n我的问题';
  const html = render(React.createElement(NotebookEditor, {
    body, title: '学习笔记', number: 1, status: '已同步', blocked: false,
    onChange() {}, onRetry() {}, onReload() {}, reloading: false,
  }));
  assert.match(html, /aria-label="File actions"/);
  assert.match(html, /aria-label="Bold"/);
  assert.match(html, /value="系统黑体"[^>]*>Inter</);
  assert.match(html, /Saved/);
  assert.match(html, /导入资料\n笔记本\n我的问题/);
});

test('account appearance and language settings use the selected language during the first render', () => {
  const html = render(React.createElement(StudyAccount, { onClose() {} }));
  assert.match(html, /Appearance/);
  assert.match(html, /Choose your interface language/);
  assert.match(html, />System</);
  assert.match(html, />Light</);
  assert.match(html, />Dark</);
  assert.doesNotMatch(html, />跟随系统</);
});

test('search and memory page labels use English with their original source data', () => {
  const groups = searchStudy({
    docs: [{ id: 'doc-a', name: '傅里叶变换.pdf', kind: 'pdf', course: '信号与系统' }],
    threads: [{ id: 'thread-a', docId: 'doc-a', page: 3,
      messages: [{ role: 'user', content: '傅里叶定义是什么？', page: 3 }] }],
    notes: [], query: '傅里叶', locale: 'en',
  });
  assert.equal(groups.find(group => group.kind === 'question').label, 'Questions');
  assert.equal(groups.find(group => group.kind === 'question').results[0].meta, '傅里叶变换 · Page 3');
  assert.equal(evidencePageLabel({ page: 3 }, 'en'), 'Page 3');
  assert.equal(evidencePageLabel({ page: 3, pages: [3, 5] }, 'en'), 'Pages 3, 5');
});

test('every explicitly localized interface message has an English translation', () => {
  const missing = new Set();
  for (const directory of ['app', 'components', 'lib']) {
    for (const name of readdirSync(directory, { recursive: true }).filter(name => /\.tsx?$/.test(name))) {
      const file = `${directory}/${name}`;
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node) {
        if (ts.isCallExpression(node)) {
          const callee = node.expression.getText(source);
          const argument = node.arguments[callee === 'translate' ? 1 : 0];
          if (['t', 'translate'].includes(callee) && argument && ts.isStringLiteral(argument)
            && !Object.hasOwn(englishMessages, argument.text)) missing.add(argument.text);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  assert.deepEqual([...missing], []);
});
