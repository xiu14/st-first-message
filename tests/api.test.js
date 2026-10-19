const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, sseResponse, jsonResponse, flush } = require('./harness');

function setup(apiType = 'openai') {
    const env = loadExtension();
    env.fmg(`settings.apiType = '${apiType}'; settings.apiUrl = 'http://api.test/v1'; settings.apiKey = 'k'; settings.model = 'm';`);
    return env;
}

async function runStream(env, response) {
    const requests = [];
    env.window.__fetchHandler = async (url, options, body) => {
        requests.push({ url, body, headers: options.headers });
        return response;
    };
    env.fmg('window.__result = null; window.__error = null;');
    await env.fmg(`startChatStream([{ role: 'system', content: 'S1' }, { role: 'system', content: 'S2' }, { role: 'user', content: 'hi' }], {
        onDone: (text) => { window.__result = text; },
        onError: (error) => { window.__error = error.message; }
    }).promise`);
    return { result: env.window.__result, error: env.window.__error, requests };
}

const openaiChunk = (content, extra = {}) => `data: ${JSON.stringify({ choices: [{ delta: { content }, ...extra }] })}\n\n`;

test('OpenAI：处理 data: 无空格、最后一行没有换行的情况', async () => {
    const env = setup();
    const { result } = await runStream(env, sseResponse([
        openaiChunk('你'),
        `data:${JSON.stringify({ choices: [{ delta: { content: '好' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: '！' } }] })}`
    ]));
    assert.equal(result, '你好！');
});

test('OpenAI：流里返回 error 时报错', async () => {
    const env = setup();
    const { result, error } = await runStream(env, sseResponse([
        openaiChunk('部分'),
        `data: ${JSON.stringify({ error: { message: 'quota exceeded' } })}\n\n`
    ]));
    assert.equal(result, null);
    assert.match(error, /quota exceeded/);
});

test('OpenAI：空回复报错并带上结束原因', async () => {
    const env = setup();
    const { error } = await runStream(env, sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'content_filter' }] })}\n\n`,
        'data: [DONE]\n\n'
    ]));
    assert.match(error, /content_filter/);
});

test('OpenAI：中转站忽略 stream 直接返回完整 JSON 时也能用', async () => {
    const env = setup();
    const raw = JSON.stringify({ choices: [{ message: { content: '完整回复' }, finish_reason: 'stop' }] });
    const { result } = await runStream(env, sseResponse([raw.slice(0, 20), raw.slice(20)]));
    assert.equal(result, '完整回复');
});

test('OpenAI：没有 Key 时不发送 Authorization', async () => {
    const env = setup();
    env.fmg("settings.apiKey = ''");
    const { requests } = await runStream(env, sseResponse([openaiChunk('ok')]));
    assert.equal(requests[0].headers.Authorization, undefined);
});

test('Gemini：合并多段输出、跳过思考内容、合并多条 system', async () => {
    const env = setup('gemini');
    const chunk = (parts) => `data: ${JSON.stringify({ candidates: [{ content: { parts } }] })}\n\n`;
    const { result, requests } = await runStream(env, sseResponse([
        chunk([{ text: '想一想', thought: true }, { text: '第一段' }, { text: '第二段' }]),
        chunk([{ text: '结尾' }])
    ]));
    assert.equal(result, '第一段第二段结尾');
    assert.equal(requests[0].body.systemInstruction.parts[0].text, 'S1\n\nS2');
    assert.match(requests[0].url, /models\/m:streamGenerateContent\?key=k&alt=sse$/);
});

test('Gemini：被拦截时报出原因', async () => {
    const env = setup('gemini');
    const { error } = await runStream(env, sseResponse([
        `data: ${JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } })}\n\n`
    ]));
    assert.match(error, /SAFETY/);
});

test('讨论页停止不会中断同时进行的其他请求', async () => {
    const env = setup();
    await env.fmg('loadCharacterData()');
    const signals = [];
    env.window.__fetchHandler = async (url, options) => {
        if (!url.endsWith('/chat/completions')) return null;
        signals.push(options.signal);
        return {
            ok: true,
            body: {
                getReader: () => ({
                    read: () => new Promise((resolve, reject) => {
                        options.signal.addEventListener('abort', () => {
                            const error = new Error('aborted');
                            error.name = 'AbortError';
                            reject(error);
                        });
                    })
                })
            }
        };
    };

    env.document.getElementById('fmg-discuss-input').value = '讨论';
    env.document.getElementById('fmg-discuss-send').click();
    await flush();
    env.fmg(`startChatStream([{ role: 'user', content: '状态栏' }], { onDone() {}, onError() {} })`);
    await flush();

    env.document.getElementById('fmg-discuss-send').click();
    await flush();
    assert.equal(signals.length, 2);
    assert.equal(signals[0].aborted, true, '讨论请求被中断');
    assert.equal(signals[1].aborted, false, '另一个请求不受影响');
});

test('API 返回非 2xx 时报错', async () => {
    const env = setup();
    const { error } = await runStream(env, jsonResponse({ error: 'bad' }, 401));
    assert.match(error, /401/);
});
