// ==UserScript==
// @name         Bitrix24 task comments to Obsidian Daily Notes
// @namespace    bitrix24-obsidian-exporter
// @version      1.3.0
// @description  Appends successfully submitted Bitrix24 task comments to the current Obsidian daily note.
// @match        https://*.bitrix24.*/*
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
    const FORUM_COMMENTS_CONTROLLER = 'bitrix:forum.comments';
    const FORUM_COMMENTS_ACTION = 'processcomment';
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
            entry.taskId ? `#task/${entry.taskId}` : null,
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
})();
