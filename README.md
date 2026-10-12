# Bitrix24 task chat to Obsidian Daily Notes

A userscript that appends successfully sent Bitrix24 task chat text and images to the current Obsidian daily note.

## What it does

After Bitrix24 confirms a task chat message, the script opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time;
- `#task/<id>` when the task ID is available;
- `#company/<name>` for each company linked to that task in the CRM field. Contacts are not exported;
- local `![[image.png]]` embeds when the message includes images. Images are downloaded into a folder you select **inside the Obsidian vault** before the note is opened.

The company tag is read from the matching task card (including a task opened in a side slider), not from CRM links elsewhere on the page. Names are normalized as Obsidian tags; for example, `ООО "ЛАСНЕТ"` becomes `#company/ООО_ЛАСНЕТ`.

Tested on a self-hosted 1C-Bitrix Corporate Portal 26.800.0 task. The script observes same-origin `POST /bitrix/services/main/ajax.php?action=tasks.v2.Task.get` to associate the task ID with its `chatId`, then `im.v2.Chat.Message.send` for text or `POST /rest/im.disk.file.commit.json` for images. It exports only after Bitrix confirms the message ID and the matching task chat is open. Other chats and legacy forum comments are not exported. Both `XMLHttpRequest` and `fetch` are supported.

## Install in Tampermonkey

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. Click **[Install the userscript](https://culnaen.github.io/bitrix24-obsidian-exporter/bitrix24-obsidian-exporter.user.js)** and confirm the installation in Tampermonkey.
3. Open a Bitrix24 task, send a task chat message, and allow the browser or operating system to open the `obsidian://` link when prompted.

When upgrading from the forum-comment version, update the existing Tampermonkey entry and reload the task tab. The entry retains its old “task comments” name so Tampermonkey recognizes it as the same script; check that its version is **1.6.0** before testing.

Obsidian must be installed and configured to handle its URI scheme. Violentmonkey and compatible userscript managers can use the same link.

## Configuration

In Tampermonkey, open the script's menu on a Bitrix24 page and choose **«Настроить экспорт в Obsidian»**. You can set the daily-note directory, enable or disable task and CRM-company tags, and rename their prefixes. Settings are stored by Tampermonkey and survive userscript updates. The script constructs dates using the browser's local time.

### Images

In Chrome or Edge on HTTPS, open **«Настроить экспорт в Obsidian»** and click **«Выбрать папку вложений Obsidian»**. Choose an existing attachment folder **inside your vault**, not the vault root. The browser grants the Bitrix site read/write access to the selected folder; accept the browser permission prompt. Set Obsidian's attachment location to that folder (or another setting where Obsidian resolves bare `![[filename]]` links). Keep the task tab open until images are exported.

After a task-chat image upload is confirmed, the script downloads the image through your logged-in Bitrix session, saves it to that folder under `bitrix-task-<task>-message-<message>-file-<file>.<extension>`, then appends the text and embeds to the daily note. Multiple images in one message are supported. No REST token or extra scope is required. If permission expires, the download fails, or no folder was selected, an on-page warning retains the message until you choose/reselect a folder and retry; **no broken note link is opened**. Pending messages exist only in the current tab: do not reload or close it before resolving a warning. Re-select the folder when Chrome revokes permission or after changing vaults.

The file picker is required for images; browsers without the File System Access API can still export text messages.

Tag names may contain letters, digits, `_`, `-`, and `/`; do not include the leading `#`. Defaults are `#task/<id>` and `#company/<name>`. **«Сбросить»** restores these defaults and `03-Daily`.

### Self-hosted Bitrix

The script is enabled for Bitrix24 cloud portals and task pages on self-hosted HTTPS portals (`https://*/company/personal/user/*/tasks/*`). To use other task URL patterns, add an exact host `@match` rule in Tampermonkey:

```js
// @match        https://bitrixmoeyjfirmy.ru/*
```

Replace `bitrixmoeyjfirmy.ru` with your portal domain. Keep the cloud `@match` line if needed.

## Privacy and permissions

On enabled pages the script observes only task lookup and task chat send/attachment commit requests. It uses the browser's existing Bitrix session: no REST token or additional OAuth scope is required. It does not send data to a third-party server. Chat text, task IDs, and available CRM company names are passed only to Obsidian through the local `obsidian://` URI. Images are downloaded from Bitrix and written only to the folder selected in the browser picker; the folder handle is stored in the Bitrix origin's IndexedDB.

Do not install this script on a portal unless you are authorized to copy its task chat messages into your local vault.

## Development

The project has no build step or runtime dependencies. Validate syntax with:

```sh
node --check bitrix24-obsidian-exporter.user.js
```

## License

[MIT](./LICENSE)
