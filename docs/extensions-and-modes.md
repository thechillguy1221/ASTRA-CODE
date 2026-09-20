# Extensions and student modes

## Skills

Skill metadata is searched first. Full instructions and resources are loaded only after routing selects a relevant Skill. Built-in Lyntar Essentials are stored as package resources and are not injected wholesale into every request.

## MCP and Plugins

MCP servers are namespaced by connection ID and declare network, credential, tool, destructive-action, and workspace scope. Plugins remain installed but disabled until every declared capability permission is explicitly approved. Marketplace packages require checksum, signature, and permission inspection before installation.

## Learn, Viva, Hackathon

Learn reads a selected relative path through the workspace capability. Viva scans a bounded local snapshot and generates questions with a real reference path; answer evaluation is grounded in that path. Hackathon Mode is deterministic planning support: it separates an MVP from should-have and future work and records a verification/demo plan.
