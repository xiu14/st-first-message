const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, createCharacter, sseResponse, flush } = require('./harness');

const wbBlock = (entry) => `[WORLDBOOK_ENTRY]\n${JSON.stringify(entry)}\n[/WORLDBOOK_ENTRY]`;

async function openWithCharacter(options) {
    const env = loadExtension(options);
    env.fmg("settings.apiType = 'openai'; settings.apiUrl = 'http://api.test/v1'; settings.apiKey = 'k';");
    await env.fmg('loadCharacterData()');
    return env;
}

function streamReply(env, text) {
    env.window.__fetchHandler = async (url) => {
        if (url === 'http://api.test/v1/chat/completions') {
            return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`, 'data: [DONE]\n\n']);
        }
        return null;
    };
}

test('讨论回复：全部应用按钮按顺序应用修改和条目，跳过已忽略的', async () => {
    const env = await openWithCharacter();
    const { document, fmg, calls } = env;
    const content = [
        '说明',
        '[EDIT:description]新描述[/EDIT]',
        wbBlock({ operation: 'create', comment: '条目一', keys: ['k1'], content: '内容一', position: 'before_char', insertion_order: 10 }),
        wbBlock({ operation: 'create', comment: '条目二', keys: ['k2'], content: '内容二' })
    ].join('\n');
    fmg(`discussMessages = [createChatMessage('user', '问'), createChatMessage('assistant', ${JSON.stringify(content)})]; renderDiscussionHistory();`);

    const bar = document.querySelector('.fmg-chat-apply-all-bar');
    assert.ok(bar, '应显示全部应用栏');
    assert.match(bar.textContent, /1 项修改、2 个世界书条目/);

    document.querySelectorAll('.fmg-worldbook-card')[1].querySelector('.fmg-worldbook-ignore').click();
    document.querySelector('.fmg-chat-apply-all').click();
    await flush(50);

    const edit = calls.fetch.find(c => c.url === '/api/characters/merge-attributes');
    assert.equal(edit.body.data.description, '新描述');
    const entries = Object.values(env.getSavedWorld().entries);
    assert.ok(entries.some(e => e.comment === '条目一'));
    assert.ok(!entries.some(e => e.comment === '条目二'), '已忽略的条目不应保存');
    assert.match(document.querySelector('.fmg-chat-apply-all-bar').textContent, /已全部应用/);
});

test('会话：新建会话保留旧会话，进入所选能恢复', async () => {
    const { document, fmg } = await openWithCharacter();
    fmg(`discussMessages = [createChatMessage('user', '问题一'), createChatMessage('assistant', '回答一')]; saveChatSession();`);
    const firstId = fmg('currentDiscussSessionId');

    fmg('openChatSessionModal()');
    document.getElementById('fmg-chat-session-new').click();
    assert.equal(document.getElementById('fmg-chat-session-modal'), null);
    assert.equal(fmg('discussMessages.length'), 0);
    assert.equal(fmg('getCurrentChatSessionRecords().length'), 1);

    fmg('openChatSessionModal()');
    document.querySelector(`input[name="fmg-chat-session-choice"][value="${firstId}"]`).checked = true;
    document.getElementById('fmg-chat-session-load').click();
    assert.equal(fmg('currentDiscussSessionId'), firstId);
    assert.match(document.getElementById('fmg-chat-messages').textContent, /回答一/);
});

test('会话：同名角色按头像区分，旧记录按名字兼容', async () => {
    const characters = [createCharacter({ avatar: 'a1.png' }), createCharacter({ avatar: 'a2.png' })];
    const { fmg, context } = await openWithCharacter({ characters });
    fmg(`settings.discussSessionHistory = [{ id: 'old', charName: 'A', title: '旧', messages: [] }];`);
    fmg(`discussMessages = [createChatMessage('user', 'q'), createChatMessage('assistant', 'r')]; saveChatSession();`);
    assert.equal(fmg('getCurrentChatSessionRecords().length'), 2, '当前角色能看到旧记录和新记录');

    context.characterId = 1;
    await fmg('loadCharacterData()');
    assert.equal(fmg('discussMessages.length'), 0, '切换到同名的另一个角色时清空当前对话');
    const visible = fmg('getCurrentChatSessionRecords().map(r => r.id)');
    assert.deepEqual(Array.from(visible), ['old'], '另一个同名角色只能看到无头像信息的旧记录');
});

test('会话：所有角色合计不超过上限', async () => {
    const { fmg } = await openWithCharacter();
    fmg(`settings.discussSessionHistory = Array.from({ length: 40 }, (_, i) => ({ id: 'o' + i, charKey: 'other' + i + '.png', charName: 'B', updatedAt: i, messages: [] }));`);
    fmg(`discussMessages = [createChatMessage('user', 'q'), createChatMessage('assistant', 'r')]; saveChatSession();`);
    const history = fmg('settings.discussSessionHistory');
    assert.equal(history.length, fmg('CHAT_SESSION_TOTAL_LIMIT'));
    assert.ok(history.some(r => r.id === 'o39'), '保留最近更新的其他角色会话');
    assert.ok(!history.some(r => r.id === 'o0'), '丢弃最旧的会话');
});

test('世界书：更新已有条目沿用原位置、深度和顺序，新建条目用 AI 的值', async () => {
    const { fmg, getSavedWorld } = await openWithCharacter();
    const text = [
        wbBlock({ operation: 'update', uid: 5, comment: '规则A', keys: [], content: '新内容A', constant: true, position: 'before_char', insertion_order: 100 }),
        wbBlock({ operation: 'create', comment: '新条目', keys: ['n'], content: '新', position: 'at_depth', depth: 6, role: 'user', insertion_order: 40 })
    ].join('\n');
    const [update, create] = fmg(`parseWorldbookEntryBlocks(${JSON.stringify(text)})`);
    assert.equal(update.position, 4);
    assert.equal(update.depth, 2);
    assert.equal(update.insertion_order, 250);

    fmg('window.__u = arguments');
    await fmg(`persistWorldbookEntry(parseWorldbookEntryBlocks(${JSON.stringify(text)})[0])`);
    await fmg(`persistWorldbookEntry(parseWorldbookEntryBlocks(${JSON.stringify(text)})[1])`);
    const entries = getSavedWorld().entries;
    assert.equal(entries[5].content, '新内容A');
    assert.equal(entries[5].depth, 2);
    assert.equal(entries[5].order, 250);
    const created = Object.values(entries).find(e => e.comment === '新条目');
    assert.equal(created.depth, 6);
    assert.equal(created.order, 40);
    assert.equal(create.role, 1);
});

test('事件：ST 页面上的 change 事件不会触发插件保存设置', async () => {
    const env = await openWithCharacter();
    let saves = 0;
    env.context.saveSettingsDebounced = () => { saves++; };

    const outside = env.document.createElement('input');
    outside.type = 'checkbox';
    env.document.body.appendChild(outside);
    outside.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    assert.equal(saves, 0);

    const inside = env.document.getElementById('fmg-inc-desc');
    inside.checked = false;
    inside.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    assert.equal(saves, 1);
    assert.equal(env.fmg('settings.includeDescription'), false);
});

test('事件：生成中点停止不会把输入框里的新内容发出去', async () => {
    const env = await openWithCharacter();
    const { document, fmg, window } = env;
    let release;
    window.__fetchHandler = async (url, options) => {
        if (!url.endsWith('/chat/completions')) return null;
        return {
            ok: true,
            body: {
                getReader: () => ({
                    read: () => new Promise((resolve, reject) => {
                        release = resolve;
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

    document.getElementById('fmg-discuss-input').value = '第一条';
    document.getElementById('fmg-discuss-send').click();
    await flush();
    assert.equal(fmg('isDiscussGenerating'), true);

    document.getElementById('fmg-discuss-input').value = '还没写完';
    document.getElementById('fmg-discuss-send').click();
    await flush();
    assert.equal(fmg('isDiscussGenerating'), false);
    assert.equal(document.getElementById('fmg-discuss-input').value, '还没写完');
    assert.equal(fmg("discussMessages.filter(m => m.role === 'user').length"), 1);
});

test('事件：输入法组字时按回车不发送', async () => {
    const env = await openWithCharacter();
    streamReply(env, '好的');
    const input = env.document.getElementById('fmg-discuss-input');
    input.value = 'pinyin';
    input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
    await flush();
    assert.equal(env.fmg('discussMessages.length'), 0);

    input.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush(50);
    assert.equal(env.fmg("discussMessages.filter(m => m.role === 'assistant').length"), 1);
});
