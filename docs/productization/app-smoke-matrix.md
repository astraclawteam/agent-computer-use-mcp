# App Smoke Matrix

This matrix tracks real local software coverage before commercial release. Each row should become a repeatable smoke script or a documented manual smoke until automation is available.

## Result Vocabulary

- `pass`: action completed through allowed semantic/element path.
- `partial`: observation works, but action needs a missing provider or policy decision.
- `blocked`: blocked by policy, permission, missing dependency, or unsupported platform.
- `insufficient`: perception cannot produce safe actionable targets.

## Capability Sources

- `uia-som`
- `ocr`
- `template`
- `cv`
- `browser-semantic`
- `manual-only`
- `insufficient`

## Matrix

| Category | Target | Minimum Flow | Expected Source | Status | Owner Notes |
| --- | --- | --- | --- | --- | --- |
| Lab | Native Lab | set name, save, verify file | uia-som | pass | Covered by `phase:1.4`. |
| Win32 | Notepad | open file, set text, save | uia-som | blocked | Existing script needs productized harness before promotion. |
| Browser | Chrome/Edge | focus address bar, navigate, observe page title | browser-semantic/uia-som | blocked | Browser semantic provider must be selected when available. |
| Browser | Firefox | navigate, observe page title | uia-som/ocr | blocked | Non-Chromium smoke needs productized harness. |
| Browser | Browser canvas fixture | identify canvas controls and click safe target | ocr/template/cv | insufficient | Must return `observation.insufficient` until local template/CV provider is safe. |
| Browser | Browser private window | observe window title only, deny page content persistence | uia-som | blocked | Private browsing must be policy-blocked before capture or artifact persistence. |
| Electron | VS Code | open command palette, type command | uia-som/ocr | blocked | Accessibility tree depth needs repeatable harness. |
| Electron | Slack/Discord-like app | focus search, read result labels | uia-som/ocr | blocked | Private content persistence must be policy-blocked. |
| Electron | Figma-like design surface | identify toolbar and canvas regions | cv/template/ocr | insufficient | Must return `observation.insufficient` until self-drawn provider confidence is safe. |
| Electron | Obsidian-like markdown editor | focus editor, type harmless note, read status | uia-som/ocr | blocked | Local document content requires policy and repeatable harness before action. |
| WPF | Sample WPF app | set textbox, click button | uia-som | blocked | Public fixture or signed local fixture is required. |
| WinForms | Native Lab | set textbox, click save | uia-som | pass | Covered by real desktop action smoke. |
| Qt | Qt sample app | click button, read label | uia-som/ocr | blocked | Qt provider coverage needs repeatable public sample. |
| Office | Word/LibreOffice Writer | type text, save document | uia-som/ocr | blocked | Policy must avoid unrelated document contents. |
| Office | Excel/LibreOffice Calc | enter value, verify cell text | uia-som/ocr | blocked | Spreadsheet content policy and repeatable harness are required. |
| Office | PowerPoint/LibreOffice Impress | add title text, verify slide label | uia-som/ocr | blocked | Document privacy policy and repeatable harness are required. |
| Editor | Notepad++/Sublime | type text, save file | uia-som/ocr | blocked | Custom editor surfaces need repeatable harness. |
| Editor | Monaco editor fixture | type text, observe caret/status | uia-som/ocr | blocked | Browser/editor fixture needs repeatable harness and policy-scoped artifacts. |
| Terminal | Windows Terminal | run harmless command, observe output | uia-som/ocr | blocked | Dangerous shell text patterns must be policy-blocked. |
| Terminal | PowerShell console | run harmless echo command, observe output | uia-som/ocr | blocked | Shell actions require command allowlist and policy-blocked dangerous patterns. |
| Canvas | Browser canvas fixture | identify controls and click safe target | ocr/template/cv | insufficient | Must return `observation.insufficient` until local template/CV provider is safe. |
| Self-drawn | Custom Skia/ImGui fixture | identify button-like regions | template/cv | insufficient | Must return `observation.insufficient` when provider confidence is unsafe. |
| Industrial | CAD-like public demo | identify panels/viewport/timeline regions | cv/template/ocr | insufficient | Must return `observation.insufficient` until CAD-like provider is safe. |
| Industrial | Video editor timeline fixture | identify timeline, media bin, and export button regions | cv/template/ocr | insufficient | Must return `observation.insufficient` until timeline provider confidence is safe. |

## Per-App Smoke Output Schema

```ts
interface AppSmokeResult {
  appId: string;
  appName: string;
  category: string;
  status: "pass" | "partial" | "blocked" | "insufficient";
  capabilitySources: Array<"uia-som" | "ocr" | "template" | "cv" | "browser-semantic" | "manual-only" | "insufficient">;
  flow: string;
  includeUserOverlay: false;
  policyEvents: string[];
  artifacts: string[];
  notes: string;
}
```
