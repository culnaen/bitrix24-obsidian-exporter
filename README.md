# Bitrix24 task chat to linked Obsidian notes

A userscript that creates ID-named Bitrix task cards and appends sent task-chat messages to linked Obsidian daily notes.

## What it does

After Bitrix24 confirms a task chat message, the script first creates `02-Tasks/Bitrix/<id>.md` if it is missing. The card contains `bitrix_id`, `tags` (`lasnet` and `company/<normalized name>` for each available directly linked CRM company), the title returned by Bitrix (or `null` if unavailable), and a source URL when the task card URL identifies the current user. If no company is linked or its name cannot be obtained, the card keeps only `lasnet`. Existing cards are never overwritten. It then opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time and `[[02-Tasks/Bitrix/<id>|№<id>]]`;
- `#company/<name>` for each company linked to that task in the CRM field. Contacts are not exported;
- local `![[image.png]]` embeds when the message includes images. Images are downloaded into a folder you select **inside the Obsidian vault** before the note is opened.

The daily company tag is read from the matching Bitrix task card (including a task opened in a side slider), not from CRM links elsewhere on the page. Task-card company tags use direct CRM company links from the task response when available, with the displayed Bitrix task card as a fallback. Contacts are excluded. Names are normalized as Obsidian tags; for example, `ООО "ЛАСНЕТ"` becomes `company/ООО_ЛАСНЕТ` in card properties and `#company/ООО_ЛАСНЕТ` in daily notes.

Tested on a self-hosted 1C-Bitrix Corporate Portal 26.800.0 task. The script observes same-origin `POST /bitrix/services/main/ajax.php?action=tasks.v2.Task.get` to associate the task ID with its `chatId`, then `im.v2.Chat.Message.send` for text or `POST /rest/im.disk.file.commit.json` for images. It exports only after Bitrix confirms the message ID and the matching task chat is open. Other chats and legacy forum comments are not exported. Both `XMLHttpRequest` and `fetch` are supported.

## Install in Tampermonkey

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. Click **[Install the userscript](https://culnaen.github.io/bitrix24-obsidian-exporter/bitrix24-obsidian-exporter.user.js)** and confirm the installation in Tampermonkey.
3. Create the `02-Tasks/Bitrix` folder inside your vault. On a Bitrix24 task page, open **«Настроить экспорт в Obsidian»** and select this folder with **«Выбрать папку 02-Tasks/Bitrix»**. Chrome or Edge on HTTPS is required for task cards.
4. Send a task chat message, and allow the browser or operating system to open the `obsidian://` link when prompted.

When upgrading from an earlier version, update the existing Tampermonkey entry and reload the task tab. The entry retains its old “task comments” name so Tampermonkey recognizes it as the same script; check that its version is **1.7.1** before testing.

Obsidian must be installed and configured to handle its URI scheme. Violentmonkey and compatible userscript managers can use the same link.

## Configuration

In Tampermonkey, open the script's menu on a Bitrix24 page and choose **«Настроить экспорт в Obsidian»**. You can set the daily-note directory and enable or disable **daily-note** CRM-company tags or rename their prefix. Task-card tags always use `lasnet` and `company/`, regardless of the daily-note setting. Task links and the task-card directory are fixed at `02-Tasks/Bitrix`; the old task-tag settings are ignored. Settings are stored by Tampermonkey and survive userscript updates. The script constructs dates using the browser's local time.

### Task cards

Select the **existing** `02-Tasks/Bitrix` directory inside the vault, not the vault root or another directory named `Bitrix`. The browser grants the Bitrix origin read/write access to that folder. The selected handle is saved in the Bitrix origin's IndexedDB; permission may need renewing after a restart or changing vaults. If the folder is unavailable, a confirmed message waits in the open task tab and **neither a broken daily link nor an incomplete task card is opened**. Choose or reselect the folder in the warning to retry; do not close or reload the tab while a message is pending.

### Images

In Chrome or Edge on HTTPS, open **«Настроить экспорт в Obsidian»** and click **«Выбрать папку вложений Obsidian»**. Choose an existing attachment folder **inside your vault**, not the vault root. The browser grants the Bitrix site read/write access to the selected folder; accept the browser permission prompt. Set Obsidian's attachment location to that folder (or another setting where Obsidian resolves bare `![[filename]]` links). Keep the task tab open until images are exported.

After a task-chat image upload is confirmed, the script downloads the image through your logged-in Bitrix session, saves it to that folder under `bitrix-task-<task>-message-<message>-file-<file>.<extension>`, then appends the text and embeds to the daily note. Multiple images in one message are supported. No REST token or extra scope is required. If permission expires, the download fails, or no folder was selected, an on-page warning retains the message until you choose/reselect a folder and retry; **no broken note link is opened**. Pending messages exist only in the current tab: do not reload or close it before resolving a warning. Re-select the folder when Chrome revokes permission or after changing vaults.

The file picker is required for task cards, including text-only messages. Browsers without the File System Access API cannot use this export path.

Company-tag names may contain letters, digits, `_`, `-`, and `/`; do not include the leading `#`. The default is `#company/<name>`. **«Сбросить»** restores this default and `03-Daily`.

### Self-hosted Bitrix

The script is enabled for Bitrix24 cloud portals and task pages on self-hosted HTTPS portals (`https://*/company/personal/user/*/tasks/*`). To use other task URL patterns, add an exact host `@match` rule in Tampermonkey:

```js
// @match        https://bitrixmoeyjfirmy.ru/*
```

Replace `bitrixmoeyjfirmy.ru` with your portal domain. Keep the cloud `@match` line if needed.

## Privacy and permissions

On enabled pages the script observes task lookup and task chat send/attachment commit requests, and looks up names of directly linked CRM companies when creating a card. It uses the browser's existing Bitrix session: no REST token or additional OAuth scope is required. It does not send data to a third-party server. Chat text and task IDs go to Obsidian through the local `obsidian://` URI; CRM company tags go into that URI only when enabled for daily notes. Task titles, CRM company tags, and source URLs are written to the selected task folder, images to the selected attachment folder. The Bitrix origin has read/write access to both selected folders; their handles are stored in its IndexedDB. Only select vault folders whose contents you are authorized to expose to that origin.

Do not install this script on a portal unless you are authorized to copy its task chat messages into your local vault.

## Development

The project has no build step or runtime dependencies. Validate syntax and behavior with:

```sh
node --check bitrix24-obsidian-exporter.user.js
node --test test/userscript.test.js
```

## License

[MIT](./LICENSE)
