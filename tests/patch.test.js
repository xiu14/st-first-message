const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, createCharacter, jsonResponse, flush } = require('./harness');

const DESC = '她叫小雨。\n她总是独来独往，不愿与人交谈。\n喜欢在雨天看书。';

const patchBlock = (target, ...pairs) => [
    `[PATCH:${target}]`,
    ...pairs.flatMap(([find, replace]) => ['<<<<<<< SEARCH', find, '=======', replace, '>>>>>>> REPLACE']),
    '[/PATCH]'
].join('\n');

async function setup(characterOverrides = {}) {
    const character = createCharacter({
        description: DESC,
        data: { description: DESC, alternate_greetings: ['早上好。', '晚上好，今天累吗？'], extensions: { world: 'W' } },
        ...characterOverrides
    });
    const env = loadExtension({ characters: [character] });
    await env.fmg('loadCharacterData()');
    return env;
}

function showReply(env, content) {
    env.fmg(`discussMessages = [createChatMessage('user', '改一下'), createChatMessage('assistant', ${JSON.stringify(content)})]; renderDiscussionHistory();`);
}

const patch = (env, value, hunks) => env.fmg(`applyPatchHunks(${JSON.stringify(value)}, ${JSON.stringify(hunks)})`);

test('替换块：精确匹配只替换命中的那一处', async () => {
    const env = await setup();
    assert.equal(patch(env, DESC, [{ find: '不愿与人交谈。', replace: '对熟人话多。' }]),
        '她叫小雨。\n她总是独来独往，对熟人话多。\n喜欢在雨天看书。');
});

test('替换块：标点全半角、空白和换行符不同也能定位，原文其余部分不变', async () => {
    const env = await setup();
    const text = '第一行。\r\n她总是独来独往，  不愿与人交谈。\r\n末行';
    const result = patch(env, text, [{ find: '她总是独来独往,不愿与人交谈.\n', replace: '\n她习惯独处。\n' }]);
    assert.equal(result, '第一行。\r\n她习惯独处。\r\n末行');
});

test('替换块：原文出现多处或找不到时报错，多处修改有一处失败就整体不改', async () => {
    const env = await setup();
    assert.throws(() => patch(env, '啊啊。啊啊。', [{ find: '啊啊', replace: 'x' }]), /出现了 2 处/);
    assert.throws(() => patch(env, DESC, [{ find: '不存在的句子', replace: 'x' }]), /找不到这段原文/);
    assert.throws(
        () => patch(env, DESC, [{ find: '她叫小雨', replace: '她叫小晴' }, { find: '不存在', replace: 'x' }]),
        /第 2 处修改：找不到这段原文/
    );
});

test('替换块：可选开场白在所有条目中定位，只改命中的那条', async () => {
    const env = await setup();
    const result = patch(env, ['早上好。', '晚上好，今天累吗？'], [{ find: '今天累吗', replace: '今天顺利吗' }]);
    assert.deepEqual(Array.from(result), ['早上好。', '晚上好，今天顺利吗？']);
    assert.throws(() => patch(env, ['好。', '好。'], [{ find: '好。', replace: 'x' }]), /出现了 2 处/);
});

test('角色卡局部修改：卡片只显示改动，应用后保存修改后的全文', async () => {
    const env = await setup();
    showReply(env, `我改了一句：\n${patchBlock('description', ['她总是独来独往，不愿与人交谈。', '她总是独来独往，但对熟人会意外地话多。'])}`);

    const card = env.document.querySelector('.fmg-patch-card');
    assert.ok(card.matches('.fmg-edit-card[data-edit-key]'));
    assert.equal(card.querySelector('.fmg-patch-mark-del').textContent, '不愿与人交谈');
    assert.equal(card.querySelector('.fmg-patch-mark-ins').textContent, '但对熟人会意外地话多');
    assert.match(card.querySelector('.fmg-edit-card-old-content').textContent, /意外地话多。\n喜欢在雨天看书/);

    card.querySelector('.fmg-edit-apply').click();
    await flush(50);

    const expected = '她叫小雨。\n她总是独来独往，但对熟人会意外地话多。\n喜欢在雨天看书。';
    const save = env.calls.fetch.find(c => c.url === '/api/characters/merge-attributes');
    assert.equal(save.body.data.description, expected);
    assert.equal(env.context.characters[0].description, expected);
    assert.ok(card.classList.contains('applied'));
});

test('角色卡局部修改：按应用时的最新内容定位，不会覆盖之后的修改', async () => {
    const env = await setup();
    showReply(env, patchBlock('description', ['喜欢在雨天看书。', '喜欢在雨天写信。']));
    // 回复之后，描述的第一句被改过
    env.context.characters[0].data.description = DESC.replace('小雨', '小晴');

    env.document.querySelector('.fmg-edit-apply').click();
    await flush(50);
    assert.equal(env.context.characters[0].data.description, '她叫小晴。\n她总是独来独往，不愿与人交谈。\n喜欢在雨天写信。');
});

test('角色卡局部修改：找不到原文时不保存，按钮变为重试', async () => {
    const env = await setup();
    showReply(env, patchBlock('description', ['根本没有这句', '新内容']));
    assert.match(env.document.querySelector('.fmg-patch-note.warning').textContent, /找不到这段原文/);

    const button = env.document.querySelector('.fmg-edit-apply');
    button.click();
    await flush(50);
    assert.ok(!env.calls.fetch.some(c => c.url === '/api/characters/merge-attributes'));
    assert.equal(button.textContent, '⚠️ 重试');
    assert.ok(env.calls.toasts.some(([type, msg]) => type === 'error' && /找不到这段原文/.test(msg)));
});

test('格式不完整的替换块显示解析失败卡片，没有应用按钮', async () => {
    const env = await setup();
    showReply(env, '[PATCH:description]\n<<<<<<< SEARCH\n原文\n[/PATCH]');
    const card = env.document.querySelector('.fmg-patch-card.invalid');
    assert.ok(card);
    assert.match(card.textContent, /缺少/);
    assert.equal(card.querySelector('button'), null);
});

test('世界书局部修改：只改正文中的一句，关键词、位置和顺序不变', async () => {
    const env = await setup();
    const data = await env.context.loadWorldInfo('W');
    data.entries[5].content = '规则一：不许说谎。\n规则二：守时。';
    await env.context.saveWorldInfo('W', data, true);
    await env.fmg('loadCharacterData()');

    showReply(env, patchBlock('wi:5', ['规则二：守时。', '规则二：守时，迟到要道歉。']));
    const card = env.document.querySelector('.fmg-patch-card');
    assert.ok(card.matches('.fmg-worldbook-card[data-entry-key]'));
    assert.match(card.querySelector('.fmg-worldbook-card-header').textContent, /#5 规则A/);

    card.querySelector('.fmg-worldbook-apply').click();
    await flush(50);

    const saved = env.getSavedWorld().entries[5];
    assert.equal(saved.content, '规则一：不许说谎。\n规则二：守时，迟到要道歉。');
    assert.deepEqual(saved.key, ['a']);
    assert.equal(saved.comment, '规则A');
    assert.equal(saved.constant, true);
    assert.equal(saved.position, 4);
    assert.equal(saved.depth, 2);
    assert.equal(saved.order, 250);
    assert.ok(card.classList.contains('applied'));
});

test('世界书 update 只写关键词时正文保持原样', async () => {
    const env = await setup();
    const block = `[WORLDBOOK_ENTRY]\n${JSON.stringify({ operation: 'update', uid: 6, keys: ['b', '新词'] })}\n[/WORLDBOOK_ENTRY]`;
    showReply(env, block);
    const card = env.document.querySelector('.fmg-worldbook-card');
    assert.match(card.textContent, /沿用原内容/);
    assert.match(card.querySelector('.fmg-worldbook-card-header').textContent, /设定B/);

    card.querySelector('.fmg-worldbook-apply').click();
    await flush(50);
    const saved = env.getSavedWorld().entries[6];
    assert.deepEqual(saved.key, ['b', '新词']);
    assert.equal(saved.content, '旧内容B');
    assert.equal(saved.comment, '设定B');
    assert.equal(saved.constant, false);
});

test('全部应用：局部修改和整段修改一起按顺序应用', async () => {
    const env = await setup();
    const content = [
        patchBlock('description', ['她叫小雨。', '她叫小晴。']),
        '[EDIT:personality]温和[/EDIT]',
        patchBlock('wi:6', ['旧内容B', '新内容B'])
    ].join('\n');
    showReply(env, content);
    assert.match(env.document.querySelector('.fmg-chat-apply-all-bar').textContent, /2 项修改、1 个世界书条目/);

    env.document.querySelector('.fmg-chat-apply-all').click();
    await flush(80);
    assert.equal(env.context.characters[0].data.description, DESC.replace('小雨', '小晴'));
    assert.equal(env.context.characters[0].personality, '温和');
    assert.equal(env.getSavedWorld().entries[6].content, '新内容B');
    assert.match(env.document.querySelector('.fmg-chat-apply-all-bar').textContent, /已全部处理/);
});

test('讨论系统提示词说明了局部修改格式', async () => {
    const env = await setup();
    const prompt = env.fmg('buildDiscussSystemPrompt()');
    assert.match(prompt, /\[PATCH:目标\]/);
    assert.match(prompt, /<<<<<<< SEARCH/);
});
