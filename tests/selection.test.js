const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./harness');

async function openModal() {
    const env = loadExtension();
    await env.fmg('loadCharacterData()');
    env.document.getElementById('fmg-wi-open').click();
    const modal = env.document.getElementById('fmg-selection-modal');
    assert.ok(modal);
    return { env, modal };
}

function search(env, modal, text) {
    const input = modal.querySelector('#fmg-select-search');
    input.value = text;
    input.dispatchEvent(new env.window.Event('input', { bubbles: true }));
}

const visibleNames = (modal) => Array.from(modal.querySelectorAll('.fmg-select-item'))
    .filter(item => item.style.display !== 'none')
    .map(item => item.querySelector('.fmg-select-name').textContent);

test('选择弹窗显示条目的位置、顺序和关键词', async () => {
    const { modal } = await openModal();
    const meta = modal.querySelector('.fmg-select-item .fmg-select-meta').textContent;
    assert.match(meta, /系统在深度/);
    assert.match(meta, /depth=2/);
    assert.match(meta, /顺序：250/);
    assert.match(meta, /关键词：a/);
});

test('搜索按名称、关键词和内容过滤，全选只作用于搜索结果', async () => {
    const { env, modal } = await openModal();
    modal.querySelectorAll('.fmg-select-cb').forEach(cb => { cb.checked = false; });

    search(env, modal, '设定');
    assert.deepEqual(visibleNames(modal), ['设定B']);

    search(env, modal, '旧内容c');
    assert.deepEqual(visibleNames(modal), ['未选C']);

    modal.querySelector('#fmg-select-all').click();
    search(env, modal, '不存在');
    assert.equal(visibleNames(modal).length, 0);
    assert.notEqual(modal.querySelector('.fmg-select-empty').style.display, 'none');

    modal.querySelector('#fmg-select-confirm').click();
    assert.deepEqual(Array.from(env.fmg('getSavedWorldInfoSelections()')), ['uid:7']);
});
