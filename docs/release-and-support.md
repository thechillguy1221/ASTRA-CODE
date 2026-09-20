# Release and support boundaries

Windows release metadata is server-managed and includes version, channel, x64 platform, installer URL, SHA-256, signature, size, minimum OS, rollout, and release notes. The desktop must verify digest/signature before executing an update payload. No release is published by the deterministic test harness.

Transactional and marketing email are separate policy paths. Transactional messages can be sent for account/security operations; marketing requires verification and consent and respects suppression. SMTP credentials are server-side only.

Support bundles contain safe diagnostics and errors. They exclude source content, tokens, API keys, passwords, credentials, and raw private source by default.
