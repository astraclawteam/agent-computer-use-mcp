# Changelog

All notable changes to `agent-computer-use-mcp` are tracked here.

## Unreleased

- Make Hub artifact registration and exact public-catalog verification part of
  the tag release transaction. GitHub Latest is now created only after the
  signed executable is visible publicly at the tagged version.
- Update the Windows release smoke to acquire the exact freshly discovered
  Native Lab window instead of using the retired partial-title selector.

## 0.0.35

- Classify structured Windows `Document` controls with declared text actions as
  editable on the default Agent surface, preserving opaque targeting and exact
  post-write read-back without requiring Host mode.
- Retire the nested `action.action`, partial-title selector, and `--host-control`
  compatibility paths. Canonical action values and acquisition selectors now
  fail with precise server-side errors even when an MCP client does not validate
  the advertised JSON Schema.

## 0.0.34

- Publish the Windows artifact as a standard executable MCP that any stdio MCP
  Host can download and launch without AstraClaw-specific runtime requirements.
- Derive both MCP initialization and health versions from the package release
  version so packaged executables cannot advertise stale protocol metadata.

## 0.0.33

- Stop terminal `computer.task` receipts from advertising stale interaction-step
  continuation control after completion, cancellation, or an indeterminate
  action. Live tasks still carry their opaque task token and bounded next-step
  contract.
- Preserve independently observed Windows process and window inventory when the
  CUA driver cannot start, so a temporarily unavailable driver does not make a
  running desktop application disappear from Host discovery.

## 0.0.32

- Merge same-owner transient and auxiliary windows into one current Scene only
  when their structure and regional evidence agree, preventing duplicate search
  editables from making deterministic messaging fail while preserving the
  fail-closed conflict rule.
- Preserve screenshot and ownership provenance for composed transient content
  so messaging and generic task candidates remain bound to the exact observed
  window and coordinate space.
- Strengthen native Unicode replacement and post-write verification for real
  Windows editors without adding clipboard fallback, guessed coordinates, or
  automatic replay of an uncertain mutation.

## 0.0.31

- Keep the foreground-confirmation contract deterministic in Windows CI by
  injecting the foreground probe in its unit tests. Production continues to
  require a fresh native foreground-window fact and never treats z-order as
  confirmation.

## 0.0.30

- Restore a requested application's owned main window through one deterministic
  Host path before Scene composition. Minimized, hidden, cloaked, and tray-owned
  windows are resolved from fresh native window evidence, while ambiguous
  ownership still fails closed instead of exposing duplicate search fields or
  guessing a target window.

## 0.0.29

- Remove the remaining private `computer.request_access` and
  `computer.cancel` schema-name override path. The public Agent and Host tool
  surfaces remain unchanged, while `computer.acquire` and `computer.release`
  now reference canonical same-name schemas directly.
- Pin patched transitive releases of `fast-uri`, `hono`, `ip-address`,
  `brace-expansion`, and `undici` across the runtime and build dependency
  closure.

## 0.0.28

- Clarify the public `computer.task` contract as native desktop and operating-
  system UI automation. Chrome/Chromium web-page interaction and XiaozhiClaw's
  in-app preview now advertise their dedicated browser capabilities as the
  preferred semantic match, leaving Computer Use as the native-UI path and
  browser fallback instead of a competing default.

## 0.0.27

- Restore a tray application's main window before considering same-process
  auxiliaries. A duplicated owner PID had promoted a visible full-size helper
  window to application identity, so a tray messaging task could compose and
  edit the helper instead of restoring the hidden main window. Owner-process
  identity now applies only to a distinct same-package owner of a headless
  child; an application's own PID cannot make all of its windows authoritative.
- Unify coordinate Unicode editing on one IME-neutral `KEYEVENTF_UNICODE`
  transaction. `incremental` and `commit` remain distinct Host task semantics,
  but neither switches to clipboard paste or submits the field; an exact Scene
  read-back remains the only authority that can commit a text mutation.
- Add an optional source-bound verifier for the ordered seven-level real
  Windows acceptance campaign. Maintainers can seal 70 privacy-safe Host
  receipts (ten consecutive passes at every level, no tool errors or wrong
  sends, no uncertain replays, and verified terminal release) against an exact
  source identity when formal qualification is requested. Preview tags do not
  force a live desktop campaign; the operator owns the release decision.
- Complete generic non-submitting edits across both screenshot-grounded and
  native semantic controls. The Host still prefers its exact replace-all text
  primitive when an Editable has current pixel provenance; when a proven
  semantic Editable exposes ValuePattern but cannot be located in the screenshot,
  it selects `set_value` before mutation, refreshes semantic authority, verifies
  exact read-back, and never falls back after an uncertain action.
- Expose official MCP request cancellation and the SDK-owned connector process
  identity to the real lifecycle acceptance harness, enabling controlled Stop,
  connector fault, clean restart, and immediate reacquire proof without adding
  a second controller or production fault-injection path.
- Classify desktop work by side effect instead of application shape. Generic
  tasks now expose consistently owned editors as non-submitting `edit`
  candidates, including Electron `ValuePattern` editors and chat-shaped draft
  boxes, but never expose send/submit or conversation-selection controls. Each
  edit is screenshot-grounded, uses replace-all without a commit key, and is
  committed only after exact-value read-back; explicit recipient-plus-send
  requests remain exclusive to `computer.message`.
- Make packaged and shell applications reachable by name. Application discovery
  excluded every process under the Windows directory, which is where a packaged
  app's generic host process lives, so those applications could never match an
  exact `applicationName` and the Host fell back to asking the Agent to pick
  from the full running-process list. A process under that directory is now
  admitted when it owns a visible top-level window, and named by its Start Menu
  shortcut where one exists, otherwise by its window title. No
  application-specific rules were added.
- Require a navigation surface to be anchored to the control that was clicked.
  "The control's own surface is already open" and the
  `owned-actionable-transient-added` post-action evidence class both accepted
  any newly seen transient surface anywhere in the frame, so an unrelated
  application's window — flat panels, clean OCR rows, parent `main-window`, and
  structurally indistinguishable from an in-window menu — could suppress the
  requested click or confirm a navigation that never happened. Both now require
  the surface to be geometrically local to the clicked control, scaled by that
  control rather than by a pixel constant, and fail closed when either lacks
  geometry.
- Report a click the Host decided not to deliver. The pre-action path returned
  an ordinary `decision-required` with no error and no action, leaving the Agent
  unable to tell that its selection had been dropped; it now returns
  `task.navigation_surface_already_open`.
- Require a comparable baseline before calling a surface new. The pre-action
  capture reports surfaces derived from pixels and OCR that a semantic
  observation never contains, so comparing the two marked panels that were on
  screen all along as newly opened. When the baseline cannot support the
  comparison the Host delivers the click and proves the outcome afterwards.
- Continue on a surface the previous step opened. The Host remembers the anchor
  of a surface its own click opened and captures the next Scene the way that
  surface was found; a plain observation cannot see an in-window popup, so every
  item just offered would revalidate as stale. Control is still released between
  steps exactly as before.
- Let an item the Host offered actually be acted on. A navigation row composed
  from a same-window popup carries a full fused proposal — two independent
  providers, its own source region, proposal id, and a fused confidence above the
  pixel-target bar — but the composition stripped its `pixelLimitedAction`
  marker, leaving an element that advertised a click no admission path could
  accept. Selecting it always failed as ungrounded even though its evidence was
  intact. The marker is retained, so the row is admitted on the evidence it
  actually has and the click is reported as pixel-limited rather than semantic.
- Recognise a surface that has stopped changing. Overlapping the changed region
  is how a surface proves it just appeared; a popup stops changing the moment it
  finishes opening, so requiring that proof on every frame erased an open menu
  from the Scene while it was still on screen. A surface already proven open is
  not asked to prove it again, and the anchor-relative gates that assume the
  anchor sits outside the surface no longer reject it once the target is one of
  its own rows.
- Report a pre-delivery refusal as not applied. Every failure from the action
  path was marked as an effect that might have landed, including refusals raised
  before the action reached any provider. That claimed a possible mutation where
  nothing was delivered and, because an indeterminate effect must not be
  replayed, blocked the Agent from reconsidering the target. Refusals that prove
  non-delivery are now `not-applied`; everything else stays indeterminate.
- Say which requirement an admission refusal failed. One code covered malformed
  requests, unoffered actions, missing provenance, low confidence, and
  ungrounded targets alike, so neither an Agent nor anyone debugging a stuck
  workflow could tell them apart. The code is unchanged and each refusal now
  carries its reason, which `computer.task` surfaces as the underlying cause
  instead of replacing it with a generic sentence.
- Fix the shared error envelope failing the output schema of the tool that
  emits it. `computer.act`, `computer.task`, and `computer.message` constrained
  `status` to `committed`, `not-applied`, and `indeterminate`, while every hard
  failure returns `status: "error"`. An official MCP SDK client validates
  `structuredContent` before delivering it, so the caller received
  `-32602 Structured content does not match the tool's output schema` and never
  saw the underlying error. The status enum now admits `error` for any tool that
  constrains it, applied once in the shared schema builder so a new tool cannot
  reintroduce the gap. `computer.message` also declared its success fields in a
  flat top-level `required` list that overrode the builder's error branch; it now
  goes through the builder like every other tool. This widens the published
  contract to describe results the server already produced, so
  `resultSchemaVersion` stays `6.0`. The error status is not folded into
  `not-applied`: everything reaching the shared envelope has already failed the
  safe-rejection check, so reusing a terminal outcome would tell an Agent that a
  possibly delivered mutation is safe to replay.
- Move the Host-only tool boundary from the private `xiaozhiclaw/visibility`
  `_meta` key into the advertised MCP contract. `tools/list` now returns only
  `computer.task` and `computer.message` unless the process was launched with
  `--tool-surface=host` or `AGENT_COMPUTER_USE_TOOL_SURFACE=host`, and
  `tools/call` rejects any name the active surface did not advertise with the
  same error as a tool that does not exist, so knowing a hidden name is not
  enough to invoke it. A third-party MCP Host no longer needs vendor knowledge
  to keep lifecycle and management tools out of the model's inventory. The
  surface is resolved once from launch arguments or environment, both owned by
  whoever spawns the server; an unrecognized value fails at startup instead of
  degrading to a working launch. The `_meta` key is retained as advisory
  compatibility, and `computer.installation` now publishes the surface contract
  so a Host can discover how to opt in.
- Add the Agent-facing `computer.task` Host contract for generic non-messaging desktop goals. It exposes only opaque semantic candidates and consistent parent-owned facts, revalidates every selected candidate against a fresh Scene, performs at most one action per invocation, never replays an indeterminate action, and releases control before every result.
- Keep `computer.acquire`, `computer.observe`, `computer.act`, and `computer.release` Host-only; generic GUI tasks do not fall back to shell commands, guessed coordinates, provider element identities, or Agent-managed lifecycle operations.
- Bind each generic task continuation to the next `computer.task` interaction step, invalidate failed application candidates, and resolve headless child processes through a same-package owner window without application-name aliases.
- Verify generic navigation clicks against a newer consistently owned Host Scene. A target state advance, target-labelled destination, or owned actionable transient can resolve an uncertain provider receipt; a provider-only success or unrelated dynamic text cannot. An inconclusive first observation permits one read-only related-surface capture, while every unproven click closes without replay.
- Deliver Host-selected navigation controls once through a foreground pointer point derived from the current semantic element bounds. This is an action-time route selection, not a retry or coordinate guess; controls without same-window bounded geometry retain the semantic provider path. The first post-action screenshot carries the clicked anchor, and an in-window popup becomes an actionable `TransientSurface` only when OCR rows agree with an anchor-local changed region or independently detected flat pixel surface. This also recognizes an already-open popup without clicking its toggle again.
- Make the opaque `taskToken` the sole continuation authority after a generic task starts. Continuations no longer require the model to repeat mutable natural-language goal text, while the Host still binds the token to its original application, goal, owner, agent, project, session, and expiry.
- Keep non-messaging navigation available in desktop shells that also contain chat-like panes. `computer.task` removes message editors, send controls, conversation targets, transcripts, and their descendants from its candidates and facts instead of rejecting the whole application Scene; actual messaging remains exclusive to `computer.message`.

## 0.0.26

- Restore tray-resident applications without falling through to a duplicate launcher, prefer materially restored primary surfaces, and select enabled owned modal windows when they block a disabled owner.
- Keep auxiliary, backdrop, compact launcher, and stale editable surfaces from stealing focus or action targeting in multi-window applications.
- Emit a reversible native edit boundary after incremental Unicode input so custom-drawn search, filtering, validation, and autocomplete models refresh while preserving the exact requested text.
- Attach a bounded semantic observation to successful acquisition and a target-local observation to actions, so the Agent can verify effects without redundant full-window captures.
- Make OCR geometry observation-only, reject repeated unconfirmed mutations, and execute screenshot-grounded clicks at the verified target center.
- Prefer changed-region and local-crop OCR, suppress repeated visual understanding for materially unchanged frames, and keep explicit visual crops bounded to the requested scene.
- Compact application state, semantic elements, OCR rows, lifecycle receipts, and routing metadata on the model-facing channel while retaining complete Host-verifiable structured results.
- Add `computer.message` as the sole Agent-facing deterministic messaging path; move acquire, observe, act, and release behind the Host workflow boundary; reject raw coordinate mutations in messaging Scenes; and preserve Host-only management operations.

## 0.0.25

- Prefer an application's exact identity-matched primary window over larger auxiliary or custom-drawn surfaces.
- Verify every foreground transition against the independent native foreground handle instead of trusting a driver success flag.
- Keep tray restoration fail-closed when an application surface cannot actually become the system foreground window.

## 0.0.24

- Preserve every running process identity for one executable so multi-process desktop applications remain one semantic application.
- Restore and select controllable windows owned by any sibling process after a tray accessibility invocation.
- Avoid falling through to a duplicate launcher when the restored primary window belongs to a sibling process.

## 0.0.23

- Require screenshot-grounded editable-surface bounds for coordinate text focus instead of accepting a placeholder glyph or border point.
- Validate a safe central target region and execute at the editable rectangle center to make focus placement deterministic across custom-drawn controls.
- Keep screen-coordinate target rectangles aligned when the Host projects them into window-local action space.

## 0.0.22

- Declare post-write `focusReceipt` and `mutationVerification` fields in the strict observation output schema.
- Cover the real MCP result envelope so a recovered focus receipt cannot be rejected as an additional property.

## 0.0.21

- Preserve safe keyboard continuation after coordinate Unicode input when a fresh same-window observation confirms the exact value near the grounded target.
- Return the recovered short-lived focus receipt on that observation so an Agent can commit live search or message input without another guessed click.
- Keep uncertain writes fail-closed when the exact post-action value or surface identity cannot be confirmed.

## 0.0.20

- Fail closed before acquire, observation, or action when the Windows input desktop is locked or secure.
- Bind each observation to a single-use surface receipt and require a fresh observation after every action.
- Reject screenshot surfaces whose reported native window identity differs from the acquired target.
- Apply screenshot-pixel to native-window scaling inside the Host instead of asking the Agent to transform coordinates.

## 0.0.19

- Restrict tray accessibility discovery to notification icon elements instead of traversing every desktop button.
- Give the bounded native tray bridge enough time to complete on control-dense desktops.
- Prevent a slow but valid tray restoration from falling through to duplicate application launch.

## 0.0.18

- Prefer an opaque application token over a redundant title hint left from an earlier window lookup.
- Keep target and explicit window selectors mutually exclusive with application restoration.
- Prevent recoverable tray workflows from terminating on harmless Agent argument carry-over.

## 0.0.17

- Enrich running-process application identities from exact Windows Start Menu shortcut targets.
- Preserve non-ASCII display identities with explicit UTF-8 probe output.
- Let tray restoration match localized system identities without fuzzy matching or application-specific rules.

## 0.0.16

- Restore an already-running tray application through its exact system accessibility identity before launching an executable.
- Preserve the discovered application display identity through the opaque application-token acquire path.
- Prevent tray-only applications from being replaced by duplicate launcher windows when the original process can be restored.

## 0.0.15

- Preserve the active Host request context across action verification observations.
- Keep semantic clicks, text actions, key presses, and activation follow-up captures on the acquiring session lease.
- Prevent correctly delivered desktop actions from being misreported as another Host session's controller.

## 0.0.14

- Wait for bounded asynchronous screenshot handoff before projecting secure MCP image content.
- Retry missing and partially written PNG assets without exposing connector-private file paths.
- Prevent real desktop screenshot observations from failing with transient `ENOENT` errors.
- Restore an existing hidden or off-screen process window before falling back to launching another application instance.

## 0.0.13

- Keep semantic observations, screenshots, and actions bound to the acquired native window handle.
- Ignore transient same-process auxiliary-window identity and off-screen bounds returned after activation.
- Prevent focus and coordinate drift when the captured primary surface differs from an auxiliary provider window.
- Keep the self-contained overlay single-file package uncompressed so first-run startup remains within the product latency budget.

## 0.0.12

- Prefer the bounded primary application surface when one process exposes same-title auxiliary windows.
- Keep screenshot-backed OCR coordinates in the exact observation pixel space consumed by actions.
- Preserve exact explicit-window selection while making tray restoration and natural-language targeting more reliable.

## 0.0.11

- Keep bounded OCR baseline and changed-region routing metadata valid under the strict MCP output schema.
- Let one Host session safely reuse or retarget its active controller without requiring the Agent to repeat an identity field.
- Preserve fail-closed controller isolation across owners, agents, projects, and sessions.

## 0.0.10

- Retry a missing full-window OCR baseline once when the first screenshot arrived before the local sidecar was ready.
- Preserve static dialogs and overlays in structured observation instead of losing them to later changed-region-only scans.
- Return immediately to changed-region and local-crop-first routing after the bounded baseline succeeds.

## 0.0.9

- Ground custom-drawn text entry from the complete editable surface instead of inferring a point from adjacent action buttons or toolbar icons.
- Expose structured safe-interior point-selection and occlusion recovery metadata to MCP Hosts.
- Stop coordinate retries from typing through dialogs, sheets, or other overlays; require a fresh non-occluded screenshot before retry.

## 0.0.8

- Restore tray-only Windows applications through generic session-process discovery and opaque application tokens without leaking executable paths.
- Prioritize semantic observation, screenshot digest comparison, changed-region or local OCR, and only then explicit Host visual understanding.
- Suppress repeated visual-model calls when the screenshot digest is unchanged and expose the local OCR fallback in the same observation transaction.
- Treat empty OCR crops as valid observations instead of provider failures.
- Compress application state into `active`, `visible`, `recoverable`, or `installed` model-facing records without application-name keywords or regular expressions.
- Preserve the official Hub card branding and link project discovery to the Xiaozhi Agent release page.

## 0.0.7

- Add a versioned capability handshake so the Host can inspect lifecycle, observation, action, delivery, and security support without expanding the Agent tool surface.
- Report focused controls, observation truncation, native-to-image scaling, action execution paths, delivery modes, and explicit fallback reasons.
- Bind desktop-control leases to the requesting Host session while allowing safe renewal by the same session.
- Keep the public Agent surface at four tools and preserve Host-only health, diagnostics, installation, and repair settings.
- Add a tag-verified Windows x64 GitHub Release workflow with immutable SEA artifacts, SHA-256 checksums, and Latest release promotion.
- Refresh the project story, installation guide, contribution workflow, and visual identity.

## 0.0.6

- Deliver owned screenshots as secure MCP image content and compact Markdown without exposing temporary local paths.
- Add verified foreground activation, tray application restore, screenshot-bound coordinate contracts, focus receipts, and explicit interaction intent.
- Add incremental native Unicode input and clipboard transaction modes for reliable Chinese text entry and live search controls.
- Keep OCR as the low-latency text path while requiring screenshot or visual grounding for editable interiors and complex layouts.
- Treat indeterminate mutations as non-replayable outcomes that require a fresh observation, and always release Computer Use state after completion or failure.
- Harden Windows SEA assembly by acquiring hash-locked assets explicitly in CI and pruning all non-Windows-x64 ONNX native targets.

## 0.0.5

- Preserve fresh OCR and screenshot observations so their bounded coordinates and high-confidence text tokens can be used by `computer.act`.
- Add observation-grounded `click`, `type_text`, and `press_key` actions with background delivery and supported foreground escalation.
- Keep coordinate actions bound to the active controller, exact observation id, capture bounds, and a 30-second action window that covers a real Agent reasoning turn.
- Update the real desktop MCP lifecycle gate to the consolidated acquire, observe, act, and release surface.

## 0.0.4

- Consolidate the Agent-facing desktop surface into `computer.acquire`, `computer.observe`, `computer.act`, and `computer.release`.
- Keep health, doctor, installation, and repair available to the Host as explicitly marked management tools instead of projecting them to the Agent.
- Preserve strict output schemas, approval, cancellation, cleanup, and safe repair planning across the consolidated contract.

## 0.0.3

- Discover the real foreground window from cua-driver z-order without requiring a guessed title.
- Accept `target: "foreground"`, exact window ids, case-insensitive titles, and the legacy `titlePart: "*"` foreground alias.
- Return structured, retryable window-resolution errors and normalized PowerShell CLIXML while keeping the MCP session usable after a failed tool call.

## 0.0.2

- Expose the existing cua-driver `type_text` capability through `computer.act` so modern Windows Notepad document surfaces can be edited without weakening observation or policy checks.

## 0.0.1

- Standard MCP stdio server and client compatibility through `@modelcontextprotocol/sdk`.
- Gateway-managed semantic desktop control with cua-driver, policy tiers, approvals, cancel/revoke/timeout cleanup, local OCR, and a user-only native overlay/cursor.
- Protected public core npm package with exact-version `@xiaozhiclaw/agent-computer-use-win32-x64` optional dependency.
- Immutable Windows x64 platform package containing locked cua-driver, native overlay, ONNX Runtime, PP-OCRv6 small models, licenses, SBOM, and a complete SHA-256 inventory.
- Complete Windows x64 offline ZIP that runs with Node.js 20+ without npm, network access, elevation, or setup software.
- Runtime platform verification fails closed for missing, linked, mismatched, incomplete, extra, or corrupt files before MCP starts.
- npm owns install, upgrade, downgrade, and rollback; runtime download and self-update are absent.
- Tag-only CI validates, builds, smokes, and uploads only the two npm tarballs; npm publication is an explicit maintainer action for one verified tarball at a time.
- Product gates for overlay exclusion, OCR/perception latency, MCP concurrency, runtime soak, app smoke evidence, platform inventory identity, and the 310 MiB complete ZIP limit.
