---
title: Resolve task-card company tags from direct CRM links
author: Culnaen
date: 2026-11-08
branch: main
id: l-c1e369cf
scope: repo
status: active
src: agent
touches:
  - README.md
  - bitrix24-obsidian-exporter.user.js
  - test/userscript.test.js
---

## Decided
- Task-card company tags use only direct CO_<id> company links from the tasks.v2.Task.get crmItemIds array; C_<id> references are contacts, not companies.
- Resolve each direct company through crm.controller.item.get with entityTypeId 4 in the existing Bitrix browser session, then normalize it to company/<name> in the note tags property. Use the matching task card DOM only if the CRM lookup is unavailable.
## Watch out
- Daily company tags may be absent or stale even when a task currently links a company; do not infer current task-card tags solely from old daily entries. Preserve user-edited existing task notes on future exports.
In the code: bitrix24-obsidian-exporter.user.js companyTagsForCard, processChatResponse and taskNoteContent; test/userscript.test.js CRM company card test; README.md task card documentation.
