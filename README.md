# Bitrix24 task comments to Obsidian Daily Notes

A userscript that appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.

## What it does

After Bitrix24 confirms a supported task-comment request, the script opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time;
- `#task/<id>` when the task ID is available;
- `#company/<name>` when Bitrix24 exposes the linked CRM company on the page.

The `#company/<name>` tag preserves the CRM context of a task comment, so notes can be filtered or found by company in Obsidian without duplicating the company name in the comment text.

Tested only with Bitrix forum comments: an `XMLHttpRequest` `POST` to `/bitrix/services/main/ajax.php?mode=class&c=bitrix%3Aforum.comments&action=processComment` using `application/x-www-form-urlencoded`. The script requires `action=ADD`, `ENTITY_TYPE=TK`, `ENTITY_XML_ID=TASK_<id>`, and `POST_MESSAGE`; other Bitrix APIs, request formats, and `fetch` are not supported.

## Install in Tampermonkey

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. Open the extension dashboard, select **Create a new script**, then delete the generated template.
3. Open [`main.js`](./main.js), copy its entire contents, paste it into the Tampermonkey editor, and press **File → Save** (`Ctrl+S` / `⌘S`).
4. Open a Bitrix24 task, submit a comment, and allow the browser or operating system to open the `obsidian://` link when prompted.

Obsidian must be installed and configured to handle its URI scheme. Violentmonkey and compatible userscript managers can install the same `main.js` file.

## Configuration

Edit `DAILY_NOTE_DIRECTORY` in `main.js` if your vault uses another directory. The script constructs dates using the browser's local time.

### Self-hosted Bitrix

The bundled script is enabled only for Bitrix24 cloud portals (`https://*.bitrix24.*/*`). For a self-hosted portal, add its exact HTTPS host to the userscript metadata before saving in Tampermonkey:

```js
// @match        https://bitrixmoeyjfirmy.ru/*
```

Replace `bitrixmoeyjfirmy.ru` with your portal domain; for example, `https://bitrix.ru/*`. Keep the cloud `@match` line when both portal types are needed. This explicit opt-in avoids granting the script access to every HTTPS site.

## Privacy and permissions

By default, the script runs only on `https://*.bitrix24.*/*`; self-hosted portals require an explicit `@match` entry. On an enabled portal it observes only the tested Bitrix forum-comment `XMLHttpRequest`. It does not send data to a third-party server. Comment text, task IDs, and available CRM company names are passed only to Obsidian through the local `obsidian://` URI and become content in your vault.

Do not install this script on a portal unless you are authorized to copy its comments into your local vault.

## Development

The project has no build step or runtime dependencies. Validate syntax with:

```sh
node --check main.js
```

## License

[MIT](./LICENSE)
