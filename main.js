// ==UserScript==
// @name         Bitrix24 task comments to Obsidian Daily Notes
// @namespace    bitrix24-obsidian-exporter
// @version      1.2.1
// @description  Appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.
// @match        https://*/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

(() => {
    'use strict';
    const INSTALLATION_MARKER = '__bitrix24ObsidianInstalled';
    if (window[INSTALLATION_MARKER]) {
        return;
    }
    Object.defineProperty(window, INSTALLATION_MARKER, { value: true });

    const DAILY_NOTE_DIRECTORY = '03-Daily';
    const DEDUPLICATION_INTERVAL_MS = 5000;
    const LAST_EXPORT_STORAGE_KEY = 'bitrix24-obsidian:last-export';
    const TASK_COMMENT_ACTIONS = new Set([
        'tasks.task.comment.add',
        'task.comment.add',
        'task.commentitem.add',
        'tasks.task.chat.message.send',
        'bitrix:forum.comments.processcomment',
    ]);

    const nativeFetch = window.fetch?.bind(window);
    const nativeXhrOpen = XMLHttpRequest.prototype.open;
    const nativeXhrSend = XMLHttpRequest.prototype.send;
    const xhrRequests = new WeakMap();

    function pad(number) {
        return String(number).padStart(2, '0');
    }

    function dailyNotePath(date) {
        return `${DAILY_NOTE_DIRECTORY}/${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.md`;
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

    function companyTag() {
        const companyName = companyNameFromPage();
        if (!companyName) {
            return null;
        }

        const slug = companyName
            .replace(/["'«»„“”]/g, '')
            .replace(/[^\p{L}\p{N}_-]+/gu, '_')
            .replace(/^_+|_+$/g, '');

        return slug ? `#company/${slug}` : null;
    }

    function formatEntry(entry, date) {
        const value = entry.comment.replace(/\r\n?/g, '\n').trim();
        const tags = [
            entry.taskId ? `#lasnet/${entry.taskId}` : null,
            companyTag(),
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

        const date = new Date();
        const uri = `obsidian://new?${encodeQuery({
            file: dailyNotePath(date),
            content: formatEntry(entry, date),
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

    function parseStringBody(body) {
        const trimmed = body.trim();
        if (!trimmed) {
            return null;
        }

        try {
            return JSON.parse(trimmed);
        } catch {
            return new URLSearchParams(trimmed);
        }
    }

    function isEntryListBody(value) {
        const tag = Object.prototype.toString.call(value);
        return tag === '[object URLSearchParams]' || tag === '[object FormData]';
    }

    async function parseBody(body) {
        if (body == null) {
            return null;
        }
        if (typeof body === 'string') {
            return parseStringBody(body);
        }
        if (isEntryListBody(body)) {
            return body;
        }
        if (body instanceof Blob) {
            return parseStringBody(await body.text());
        }
        if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
            const bytes = body instanceof ArrayBuffer
                ? new Uint8Array(body)
                : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
            return parseStringBody(new TextDecoder().decode(bytes));
        }
        if (typeof body === 'object') {
            return body;
        }
        return null;
    }

    function entriesOf(value) {
        if (isEntryListBody(value)) {
            return Array.from(value.entries());
        }
        return value && typeof value === 'object' ? Object.entries(value) : [];
    }

    function findValue(payload, keyPattern) {
        const queue = [payload];
        const visited = new Set();

        while (queue.length > 0) {
            const current = queue.shift();
            if (!current || typeof current !== 'object' || visited.has(current)) {
                continue;
            }
            visited.add(current);

            for (const [key, value] of entriesOf(current)) {
                if (keyPattern.test(key) && typeof value === 'string' && value.trim()) {
                    return value;
                }
                if (value && typeof value === 'object') {
                    queue.push(value);
                } else if (typeof value === 'string' && /^[\s]*[\[{]/.test(value)) {
                    const nested = parseStringBody(value);
                    if (nested && typeof nested === 'object') {
                        queue.push(nested);
                    }
                }
            }
        }

        return null;
    }

    function actionFrom(url, payload) {
        let parsedUrl;
        try {
            parsedUrl = new URL(url, window.location.href);
        } catch {
            return null;
        }

        const queryAction = parsedUrl.searchParams.get('action');
        const controller = parsedUrl.searchParams.get('c');
        if (controller?.toLowerCase() === 'bitrix:forum.comments'
            && queryAction?.toLowerCase() === 'processcomment') {
            return 'bitrix:forum.comments.processcomment';
        }
        if (queryAction) {
            return queryAction.toLowerCase().replace(/\.json$/i, '');
        }

        const bodyAction = findValue(payload, /(?:^|\[)action\]?$/i);
        if (bodyAction) {
            return bodyAction.toLowerCase().replace(/\.json$/i, '');
        }

        const pathMatch = parsedUrl.pathname.match(/(?:^|\/)(tasks\.task\.comment\.add|task\.commentitem\.add|task\.comment\.add|tasks\.task\.chat\.message\.send)(?:\.json)?(?:$|\/)/i);
        return pathMatch?.[1].toLowerCase() ?? null;
    }

    function commentFrom(payload) {
        return findValue(payload, /(?:^|\[)(?:post_message|review_text|commenttext|comment_text|message|text)\]?$/i);
    }

    function taskIdFrom(payload) {
        const directId = findValue(payload, /(?:^|\[)(?:entity_id|task_?id)\]?$/i);
        if (/^\d+$/.test(directId ?? '')) {
            return directId;
        }

        const entityXmlId = findValue(payload, /(?:^|\[)entity_xml_id\]?$/i);
        return entityXmlId?.match(/^TASK_(\d+)$/i)?.[1] ?? null;
    }

    function isTaskCommentPayload(payload, action) {
        if (action !== 'bitrix:forum.comments.processcomment') {
            return true;
        }

        const operation = findValue(payload, /(?:^|\[)action\]?$/i);
        const entityType = findValue(payload, /(?:^|\[)entity_type\]?$/i);
        const entityXmlId = findValue(payload, /(?:^|\[)entity_xml_id\]?$/i);

        return operation?.toUpperCase() === 'ADD'
            && (entityType?.toUpperCase() === 'TK' || /^TASK_\d+$/i.test(entityXmlId ?? ''));
    }

    async function taskComment(url, method, body) {
        if (String(method || 'GET').toUpperCase() !== 'POST') {
            return null;
        }

        const payload = await parseBody(body);
        const action = actionFrom(url, payload);
        if (!TASK_COMMENT_ACTIONS.has(action) || !isTaskCommentPayload(payload, action)) {
            return null;
        }

        const comment = commentFrom(payload);
        if (!comment) {
            console.warn(`[Bitrix24 → Obsidian] Запрос ${action} найден, но текст комментария не распознан.`);
            return null;
        }

        const taskId = taskIdFrom(payload);
        if (!taskId) {
            console.warn(`[Bitrix24 → Obsidian] Запрос ${action} найден, но номер задачи не распознан.`);
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

    async function fetchResponseSucceeded(response) {
        if (!response.ok) {
            return false;
        }

        try {
            return apiResponseSucceeded(await response.clone().json());
        } catch {
            return true;
        }
    }

    async function fetchBody(input, init) {
        if (init?.body != null) {
            return init.body;
        }
        if (typeof Request !== 'undefined' && input instanceof Request) {
            try {
                return await input.clone().text();
            } catch {
                return null;
            }
        }
        return null;
    }

    if (nativeFetch) {
        window.fetch = function interceptedFetch(input, init) {
            const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
            const method = init?.method ?? input?.method ?? 'GET';
            const entryPromise = fetchBody(input, init).then((body) => taskComment(url, method, body));
            const responsePromise = nativeFetch(input, init);

            void Promise.all([entryPromise, responsePromise])
                .then(async ([entry, response]) => {
                    if (entry && await fetchResponseSucceeded(response)) {
                        openObsidian(entry);
                    }
                })
                .catch((error) => {
                    console.warn('[Bitrix24 → Obsidian] Не удалось обработать fetch-запрос.', error);
                });

            return responsePromise;
        };
    }

    XMLHttpRequest.prototype.open = function interceptedOpen(method, url, ...rest) {
        xhrRequests.set(this, { method, url: String(url), body: null });
        return nativeXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function interceptedSend(body) {
        const request = xhrRequests.get(this);
        if (request) {
            request.body = body;
            this.addEventListener('loadend', async () => {
                if (this.status < 200 || this.status >= 300) {
                    return;
                }

                const entry = await taskComment(request.url, request.method, request.body);
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
})();
