/**
 * DOM wiring for the home/search page (web/index.html). Not imported by
 * tests — all decision logic it uses lives in pure modules (risk.ts).
 */

import { loadCatalogIndex } from "./catalog-client.js";
import { computeHomeRisk } from "./risk.js";
import type { CatalogIndexEntry } from "./types.js";

const statusEl = document.getElementById("status") as HTMLElement;
const listEl = document.getElementById("show-list") as HTMLUListElement;
const searchEl = document.getElementById("search-box") as HTMLInputElement;

let allShows: CatalogIndexEntry[] = [];

function render(shows: CatalogIndexEntry[]): void {
  listEl.innerHTML = "";
  if (shows.length === 0) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = allShows.length === 0 ? "No shows in the catalog yet." : "No shows match your search.";
    listEl.appendChild(li);
    return;
  }

  for (const show of shows) {
    const risk = computeHomeRisk(show);
    const li = document.createElement("li");

    const a = document.createElement("a");
    a.className = "show-row";
    a.href = `show.html?slug=${encodeURIComponent(show.slug)}`;

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = show.title;

    const chip = document.createElement("span");
    chip.className = `risk-chip ${risk.level}`;
    chip.textContent = risk.label;

    a.appendChild(title);
    a.appendChild(chip);
    li.appendChild(a);
    listEl.appendChild(li);
  }
}

function applyFilter(): void {
  const query = searchEl.value.trim().toLowerCase();
  const filtered = query
    ? allShows.filter((s) => s.title.toLowerCase().includes(query))
    : allShows;
  render(filtered);
}

async function init(): Promise<void> {
  try {
    allShows = await loadCatalogIndex();
  } catch (err) {
    statusEl.textContent = `Couldn't load the catalog: ${(err as Error).message}`;
    statusEl.className = "error-state";
    return;
  }

  statusEl.hidden = true;
  listEl.hidden = false;
  render(allShows);

  searchEl.addEventListener("input", applyFilter);
}

void init();
