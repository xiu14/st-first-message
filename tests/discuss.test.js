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
    assert.match(document.querySelector('.fmg-chat-apply-all-bar').textContent, /已全部处理/);
});

const activeTab = (document) => document.querySelector('.fmg-tab.active').dataset.tab;
const sessionCards = (document) => Array.from(document.querySelectorAll('#fmg-session-list .fmg-discuss-session-card'));

test('会话页：列出当前角色的会话，新建后回到讨论页，进入所选能恢复', async () => {
    const { document, fmg } = await openWithCharacter();
    fmg(`discussMessages = [createChatMessage('user', '问题一'), createChatMessage('assistant', '回答一')]; saveChatSession();`);
    const firstId = fmg('currentDiscussSessionId');

    document.querySelector('.fmg-tab[data-tab="sessions"]').click();
    assert.equal(sessionCards(document).length, 1);
    assert.ok(sessionCards(document)[0].classList.contains('active'), '当前会话高亮');
    assert.match(sessionCards(document)[0].textContent, /问题一[\s\S]*回答一[\s\S]*2 条消息/);
    assert.equal(document.getElementById('fmg-session-count').textContent, '1/10');

    document.getElementById('fmg-session-new').click();
    assert.equal(activeTab(document), 'discuss');
    assert.equal(fmg('discussMessages.length'), 0);
    assert.equal(fmg('getCurrentChatSessionRecords().length'), 1);

    document.querySelector('.fmg-tab[data-tab="sessions"]').click();
    assert.ok(!sessionCards(document)[0].classList.contains('active'), '新建后旧会话不再是当前会话');
    document.querySelector(`.fmg-session-open[data-session-id="${firstId}"]`).click();
    assert.equal(activeTab(document), 'discuss');
    assert.equal(fmg('currentDiscussSessionId'), firstId);
    assert.match(document.getElementById('fmg-chat-messages').textContent, /回答一/);
});

test('会话页：删除前确认，取消时不删', async () => {
    const { document, fmg, window } = await openWithCharacter();
    fmg(`discussMessages = [createChatMessage('user', '要删的'), createChatMessage('assistant', '回答')]; saveChatSession();`);
    document.querySelector('.fmg-tab[data-tab="sessions"]').click();

    window.confirm = () => false;
    document.querySelector('.fmg-session-delete').click();
    assert.equal(fmg('getCurrentChatSessionRecords().length'), 1);

    window.confirm = () => true;
    document.querySelector('.fmg-session-delete').click();
    assert.equal(fmg('getCurrentChatSessionRecords().length'), 0);
    assert.match(document.getElementById('fmg-session-list').textContent, /暂无讨论会话/);
    assert.equal(document.getElementById('fmg-session-count').textContent, '0/10');
});

test('会话页：每个角色最多保留 10 个，超出时去掉最旧的', async () => {
    const { fmg } = await openWithCharacter();
    for (let i = 1; i <= 11; i++) {
        fmg(`clearDiscussion(); discussMessages = [createChatMessage('user', '问${i}'), createChatMessage('assistant', '答${i}')]; saveChatSession();`);
    }
    const titles = Array.from(fmg('getCurrentChatSessionRecords().map(r => r.title)'));
    assert.equal(titles.length, 10);
    assert.equal(titles[0], '问11');
    assert.ok(!titles.includes('问1'), '最旧的会话被去掉');
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
    fmg(`settings.discussSessionHistory = Array.from({ length: 210 }, (_, i) => ({ id: 'o' + i, charKey: 'other' + i + '.png', charName: 'B', updatedAt: i, messages: [] }));`);
    fmg(`discussMessages = [createChatMessage('user', 'q'), createChatMessage('assistant', 'r')]; saveChatSession();`);
    const history = fmg('settings.discussSessionHistory');
    assert.equal(fmg('CHAT_SESSION_TOTAL_LIMIT'), 200);
    assert.equal(history.length, 200);
    assert.ok(history.some(r => r.id === 'o209'), '保留最近更新的其他角色会话');
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

    env.fmg(`settings.apiProfiles = [{ id: 'p1', name: '方案一', apiType: 'openai', apiUrl: 'http://x', apiKey: '', model: 'm', models: ['m'] }]; renderApiProfileSelect();`);
    const inside = env.document.getElementById('fmg-api-profile');
    inside.value = 'p1';
    inside.dispatchEvent(new env.window.Event('change', { bubbles: true }));
    assert.equal(saves, 1);
    assert.equal(env.fmg('settings.activeApiProfileId'), 'p1');
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

test('卡片的应用/忽略状态在重新渲染和切换会话后保留', async () => {
    const env = await openWithCharacter();
    const { document, fmg } = env;
    const content = [
        '[EDIT:description]新描述[/EDIT]',
        wbBlock({ operation: 'create', comment: '条目一', keys: ['k1'], content: '内容一' }),
        wbBlock({ operation: 'create', comment: '条目二', keys: ['k2'], content: '内容二' })
    ].join('\n');
    fmg(`discussMessages = [createChatMessage('user', '问'), createChatMessage('assistant', ${JSON.stringify(content)})]; saveChatSession(); renderDiscussionHistory();`);
    const sessionId = fmg('currentDiscussSessionId');

    document.querySelector('.fmg-edit-apply').click();
    await flush(30);
    document.querySelectorAll('.fmg-worldbook-card')[1].querySelector('.fmg-worldbook-ignore').click();

    fmg('renderDiscussionHistory()');
    const cards = () => Array.from(document.querySelectorAll('[data-card-index]'));
    assert.deepEqual(cards().map(c => c.className.match(/applied|ignored/)?.[0] || 'pending'), ['applied', 'pending', 'ignored']);

    // 切到新会话再切回来
    fmg('startNewChatSession()');
    assert.equal(cards().length, 0);
    fmg(`loadChatSession('${sessionId}')`);
    assert.deepEqual(cards().map(c => c.className.match(/applied|ignored/)?.[0] || 'pending'), ['applied', 'pending', 'ignored']);
    assert.match(document.querySelector('.fmg-chat-apply-all-bar').textContent, /全部应用/);

    // 剩下的一张也处理掉后，全部应用栏显示已全部处理
    document.querySelectorAll('.fmg-worldbook-card')[0].querySelector('.fmg-worldbook-apply').click();
    await flush(50);
    fmg('renderDiscussionHistory()');
    assert.match(document.querySelector('.fmg-chat-apply-all-bar').textContent, /已全部处理/);
    assert.equal(document.querySelector('.fmg-chat-apply-all'), null);
});

test('旧会话里的开场白大纲块按原文显示，之后卡片的已应用状态不错位', async () => {
    const { document, fmg } = await openWithCharacter();
    const plan = '[FIRST_MESSAGE_PLAN]\n{"title":"大纲","request":"写一个开场白"}\n[/FIRST_MESSAGE_PLAN]';
    const content = `${plan}\n[EDIT:description]新描述[/EDIT]`;
    // 卡片序号 1 是大纲，2 是修改卡片
    fmg(`discussMessages = [createChatMessage('user', '问'), Object.assign(createChatMessage('assistant', ${JSON.stringify(content)}), { cardStates: { 2: 'applied' } })]; renderDiscussionHistory();`);

    assert.match(document.querySelector('.fmg-chat-plain').textContent, /FIRST_MESSAGE_PLAN/);
    const card = document.querySelector('.fmg-edit-card');
    assert.equal(card.dataset.cardIndex, '2');
    assert.ok(card.classList.contains('applied'));
});

test('讨论页提示浮在聊天区上：成功提示自动消失，点击可关闭，加载提示不自动消失', async () => {
    const { document, fmg } = await openWithCharacter();
    const status = document.getElementById('fmg-discuss-status');
    assert.ok(status.parentElement.classList.contains('fmg-chat-messages-wrap'), '提示和聊天区在同一个定位容器里，不占输入框上下的空间');

    fmg(`STATUS_TOAST_DURATION.success = 30; STATUS_TOAST_DURATION.error = 30;`);
    fmg(`showStatus('fmg-discuss-status', 'success', '已进入会话')`);
    assert.equal(status.style.display, 'block');
    assert.ok(status.classList.contains('fmg-status-toast') && status.classList.contains('success'));
    await flush(60);
    assert.equal(status.style.display, 'none', '成功提示自动消失');

    fmg(`showStatus('fmg-discuss-status', 'error', '出错了')`);
    status.click();
    assert.equal(status.style.display, 'none', '点击关闭');

    fmg(`showStatus('fmg-discuss-status', 'loading', '处理中')`);
    await flush(60);
    assert.equal(status.style.display, 'block', '加载提示保持显示');
    // 新提示替换旧提示时重新计时
    fmg(`showStatus('fmg-discuss-status', 'success', '完成')`);
    assert.equal(status.textContent, '完成');
});

test('专注模式：弹窗进入专注状态，讨论页头部的关闭按钮能关闭弹窗', async () => {
    const env = loadExtension();
    const { document } = env;
    document.querySelector('#fmg-wand-container .list-group-item').click();
    await flush(50);
    const popup = document.getElementById('fmg-popup');

    document.getElementById('fmg-discuss-focus-toggle').click();
    assert.ok(popup.classList.contains('fmg-mobile-chat-focus-active'));
    assert.equal(document.getElementById('fmg-discuss-focus-toggle').textContent, '↕ 展开');

    document.getElementById('fmg-discuss-close').click();
    assert.ok(!popup.classList.contains('show'));
});
