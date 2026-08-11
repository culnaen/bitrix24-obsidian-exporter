# Bitrix24 task comments to Obsidian Daily Notes

A userscript that appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.

## What it does

After Bitrix24 confirms a supported task-comment request, the script opens an `obsidian://new` URI with:

- daily note path: `03-Daily/YYYY-MM-DD.md`;
- one appended list item with the local time;
- `#task/<id>` when the task ID is available;
- `#company/<name>` when Bitrix24 exposes the linked CRM company on the page.

Supported actions are `tasks.task.comment.add`, `task.comment.add`, `task.commentitem.add`, `tasks.task.chat.message.send`, and the Bitrix forum task-comment flow.

## Installation

1. Install [Violentmonkey](https://violentmonkey.github.io/), Tampermonkey, or another userscript manager.
2. Create a new userscript and replace its contents with [`main.js`](./main.js).
3. Save it, then open a Bitrix24 portal and submit a task comment.
4. Allow your browser and operating system to open `obsidian://` links when prompted.

Obsidian must be installed and configured to handle its URI scheme.

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

No license has been selected yet. Do not assume permission to reuse, modify, or distribute the code beyond rights granted by applicable law.
