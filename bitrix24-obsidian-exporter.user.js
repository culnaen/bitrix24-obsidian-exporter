// ==UserScript==
// @name         Bitrix24 task comments to Obsidian Daily Notes
// @namespace    bitrix24-obsidian-exporter
// @version      1.6.0
// @description  Exports sent Bitrix24 task chat text and images to Obsidian Daily Notes.
// @homepageURL  https://github.com/culnaen/bitrix24-obsidian-exporter
// @source       https://github.com/culnaen/bitrix24-obsidian-exporter.git
// @supportURL   https://github.com/culnaen/bitrix24-obsidian-exporter/issues
// @downloadURL  https://raw.githubusercontent.com/culnaen/bitrix24-obsidian-exporter/main/bitrix24-obsidian-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/culnaen/bitrix24-obsidian-exporter/main/bitrix24-obsidian-exporter.user.js
// @match        https://*.bitrix24.*/*
// @match        https://*/company/personal/user/*/tasks/*
// @noframes
// @run-at       document-start
// @sandbox      raw
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    'use strict';
    const INSTALLATION_MARKER = 'data-bitrix24-obsidian-exporter-installed';
    const FRAME_INTERCEPTORS_MARKER = '__bitrix24ObsidianExportInterceptorsInstalled';
    if (window.top !== window
        || document.documentElement?.hasAttribute(INSTALLATION_MARKER)) {
        return;
    }
    document.documentElement.setAttribute(INSTALLATION_MARKER, '');

    const DEFAULT_SETTINGS = Object.freeze({
        dailyNoteDirectory: '03-Daily',
        includeTaskTag: true,
        taskTagName: 'task',
        includeCompanyTag: true,
        companyTagName: 'company',
    });
    const SETTINGS_STORAGE_KEY = 'bitrix24-obsidian:settings';
    const DEDUPLICATION_INTERVAL_MS = 5000;
    const LAST_EXPORT_STORAGE_KEY = 'bitrix24-obsidian:last-export';
    const TASK_GET_ACTION = 'tasks.v2.task.get';
    const CHAT_SEND_ACTION = 'im.v2.chat.message.send';
    const IMAGE_COMMIT_ACTION = 'im.disk.file.commit';
    const ATTACHMENT_DB = 'bitrix24-obsidian-attachments';
    const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']);
    const pendingImages = new Map();
    let exportingImages = false;
    let retryImages = false;


    function pad(number) {
        return String(number).padStart(2, '0');
    }

    function dailyNotePath(date, settings) {
        return `${settings.dailyNoteDirectory}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
    }

    function isTagName(value) {
        return typeof value === 'string'
            && /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u.test(value);
    }

    function normalizeSettings(value) {
        const settings = value && typeof value === 'object' ? value : {};
        const dailyNoteDirectory = typeof settings.dailyNoteDirectory === 'string'
            ? settings.dailyNoteDirectory.trim().replace(/^\/+|\/+$/g, '')
            : '';

        return {
            dailyNoteDirectory: dailyNoteDirectory || DEFAULT_SETTINGS.dailyNoteDirectory,
            includeTaskTag: typeof settings.includeTaskTag === 'boolean'
                ? settings.includeTaskTag
                : DEFAULT_SETTINGS.includeTaskTag,
            taskTagName: isTagName(settings.taskTagName)
                ? settings.taskTagName
                : DEFAULT_SETTINGS.taskTagName,
            includeCompanyTag: typeof settings.includeCompanyTag === 'boolean'
                ? settings.includeCompanyTag
                : DEFAULT_SETTINGS.includeCompanyTag,
            companyTagName: isTagName(settings.companyTagName)
                ? settings.companyTagName
                : DEFAULT_SETTINGS.companyTagName,
        };
    }

    function loadSettings() {
        try {
            return normalizeSettings(GM_getValue(SETTINGS_STORAGE_KEY, DEFAULT_SETTINGS));
        } catch {
            return DEFAULT_SETTINGS;
        }
    }

    function saveSettings(settings) {
        GM_setValue(SETTINGS_STORAGE_KEY, settings);
    }

    function companyTagsFromTask(taskDocument, taskId, settings) {
        if (!settings.includeCompanyTag) {
            return [];
        }

        const card = taskDocument.querySelector(`.tasks-full-card[data-task-id="${taskId}"]`);
        if (!card) {
            return [];
        }

        const tags = [];
        for (const item of card.querySelectorAll('.tasks-field-crm-item-text > span')) {
            const type = item.firstChild?.textContent.trim().toLowerCase();
            if (type !== 'компания' && type !== 'company') {
                continue;
            }

            const name = item.querySelector('a')?.textContent.trim();
            if (!name) {
                continue;
            }
            const slug = name
                .replace(/["'«»„“”]/g, '')
                .replace(/[^\p{L}\p{N}_-]+/gu, '_')
                .replace(/^_+|_+$/g, '');
            if (slug) {
                const tag = `#${settings.companyTagName}/${slug}`;
                if (!tags.includes(tag)) {
                    tags.push(tag);
                }
            }
        }

        return tags;
    }

    function formatEntry(entry, date, settings, taskDocument) {
        const value = entry.message.replace(/\r\n?/g, '\n').trim();
        const tags = [
            settings.includeTaskTag && entry.taskId ? `#${settings.taskTagName}/${entry.taskId}` : null,
            ...companyTagsFromTask(taskDocument, entry.taskId, settings),
        ].filter(Boolean);
        const tagPrefix = tags.length > 0 ? `${tags.join(' ')} ` : '';

        return `\n- ${pad(date.getHours())}:${pad(date.getMinutes())} ${tagPrefix}${value}`;
    }

    function showSuccessNotification() {
        let targetDocument = document;
        try {
            targetDocument = window.top.document;
        } catch {
            // Cross-origin frames must render the link in their own document.
        }

        targetDocument.getElementById('bitrix24-obsidian-notification')?.remove();

        const panel = targetDocument.createElement('div');
        panel.id = 'bitrix24-obsidian-notification';
        Object.assign(panel.style, {
            position: 'fixed',
            right: '20px',
            bottom: '20px',
            zIndex: '2147483647',
            padding: '12px 16px',
            border: '1px solid #7c3aed',
            borderRadius: '8px',
            background: '#18181b',
            color: '#fafafa',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            font: '14px/1.4 sans-serif',
        });

        const message = targetDocument.createElement('span');
        message.textContent = 'Сообщение чата задачи передано в Obsidian';

        panel.append(message);
        (targetDocument.body || targetDocument.documentElement).append(panel);
        window.setTimeout(() => panel.remove(), 5000);
    }

    function claimExport(entry) {
        const signature = `${entry.taskId}\u0000${entry.messageId ?? entry.message}`;
        const current = { signature, timestamp: Date.now() };

        try {
            const storage = window.top.sessionStorage;
            const previous = JSON.parse(storage.getItem(LAST_EXPORT_STORAGE_KEY));
            if (previous?.signature === signature
                && current.timestamp - previous.timestamp < DEDUPLICATION_INTERVAL_MS) {
                return false;
            }
            storage.setItem(LAST_EXPORT_STORAGE_KEY, JSON.stringify(current));
        } catch {
            // If storage is unavailable, the installation marker still prevents same-frame duplicates.
        }

        return true;
    }

    function encodeQuery(parameters) {
        return Object.entries(parameters)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
    }

    function openObsidian(entry, taskDocument) {
        if (!claimExport(entry)) {
            return;
        }

        const settings = loadSettings();
        const date = new Date();
        const uri = `obsidian://new?${encodeQuery({
            file: dailyNotePath(date, settings),
            content: formatEntry(entry, date, settings, taskDocument),
            append: 'true',
        })}`;
        const link = document.createElement('a');
        link.href = uri;
        link.style.display = 'none';
        (document.body || document.documentElement).append(link);

        console.info('[Bitrix24 → Obsidian] Сообщение чата задачи передано в Obsidian.');
        link.click();
        link.remove();
        showSuccessNotification();
    }

    function requestAction(url, method) {
        if (String(method).toUpperCase() !== 'POST') {
            return null;
        }

        try {
            const endpoint = new URL(url, window.location.href);
            if (endpoint.origin !== window.location.origin) {
                return null;
            }
            if (endpoint.pathname === '/rest/im.disk.file.commit.json') {
                return IMAGE_COMMIT_ACTION;
            }
            return endpoint.pathname === '/bitrix/services/main/ajax.php'
                ? endpoint.searchParams.get('action')?.toLowerCase() ?? null
                : null;
        } catch {
            return null;
        }
    }

    function requestBody(body) {
        if (typeof body === 'string') {
            return body;
        }
        if (body instanceof URLSearchParams) {
            return body.toString();
        }
        return null;
    }

    function fetchChatRequest(input, init) {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : String(input);
        const method = init?.method ?? request?.method ?? 'GET';
        const action = requestAction(url, method);
        if (action !== TASK_GET_ACTION && action !== CHAT_SEND_ACTION && action !== IMAGE_COMMIT_ACTION) {
            return null;
        }

        let body = init?.body;
        if (body == null && request && action !== TASK_GET_ACTION) {
            try {
                body = request.clone().text();
            } catch {
                return null;
            }
        }

        return { action, body };
    }

    function processChatResponse(request, payload, targetWindow, taskChats) {
        if (request.action === IMAGE_COMMIT_ACTION) {
            const body = requestBody(request.body);
            const params = body === null ? null : new URLSearchParams(body);
            const taskId = taskChats.get(params?.get('chat_id'));
            const messageId = payload?.result?.MESSAGE_ID;
            if (!taskId || !Number.isSafeInteger(Number(messageId)) || Number(messageId) <= 0
                || !targetWindow.document.querySelector(
                    `.tasks-full-card[data-task-id="${taskId}"] .tasks-full-card-chat`,
                )) {
                return;
            }
            const files = Object.values(payload.result.FILES ?? {}).filter(
                file => file && (file.type === 'image' || file.image || file.isImage),
            );
            if (files.length) {
                pendingImages.set(String(messageId), {
                    taskId, messageId, message: params.get('message')?.trim() ?? '',
                    files, taskDocument: targetWindow.document,
                });
                exportPendingImages();
            }
            return;
        }
        if (payload?.status !== 'success'
            || payload.error
            || (Array.isArray(payload.errors) && payload.errors.length > 0)) {
            return;
        }

        if (request.action === TASK_GET_ACTION) {
            const { id, chatId } = payload.data ?? {};
            if (Number.isSafeInteger(Number(id)) && Number(id) > 0
                && Number.isSafeInteger(Number(chatId)) && Number(chatId) > 0) {
                taskChats.set(String(chatId), String(id));
            }
            return;
        }

        if (!Number.isSafeInteger(Number(payload.data?.id)) || Number(payload.data.id) <= 0) {
            return;
        }

        const body = requestBody(request.body);
        if (body === null) {
            return;
        }
        const params = new URLSearchParams(body);
        const chatId = params.get('dialogId')?.match(/^chat(\d+)$/)?.[1];
        const taskId = taskChats.get(chatId);
        if (!taskId
            || !targetWindow.document.querySelector(
                `.tasks-full-card[data-task-id="${taskId}"] .tasks-full-card-chat`,
            )) {
            return;
        }

        const message = params.get('fields[message]')?.trim();
        if (message) {
            openObsidian({ taskId, message, messageId: payload.data.id }, targetWindow.document);
        }
    }

    async function handleFetchChat(request, response, targetWindow, taskChats) {
        if (!request || !response.ok) {
            return;
        }

        let payload;
        try {
            payload = await response.clone().json();
            if (typeof request.body?.then === 'function') {
                request.body = await request.body;
            }
        } catch {
            return;
        }
        processChatResponse(request, payload, targetWindow, taskChats);
    }
    function attachmentDatabase() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(ATTACHMENT_DB, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('settings');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function attachmentFolder() {
        const db = await attachmentDatabase();
        try {
            return await new Promise((resolve, reject) => {
                const request = db.transaction('settings').objectStore('settings').get('folder');
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } finally {
            db.close();
        }
    }

    async function saveAttachmentFolder(folder) {
        const db = await attachmentDatabase();
        try {
            await new Promise((resolve, reject) => {
                const transaction = db.transaction('settings', 'readwrite');
                transaction.objectStore('settings').put(folder, 'folder');
                transaction.oncomplete = resolve;
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        } finally {
            db.close();
        }
    }

    function showAttachmentPrompt(reason) {
        let panel = document.getElementById('bitrix24-obsidian-attachments');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'bitrix24-obsidian-attachments';
            panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;padding:16px;max-width:360px;background:#18181b;color:#fafafa;border:1px solid #fca5a5;border-radius:8px;font:14px/1.4 sans-serif;';
            const message = document.createElement('div');
            message.className = 'attachment-message';
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Выбрать папку вложений Obsidian';
            button.addEventListener('click', () => chooseAttachmentFolder(message));
            panel.append(message, button);
            (document.body || document.documentElement).append(panel);
        }
        panel.querySelector('.attachment-message').textContent = reason;
    }

    async function chooseAttachmentFolder(status) {
        if (typeof window.showDirectoryPicker !== 'function') {
            status.textContent = 'Для вложений нужен Chrome или Edge с доступом к папкам (HTTPS).';
            return;
        }
        try {
            // The picker must be called synchronously from the user's click.
            const folder = await window.showDirectoryPicker({ mode: 'readwrite' });
            await saveAttachmentFolder(folder);
            status.textContent = `Папка вложений: ${folder.name}`;
            await exportPendingImages();
        } catch (error) {
            if (error.name !== 'AbortError') {
                status.textContent = `Не удалось выбрать папку вложений: ${error.message}`;
            }
        }
    }

    function imageFileName(entry, file) {
        const extension = String(file.extension || file.name?.split('.').pop() || '').toLowerCase();
        if (!IMAGE_EXTENSIONS.has(extension) || !Number.isSafeInteger(Number(file.id))
            || Number(file.id) <= 0) {
            throw new Error('Неподдерживаемый формат или ID изображения.');
        }
        return `bitrix-task-${entry.taskId}-message-${entry.messageId}-file-${file.id}.${extension}`;
    }

    async function exportPendingImages() {
        if (exportingImages) {
            retryImages = true;
            return;
        }
        exportingImages = true;
        try {
            for (const [key, entry] of pendingImages) {
                try {
                    const folder = await attachmentFolder();
                    if (!folder || await folder.queryPermission({ mode: 'readwrite' }) !== 'granted') {
                        showAttachmentPrompt('Сообщение с изображением ожидает доступа к папке вложений внутри vault Obsidian.');
                        break;
                    }
                    const names = [];
                    for (const file of entry.files) {
                        const name = imageFileName(entry, file);
                        const url = new URL(file.urlDownload, window.location.href);
                        if (url.origin !== window.location.origin) {
                            throw new Error('Ссылка на изображение ведёт за пределы портала.');
                        }
                        const response = await window.fetch(url.href, { credentials: 'include' });
                        if (!response.ok || new URL(response.url).origin !== window.location.origin
                            || !response.headers.get('content-type')?.toLowerCase().startsWith('image/')) {
                            throw new Error(`Bitrix не отдал изображение ${file.name || file.id}.`);
                        }
                        const handle = await folder.getFileHandle(name, { create: true });
                        const writable = await handle.createWritable();
                        try {
                            await writable.write(await response.blob());
                            await writable.close();
                        } catch (error) {
                            await writable.abort();
                            throw error;
                        }
                        names.push(name);
                    }
                    const embeds = names.map(name => `![[${name}]]`).join('\n  ');
                    openObsidian({
                        taskId: entry.taskId, messageId: entry.messageId,
                        message: `${entry.message}${entry.message ? '\n  ' : ''}${embeds}`,
                    }, entry.taskDocument);
                    pendingImages.delete(key);
                    document.getElementById('bitrix24-obsidian-attachments')?.remove();
                } catch (error) {
                    showAttachmentPrompt(`Изображение не перенесено: ${error.message}. Выберите папку для повтора.`);
                    break;
                }
            }
        } finally {
            exportingImages = false;
            if (retryImages) {
                retryImages = false;
                exportPendingImages();
            }
        }
    }

    function configureSettings() {
        const settings = loadSettings();
        const overlay = document.createElement('div');
        const panel = document.createElement('form');
        const fields = [
            ['Каталог daily notes', 'dailyNoteDirectory', 'text'],
            ['Тег задачи', 'taskTagName', 'text'],
            ['Тег компании', 'companyTagName', 'text'],
        ];
        const inputs = {};

        Object.assign(overlay.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483647',
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0, 0, 0, 0.55)',
            font: '14px/1.4 sans-serif',
        });
        Object.assign(panel.style, {
            width: 'min(420px, calc(100vw - 32px))',
            boxSizing: 'border-box',
            padding: '20px',
            borderRadius: '8px',
            background: '#18181b',
            color: '#fafafa',
        });

        const title = document.createElement('h2');
        title.textContent = 'Экспорт сообщений чата задач в Obsidian';
        title.style.marginTop = '0';
        panel.append(title);

        for (const [labelText, name, type] of fields) {
            const label = document.createElement('label');
            label.textContent = labelText;
            label.style.display = 'block';
            label.style.marginTop = '12px';
            const input = document.createElement('input');
            input.type = type;
            input.value = settings[name];
            input.style.cssText = 'box-sizing:border-box;display:block;margin-top:4px;padding:8px;width:100%;';
            label.append(input);
            panel.append(label);
            inputs[name] = input;
        }

        for (const [labelText, name] of [['Добавлять тег задачи', 'includeTaskTag'], ['Добавлять тег компании', 'includeCompanyTag']]) {
            const label = document.createElement('label');
            label.style.cssText = 'display:block;margin-top:12px;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = settings[name];
            label.append(input, ` ${labelText}`);
            panel.append(label);
            inputs[name] = input;
        }
        const preview = document.createElement('div');
        preview.style.cssText = 'margin-top:16px;padding:8px;background:#27272a;border-radius:4px;word-break:break-word;';
        const updatePreview = () => {
            const tags = [
                inputs.includeTaskTag.checked ? `#${inputs.taskTagName.value || 'task'}/123` : null,
                inputs.includeCompanyTag.checked ? `#${inputs.companyTagName.value || 'company'}/Acme` : null,
            ].filter(Boolean);
            preview.textContent = `Пример: 12:34 ${tags.length ? `${tags.join(' ')} ` : ''}Сообщение`;
        };
        for (const input of Object.values(inputs)) {
            input.addEventListener('input', updatePreview);
            input.addEventListener('change', updatePreview);
        }
        updatePreview();
        panel.append(preview);


        const folderLabel = document.createElement('div');
        folderLabel.style.marginTop = '12px';
        folderLabel.textContent = 'Вложения: папка не выбрана';
        const chooseFolder = document.createElement('button');
        chooseFolder.type = 'button';
        chooseFolder.textContent = 'Выбрать папку вложений Obsidian';
        chooseFolder.addEventListener('click', () => chooseAttachmentFolder(folderLabel));
        panel.append(folderLabel, chooseFolder);
        attachmentFolder().then(folder => {
            if (folder) {
                folderLabel.textContent = `Вложения: ${folder.name}`;
            }
        }).catch(error => { folderLabel.textContent = `Хранилище папки недоступно: ${error.message}`; });
        const error = document.createElement('div');
        error.style.cssText = 'color:#fca5a5;margin-top:12px;min-height:20px;';
        panel.append(error);

        const save = document.createElement('button');
        save.type = 'submit';
        save.textContent = 'Сохранить';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Сбросить';
        reset.style.marginLeft = '8px';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Отмена';
        cancel.style.marginLeft = '8px';
        panel.append(save, reset, cancel);

        cancel.addEventListener('click', () => overlay.remove());
        reset.addEventListener('click', () => {
            saveSettings(DEFAULT_SETTINGS);
            overlay.remove();
        });
        panel.addEventListener('submit', (event) => {
            event.preventDefault();
            const dailyNoteDirectory = inputs.dailyNoteDirectory.value.trim().replace(/^\/+|\/+$/g, '');
            if (!dailyNoteDirectory) {
                error.textContent = 'Укажите каталог daily notes.';
                return;
            }
            if (!isTagName(inputs.taskTagName.value) || !isTagName(inputs.companyTagName.value)) {
                error.textContent = 'Имя тега: буквы, цифры, _, -, и /; без #.';
                return;
            }

            saveSettings({
                dailyNoteDirectory,
                includeTaskTag: inputs.includeTaskTag.checked,
                taskTagName: inputs.taskTagName.value,
                includeCompanyTag: inputs.includeCompanyTag.checked,
                companyTagName: inputs.companyTagName.value,
            });
            overlay.remove();
        });

        overlay.append(panel);
        (document.body || document.documentElement).append(overlay);
    }

    function installInterceptors(targetWindow) {
        const targetXhr = targetWindow.XMLHttpRequest;
        if (targetWindow[FRAME_INTERCEPTORS_MARKER]
            || !targetXhr?.prototype) {
            return;
        }

        const nativeFetch = targetWindow.fetch;
        const nativeXhrOpen = targetXhr.prototype.open;
        const nativeXhrSend = targetXhr.prototype.send;
        const xhrRequests = new WeakMap();
        const taskChats = new Map();
        targetWindow[FRAME_INTERCEPTORS_MARKER] = true;

        if (typeof nativeFetch === 'function') {
            targetWindow.fetch = async function interceptedFetch(input, init) {
                const request = fetchChatRequest(input, init);
                const response = await nativeFetch.call(this, input, init);
                await handleFetchChat(request, response, targetWindow, taskChats);
                return response;
            };
        }

        targetXhr.prototype.open = function interceptedOpen(method, url, ...rest) {
            const action = requestAction(url, method);
            if (action === TASK_GET_ACTION || action === CHAT_SEND_ACTION || action === IMAGE_COMMIT_ACTION) {
                xhrRequests.set(this, { action, body: null });
            }
            return nativeXhrOpen.call(this, method, url, ...rest);
        };

        targetXhr.prototype.send = function interceptedSend(body) {
            const request = xhrRequests.get(this);
            if (request) {
                request.body = body;
                this.addEventListener('loadend', () => {
                    if (this.status < 200 || this.status >= 300) {
                        return;
                    }

                    let payload;
                    try {
                        payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                    } catch {
                        return;
                    }
                    processChatResponse(request, payload, targetWindow, taskChats);
                }, { once: true });
            }

            return nativeXhrSend.call(this, body);
        };
    }

    function isTaskFrame(frame) {
        try {
            const url = new URL(frame.src, window.location.href);
            return url.pathname.includes('/tasks/task/view/')
                && url.searchParams.get('IFRAME_TYPE') === 'SIDE_SLIDER';
        } catch {
            return false;
        }
    }

    function installTaskFrame(frame) {
        if (!isTaskFrame(frame)) {
            return;
        }

        try {
            installInterceptors(frame.contentWindow);
        } catch {
            // Frames outside the current origin cannot host task chats.
        }
    }

    function install() {
        GM_registerMenuCommand('Настроить экспорт в Obsidian', configureSettings);
        installInterceptors(window);
        document.querySelectorAll('iframe').forEach(installTaskFrame);
        document.addEventListener('load', event => {
            if (event.target?.tagName === 'IFRAME') {
                installTaskFrame(event.target);
            }
        }, true);
    }

    install();
})();
