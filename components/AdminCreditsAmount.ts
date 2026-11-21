const wholeNumber = new Intl.NumberFormat('zh-CN');

export function formatAdminCredits(milli: number, signed = false) {
  const absolute = Math.abs(milli);
  const fraction = absolute % 1000;
  const whole = (absolute - fraction) / 1000;
  const sign = milli < 0 ? '−' : signed && milli > 0 ? '+' : '';
  return `${sign}${wholeNumber.format(whole)}.${String(fraction).padStart(3, '0')}`;
}

export function parseAdminCreditsDelta(input: string) {
  const parts = /^([+\-−]?)(\d*)(?:\.(\d{1,3}))?$/.exec(input.trim());
  if (!parts || !(parts[2] || parts[3])) return null;
  const amount = Number(parts[2] + (parts[3] ?? '').padEnd(3, '0'));
  if (!Number.isSafeInteger(amount) || amount === 0) return null;
  return parts[1] === '-' || parts[1] === '−' ? -amount : amount;
}
