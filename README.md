# Bitrix24 task comments to Obsidian Daily Notes

A userscript that appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.

## What it does

After Bitrix24 confirms a supported task-comment request, the script opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time;
- `#task/<id>` when the task ID is available;
- `#company/<name>` when Bitrix24 exposes the linked CRM company on the page.

Supported actions are `tasks.task.comment.add`, `task.comment.add`, `task.commentitem.add`, `tasks.task.chat.message.send`, and the Bitrix forum task-comment flow.

## Install in Tampermonkey

1. Install the [Tampermonkey browser extension](https://www.tampermonkey.net/).
2. Open the extension dashboard, select **Create a new script**, then delete the generated template.
3. Open [`main.js`](./main.js), copy its entire contents, paste it into the Tampermonkey editor, and press **File → Save** (`Ctrl+S` / `⌘S`).
4. Open a Bitrix24 task, submit a comment, and allow the browser or operating system to open the `obsidian://` link when prompted.

Obsidian must be installed and configured to handle its URI scheme. Violentmonkey and compatible userscript managers can install the same `main.js` file.

## Configuration

Edit `DAILY_NOTE_DIRECTORY` in `main.js` if your vault uses another directory. The script constructs dates using the browser's local time.

## Privacy and permissions

The script runs only on `https://*.bitrix24.*/*`. It observes in-page `fetch` and `XMLHttpRequest` calls solely to recognize supported task-comment submissions. It does not send data to a third-party server. Comment text, task IDs, and available CRM company names are passed only to Obsidian through the local `obsidian://` URI and become content in your vault.

Do not install this script on a portal unless you are authorized to copy its comments into your local vault.

## Development

The project has no build step or runtime dependencies. Validate syntax with:

```sh
node --check main.js
```

## License

[MIT](./LICENSE)
