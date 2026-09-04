// ==UserScript==
// @name         Bitrix24 task comments to Obsidian Daily Notes
// @namespace    bitrix24-obsidian-exporter
// @version      1.4.0
// @description  Appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.
// @homepageURL  https://github.com/culnaen/bitrix24-obsidian-exporter
// @source       https://github.com/culnaen/bitrix24-obsidian-exporter.git
// @supportURL   https://github.com/culnaen/bitrix24-obsidian-exporter/issues
// @downloadURL  https://raw.githubusercontent.com/culnaen/bitrix24-obsidian-exporter/main/bitrix24-obsidian-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/culnaen/bitrix24-obsidian-exporter/main/bitrix24-obsidian-exporter.user.js
// @match        https://*.bitrix24.*/*
// @run-at       document-start
// @sandbox      raw
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
    'use strict';
    const INSTALLATION_MARKER = 'data-bitrix24-obsidian-exporter-installed';
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
    const FORUM_COMMENTS_CONTROLLER = 'bitrix:forum.comments';
    const FORUM_COMMENTS_ACTION = 'processcomment';
    const nativeFetch = window.fetch;
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    const nativeXhrSend = XMLHttpRequest.prototype.send;
    const xhrRequests = new WeakMap();

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

    function companyNameFromPage() {
        const documents = [document];
        for (const frame of document.querySelectorAll('iframe')) {
            try {
                if (frame.contentDocument) {
                    documents.push(frame.contentDocument);
                }
            } catch {
                // Ignore cross-origin frames.
            }
        }

        for (const candidate of documents) {
            const company = candidate.querySelector('.field_crm a[href*="/crm/company/details/"]');
            if (company?.textContent.trim()) {
                return company.textContent.trim();
            }
        }

        return null;
    }

    function companyTag(settings) {
        if (!settings.includeCompanyTag) {
            return null;
        }

        const companyName = companyNameFromPage();
        if (!companyName) {
            return null;
        }

        const slug = companyName
            .replace(/["'«»„“”]/g, '')
            .replace(/[^\p{L}\p{N}_-]+/gu, '_')
            .replace(/^_+|_+$/g, '');

        return slug ? `#${settings.companyTagName}/${slug}` : null;
    }

    function formatEntry(entry, date, settings) {
        const value = entry.comment.replace(/\r\n?/g, '\n').trim();
        const tags = [
            settings.includeTaskTag && entry.taskId ? `#${settings.taskTagName}/${entry.taskId}` : null,
            companyTag(settings),
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
        message.textContent = 'Комментарий успешно передан в Obsidian';

        panel.append(message);
        (targetDocument.body || targetDocument.documentElement).append(panel);
        window.setTimeout(() => panel.remove(), 5000);
    }

    function claimExport(entry) {
        const signature = `${entry.taskId ?? ''}\u0000${entry.comment}`;
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

    function openObsidian(entry) {
        if (!claimExport(entry)) {
            return;
        }

        const settings = loadSettings();
        const date = new Date();
        const uri = `obsidian://new?${encodeQuery({
            file: dailyNotePath(date, settings),
            content: formatEntry(entry, date, settings),
            append: 'true',
        })}`;
        const link = document.createElement('a');
        link.href = uri;
        link.style.display = 'none';
        (document.body || document.documentElement).append(link);

        console.info('[Bitrix24 → Obsidian] Комментарий успешно передан в Obsidian.');
        link.click();
        link.remove();
        showSuccessNotification();
    }

    function isForumCommentRequest(url, method) {
        if (String(method || 'GET').toUpperCase() !== 'POST') {
            return false;
        }

        try {
            const endpoint = new URL(url, window.location.href);
            return endpoint.pathname === '/bitrix/services/main/ajax.php'
                && endpoint.searchParams.get('c')?.toLowerCase() === FORUM_COMMENTS_CONTROLLER
                && endpoint.searchParams.get('action')?.toLowerCase() === FORUM_COMMENTS_ACTION;
        } catch {
            return false;
        }
    }

    function taskComment(url, method, body) {
        if (!isForumCommentRequest(url, method) || typeof body !== 'string') {
            return null;
        }

        const payload = new URLSearchParams(body);
        const entityXmlId = payload.get('ENTITY_XML_ID');
        const taskId = entityXmlId?.match(/^TASK_(\d+)$/i)?.[1] ?? null;
        const action = payload.get('action') ?? payload.get('ACTION');
        if (action?.toUpperCase() !== 'ADD'
            || payload.get('ENTITY_TYPE')?.toUpperCase() !== 'TK'
            || !taskId) {
            return null;
        }

        const comment = (payload.get('POST_MESSAGE') || payload.get('REVIEW_TEXT'))?.trim();
        if (!comment) {
            console.warn('[Bitrix24 → Obsidian] Текст комментария не распознан.');
            return null;
        }

        return { comment, taskId };
    }

    function apiResponseSucceeded(payload) {
        if (!payload || typeof payload !== 'object') {
            return true;
        }

        return String(payload.status ?? '').toLowerCase() !== 'error'
            && !payload.error
            && !(Array.isArray(payload.errors) && payload.errors.length > 0);
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

    function fetchCommentRequest(input, init) {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : String(input);
        const method = init?.method ?? request?.method ?? 'GET';
        if (!isForumCommentRequest(url, method)) {
            return null;
        }

        let body = init?.body;
        if (body == null && request) {
            try {
                body = request.clone().text();
            } catch {
                return null;
            }
        }

        return { url, method, body };
    }

    async function handleFetchComment(request, response) {
        if (!request || !response.ok) {
            return;
        }

        let body;
        try {
            body = await request.body;
        } catch {
            return;
        }

        const entry = taskComment(request.url, request.method, requestBody(body));
        if (!entry) {
            return;
        }

        let payload = null;
        try {
            payload = await response.clone().json();
        } catch {
            // A successful non-JSON response is accepted.
        }

        if (apiResponseSucceeded(payload)) {
            openObsidian(entry);
        } else {
            console.warn('[Bitrix24 → Obsidian] Bitrix24 отклонил комментарий.');
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
        title.textContent = 'Экспорт комментариев в Obsidian';
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
            preview.textContent = `Пример: 12:34 ${tags.length ? `${tags.join(' ')} ` : ''}Комментарий`;
        };
        for (const input of Object.values(inputs)) {
            input.addEventListener('input', updatePreview);
            input.addEventListener('change', updatePreview);
        }
        updatePreview();
        panel.append(preview);


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

    function install() {
        GM_registerMenuCommand('Настроить экспорт в Obsidian', configureSettings);

        if (typeof nativeFetch === 'function') {
            window.fetch = async function interceptedFetch(input, init) {
                const request = fetchCommentRequest(input, init);
                const response = await nativeFetch.call(this, input, init);
                await handleFetchComment(request, response);
                return response;
            };
        }

        XMLHttpRequest.prototype.open = function interceptedOpen(method, url, ...rest) {
            if (isForumCommentRequest(url, method)) {
                xhrRequests.set(this, { method, url: String(url), body: null });
            }
            return nativeXhrOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function interceptedSend(body) {
            const request = xhrRequests.get(this);
            if (request) {
                request.body = body;
                this.addEventListener('loadend', () => {
                    if (this.status < 200 || this.status >= 300) {
                        return;
                    }

                    const entry = taskComment(request.url, request.method, request.body);
                    if (!entry) {
                        return;
                    }

                    let payload = null;
                    try {
                        payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText);
                    } catch {
                        // A successful non-JSON response is accepted.
                    }

                    if (apiResponseSucceeded(payload)) {
                        openObsidian(entry);
                    } else {
                        console.warn('[Bitrix24 → Obsidian] Bitrix24 отклонил комментарий.');
                    }
                }, { once: true });
            }

            return nativeXhrSend.call(this, body);
        };
    }

    let installed = false;
    let initializationQueued = false;
    const observer = new MutationObserver(queueInitialization);

    function queueInitialization() {
        if (installed || initializationQueued) {
            return;
        }

        initializationQueued = true;
        window.requestAnimationFrame(() => {
            initializationQueued = false;
            if (installed) {
                return;
            }

            installed = true;
            observer.disconnect();
            install();
        });
    }

    observer.observe(document.documentElement, { childList: true, subtree: true });
    queueInitialization();
})();
