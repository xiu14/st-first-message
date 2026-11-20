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

    assert.match(env.document.querySelector('#fmg-popup .fmg-header h3').textContent, /角色卡编辑器/);
    const tabs = Array.from(env.document.querySelectorAll('.fmg-tab')).map(tab => tab.dataset.tab);
    assert.deepEqual(tabs, ['discuss', 'sessions', 'api']);
    assert.ok(env.document.querySelector('.fmg-tab-content[data-tab="discuss"]').classList.contains('active'), '默认打开讨论页');
    for (const tab of env.document.querySelectorAll('.fmg-tab')) {
        tab.click();
        const content = env.document.querySelector(`.fmg-tab-content[data-tab="${tab.dataset.tab}"]`);
        assert.ok(content.classList.contains('active'), `${tab.dataset.tab} 标签页已激活`);
    }

    env.document.getElementById('fmg-discuss-wi-open').click();
    assert.ok(env.document.getElementById('fmg-selection-modal'));
    env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(env.document.getElementById('fmg-selection-modal'), null, 'ESC 先关闭条目选择弹窗');
    env.document.dispatchEvent(new env.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.ok(!env.document.getElementById('fmg-popup').classList.contains('show'), '再按 ESC 关闭主弹窗');

    assert.deepEqual(errors, []);
});

test('加载设置时清理旧版本遗留数据', () => {
    const env = loadExtension({
        extensionSettings: {
            'first-message-generator': {
                worldbookSessionHistory: [{ id: 'x' }],
                discussSessionHistory: [],
                // 已移除的生成页、状态栏页的设置
                includeDescription: false,
                selectedPresetPrompts: ['a'],
                statusBarStyle: 'sms',
                firstMessageHistory: [{ id: 1 }]
            }
        }
    });
    env.window.localStorage.setItem('first_message_generator_settings', '{"apiKey":"old"}');
    env.fmg('loadSettings()');
    assert.equal(env.fmg('settings.worldbookSessionHistory'), undefined);
    for (const key of ['includeDescription', 'selectedPresetPrompts', 'statusBarStyle', 'firstMessageHistory']) {
        assert.equal(env.fmg(`settings.${key}`), undefined, key);
    }
    assert.equal(env.window.localStorage.getItem('first_message_generator_settings'), null);
});
