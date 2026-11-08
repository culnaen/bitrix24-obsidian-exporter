---
title: Create task cards before linking daily messages
author: Culnaen
date: 2026-11-08
branch: main
id: l-516f6329
scope: repo
status: active
src: agent
touches:
  - README.md
  - bitrix24-obsidian-exporter.user.js
  - test/userscript.test.js
---

## Decided
- Create the ID-named task card in the user-selected 02-Tasks/Bitrix folder before opening a daily Obsidian URI. The folder handle comes from File System Access and is kept in the existing Bitrix-origin IndexedDB; never overwrite existing cards.
- If permission is missing, keep the confirmed message pending in the tab and show a folder picker instead of writing a dangling daily link.
## Tried and ruled out
- Opening two obsidian://new URIs for one message: browser external-protocol prompts are not a reliable atomic creation sequence; a failed card creation would leave a broken daily link.
## Watch out
- The selected Bitrix folder must belong to the vault; grant Bitrix-origin read/write access to that folder only. No REST token is needed.
In the code: bitrix24-obsidian-exporter.user.js taskNoteContent, ensureTaskNote, exportPendingEntries; README.md Task cards.
