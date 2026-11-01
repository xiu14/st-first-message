// 在 jsdom 中加载 index.js，并通过 fmg() 访问 IIFE 内部的变量和函数。
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');

function createWorldData() {
    return {
        entries: {
            5: { uid: 5, comment: '规则A', key: ['a'], keysecondary: [], content: '旧内容A', constant: true, position: 4, depth: 2, role: 0, order: 250, probability: 100, group: '' },
            6: { uid: 6, comment: '设定B', key: ['b'], keysecondary: [], content: '旧内容B', constant: false, position: 3, depth: 4, role: null, order: 30, probability: 30, group: '分组B', sticky: 2 },
            7: { uid: 7, comment: '未选C', key: ['c'], keysecondary: [], content: '旧内容C', constant: false, position: 1, depth: 4, role: null, order: 77 }
        }
    };
}

function createCharacter(overrides = {}) {
    return {
        name: 'A',
        avatar: 'a.png',
        description: '旧描述',
        data: { description: '旧描述', extensions: { world: 'W' } },
        ...overrides
    };
}

/**
 * 创建一个加载了插件的页面。
 * @returns {{ window, document, fmg: (expr: string) => any, calls: object, context: object }}
 */
function loadExtension({ characters = [createCharacter()], characterId = 0, worldData = createWorldData(), extensionSettings = {} } = {}) {
    // 暴露求值钩子，并阻止自动 init（测试里手动调用）
    const source = SOURCE
        .replace(/\n\}\)\(\);\s*$/, '\nwindow.__fmgEval = (code) => eval(code);\n})();')
        .replace(/setTimeout\(init, 1000\);/g, '');

    const dom = new JSDOM('<!doctype html><body><div id="extensionsMenu"></div><div id="chat"></div></body>', {
        runScripts: 'outside-only',
        url: 'http://localhost/'
    });
    const w = dom.window;

    const calls = { fetch: [], toasts: [], savedWorlds: [], selectCharacterById: [], errors: [] };
    // savedWorld 是服务器上的世界书；ST 前端另有一份内存缓存
    let savedWorld = null;
    const worldInfoCache = new Map();
    let pendingWorldSave = null;
    const writeWorldToServer = (data) => {
        if (w.__failWorldSaves) return;
        savedWorld = JSON.parse(JSON.stringify(data));
        calls.savedWorlds.push(savedWorld);
    };

    const context = {
        characterId,
        characters,
        extensionSettings,
        chat: [],
        saveSettingsDebounced() {},
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        // 与 ST 一致：有缓存就直接返回缓存对象本身
        loadWorldInfo: async (name) => {
            if (!worldInfoCache.has(name)) {
                worldInfoCache.set(name, JSON.parse(JSON.stringify(savedWorld || worldData)));
            }
            return worldInfoCache.get(name);
        },
        // 与 ST 一致：先更新缓存，默认防抖 1 秒才写盘，immediately 为 true 时立即写盘
        saveWorldInfo: async (name, data, immediately = false) => {
            worldInfoCache.set(name, data);
            clearTimeout(pendingWorldSave);
            if (immediately) {
                writeWorldToServer(data);
                return;
            }
            pendingWorldSave = setTimeout(() => writeWorldToServer(data), 1000);
        },
        selectCharacterById: async (id, options) => { calls.selectCharacterById.push([id, options]); },
        getTokenCountAsync: async (text) => String(text).length
    };

    w.SillyTavern = { getContext: () => context };
    w.structuredClone = (value) => JSON.parse(JSON.stringify(value));
    w.TextDecoder = TextDecoder;
    w.TextEncoder = TextEncoder;
    w.toastr = {
        success: (m) => calls.toasts.push(['success', m]),
        error: (m) => calls.toasts.push(['error', m]),
        info: (m) => calls.toasts.push(['info', m]),
        warning: (m) => calls.toasts.push(['warning', m])
    };
    w.confirm = () => true;
    w.console.warn = () => {};
    w.console.log = () => {};
    w.console.error = (...args) => calls.errors.push(args);

    // 默认的 fetch：世界书读取返回当前世界书，角色保存返回成功；测试可覆盖 w.__fetchHandler
    w.fetch = async (url, options = {}) => {
        const body = options.body ? JSON.parse(options.body) : null;
        calls.fetch.push({ url, body });
        if (w.__fetchHandler) {
            const handled = await w.__fetchHandler(url, options, body);
            if (handled) return handled;
        }
        if (url === '/api/worldinfo/get') {
            return jsonResponse(JSON.parse(JSON.stringify(savedWorld || worldData)));
        }
        return jsonResponse({});
    };

    w.eval(source);
    const fmg = (expr) => w.__fmgEval(expr);
    fmg('loadSettings(); createUI(); bindEvents();');

    return { window: w, document: w.document, fmg, calls, context, getSavedWorld: () => savedWorld };
}

function jsonResponse(data, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
        text: async () => JSON.stringify(data)
    };
}

// 模拟 SSE 流式响应
function sseResponse(lines) {
    const encoder = new TextEncoder();
    const chunks = lines.map(line => encoder.encode(line));
    let index = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length
                    ? { done: false, value: chunks[index++] }
                    : { done: true, value: undefined })
            })
        },
        text: async () => ''
    };
}

const flush = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { loadExtension, createCharacter, createWorldData, jsonResponse, sseResponse, flush };
