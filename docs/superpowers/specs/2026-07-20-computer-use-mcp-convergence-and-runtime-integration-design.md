# Computer Use MCP Convergence and Runtime Integration Design

**Status:** Approved on 2026-07-20

## Objective

Converge `agent-computer-use-mcp` from an independently productized Windows distribution into a standard cloud-hosted MCP resource managed by Xiaozhiclaw Runtime, while preserving a direct source-development entrypoint and proving both module-level and end-user Agent usability.

The first supported product target is Windows 11 x64. macOS, Linux, independent npm/ZIP distribution, Commercial 1.0 promotion, long-running evidence programs, and broad application certification are outside this design.

This design supersedes only the Computer Use portions of the earlier exact-two Runtime component, four-platform private-component, independent npm/ZIP, and commercial-evidence plans. It does not alter the approved PET, official Agent, Provider Core, or hosted MCP architecture.

## Current Integration Fact

Xiaozhiclaw Runtime already composes the generic MCP Host management chain:

- `McpStore` owns installation, binding, status, and approval persistence.
- `McpManagementService` owns install, configure, enable, start, stop, test, update, detach, and uninstall operations.
- `McpSessionManager` owns connection lifecycle, retries, cancellation, inventory, and status transitions.
- the official MCP SDK client uses Runtime's `ProcessTreeController` for stdio process containment and cleanup.
- `McpAgentProjection` exposes enabled and trusted MCP tools to Agent sessions and proxies calls through the Host.
- Resource Community installation and preinstall both enter the same typed Host authority.

No new Computer Use-specific Runtime manager, registry, installer, session owner, supervisor, or protocol is allowed. The missing integration is a reviewed `agent-computer-use-mcp` cloud resource and a Windows executable artifact compatible with the existing Host contract.

## Authority Boundaries

### `agent-computer-use-mcp`

Owns:

- the public `computer.*` MCP tool contract;
- driver, OCR, overlay, access, approval, controller, observation, and module-internal cleanup behavior;
- the source-development command `npm run mcp`;
- generation and verification of one Windows x64 executable MCP artifact.

Does not own:

- user-facing installation, trust, binding scope, MCP session authority, Agent tool selection, self-update, or product-wide process supervision;
- an independent npm/ZIP product distribution;
- Commercial 1.0 promotion, multi-Agent certification, or macOS/Linux product gates.

### `xiaozhiclaw-runtime`

Continues to own installation, trust, configuration, binding, credentials, enablement, stdio sessions, process-tree containment, status, inventory, and Agent projection through its existing implementation. Phase 1 makes no Runtime source change.

### `qlogicagent-hub`

Owns the reviewed cloud resource record, version metadata, signing metadata, and artifact reference. It does not own local installation, approval, enablement, or running state.

### `electron`

Continues to deliver and launch Runtime. It does not parse the Computer Use manifest or start the MCP directly.

## Runtime Data Flow

```text
agent-computer-use-mcp source
  -> verified win32-x64 executable artifact
  -> cloud object storage + reviewed Hub MCP resource version
  -> Resource Community install request
  -> existing Runtime mcp.install authority
  -> download, signature/integrity verification, and materialization
  -> approval and enablement
  -> existing McpSessionManager stdio launch
  -> existing McpAgentProjection
  -> Agent selects computer.*
  -> MCP coordinates cua-driver, OCR, and overlay
  -> real Windows application effect
```

Development and production must enter the same MCP server composition:

```text
npm run mcp ---------+
                     +-> main(runtimeContext)
Windows SEA entry ---+
```

## Windows Executable Artifact

The only phase-1 product artifact is:

```text
agent-computer-use-mcp-<version>-win32-x64.tar.gz
└─ artifact/
   ├─ bin/agent-computer-use-mcp.exe
   ├─ runtime/
   ├─ driver/
   ├─ overlay/
   ├─ ocr/
   ├─ manifest.json
   ├─ inventory.json
   ├─ checksums.json
   ├─ licenses/
   └─ sbom.cdx.json
```

Requirements:

- the entrypoint is a thin Node SEA executable that enters the same `main(runtimeContext)` used by `npm run mcp`;
- the artifact satisfies Runtime's existing `mcp-executable-artifact-v2` contract and has an exact version, `win32`/`x64` target, SHA-256 checksum, byte size, manifest digest, and Hub signature;
- the tar archive has the required `artifact/` root and a compressed size below Runtime's current 256 MiB limit;
- the artifact contains the complete driver, OCR, overlay, native-library, model, and production JavaScript closure;
- startup performs no download, package installation, or self-update and requires no system Node, global npm, source checkout, or ambient working directory;
- production asset resolution is relative to the executable installation root; `AGENT_COMPUTER_USE_*` remains available for development and controlled overrides only;
- stdout carries MCP protocol bytes only and diagnostics use stderr;
- user overlay pixels are excluded from capture, OCR, observations, traces, and persisted artifacts;
- the released artifact and its SBOM contain no known high-severity installation-chain dependency. The current `adm-zip`/`onnxruntime-node`/`ppu-paddle-ocr` finding must be resolved before publication.

## Installation and Preinstall Phases

### Phase 1: reviewed cloud resource with manual installation

The artifact is uploaded and registered as an approved Resource Community MCP resource. A user installs, approves, and enables the exact version through the existing Runtime UI and typed Host operation. No Runtime source file changes in this phase.

### Phase 2: declarative automatic preinstall

After one version passes the full acceptance matrix and its observation period:

- add its exact `resourceId` and version to Runtime's existing `PREINSTALL.mcp` list;
- increment the preinstall manifest version;
- retain the current typed `mcp.install` request containing only resource identity, exact version, scope, and declared inputs;
- retain existing retry-next-boot and trust/approval semantics;
- do not modify `McpStore`, `McpManagementService`, `McpSessionManager`, stdio transport, process-tree containment, or Agent projection;
- treat preinstall as the initial recommended version, not an auto-updater. Later upgrades continue through existing `mcp.update` behavior.

## Failure Semantics

- Invalid catalog data, signature, checksum, target, version, archive shape, path, or executable fails installation before a runnable binding exists.
- An unapproved or disabled binding is not projected to the Agent and cannot use a bypass startup path.
- MCP initialization failure produces the existing Runtime error status and structured diagnostic; no fallback process is started.
- Missing or failed driver, OCR, or overlay produces a structured `computer.health` degraded/error result. Dependent actions fail explicitly.
- Insufficient observation returns `observation.insufficient`; coordinates are never guessed.
- Dangerous windows, secure fields, and unapproved actions fail through the MCP policy layer.
- cancellation propagates through the Host call. The MCP revokes its controller, closes the overlay, and removes temporary state; Runtime process-tree containment remains the final process cleanup authority.
- a previously verified cached artifact may restart offline. A damaged cache fails closed rather than trusting an unproved active tree.
- updates and rollback use exact cloud resource versions through existing Runtime operations. The MCP never updates itself.

## Acceptance Matrix

### Layer A: direct MCP artifact smoke

Run from the extracted final tarball in a clean temporary root without the source checkout, global npm, system Node, or network:

1. initialize with the official MCP SDK client;
2. list and validate the expected `computer.*` tools;
3. call `computer.health` and confirm real driver, OCR, and overlay status;
4. observe a controlled Native Lab/visual fixture using the released OCR path and perform one safe click;
5. prove overlay exclusion from capture and OCR output;
6. cancel an active operation and prove controller, overlay, child-process, and temporary-file cleanup;
7. tamper with an artifact file and prove verification fails.

This layer proves that the published bytes are usable.

### Layer B: Runtime and natural-language Agent E2E

Use a clean test profile and the real Resource Community installation path:

1. install, approve, and enable the exact resource version;
2. confirm Runtime inventory and Agent projection contain the expected tools;
3. ask the Agent in natural language to open Notepad, enter fixed test text, save it under a task-owned temporary directory, and verify the resulting file bytes;
4. ask the Agent to observe the Native Lab/visual fixture through real OCR, choose a safe target, click it, and verify the effect;
5. request one dangerous action and verify an explicit refusal;
6. cancel one active operation and verify no MCP, driver, OCR, or overlay process remains under Runtime;
7. disconnect the network, restart Runtime, and verify the cached resource starts and `computer.health` succeeds.

This layer proves that an end user can use the capability through the actual product chain. It cannot be replaced by a scripted direct MCP call.

Routine CI uses deterministic protocol, policy, packaging, and Host-projection tests. A real model-backed natural-language run is required for a release candidate, not for every unit-test invocation.

## Test and Code Convergence

Retain tests for the public MCP contract, policy and approval, cancellation and cleanup, driver/OCR/overlay behavior, overlay exclusion, artifact generation and integrity, direct artifact smoke, and the two real acceptance lanes.

Delete or consolidate only after Layer A and Layer B pass:

- tests that only assert a `phase:*` wrapper exists;
- independent npm/platform-package publication, token, and post-publish paths;
- the standalone offline ZIP product track;
- Commercial 1.0 promotion, Phase 9/10 aggregation, long-running evidence retention, and four-Agent qualification;
- two-hour/eight-hour soak and broad application-certification gates;
- macOS/Linux placeholder or unimplemented platform gates;
- wrappers that duplicate an already retained behavioral test.

There is no target test count. Every retained test must protect a current contract, safety boundary, cleanup condition, artifact invariant, or real product acceptance requirement.

## Implementation and Cutover Order

1. Refactor the Computer Use entrypoint around one `main(runtimeContext)` without changing behavior.
2. Build and verify the Windows SEA artifact and its complete offline closure.
3. Resolve the high-severity production dependency chain.
4. Publish a reviewed staging resource through Hub and complete Layer A.
5. Install through the existing Runtime UI, approve, enable, and complete Layer B without modifying Runtime.
6. Freeze and then remove the superseded npm/ZIP/commercial/four-platform paths using source and consumer reference checks.
7. After the accepted version's observation period, make the minimal declarative `PREINSTALL.mcp` change and verify automatic installation through the same Host authority.

The old distribution code remains frozen until the new cloud-resource path passes both acceptance layers. After cutover, it is removed rather than retained as a permanent fallback.

## Non-Goals

- changing Runtime MCP Host architecture or lifecycle code;
- introducing a Computer Use-specific Runtime service, registry, installer, or session manager;
- modifying Electron to launch the MCP directly;
- automatic preinstall before the manually installed cloud resource passes real acceptance;
- independent npm/ZIP distribution;
- macOS or Linux support in the first product phase;
- broad application certification, commercial promotion, or long-term evidence infrastructure.
