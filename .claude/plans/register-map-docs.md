# Plan — restore register map, resolve register TBDs in docs

## What & why

`.claude/docs/register-map.md` was empty. The original vendor file is in
`~/Downloads/energy-report-take-home.zip`; the zip's other three files are byte-identical to the
repo copies. Restore it verbatim, then replace every "TBD (register-map.md)" in the docs with the
decoded rules and the expected numbers. User choices:

- docs only, no feature code yet;
- the power ×3 conflict is recorded in a separate file and stays open for the user to decide.

## Files

- `register-map.md`: restored verbatim. Never edited.
- New `register-map-analysis.md`: address mapping, decoding, facts verified against the data,
  conflicts C-01…C-05 (C-02 power ×3 open), decode constants, expected report values.
- Updated:
  - `srs.md`, `business-rules.md`, `architecture.md`, `coding-standards.md`, `testing-standards.md`,
    `error-handling.md`, `security-rules.md`, `user-stories.md`, `requirements-traceability-matrix.md`:
    remove TBDs, add rollover, power-loss and N/A rules, and the acceptance numbers;
  - `CLAUDE.md` Docs table.

## Evidence

Read-only exploratory decode scripts in the session scratchpad (not project code). The feature's
tests must reproduce these numbers.

## Pipeline fit

Docs only. Feature code (step D) goes through the pipeline later, after the C-02 decision.
