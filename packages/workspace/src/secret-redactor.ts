/**
 * Secret redactor for the Astra AI agent.
 *
 * Detects and redacts common secret patterns before they are stored in
 * agent session memory. Repository files are untrusted input.
 *
 * Spec §43: Do not persist project secrets into long-term agent memory.
 */

export interface RedactionResult {
  redacted: string;
  foundPatterns: string[];
  sensitiveFileReferenced: boolean;
}

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  // Generic API keys
  {
    name: 'generic-api-key',
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_-]{20,})['"]?/gi,
  },
  // Bearer tokens
  { name: 'bearer-token', pattern: /Bearer\s+([A-Za-z0-9\-._~+/]{20,})/g },
  // AWS-style keys
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g },
  // AWS-secret-key
  {
    name: 'aws-secret-key',
    pattern: /(?:aws[_-]?secret|secret[_-]?key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
  },
  // Private key headers
  {
    name: 'private-key',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  // OAuth client secrets
  {
    name: 'oauth-secret',
    pattern: /(?:client[_-]?secret|oauth[_-]?secret)\s*[:=]\s*['"]?([A-Za-z0-9_-]{16,})['"]?/gi,
  },
  // Database connection strings with passwords
  {
    name: 'db-connection-string',
    pattern: /(?:postgres|postgresql|mysql|mongodb|redis):(?:\/\/)[^:]+:([^@]{6,})@/gi,
  },
  // JWT tokens
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // Generic password assignments
  {
    name: 'password-assignment',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"\s]{8,})['"]?/gi,
  },
  // GitHub/GitLab tokens
  { name: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  // Razorpay/Stripe keys
  { name: 'payment-key', pattern: /(?:rzp|sk|pk)_(?:live|test)_[A-Za-z0-9]{20,}/g },
];

const SENSITIVE_FILENAMES = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.development',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'credentials',
  'credentials.json',
  'service-account.json',
  '.npmrc',
  '.netrc',
  '.htpasswd',
  'secrets.yaml',
  'secrets.json',
  'secrets.toml',
];

function isSensitiveFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const basename = lower.split('/').pop() ?? lower;
  return SENSITIVE_FILENAMES.some((name) => basename === name || basename.startsWith('.env'));
}

export function redactSecrets(content: string, filePath?: string): RedactionResult {
  const foundPatterns: string[] = [];
  const sensitiveFileReferenced = filePath ? isSensitiveFile(filePath) : false;

  let redacted = content;
  for (const { name, pattern } of SECRET_PATTERNS) {
    const before = redacted;
    redacted = redacted.replace(pattern, (match) => {
      if (!foundPatterns.includes(name)) foundPatterns.push(name);
      // Keep first few chars for debugging, redact the rest
      const keepChars = Math.min(4, Math.floor(match.length * 0.2));
      return match.slice(0, keepChars) + '[REDACTED]';
    });
    void before;
  }

  return { redacted, foundPatterns, sensitiveFileReferenced };
}

/**
 * Returns a safe reference to a sensitive file rather than its contents.
 * Use this when the agent needs to know a file exists but shouldn't read it into memory.
 */
export function sensitiveFileReference(filePath: string): string {
  return `[SENSITIVE FILE: ${filePath} — contents not included in agent memory for security]`;
}

/**
 * Determines if a file should be treated as sensitive and not fully read into agent memory.
 */
export function isSensitivePath(filePath: string): boolean {
  return isSensitiveFile(filePath);
}
