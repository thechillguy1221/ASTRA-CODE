import type { CreditAmount, UsdAmount } from '@lyntar/contracts';

export const CREDIT_SCALE = 10_000_000n;
export const USD_SCALE = 10_000_000_000n;

function parseScaled(value: string, scale: bigint, maxDecimals: number): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid decimal amount: ${value}`);
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > maxDecimals) throw new Error(`Too many decimal places: ${value}`);
  return BigInt(whole ?? '0') * scale + BigInt(fraction.padEnd(maxDecimals, '0') || '0');
}

function formatScaled(value: bigint, scale: bigint): string {
  if (value < 0n) throw new Error('Amount cannot be negative');
  const whole = value / scale;
  const remainder = value % scale;
  if (remainder === 0n) return whole.toString();
  const decimals = remainder
    .toString()
    .padStart(scale.toString().length - 1, '0')
    .replace(/0+$/, '');
  return `${whole.toString()}.${decimals}`;
}

export function parseCredits(value: string): bigint {
  return parseScaled(value, CREDIT_SCALE, 7);
}

export function formatCredits(value: bigint): CreditAmount {
  return formatScaled(value, CREDIT_SCALE) as CreditAmount;
}

export function parseUsd(value: string): bigint {
  return parseScaled(value, USD_SCALE, 10);
}

export function formatUsd(value: bigint): UsdAmount {
  return formatScaled(value, USD_SCALE) as UsdAmount;
}

export function creditsFromUsd(value: string): CreditAmount {
  return formatCredits(parseUsd(value));
}

export function creditsToUsd(value: string): UsdAmount {
  return formatUsd(parseCredits(value));
}

export function addCredits(left: string, right: string): CreditAmount {
  return formatCredits(parseCredits(left) + parseCredits(right));
}

export function subtractCredits(left: string, right: string): CreditAmount {
  const result = parseCredits(left) - parseCredits(right);
  if (result < 0n) throw new Error('Credit balance cannot be negative');
  return formatCredits(result);
}

export function compareCredits(left: string, right: string): -1 | 0 | 1 {
  const a = parseCredits(left);
  const b = parseCredits(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function subtractUsd(left: string, right: string): UsdAmount {
  const result = parseUsd(left) - parseUsd(right);
  if (result < 0n)
    throw new Error('Customer cost cannot exceed provider cost in absorbed-cost accounting');
  return formatUsd(result);
}
