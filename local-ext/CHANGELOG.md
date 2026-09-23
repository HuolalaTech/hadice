# Changelog

## 2026-09-22 — Windows ConPTY local Shell

- Add ConPTY-backed `shell_windows.go` (methods/events match official Shell API).
- Library: `github.com/UserExistsError/conpty`
- `apply.ps1` / `revert.ps1` / `build-after-apply.ps1`
- Ops log: `F:\techtool\hadice\.agent-ops.log`
- Constraint: no permanent official-source edits; apply is temporary and revertible.

## 2026-09-22 - README: revert impact and verify steps

- Accidental revert.ps1 only restores official backend temp patches; does not delete local-ext/; does not rebuild exe.
- README now has smoke-test checklist (terminal page / echo / resize / exit).
## 2026-09-22 - README: re-apply after revert

- Documented how to re-run build-after-apply.ps1 and Start-Process Hadice.exe after accidental revert.
