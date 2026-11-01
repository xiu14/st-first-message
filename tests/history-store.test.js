const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, jsonResponse, flush } = require('./harness');

const HISTORY_URL = '/user/files/first-message-generator-history.json';

const session = (id, updatedAt, content = '你好') => ({
    id, charKey: 'a.png', charName: 'A', title: id, preview: '', messageCount: 2, timestamp: '', updatedAt,
    messages: [{ id: 'm1', role: 'user', content }, { id: 'm2', role: 'assistant', content: '回复' }]
});

// 模拟 ST 的用户文件：GET /user/files/<name> 读取，POST /api/files/upload 写入（base64）
function loadWithFiles({ extensionSettings = {}, fileContent = null, readStatus = 200 } = {}) {
    const env = loadExtension({ extensionSettings });
    const files = { content: fileContent === null ? null : JSON.stringify(fileContent), uploads: 0 };
    env.window.__fetchHandler = async (url, options, body) => {
        if (url === HISTORY_URL) {
            if (readStatus !== 200) return jsonResponse({}, readStatus);
            return files.content === null ? jsonResponse({}, 404) : jsonResponse(JSON.parse(files.content));
        }
        if (url === '/api/files/upload') {
            assert.equal(body.name, 'first-message-generator-history.json');
            files.content = Buffer.from(body.data, 'base64').toString('utf8');
            files.uploads++;
            return jsonResponse({ path: `user/files/${body.name}` });
        }
        return null;
    };
    return { ...env, files, stored: () => env.context.extensionSettings['first-message-generator'] };
}

test('首次运行把 settings 里的会话和开场白历史迁移到文件，并从 settings 删掉', async () => {
    const env = loadWithFiles({
        extensionSettings: {
            'first-message-generator': {
                temperature: 0.5,
                discussSessionHistory: [session('s1', 10, '中文内容')],
                firstMessageHistory: [{ id: 1, prompt: 'p', content: '开场白', charName: 'A' }],
                discussionHistory: [{ old: true }]
            }
        }
    });
    await env.fmg('loadHistoryStore()');

    const file = JSON.parse(env.files.content);
    assert.equal(file.discussSessionHistory[0].messages[0].content, '中文内容');
    assert.equal(file.firstMessageHistory[0].content, '开场白');

    const stored = env.stored();
    assert.equal(stored.temperature, 0.5);
    assert.ok(!('discussSessionHistory' in stored));
    assert.ok(!('firstMessageHistory' in stored));
    assert.ok(!('discussionHistory' in stored));
    // 内存里照常可用
    assert.equal(env.fmg('settings.discussSessionHistory.length'), 1);
});

test('已有历史文件时直接读取，不重复写入', async () => {
    const env = loadWithFiles({
        fileContent: { version: 1, discussSessionHistory: [session('s1', 10)], firstMessageHistory: [] }
    });
    await env.fmg('loadHistoryStore()');
    assert.equal(env.fmg('settings.discussSessionHistory[0].id'), 's1');
    assert.equal(env.files.uploads, 0);
});

test('之后的改动只写历史文件，不进 settings', async () => {
    const env = loadWithFiles({ fileContent: { version: 1, discussSessionHistory: [], firstMessageHistory: [] } });
    await env.fmg('loadHistoryStore()');
    env.fmg(`settings.discussSessionHistory.unshift(${JSON.stringify(session('s2', 20))}); saveSettings()`);
    await flush(700);

    assert.equal(JSON.parse(env.files.content).discussSessionHistory[0].id, 's2');
    assert.ok(!('discussSessionHistory' in env.stored()));
});

test('settings 和文件里都有记录时按 id 合并，保留较新的', async () => {
    const env = loadWithFiles({
        extensionSettings: {
            'first-message-generator': { discussSessionHistory: [session('s1', 30, '新'), session('s3', 5)] }
        },
        fileContent: { version: 1, discussSessionHistory: [session('s1', 10, '旧'), session('s2', 20)], firstMessageHistory: [] }
    });
    await env.fmg('loadHistoryStore()');

    const sessions = JSON.parse(env.files.content).discussSessionHistory;
    assert.deepEqual(sessions.map(s => s.id), ['s1', 's2', 's3']);
    assert.equal(sessions[0].messages[0].content, '新');
    assert.ok(!('discussSessionHistory' in env.stored()));
});

test('读不到历史文件时不迁移，继续存在 settings 里', async () => {
    const env = loadWithFiles({
        extensionSettings: { 'first-message-generator': { discussSessionHistory: [session('s1', 10)] } },
        readStatus: 500
    });
    await env.fmg('loadHistoryStore()');
    env.fmg('saveSettings()');
    await flush(700);

    assert.equal(env.files.uploads, 0);
    assert.equal(env.stored().discussSessionHistory[0].id, 's1');
});
