import path from "node:path";
import type { DesktopCdpHostSpec } from "@beauticode/adapter-desktop-cdp";

function candidates(): string[] {
  const values = [
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "cursor", "Cursor.exe")
      : "",
    process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, "Cursor", "Cursor.exe")
      : "",
    process.env["ProgramFiles(x86)"]
      ? path.join(process.env["ProgramFiles(x86)"]!, "Cursor", "Cursor.exe")
      : "",
    "D:\\cursor\\Cursor.exe",
  ];
  return [...new Set(values.filter(Boolean).map((value) => path.win32.normalize(value)))];
}

export const CURSOR_CDP_SPEC: DesktopCdpHostSpec = Object.freeze({
  kind: "cursor",
  displayName: "Cursor",
  processName: "Cursor.exe",
  executableCandidates: Object.freeze(candidates()),
  defaultPort: 9341,
  candidatePorts: Object.freeze([9351, 9361, 9371]),
  popupTopInset: 44,
  targetUrl:
    "vscode-file://vscode-app/d:/cursor/resources/app/out/vs/code/electron-sandbox/workbench/workbench.html",
  targetRuntimeUrl: "vscode-file://vscode-app/",
  mount: "cursor",
  anchorSelector: '[data-action-id="marketplace"][data-sidebar-primary-action]',
  anchorText: "Customize",
  strings: Object.freeze({
    entry: "background",
    title: "Background",
    dim: "Background shadow",
    blur: "Background blur",
    transparency: "Panel transparency",
    sound: "Sound",
    soundOn: "On",
    soundOff: "Off",
    importBackground: "Import background",
    chooseFile: "Choose file",
    savedThemes: "Saved themes",
    choose: "Choose",
    skinCenter: "Skin center",
    open: "Open",
    clearBackground: "Clear background",
    clear: "Clear",
    saveTheme: "Save theme",
    themeNamePlaceholder: "Theme name",
    cancel: "Cancel",
    saveAndApply: "Save and apply",
    nameRequired: "Enter a theme name.",
    noThemes: "No saved themes.",
    close: "Close",
    image: "Image",
    video: "Video",
    missingFile: "The original file is unavailable.",
    unsupportedFile: "Unsupported image or video format.",
    importFailed: "The background could not be loaded.",
    appliedImage: "Image background applied.",
    appliedVideo: "Video background applied.",
  }),
  contract: Object.freeze({
    backdropSelectors: Object.freeze([
      "body > div:has(.agent-panel)",
      "div:has(> .ui-sidebar)",
      ".monaco-workbench",
      ".part.editor",
      ".editor-group-container",
      ".editor-instance",
      ".monaco-editor",
      ".monaco-editor-background",
      ".monaco-editor .margin",
      ".agent-panel",
      ".terminal-outer-container",
    ]),
    surfaceSelectors: Object.freeze([
      ".ui-sidebar",
      ".ui-prompt-input__container",
      ".part.sidebar",
      ".part.panel",
      '[role="dialog"]',
    ]),
    flattenSelectors: Object.freeze([
      ".ui-prompt-input__container > *",
      ".part.sidebar > .content",
      ".part.panel > .content",
    ]),
  }),
  theme: Object.freeze({
    highContrastClassTokens: Object.freeze(["cursor-high-contrast", "hc-black"]),
    darkClassTokens: Object.freeze(["cursor-dark", "vs-dark"]),
    lightClassTokens: Object.freeze(["cursor-light"]),
    observeAttributes: Object.freeze(["class", "data-theme"]),
  }),
});
