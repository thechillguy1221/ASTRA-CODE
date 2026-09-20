import { createHmac, randomUUID, createHash } from 'node:crypto';
import type { PairingTokenPayload } from './types.js';
import { PairingTokenPayloadSchema } from './types.js';

export const PAIRING_TOKEN_TTL_MS = 60_000; // 60 seconds

/**
 * Generates a signed pairing token for QR code display.
 * The QR code contains this token (base64url encoded).
 *
 * The token encodes: pairingId, userId, relayUrl, expiresAt
 * Signed with HMAC-SHA256 using the server's pairing secret.
 */
export function createPairingToken(
  input: { userId: string; relayUrl: string },
  secret: string,
): { token: string; payload: PairingTokenPayload } {
  const payload: PairingTokenPayload = {
    pairingId: randomUUID(),
    userId: input.userId,
    relayUrl: input.relayUrl,
    expiresAt: new Date(Date.now() + PAIRING_TOKEN_TTL_MS).toISOString(),
  };
  const data = JSON.stringify(payload);
  const sig = createHmac('sha256', secret).update(data).digest('base64url');
  const token = Buffer.from(data).toString('base64url') + '.' + sig;
  return { token, payload };
}

/**
 * Verifies and decodes a pairing token.
 * Throws if invalid or expired.
 */
export function verifyPairingToken(token: string, secret: string): PairingTokenPayload {
  const dotIndex = token.lastIndexOf('.');
  if (dotIndex === -1) throw new Error('Invalid pairing token format');
  const data = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);
  const expectedSig = createHmac('sha256', secret)
    .update(Buffer.from(data, 'base64url').toString())
    .digest('base64url');
  if (expectedSig.length !== sig.length || !Buffer.from(expectedSig).equals(Buffer.from(sig))) {
    throw new Error('Pairing token signature is invalid');
  }
  const payload = PairingTokenPayloadSchema.parse(
    JSON.parse(Buffer.from(data, 'base64url').toString()),
  );
  if (new Date(payload.expiresAt).getTime() < Date.now()) {
    throw new Error('Pairing token has expired');
  }
  return payload;
}

/**
 * Creates a stable device fingerprint from its public key.
 */
export function deviceFingerprint(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}
