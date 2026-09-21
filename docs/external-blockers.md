# Astra Code External Certification Blockers

These are external certification blockers, not substitutes for implementation work.

1. Astra Gateway/model credentials and configured staging/production provider.
   Needed for real Codex turns, streamed usage, tools, approvals, cancellation, completion, and Room billing.

2. Staging relay and two authorized Windows devices.
   Needed for remote host, offline, revocation, handoff, and cross-person Room certification.

3. Disposable PostgreSQL environment.
   Needed for migration, restart, transaction, uniqueness, FK, and concurrency certification.

4. Razorpay sandbox credentials, verified Resend sender, and Google OAuth client.
   Needed for payment, mail, and OAuth live certification.

5. Trusted Windows code-signing certificate/private key and clean Windows 10/11 x64 test environment.
   Needed for signed public installer, Authenticode verification, install/auth/restart/uninstall certification.

6. Signed update endpoint/artifacts, if auto-update remains in V1 scope.

7. A host with sufficient Windows virtual-memory/allocation capacity to build the current-source installer. The previous unsigned installer is retained only as historical evidence because it was built from the preceding source commit; it must not be released as the current build.
