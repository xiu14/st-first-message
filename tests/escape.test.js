const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, jsonResponse, flush } = require('./harness');

test('escapeHtml 转义引号，可安全用于属性值', () => {
    const { fmg } = loadExtension();
    assert.equal(fmg(`escapeHtml('a"b\\'c<d>&')`), 'a&quot;b&#39;c&lt;d&gt;&amp;');
    assert.equal(fmg('escapeHtml(undefined)'), '');
    assert.equal(fmg('escapeHtml(12)'), '12');
});

test('API 返回的模型名不会被当成 HTML 插入', async () => {
    const env = loadExtension();
    const evil = '"><img src=x onerror="window.__pwned=1">';
    env.window.__fetchHandler = async (url) => (url.endsWith('/models') ? jsonResponse({ data: [{ id: evil }, { id: 'gpt-ok' }] }) : null);
    env.document.getElementById('fmg-api-url').value = 'http://api.test/v1';
    env.document.getElementById('fmg-api-key').value = 'k';
    env.document.getElementById('fmg-get-models').click();
    await flush(50);

    const options = Array.from(env.document.querySelectorAll('#fmg-model option')).map(o => o.value);
    assert.deepEqual(options.sort(), [evil, 'gpt-ok'].sort());
    assert.equal(env.document.querySelector('#fmg-model img'), null);
});
