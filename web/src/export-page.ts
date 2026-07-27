/**
 * DOM wiring for the Log & export page (web/export.html). Lists locally
 * logged entries, lets the user delete bad ones, and builds the exact JSON
 * payload `mealtv import-log` expects (see export-log.ts, the pure module
 * that owns the actual transform).
 */

import { importLogCliCommand, toImportLogPayload, type LoggedEntry } from "./export-log.js";
import { getLogEntries, removeLogEntry } from "./storage.js";

const statusEl = document.getElementById("status") as HTMLElement;
const emptyStateEl = document.getElementById("empty-state") as HTMLElement;
const listEl = document.getElementById("log-list") as HTMLUListElement;
const exportPanelEl = document.getElementById("export-panel") as HTMLElement;
const exportButton = document.getElementById("export-button") as HTMLButtonElement;
const copyButton = document.getElementById("copy-button") as HTMLButtonElement;
const downloadButton = document.getElementById("download-button") as HTMLButtonElement;
const cliLabelEl = document.getElementById("cli-label") as HTMLElement;
const cliCommandEl = document.getElementById("cli-command") as HTMLElement;
const jsonLabelEl = document.getElementById("json-label") as HTMLElement;
const textareaEl = document.getElementById("export-textarea") as HTMLTextAreaElement;
const copyConfirmationEl = document.getElementById("copy-confirmation") as HTMLElement;

const EXPORT_FILENAME = "mealtv-log.json";

let entries: LoggedEntry[] = [];

function formatClock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function render(): void {
  entries = getLogEntries();
  listEl.innerHTML = "";
  exportPanelEl.hidden = entries.length === 0;
  emptyStateEl.hidden = entries.length > 0;

  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "log-entry-row";

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${entry.slug} S${entry.season}E${entry.episode} — ${entry.category.replace(/_/g, " ")} @ ${formatClock(entry.atSec)}`;

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "delete";
    delBtn.textContent = "Delete";
    delBtn.addEventListener("click", () => {
      removeLogEntry(entry.id);
      render();
    });

    li.appendChild(meta);
    li.appendChild(delBtn);
    listEl.appendChild(li);
  }

  // Any edit invalidates a previously built export preview.
  cliLabelEl.hidden = true;
  cliCommandEl.hidden = true;
  jsonLabelEl.hidden = true;
  textareaEl.hidden = true;
  copyButton.hidden = true;
  downloadButton.hidden = true;
  copyConfirmationEl.hidden = true;
}

function buildExport(): void {
  const payload = toImportLogPayload(entries);
  const json = JSON.stringify(payload, null, 2);

  textareaEl.value = json;
  textareaEl.hidden = false;
  jsonLabelEl.hidden = false;

  cliCommandEl.textContent = importLogCliCommand(EXPORT_FILENAME);
  cliCommandEl.hidden = false;
  cliLabelEl.hidden = false;

  copyButton.hidden = false;
  downloadButton.hidden = false;
}

exportButton.addEventListener("click", buildExport);

copyButton.addEventListener("click", () => {
  void navigator.clipboard
    .writeText(textareaEl.value)
    .then(() => {
      copyConfirmationEl.hidden = false;
      window.setTimeout(() => {
        copyConfirmationEl.hidden = true;
      }, 3000);
    })
    .catch(() => {
      textareaEl.select();
    });
});

downloadButton.addEventListener("click", () => {
  const blob = new Blob([textareaEl.value], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = EXPORT_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
});

statusEl.hidden = true;
render();
