# Deployment steering

- Railway configuration must be reproducible and must not contain generated
  domains or secrets.
- Migrations run through the repository migration runner against the target
  PostgreSQL instance.
- API liveness and dependency readiness are separate signals. Provider
  degradation must remain observable without making process health lie.
- Production release claims require actual external evidence; local mocks are
  not live deployment evidence.
