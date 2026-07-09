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
| Win32 | Notepad | open file, set text, save | uia-som | pending | Existing script needs productized harness. |
| Browser | Chrome/Edge | focus address bar, navigate, observe page title | browser-semantic/uia-som | pending | Prefer browser semantic provider when available. |
| Browser | Firefox | navigate, observe page title | uia-som/ocr | pending | Validate non-Chromium behavior. |
| Electron | VS Code | open command palette, type command | uia-som/ocr | pending | Check accessibility tree depth. |
| Electron | Slack/Discord-like app | focus search, read result labels | uia-som/ocr | pending | Avoid private content persistence. |
| WPF | Sample WPF app | set textbox, click button | uia-som | pending | Add fixture if no public app is available. |
| WinForms | Native Lab | set textbox, click save | uia-som | pass | Covered by real desktop action smoke. |
| Qt | Qt sample app | click button, read label | uia-som/ocr | pending | Important for industrial software. |
| Office | Word/LibreOffice Writer | type text, save document | uia-som/ocr | pending | Must avoid reading unrelated document contents. |
| Editor | Notepad++/Sublime | type text, save file | uia-som/ocr | pending | Validate custom editor surfaces. |
| Terminal | Windows Terminal | run harmless command, observe output | uia-som/ocr | pending | Deny dangerous shell text patterns. |
| Canvas | Browser canvas fixture | identify controls and click safe target | ocr/template/cv | pending | No image upload required. |
| Self-drawn | Custom Skia/ImGui fixture | identify button-like regions | template/cv | pending | Should return `insufficient` if unsafe. |
| Industrial | CAD-like public demo | identify panels/viewport/timeline regions | cv/template/ocr | pending | Do not require full automation at first. |

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

