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

// ST-Grouping 的世界书分组数据
const groupingSettings = () => ({
    worldinfo_groups: {
        enabled: true,
        worldbooks: {
            W: {
                groupOrder: ['g2', 'g1'],
                groups: {
                    g1: { name: '规则', collapsed: false, entries: [5, 999], subgroups: { s1: { name: '子组', collapsed: false, entries: [6] } }, subgroupOrder: ['s1'] },
                    g2: { name: '空组', collapsed: false, entries: [], subgroups: {}, subgroupOrder: [] }
                }
            }
        }
    }
});

async function openGroupedModal() {
    const env = loadExtension({ extensionSettings: groupingSettings() });
    await env.fmg('loadCharacterData()');
    env.document.getElementById('fmg-wi-open').click();
    return { env, modal: env.document.getElementById('fmg-selection-modal') };
}

const groupByName = (modal, name) => Array.from(modal.querySelectorAll('.fmg-select-group'))
    .find(group => group.querySelector(':scope > .fmg-select-group-header .fmg-select-group-name').textContent === name);

test('按 ST-Grouping 的分组显示世界书条目，默认折叠，未分组放最后', async () => {
    const { modal } = await openGroupedModal();
    const topNames = Array.from(modal.querySelectorAll('.fmg-select-body > .fmg-select-group > .fmg-select-group-header .fmg-select-group-name'))
        .map(el => el.textContent);
    // 空组和不存在的条目 999 被忽略
    assert.deepEqual(topNames, ['规则', '未分组']);

    const rule = groupByName(modal, '规则');
    assert.ok(rule.classList.contains('fmg-collapsed'));
    assert.equal(groupByName(modal, '子组').querySelector('.fmg-select-name').textContent, '设定B');
    assert.equal(groupByName(modal, '未分组').querySelector('.fmg-select-name').textContent, '未选C');

    rule.querySelector('.fmg-select-group-header').click();
    assert.ok(!rule.classList.contains('fmg-collapsed'));
});

test('勾选分组会勾选组内（含子组）全部条目，并显示半选状态', async () => {
    const { env, modal } = await openGroupedModal();
    modal.querySelectorAll('.fmg-select-cb').forEach(cb => { cb.checked = false; });

    const subgroupCb = groupByName(modal, '子组').querySelector('.fmg-select-group-cb');
    subgroupCb.checked = true;
    subgroupCb.dispatchEvent(new env.window.Event('change'));
    const ruleCb = groupByName(modal, '规则').querySelector('.fmg-select-group-cb');
    assert.equal(ruleCb.indeterminate, true);
    assert.equal(groupByName(modal, '规则').querySelector('.fmg-select-group-count').textContent, '1/2');

    ruleCb.checked = true;
    ruleCb.dispatchEvent(new env.window.Event('change'));
    modal.querySelector('#fmg-select-confirm').click();
    assert.deepEqual(Array.from(env.fmg('getSavedWorldInfoSelections()')).sort(), ['uid:5', 'uid:6']);
});

test('搜索时隐藏没有匹配条目的分组', async () => {
    const { env, modal } = await openGroupedModal();
    search(env, modal, '设定');
    assert.deepEqual(visibleNames(modal), ['设定B']);
    assert.equal(groupByName(modal, '未分组').style.display, 'none');
    assert.equal(groupByName(modal, '规则').style.display, '');
    assert.ok(modal.querySelector('.fmg-select-body').classList.contains('fmg-searching'));
});

test('选择弹窗只显示名称和状态标签，不显示位置和顺序', async () => {
    const { modal } = await openModal();
    const item = modal.querySelector('.fmg-select-item');
    assert.equal(item.querySelector('.fmg-select-meta'), null);
    assert.doesNotMatch(item.textContent, /顺序|position/);
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
