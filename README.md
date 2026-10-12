# Bitrix24 task chat to Obsidian Daily Notes

A userscript that appends successfully sent Bitrix24 task chat messages to the current Obsidian daily note.

## What it does

After Bitrix24 confirms a task chat message, the script opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time;
- `#task/<id>` when the task ID is available;
- `#company/<name>` when Bitrix24 exposes the linked CRM company on the page.

The `#company/<name>` tag preserves the CRM context of a task chat message, so notes can be filtered or found by company in Obsidian without duplicating the company name in the message text.

Tested on a self-hosted 1C-Bitrix Corporate Portal 26.800.0 task. The script observes same-origin `POST /bitrix/services/main/ajax.php?action=tasks.v2.Task.get` to associate the task ID with its `chatId`, then `POST /bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send` to read `dialogId=chat<chatId>` and `fields[message]`. It exports only after Bitrix confirms the message ID and the matching task chat is open. Other chats and legacy forum comments are not exported. Both `XMLHttpRequest` and `fetch` are supported.

## Install in Tampermonkey

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. Click **[Install the userscript](https://culnaen.github.io/bitrix24-obsidian-exporter/bitrix24-obsidian-exporter.user.js)** and confirm the installation in Tampermonkey.
3. Open a Bitrix24 task, send a task chat message, and allow the browser or operating system to open the `obsidian://` link when prompted.

When upgrading from the forum-comment version, update the existing Tampermonkey entry and reload the task tab. The entry retains its old “task comments” name so Tampermonkey recognizes it as the same script; check that its version is **1.5.1** before testing.

Obsidian must be installed and configured to handle its URI scheme. Violentmonkey and compatible userscript managers can use the same link.

## Configuration

In Tampermonkey, open the script's menu on a Bitrix24 page and choose **«Настроить экспорт в Obsidian»**. You can set the daily-note directory, enable or disable task and CRM-company tags, and rename their prefixes. Settings are stored by Tampermonkey and survive userscript updates. The script constructs dates using the browser's local time.

Tag names may contain letters, digits, `_`, `-`, and `/`; do not include the leading `#`. Defaults are `#task/<id>` and `#company/<name>`. **«Сбросить»** restores these defaults and `03-Daily`.

### Self-hosted Bitrix

The script is enabled for Bitrix24 cloud portals and task pages on self-hosted HTTPS portals (`https://*/company/personal/user/*/tasks/*`). To use other task URL patterns, add an exact host `@match` rule in Tampermonkey:

```js
// @match        https://bitrixmoeyjfirmy.ru/*
```

Replace `bitrixmoeyjfirmy.ru` with your portal domain. Keep the cloud `@match` line if needed.

## Privacy and permissions

On enabled pages the script observes only the task lookup and task chat send AJAX requests. It uses the browser's existing Bitrix session: no REST token or additional OAuth scope is required. It does not send data to a third-party server. Chat text, task IDs, and available CRM company names are passed only to Obsidian through the local `obsidian://` URI and become content in your vault.

Do not install this script on a portal unless you are authorized to copy its task chat messages into your local vault.

## Development

The project has no build step or runtime dependencies. Validate syntax with:

```sh
node --check bitrix24-obsidian-exporter.user.js
```

## License

[MIT](./LICENSE)
