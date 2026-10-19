const test = require('node:test');
const assert = require('node:assert/strict');
const { loadExtension, flush } = require('./harness');

test('打开弹窗、切换所有标签页、ESC 关闭都不报错', async () => {
    const env = loadExtension();
    const errors = [];
    env.window.console.error = (...args) => errors.push(args);
    env.window.addEventListener('error', (e) => errors.push([e.message]));

    const menuItem = env.document.querySelector('#fmg-wand-container .list-group-item');
    assert.ok(menuItem, '扩展菜单按钮已创建');
    menuItem.click();
    await flush(50);
    assert.ok(env.document.getElementById('fmg-popup').classList.contains('show'));

    const tabs = Array.from(env.document.querySelectorAll('.fmg-tab')).map(tab => tab.dataset.tab);
    assert.deepEqual(tabs, ['generate', 'discuss', 'statusbar', 'api']);
    for (const tab of env.document.querySelectorAll('.fmg-tab')) {
        tab.click();
        const content = env.document.querySelector(`.fmg-tab-content[data-tab="${tab.dataset.tab}"]`);
        assert.ok(content.classList.contains('active'), `${tab.dataset.tab} 标签页已激活`);
    }

    env.document.getElementById('fmg-discuss-session-open').click();
    assert.ok(env.document.getElementById('fmg-chat-session-modal'));
    env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(env.document.getElementById('fmg-chat-session-modal'), null, 'ESC 先关闭会话弹窗');
    env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!env.document.getElementById('fmg-popup').classList.contains('show'), '再按 ESC 关闭主弹窗');

    assert.deepEqual(errors, []);
});

test('加载设置时清理旧版本遗留数据', () => {
    const env = loadExtension({
        extensionSettings: {
            'first-message-generator': { worldbookSessionHistory: [{ id: 'x' }], discussSessionHistory: [] }
        }
    });
    env.window.localStorage.setItem('first_message_generator_settings', '{"apiKey":"old"}');
    env.fmg('loadSettings()');
    assert.equal(env.fmg('settings.worldbookSessionHistory'), undefined);
    assert.equal(env.window.localStorage.getItem('first_message_generator_settings'), null);
});
