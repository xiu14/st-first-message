const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, createCharacter, jsonResponse } = require('./harness');

async function setup(options) {
    const env = loadExtension(options);
    await env.fmg('loadCharacterData()');
    return env;
}

test('应用修改后同步顶层属性并刷新 ST 角色编辑面板', async () => {
    const env = await setup();
    const ok = await env.fmg(`applyCharacterEdit('creator_notes', '新备注', null)`);
    assert.equal(ok, true);
    const char = env.context.characters[0];
    assert.equal(char.data.creator_notes, '新备注');
    assert.equal(char.creatorcomment, '新备注');
    assert.equal(JSON.stringify(env.calls.selectCharacterById), JSON.stringify([[0, { switchMenu: false }]]));
});

test('服务器保存失败时不改动内存中的角色数据', async () => {
    const env = await setup();
    env.window.__fetchHandler = async (url) => (url === '/api/characters/merge-attributes' ? jsonResponse({ error: 'x' }, 500) : null);
    const ok = await env.fmg(`applyCharacterEdit('description', '新描述', null, { silent: true })`);
    assert.equal(ok, false);
    assert.equal(env.context.characters[0].description, '旧描述');
    assert.equal(env.context.characters[0].data.description, '旧描述');
    assert.equal(env.calls.selectCharacterById.length, 0);
});

test('ST 当前角色已切换时拒绝写入角色卡和世界书', async () => {
    const characters = [createCharacter({ avatar: 'a.png' }), createCharacter({ name: 'B', avatar: 'b.png' })];
    const env = await setup({ characters });
    env.context.characterId = 1;

    const ok = await env.fmg(`applyCharacterEdit('description', '新描述', null, { silent: true })`);
    assert.equal(ok, false);
    assert.ok(!env.calls.fetch.some(c => c.url === '/api/characters/merge-attributes'));

    await assert.rejects(
        env.fmg(`persistWorldbookEntry({ operation: 'create', uid: null, comment: 'x', keys: ['x'], secondary_keys: [], content: 'x', constant: false })`),
        /角色已切换/
    );
});

test('全部应用多项修改时只刷新一次编辑面板', async () => {
    const env = await setup();
    const content = '[EDIT:description]新描述[/EDIT]\n[EDIT:personality]新性格[/EDIT]';
    env.fmg(`discussMessages = [createChatMessage('user', '问'), createChatMessage('assistant', ${JSON.stringify(content)})]; renderDiscussionHistory();`);
    env.document.querySelector('.fmg-chat-apply-all').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(env.context.characters[0].personality, '新性格');
    assert.equal(env.calls.selectCharacterById.length, 1);
});
