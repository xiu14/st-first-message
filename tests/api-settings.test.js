const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, sseResponse } = require('./harness');

function fillForm(env, values) {
    for (const [id, value] of Object.entries(values)) {
        env.document.getElementById(id).value = value;
    }
}

async function captureRequest(env) {
    let captured = null;
    env.window.__fetchHandler = async (url, options, body) => {
        captured = { url, body };
        return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`]);
    };
    await env.fmg(`startChatStream([{ role: 'user', content: 'hi' }], { onDone() {}, onError() {} }).promise`);
    return captured;
}

test('保存方案时记录温度和最大输出，并用于请求', async () => {
    const env = loadExtension();
    fillForm(env, {
        'fmg-api-url': 'http://api.test/v1',
        'fmg-api-key': '',
        'fmg-api-temperature': '1.3',
        'fmg-api-max-tokens': '2048'
    });
    env.document.getElementById('fmg-save-api').click();

    const profile = env.fmg('getActiveApiProfile()');
    assert.equal(profile.temperature, 1.3);
    assert.equal(profile.maxTokens, 2048);
    assert.equal(profile.apiKey, '', '允许不填 Key');

    const request = await captureRequest(env);
    assert.equal(request.body.temperature, 1.3);
    assert.equal(request.body.max_tokens, 2048);
});

test('最大输出留空时不发送该参数，温度超出范围时被限制', async () => {
    const env = loadExtension();
    fillForm(env, {
        'fmg-api-url': 'http://api.test/v1',
        'fmg-api-temperature': '5',
        'fmg-api-max-tokens': ''
    });
    env.document.getElementById('fmg-save-api').click();

    const request = await captureRequest(env);
    assert.equal(request.body.temperature, 2);
    assert.equal('max_tokens' in request.body, false);
});

test('旧方案没有温度字段时使用默认值 0.8', () => {
    const env = loadExtension({
        extensionSettings: {
            'first-message-generator': {
                apiProfiles: [{ id: 'p1', name: '旧方案', apiType: 'openai', apiUrl: 'http://x', apiKey: 'k', model: 'm', models: ['m'] }],
                activeApiProfileId: 'p1'
            }
        }
    });
    env.fmg('applyApiProfile(getActiveApiProfile())');
    assert.equal(env.fmg('settings.temperature'), 0.8);
    assert.equal(env.fmg('settings.maxTokens'), null);
    env.fmg('loadSettingsToForm()');
    assert.equal(env.document.getElementById('fmg-api-temperature').value, '0.8');
    assert.equal(env.document.getElementById('fmg-api-max-tokens').value, '');
});
