import test from 'node:test';
import assert from 'node:assert/strict';
import { practicePrompt } from '../lib/practice-draft.ts';

test('a self-test names the stable topic even when the last reply was 1/q',()=>{
  const prompt=practicePrompt('卷积和频谱的关系是什么？','1/q');
  assert.match(prompt,/请围绕「卷积和频谱的关系是什么？」给我一道自测题/);
  assert.doesNotMatch(prompt,/1\/q/);
  assert.match(prompt,/先只出题/);
  assert.match(prompt,/不要给答案/);
});

test('a substantive latest question adds a concrete check target',()=>{
  assert.match(practicePrompt('卷积和频谱的关系','卷积核大小怎么影响频谱？'),/检查我对「卷积核大小怎么影响频谱？」的理解/);
});

test('blank or missing questions fall back to the topic alone',()=>{
  assert.equal(practicePrompt('采样定理'),'请围绕「采样定理」给我一道自测题。先只出题，不要给答案；等我作答后再给提示与解析。');
  assert.doesNotMatch(practicePrompt('采样定理','  '),/检查我/);
});
