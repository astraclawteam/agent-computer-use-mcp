## What changed

-

## Why it matters

Describe the real user scenario, observed failure, or capability gap. Link an
issue when one exists.

## Evidence

Show the before/after structured result or final application state. Use
synthetic data only; do not attach private screenshots, OCR text, paths, or
documents.

## Contract impact

- [ ] No MCP public contract changes
- [ ] MCP tool name/argument/result changes
- [ ] Agent/Host visibility or lifecycle metadata changes
- [ ] Environment/config changes
- [ ] Released artifact, dependency, model, or native binary changes

If checked, identify every producer and consumer and describe compatibility.

## Safety checklist

- [ ] User-only overlay is not included in observations, screenshots, OCR input, or artifacts
- [ ] Actions are grounded in semantic evidence, a focus receipt, or an exact fresh observation
- [ ] Focus, scale, truncation, execution path, and fallback metadata remain honest
- [ ] Success, failure, cancellation, timeout, disconnect, and shutdown release owned resources
- [ ] No secrets, local private data, generated captures, model packs, or build outputs are committed
- [ ] New dependencies are justified for size, license, offline behavior, and platform support
- [ ] No application-name keyword, regex, or hard-coded natural-language routing was added
- [ ] Asset trust, installation, approval, and media delivery remain Host-owned

## Verification

Paste exact commands and pass counts:

```text
npm test
```

Additional phase checks, if relevant:

```text
npm run phase:1.6
npm run phase:1.7
npm run phase:1.8
npm run phase:1.4
```

## Notes For Reviewers

Call out the highest-risk assumption and the most important file to review first.
