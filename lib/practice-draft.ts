import { lowInformationQuestion } from './workspace-model.ts';

/** A self-test names the stable topic, never a bare follow-up marker such as "1/q". */
export function practicePrompt(topic: string, question?: string): string {
  const latest = question?.trim() ?? '';
  const check = latest && !lowInformationQuestion(latest)
    ? `，检查我对「${latest.slice(0, 60)}」的理解`
    : '';
  return `请围绕「${topic}」给我一道自测题${check}。先只出题，不要给答案；等我作答后再给提示与解析。`;
}
