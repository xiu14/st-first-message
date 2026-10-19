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

test('保存条目后只把它的 uid 加入已选列表', async () => {
    const { fmg } = await setup();
    fmg("setSavedWorldInfoSelections(['uid:5'])");
    await fmg(`persistWorldbookEntry({ operation: 'create', uid: null, comment: '设定B', keys: ['b'], secondary_keys: [], content: '同名', constant: false, position: 0, insertion_order: 100 })`);
    const selections = Array.from(fmg('getSavedWorldInfoSelections()'));
    assert.deepEqual(selections, ['uid:5', 'uid:8']);
});
