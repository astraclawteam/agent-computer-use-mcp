# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## 0.0.1

- Initial 0.x preview package for Gateway-managed local Computer Use MCP.
- Standard MCP stdio server/client compatibility through `@modelcontextprotocol/sdk`.
- Gateway-managed desktop control lifecycle with `cua-driver mcp`, local overlay, and cursor affordance.
- Productization gates for package foundation, permission policy, runtime recovery, perception hardening, overlay safety, MCP compatibility, app smoke coverage, and install experience.
- Release readiness gate for alpha command manifests, required evidence, and release-blocking invariants.
- Release artifact hash and Windows helper signing verification gate.
- Offline install proof for prepared install roots, offline bundle readiness, and no-network capability enablement.
- Commercial policy-deny proof for password, payment, credential, and private surfaces.
- Computer control approval state machine for approve, deny, cancel, revoke, and timeout flows.
- MCP approval compatibility proof for pending approval schemas, duplicate-pending rejection, and disconnect cleanup.
- Daemon session proof for lock ownership, child supervision, duplicate startup blocking, and clean shutdown.
