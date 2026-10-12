const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync('bitrix24-obsidian-exporter.user.js', 'utf8');
const taskEndpoint = 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?action=tasks.v2.Task.get';
const sendEndpoint = 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send';
const messageBody = 'dialogId=chat11784&fields%5Bmessage%5D=exported+message';
const imageEndpoint = 'https://acme.bitrix24.ru/rest/im.disk.file.commit.json';
const imageBody = 'chat_id=11784&message=&upload_id%5B0%5D=123';

function imageCommit(messageId, files) {
    return {
        result: {
            MESSAGE_ID: messageId,
            FILES: Object.fromEntries(files.map(file => [`upload${file.id}`, {
                id: file.id, name: `${file.id}.png`, extension: 'png', type: 'image',
                urlDownload: `/download/${file.id}.png`,
            }])),
        },
    };
}


function createEnvironment({ payload = { status: 'success', data: { id: 1376900 } }, settings, isTopFrame = true, hasTaskFrame = false, crmItems = [], frameCrmItems = crmItems, folder = null, downloadResponse } = {}) {
    const openedUris = [];
    const storage = new Map();
    const scriptStorage = new Map();
    const eventListeners = new WeakMap();
    const elements = new Map();
    const databaseValues = new Map(folder ? [['folder', folder]] : []);
    const indexedDB = {
        open() {
            const request = { result: {
                createObjectStore() {},
                close() {},
                transaction() {
                    const transaction = {
                        objectStore() {
                            return {
                                get(key) {
                                    const get = { result: databaseValues.get(key) };
                                    queueMicrotask(() => get.onsuccess());
                                    return get;
                                },
                                put(value, key) {
                                    databaseValues.set(key, value);
                                    queueMicrotask(() => transaction.oncomplete());
                                },
                            };
                        },
                    };
                    return transaction;
                },
            } };
            queueMicrotask(() => request.onsuccess());
            return request;
        },
    };

    if (settings) {
        scriptStorage.set('bitrix24-obsidian:settings', settings);
    }
    const taskCard = items => ({
        querySelectorAll(selector) {
            if (selector !== '.tasks-field-crm-item-text > span') {
                return [];
            }
            return items.map(([type, name]) => ({
                firstChild: { textContent: `${type} ` },
                querySelector(query) {
                    return query === 'a' ? { textContent: name } : null;
                },
            }));
        },
    });

    class MockXMLHttpRequest {
        constructor() {
            this.status = 200;
            this.responseType = '';
            this.responseText = '';
            this.response = null;
        }

        open(method, url) {
            this.method = method;
            this.url = url;
        }

        send(body) {
            this.body = body;
            const result = this.url?.includes('tasks.v2.Task.get')
                ? { status: 'success', data: { id: 42, chatId: 11784 } }
                : payload;
            this.responseText = JSON.stringify(result);
            this.response = result;
            for (const listener of eventListeners.get(this) ?? []) {
                listener.callback.call(this);
            }
        }

        addEventListener(type, callback, options) {
            if (type !== 'loadend') {
                return;
            }
            const listeners = eventListeners.get(this) ?? [];
            listeners.push({ callback, once: options?.once });
            eventListeners.set(this, listeners);
        }
    }

    class MockTaskFrameXMLHttpRequest extends MockXMLHttpRequest {
        open(method, url) {
            return super.open(method, url);
        }

        send(body) {
            return super.send(body);
        }
    }

    let taskFrame = null;
    let taskFrameWindow = null;

    const attributes = new Set();
    const documentElement = {
        append() {},
        hasAttribute(name) {
            return attributes.has(name);
        },
        setAttribute(name) {
            attributes.add(name);
        },
    };
    const document = {
        body: { append(node) { if (node.id) elements.set(node.id, node); } },
        documentElement,
        createElement() {
            return {
                style: {},
                children: [],
                append(...children) { this.children.push(...children); },
                querySelector(selector) {
                    return this.children.find(child => child.className === selector.slice(1));
                },
                addEventListener(type, callback) { this[`on${type}`] = callback; },
                remove() { elements.delete(this.id); },
                click() {
                    if (this.href) openedUris.push(this.href);
                    else this.onclick?.();
                },
            };
        },
        getElementById(id) {
            return elements.get(id) ?? null;
        },
        querySelector(selector) {
            if (selector === '.tasks-full-card[data-task-id="42"] .tasks-full-card-chat') {
                return {};
            }
            return selector === '.tasks-full-card[data-task-id="42"]' ? taskCard(crmItems) : null;
        },
        querySelectorAll(selector) {
            return selector === 'iframe' && taskFrame ? [taskFrame] : [];
        },
        addEventListener() {},
    };
    const window = {
        document,
        location: { href: 'https://acme.bitrix24.ru/tasks/task/view/42/', origin: 'https://acme.bitrix24.ru' },
        sessionStorage: {
            getItem(key) {
                return storage.get(key) ?? null;
            },
            setItem(key, value) {
                storage.set(key, value);
            },
        },
        setTimeout() {},
        XMLHttpRequest: MockXMLHttpRequest,
        async fetch(url) {
            if (String(url).includes('/download/')) {
                return downloadResponse?.(String(url)) ?? {
                    ok: true, url: String(url), headers: new Headers({ 'content-type': 'image/png' }),
                    async blob() { return new Blob(['image bytes'], { type: 'image/png' }); },
                };
            }
            const result = String(url).includes('tasks.v2.Task.get')
                ? { status: 'success', data: { id: 42, chatId: 11784 } }
                : payload;
            return new Response(JSON.stringify(result), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        },
    };
    window.top = isTopFrame ? window : { document };
    if (hasTaskFrame) {
        taskFrameWindow = {
            document: {
                ...document,
                querySelector(selector) {
                    return selector === '.tasks-full-card[data-task-id="42"]'
                        ? taskCard(frameCrmItems)
                        : document.querySelector(selector);
                },
            },
            XMLHttpRequest: MockTaskFrameXMLHttpRequest,
            fetch: window.fetch,
        };
        taskFrame = {
            tagName: 'IFRAME',
            src: 'https://acme.bitrix24.ru/company/personal/user/1/tasks/task/view/42/?IFRAME=Y&IFRAME_TYPE=SIDE_SLIDER',
            contentWindow: taskFrameWindow,
        };
    }


    const context = {
        Request,
        Response,
        URL,
        URLSearchParams,
        indexedDB,
        WeakMap,
        XMLHttpRequest: MockXMLHttpRequest,
        GM_getValue(key, defaultValue) {
            return scriptStorage.get(key) ?? defaultValue;
        },
        GM_setValue(key, value) {
            scriptStorage.set(key, value);
        },
        GM_registerMenuCommand() {},
        console: { info() {}, warn() {} },
        document,
        window,
    };
    vm.runInNewContext(script, context);

    return {
        MockXMLHttpRequest,
        taskFrameWindow,
        openedUris,
        elements,
        databaseValues,
        window,
    };
}

function assertExported(uri) {
    assert.ok(uri?.startsWith('obsidian://new?'), 'Obsidian URI should be opened');
    const query = new URL(uri).searchParams;
    assert.match(query.get('file'), /^03-Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    assert.match(query.get('content'), /#task\/42 exported message/);
}

function send(Xhr, url, body) {
    const xhr = new Xhr();
    xhr.open('POST', url);
    xhr.send(body);
    return xhr;
}

test('does not export from an independently injected nested frame', () => {
    const nested = createEnvironment({ isTopFrame: false });
    send(nested.MockXMLHttpRequest, taskEndpoint);
    send(nested.MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.equal(nested.openedUris.length, 0);
});

test('exports only confirmed messages from the task-linked chat', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment();
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.equal(openedUris.length, 0, 'no export before task/chat association arrives');

    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, 'dialogId=chat999&fields%5Bmessage%5D=other+chat');
    assert.equal(openedUris.length, 0, 'other chat must not be exported');
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    assertExported(openedUris[0]);
    assert.equal(openedUris.length, 1);
});

test('exports the company from the task side slider, not the parent page', () => {
    const { openedUris, taskFrameWindow } = createEnvironment({
        hasTaskFrame: true,
        crmItems: [['Компания', 'Чужая компания']],
        frameCrmItems: [['Компания', 'ООО "ЛАСНЕТ"']],
    });
    send(taskFrameWindow.XMLHttpRequest, taskEndpoint);
    send(taskFrameWindow.XMLHttpRequest, sendEndpoint, messageBody);
    const content = new URL(openedUris[0]).searchParams.get('content');
    assert.match(content, /#task\/42 #company\/ООО_ЛАСНЕТ exported message/);
    assert.doesNotMatch(content, /Чужая/);
});

test('adds linked companies beside a custom task tag, never the contact', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment({
        settings: { taskTagName: 'lasnet' },
        crmItems: [
            ['Контакт', 'Чубаров Владлен'],
            ['Компания', 'ООО "ЛАСНЕТ"'],
            ['Компания', 'Рога & Копыта'],
            ['Компания', 'ООО "ЛАСНЕТ"'],
        ],
    });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    const content = new URL(openedUris[0]).searchParams.get('content');
    assert.match(content, /#lasnet\/42 #company\/ООО_ЛАСНЕТ #company\/Рога_Копыта exported message/);
    assert.doesNotMatch(content, /Чубаров|#contact/);
    assert.equal(content.match(/#company\//g).length, 2);
});

test('omits company tags when disabled, including when a contact exists', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment({
        settings: { includeCompanyTag: false },
        crmItems: [['Компания', 'ООО "ЛАСНЕТ"'], ['Контакт', 'Чубаров Владлен']],
    });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    const content = new URL(openedUris[0]).searchParams.get('content');
    assert.match(content, /#task\/42 exported message/);
    assert.doesNotMatch(content, /#company|#contact|ЛАСНЕТ|Чубаров/);
});

test('exports fetch messages without consuming the response', async () => {
    const { openedUris, window } = createEnvironment();
    await window.fetch(taskEndpoint, { method: 'POST' });
    const response = await window.fetch(sendEndpoint, { method: 'POST', body: messageBody });
    assertExported(openedUris[0]);
    assert.deepEqual(await response.json(), { status: 'success', data: { id: 1376900 } });
});

test('uses saved export settings and custom task tags', () => {
    const { MockXMLHttpRequest, openedUris } = createEnvironment({
        settings: {
            dailyNoteDirectory: 'Journal/Daily',
            includeTaskTag: false,
            includeCompanyTag: false,
        },
    });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    const query = new URL(openedUris[0]).searchParams;
    assert.match(query.get('file'), /^Journal\/Daily\/\d{4}-\d{2}-\d{2}\.md$/);
    assert.doesNotMatch(query.get('content'), /#task\/42/);
    assert.match(query.get('content'), /exported message/);

    const custom = createEnvironment({ settings: { taskTagName: 'project/task' } });
    send(custom.MockXMLHttpRequest, taskEndpoint);
    send(custom.MockXMLHttpRequest, sendEndpoint, messageBody);
    assert.match(new URL(custom.openedUris[0]).searchParams.get('content'), /#project\/task\/42 exported message/);
});

test('does not export rejected, empty, unrelated, or legacy forum submissions', async () => {
    const { MockXMLHttpRequest, openedUris, window } = createEnvironment({ payload: { status: 'error' } });
    send(MockXMLHttpRequest, taskEndpoint);
    send(MockXMLHttpRequest, sendEndpoint, messageBody);
    await window.fetch(sendEndpoint, { method: 'POST', body: messageBody });
    assert.equal(openedUris.length, 0);

    const valid = createEnvironment();
    send(valid.MockXMLHttpRequest, taskEndpoint);
    send(valid.MockXMLHttpRequest, sendEndpoint, 'dialogId=chat11784&fields%5Bmessage%5D=+');
    send(valid.MockXMLHttpRequest, 'https://other.example/bitrix/services/main/ajax.php?action=im.v2.Chat.Message.send', messageBody);
    send(valid.MockXMLHttpRequest, 'https://acme.bitrix24.ru/bitrix/services/main/ajax.php?c=bitrix%3Aforum.comments&action=processComment', 'ENTITY_XML_ID=TASK_42&POST_MESSAGE=legacy');
    assert.equal(valid.openedUris.length, 0);
});

function writableFolder() {
    const files = new Map();
    const folder = {
        name: 'Attachments',
        permission: 'granted',
        async queryPermission() { return this.permission; },
        async getFileHandle(name) {
            return {
                async createWritable() {
                    return {
                        async write(blob) { files.set(name, blob); },
                        async close() {},
                        async abort() { files.delete(name); },
                    };
                },
            };
        },
    };
    return { folder, files };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('copies image-only and captioned multiple images before linking them in the note', async () => {
    const { folder, files } = writableFolder();
    const env = createEnvironment({ folder, payload: imageCommit(1377256, [{ id: 401 }, { id: 402 }]) });
    send(env.MockXMLHttpRequest, taskEndpoint);
    send(env.MockXMLHttpRequest, imageEndpoint, 'chat_id=999&message=unrelated');
    assert.equal(env.openedUris.length, 0);
    send(env.MockXMLHttpRequest, imageEndpoint, imageBody);
    await settle();
    const first = new URL(env.openedUris[0]).searchParams.get('content');
    assert.match(first, /#task\/42 !\[\[bitrix-task-42-message-1377256-file-401\.png\]\]/);
    assert.match(first, /\n  !\[\[bitrix-task-42-message-1377256-file-402\.png\]\]/);
    assert.equal(await files.get('bitrix-task-42-message-1377256-file-401.png').text(), 'image bytes');
    assert.equal(files.size, 2);

    send(env.MockXMLHttpRequest, imageEndpoint, imageBody);
    await settle();
    assert.equal(env.openedUris.length, 1, 'same confirmed message cannot be exported twice');

    const captioned = createEnvironment({ folder, payload: imageCommit(1377257, [{ id: 403 }]) });
    send(captioned.MockXMLHttpRequest, taskEndpoint);
    send(captioned.MockXMLHttpRequest, imageEndpoint, 'chat_id=11784&message=photo+caption');
    await settle();
    assert.match(new URL(captioned.openedUris[0]).searchParams.get('content'),
        /#task\/42 photo caption\n  !\[\[bitrix-task-42-message-1377257-file-403\.png\]\]/);
});

test('keeps image pending until user selects a writable folder', async () => {
    const { folder, files } = writableFolder();
    const env = createEnvironment({ payload: imageCommit(52, [{ id: 123 }]) });
    send(env.MockXMLHttpRequest, taskEndpoint);
    send(env.MockXMLHttpRequest, imageEndpoint, imageBody);
    await settle();
    assert.equal(env.openedUris.length, 0);
    const panel = env.elements.get('bitrix24-obsidian-attachments');
    assert.match(panel.children[0].textContent, /ожидает доступа/);
    env.window.showDirectoryPicker = () => Promise.resolve(folder);
    panel.children[1].click();
    await settle();
    assert.equal(env.openedUris.length, 1);
    assert.equal(files.size, 1);
    assert.equal(env.elements.has('bitrix24-obsidian-attachments'), false);
});

test('failed or unauthorized downloads never create broken Obsidian embeds', async () => {
    const { folder, files } = writableFolder();
    const env = createEnvironment({
        folder, payload: imageCommit(53, [{ id: 124 }]),
        downloadResponse(url) {
            return { ok: true, url, headers: new Headers({ 'content-type': 'text/html' }) };
        },
    });
    send(env.MockXMLHttpRequest, taskEndpoint);
    send(env.MockXMLHttpRequest, imageEndpoint, imageBody);
    await settle();
    assert.equal(files.size, 0);
    assert.equal(env.openedUris.length, 0);
    assert.match(env.elements.get('bitrix24-obsidian-attachments').children[0].textContent, /не отдал изображение/);

    folder.permission = 'prompt';
    const revoked = createEnvironment({ folder, payload: imageCommit(54, [{ id: 125 }]) });
    send(revoked.MockXMLHttpRequest, taskEndpoint);
    send(revoked.MockXMLHttpRequest, imageEndpoint, imageBody);
    await settle();
    assert.equal(revoked.openedUris.length, 0);
    assert.match(revoked.elements.get('bitrix24-obsidian-attachments').children[0].textContent, /ожидает доступа/);
});

test('handles fetch image commits with a Request body without consuming the response', async () => {
    const { folder, files } = writableFolder();
    const env = createEnvironment({ folder, payload: imageCommit(55, [{ id: 126 }]) });
    await env.window.fetch(taskEndpoint, { method: 'POST' });
    const request = new Request(imageEndpoint, { method: 'POST', body: imageBody });
    const response = await env.window.fetch(request);
    await settle();
    assert.equal((await response.json()).result.MESSAGE_ID, 55);
    assert.match(new URL(env.openedUris[0]).searchParams.get('content'),
        /!\[\[bitrix-task-42-message-55-file-126\.png\]\]/);
    assert.equal(await files.get('bitrix-task-42-message-55-file-126.png').text(), 'image bytes');
});
