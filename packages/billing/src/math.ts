import type { CreditAmount, UsdAmount } from '@astra/contracts';

export const CREDIT_SCALE = 10_000_000n;
export const USD_SCALE = 10_000_000_000n;
/** One displayed credit represents one US cent of billable model usage. */
export const USD_CENTS_PER_CREDIT = 1n;

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

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Division denominator must be positive');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
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
  // USD is stored at 10 decimal places and credits at 7 decimal places. The
  // conversion is USD / $0.01, rounded half-up to the supported credit scale.
  const usdScaled = parseUsd(value);
  const numerator = usdScaled * 100n * CREDIT_SCALE;
  return formatCredits(roundDivide(numerator, USD_SCALE * USD_CENTS_PER_CREDIT));
}

export function creditsToUsd(value: string): UsdAmount {
  const creditsScaled = parseCredits(value);
  const numerator = creditsScaled * USD_SCALE;
  const numeratorWithUnit = numerator * USD_CENTS_PER_CREDIT;
  const denominator = CREDIT_SCALE * 100n;
  return formatUsd(roundDivide(numeratorWithUnit, denominator));
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
