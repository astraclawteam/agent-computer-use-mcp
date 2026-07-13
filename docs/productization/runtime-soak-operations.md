# Runtime Soak Operations

This runbook operates immutable commercial runtime evidence. It does not change
the soak policy, repair a report, or promote a candidate by itself.

## Gates

| Gate | Exact duration | Invocation | Evidence root |
| --- | ---: | --- | --- |
| Pull request | 900,000 ms | `npm run soak:pr` | `evidence/pr-soak` |
| Nightly | 7,200,000 ms | `npm run phase:8.0 -- --gate nightly --duration-ms 7200000 --evidence-root evidence/nightly --seed 20260713` | `evidence/nightly` |
| Release candidate | 28,800,000 ms | `npm run soak:rc` | `evidence/release-candidate` |

All gates enforce at most 128 MiB RSS net growth, at most 128 handles net
growth, a tool-call failure rate below 0.1%, and zero orphan processes, residual ports, overlay leaks, and cursor leaks. A trend warning never changes an absolute gate result.

## Machine Preparation

1. Use a dedicated Windows x64 machine or runner with the exact candidate
   checked out and a clean worktree.
2. Keep at least 5 GiB free for nightly evidence and at least 10 GiB free for a
   release-candidate run and its imported copy.
3. Keep the machine on AC power (plugged in) and set sleep to Never for the run,
   or otherwise disable automatic sleep through the approved machine policy.
4. Schedule outside the Windows Update maintenance window. Confirm there is no
   pending reboot; do not disable security protection or suppress required
   updates to manufacture a passing run.
5. Stop unrelated load generators. Do not close, edit, or inspect user
   applications through Gateway-managed desktop control during the soak.

## Nightly Run

The scheduled workflow owns the normal two-hour run. For an approved local
reproduction, use the exact nightly command in the table. A different duration,
client count, concurrency, fault cadence, sample interval, threshold, or
checkpoint policy fails before the daemon starts.

After completion, verify the sealed directory:

```powershell
npm run evidence:verify -- <evidence-directory>
```

## Release-Candidate Run And Import

Run `npm run soak:rc` from the exact candidate commit. The command records a
checkpoint every ten minutes and seals the run after cleanup. Verify and import
the resulting directory with:

```powershell
npm run soak:rc:verify -- <evidence-directory>
```

The importer verifies the source in place, copies it to a staging directory,
verifies the copy, and atomically promotes it under
`evidence/imported/<commit>/<run-id>`. It never replaces an existing run.

## Failure And Retry

- Never delete or overwrite failed evidence. A passing retry is a separate run
  with a new run ID and remains beside every failed attempt.
- Do not edit `report.json`, `events.jsonl`, `run-manifest.json`, or `checksums.txt`. Editing invalidates the inventory; correct the product or
  environment and run again.
- Retain the failure code, last checkpoint, cleanup event, and exact candidate
  identity when triaging an interruption.
- Screenshots and user documents are forbidden in soak evidence. The retained
  artifact is limited to JSON, JSONL, and checksums.

## Promotion Input

Only an independently verified release-candidate import may become Commercial
1.0 promotion input. The promotion step consumes the immutable directory; it
does not rerun, repair, or reinterpret the source evidence.
