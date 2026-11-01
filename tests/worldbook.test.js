const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension } = require('./harness');

async function setup() {
    const env = loadExtension();
    await env.fmg('loadCharacterData()');
    return env;
}

test('新建条目不继承已有条目的概率、分组、sticky 等设置', async () => {
    const { fmg, getSavedWorld } = await setup();
    // 世界书最后一个条目（uid 6）的概率是 30%，分组「分组B」，sticky 2
    await fmg(`persistWorldbookEntry({ operation: 'create', uid: null, comment: '新条目', keys: ['n'], secondary_keys: [], content: '新', constant: false, position: 0, insertion_order: 100 })`);
    const created = Object.values(getSavedWorld().entries).find(e => e.comment === '新条目');
    assert.equal(created.probability, 100);
    assert.equal(created.group, '');
    assert.equal(created.sticky, null);
    assert.equal(created.uid, 8);
});

const newEntry = (comment, content) => `{ operation: 'create', uid: null, comment: '${comment}', keys: ['k'], secondary_keys: [], content: '${content}', constant: false, position: 0, insertion_order: 100 }`;

test('连续添加两条，服务器上两条都在（ST 默认防抖写盘时后一条曾覆盖前一条）', async () => {
    const { fmg, getSavedWorld } = await setup();
    await fmg(`persistWorldbookEntry(${newEntry('第一条', '一')})`);
    await fmg(`persistWorldbookEntry(${newEntry('第二条', '二')})`);
    const comments = Object.values(getSavedWorld().entries).map(e => e.comment);
    assert.ok(comments.includes('第一条'));
    assert.ok(comments.includes('第二条'));
});

test('编辑器里尚未写盘的修改不会被添加条目覆盖', async () => {
    const { fmg, context, getSavedWorld } = await setup();
    const data = await context.loadWorldInfo('W');
    data.entries[7].content = '编辑器里刚改的';
    await context.saveWorldInfo('W', data);
    await fmg(`persistWorldbookEntry(${newEntry('新条目', '新')})`);
    assert.equal(getSavedWorld().entries[7].content, '编辑器里刚改的');
    assert.equal(getSavedWorld().entries[8].comment, '新条目');
});

test('服务器没有保存成功时报错，不显示成功', async () => {
    const { fmg, window } = await setup();
    window.__failWorldSaves = true;
    await assert.rejects(
        () => fmg(`persistWorldbookEntry(${newEntry('新条目', '新')})`),
        /保存后校验失败/
    );
});

test('保存条目后只把它的 uid 加入已选列表', async () => {
    const { fmg } = await setup();
    fmg("setSavedWorldInfoSelections(['uid:5'])");
    await fmg(`persistWorldbookEntry({ operation: 'create', uid: null, comment: '设定B', keys: ['b'], secondary_keys: [], content: '同名', constant: false, position: 0, insertion_order: 100 })`);
    const selections = Array.from(fmg('getSavedWorldInfoSelections()'));
    assert.deepEqual(selections, ['uid:5', 'uid:8']);
});
