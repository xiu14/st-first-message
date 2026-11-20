/**
 * 角色卡编辑器 - SillyTavern Extension
 * 功能：和 AI 讨论角色卡与世界书，把修改建议直接应用到角色卡和世界书
 * （EXTENSION_NAME 等标识沿用开场白生成器时期的名字，保证已有设置和会话可用）
 */

(function () {
    'use strict';

    const EXTENSION_NAME = 'first-message-generator';
    const SETTINGS_KEY = 'first_message_generator_settings';

    // 默认设置
    const DEFAULT_SETTINGS = {
        apiType: 'openai',
        apiUrl: '',
        apiKey: '',
        model: 'gpt-4o-mini',
        models: [],
        temperature: 0.8,
        maxTokens: null,
        // API 配置方案（可保存多套并切换）
        apiProfiles: [],
        activeApiProfileId: '',
        // 世界书条目选择
        selectedWorldEntries: [],
        worldInfoSelectionsByScope: {},
        worldInfoSelectionInitializedByScope: {},
        // 讨论会话（每个角色最多10个，所有角色合计最多200个）
        discussSessionHistory: []
    };

    // 已移除功能留下的设置，加载时清掉：生成页、状态栏页、更早的提示词模板、
    // 独立世界书页的会话（worldbookSessionHistory）和最早版本的讨论记录（discussionHistory）
    const REMOVED_SETTING_KEYS = [
        'includeDescription', 'includePersonality', 'includeScenario', 'includeCurrentFirstMes',
        'includePresetPrompts', 'selectedPresetPrompts', 'firstMessageHistory', 'statusBarStyle',
        'customPromptTemplates', 'worldbookSessionHistory', 'discussionHistory'
    ];
    // 加载时发现了旧键，初始化完成后保存一次，让清理真正写回 settings.json
    let settingsNeedCleanup = false;

    let settings = { ...DEFAULT_SETTINGS };
    let currentWorldInfoSelectionScope = 'global';

    // 可编辑字段标签映射
    const FIELD_LABELS = {
        description: '描述',
        personality: '性格',
        scenario: '场景',
        first_mes: '开场白',
        mes_example: '对话示例',
        system_prompt: '系统提示词',
        post_history_instructions: '越权提示词',
        creator_notes: '创作者备注',
        alternate_greetings: '可选开场白',
        tags: '标签',
        creator: '创作者',
        character_version: '版本',
        spec: '规格',
        spec_version: '规格版本',
        extensions: '扩展数据',
        depth_prompt: '深度提示词',
        'extensions.depth_prompt': '深度提示词',
        talkativeness: '对话积极性',
        'extensions.talkativeness': '对话积极性'
    };

    // 字段名到 _fmgCharData 缓存键的映射
    const FIELD_TO_CACHE_KEY = {
        description: 'desc',
        personality: 'pers',
        scenario: 'scen',
        first_mes: 'first',
        mes_example: 'mes_example',
        system_prompt: 'system_prompt',
        post_history_instructions: 'post_history_instructions',
        creator_notes: 'creator_notes',
        alternate_greetings: 'alternate_greetings',
        tags: 'tags',
        creator: 'creator',
        character_version: 'character_version',
        spec: 'spec',
        spec_version: 'spec_version',
        extensions: 'extensions',
        depth_prompt: 'depth_prompt',
        'extensions.depth_prompt': 'depth_prompt',
        talkativeness: 'talkativeness',
        'extensions.talkativeness': 'talkativeness'
    };

    const EDIT_FIELD_ALIASES = {
        desc: 'description',
        pers: 'personality',
        scen: 'scenario',
        first: 'first_mes',
        creatorcomment: 'creator_notes',
        depth_prompt: 'extensions.depth_prompt',
        talkativeness: 'extensions.talkativeness'
    };

    // data 字段在 ST 角色对象顶层的对应属性（ST 的角色编辑面板读这些属性）
    const TOP_LEVEL_CHARACTER_FIELDS = {
        description: 'description',
        personality: 'personality',
        scenario: 'scenario',
        first_mes: 'first_mes',
        mes_example: 'mes_example',
        creator_notes: 'creatorcomment',
        tags: 'tags',
        'extensions.talkativeness': 'talkativeness'
    };

    const WORLDBOOK_POSITIONS = {
        before: 0,
        after: 1,
        authorNoteBefore: 2,
        authorNoteAfter: 3,
        atDepth: 4,
        exampleBefore: 5,
        exampleAfter: 6,
        outlet: 7
    };

    const WORLDBOOK_DEPTH_ROLES = {
        system: 0,
        user: 1,
        assistant: 2
    };

    // ========================================
    // 初始化
    // ========================================

    async function init() {
        console.log('[开场白生成器] 初始化中...');

        loadSettings();
        await loadHistoryStore();
        // 放在读取历史文件之后：这时才知道会话该写进文件还是 settings
        if (settingsNeedCleanup) {
            settingsNeedCleanup = false;
            saveSettings();
        }
        createUI();
        bindEvents();

        console.log('[开场白生成器] 初始化完成');
    }

    // ========================================
    // 设置管理
    // ========================================

    function loadSettings() {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (context && context.extensionSettings && context.extensionSettings[EXTENSION_NAME]) {
                settings = { ...DEFAULT_SETTINGS, ...context.extensionSettings[EXTENSION_NAME] };
                console.log('[开场白生成器] 从 extensionSettings 加载设置');
                normalizeLoadedSettings();
                // 旧版本会在 localStorage 另存一份完整设置（含 API Key），已迁移后不再需要
                localStorage.removeItem(SETTINGS_KEY);
                return;
            }

            // 仅用于从旧版本迁移：读一次 localStorage，之后只存 extensionSettings
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
                console.log('[开场白生成器] 从 localStorage 迁移设置');
                normalizeLoadedSettings();
                saveSettings();
            }
        } catch (e) {
            console.error('[开场白生成器] 加载设置失败:', e);
        }
    }

    function normalizeLoadedSettings() {
        migrateApiProfiles();
        REMOVED_SETTING_KEYS.forEach(key => {
            if (!Object.hasOwn(settings, key)) return;
            delete settings[key];
            settingsNeedCleanup = true;
        });
    }

    // ========================================
    // API 配置方案管理
    // ========================================

    function generateProfileId() {
        return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function getApiProfiles() {
        if (!Array.isArray(settings.apiProfiles)) settings.apiProfiles = [];
        return settings.apiProfiles;
    }

    function getActiveApiProfile() {
        return getApiProfiles().find(p => p.id === settings.activeApiProfileId) || null;
    }

    function buildProfileName(apiType, apiUrl, model) {
        let host = '';
        try {
            host = new URL(apiUrl).hostname;
        } catch (e) {
            host = (apiUrl || '').replace(/^https?:\/\//, '').split('/')[0];
        }
        const parts = [host || (apiType === 'gemini' ? 'Gemini' : 'OpenAI'), model].filter(Boolean);
        return parts.join(' / ');
    }

    // 旧版本只有一套扁平配置，首次加载时把它迁移为一个方案
    function migrateApiProfiles() {
        const profiles = getApiProfiles();
        if (profiles.length === 0 && (settings.apiUrl || settings.apiKey)) {
            const profile = {
                id: generateProfileId(),
                name: buildProfileName(settings.apiType, settings.apiUrl, settings.model) || '默认配置',
                apiType: settings.apiType || 'openai',
                apiUrl: settings.apiUrl || '',
                apiKey: settings.apiKey || '',
                model: settings.model || '',
                models: Array.isArray(settings.models) ? [...settings.models] : [],
                temperature: normalizeTemperature(settings.temperature),
                maxTokens: normalizeMaxTokens(settings.maxTokens)
            };
            profiles.push(profile);
            settings.activeApiProfileId = profile.id;
            console.log('[开场白生成器] 已将旧版 API 配置迁移为方案:', profile.name);
        }
        if (profiles.length > 0 && !getActiveApiProfile()) {
            settings.activeApiProfileId = profiles[0].id;
        }
    }

    // 把方案内容灌回扁平字段，其余调用 API 的代码无需改动
    function applyApiProfile(profile) {
        if (!profile) return;
        settings.activeApiProfileId = profile.id;
        settings.apiType = profile.apiType || 'openai';
        settings.apiUrl = profile.apiUrl || '';
        settings.apiKey = profile.apiKey || '';
        settings.model = profile.model || '';
        settings.models = Array.isArray(profile.models) ? [...profile.models] : [];
        settings.temperature = normalizeTemperature(profile.temperature);
        settings.maxTokens = normalizeMaxTokens(profile.maxTokens);
    }

    function normalizeTemperature(value) {
        const num = Number(value);
        if (value === '' || value === null || value === undefined || !Number.isFinite(num)) {
            return DEFAULT_SETTINGS.temperature;
        }
        return Math.min(2, Math.max(0, num));
    }

    // 留空或非正数表示不限制，请求里不发送该参数
    function normalizeMaxTokens(value) {
        const num = Math.floor(Number(value));
        return value !== '' && value !== null && Number.isFinite(num) && num > 0 ? num : null;
    }

    async function saveSettings() {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (context && context.extensionSettings) {
                // 历史文件可用时，讨论会话不再写进 settings.json
                const { discussSessionHistory, ...rest } = settings;
                context.extensionSettings[EXTENSION_NAME] = historyFileReady ? rest : { ...settings };
                if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                }
            }
            if (historyFileReady) scheduleHistorySave();
        } catch (e) {
            console.error('[开场白生成器] 保存设置失败:', e);
        }
    }

    // ========================================
    // 历史记录文件（data/<用户>/user/files 下）
    // ========================================

    // settings.json 每次保存都会整个重写，大块的会话记录单独存一个文件
    const HISTORY_FILE_NAME = 'first-message-generator-history.json';
    const HISTORY_SAVE_DELAY = 500;
    // 读取历史文件成功后才写文件；读不到时退回存在 settings 里，避免用不完整的数据覆盖文件
    let historyFileReady = false;
    let lastSavedHistoryJson = null;
    let historySaveTimer = null;
    let historySaveChain = Promise.resolve();

    function getStRequestHeaders() {
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        return typeof context?.getRequestHeaders === 'function'
            ? context.getRequestHeaders()
            : { 'Content-Type': 'application/json' };
    }

    function serializeHistory(discussSessionHistory = settings.discussSessionHistory) {
        return JSON.stringify({
            version: 1,
            discussSessionHistory: Array.isArray(discussSessionHistory) ? discussSessionHistory : []
        });
    }

    function encodeBase64Utf8(text) {
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
    }

    async function readHistoryFile() {
        const response = await fetch(`/user/files/${HISTORY_FILE_NAME}`, {
            headers: getStRequestHeaders(),
            cache: 'no-cache'
        });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`读取历史文件失败 (${response.status})`);
        return await response.json();
    }

    async function writeHistoryFile(json) {
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: getStRequestHeaders(),
            body: JSON.stringify({ name: HISTORY_FILE_NAME, data: encodeBase64Utf8(json) })
        });
        if (!response.ok) throw new Error(`保存历史文件失败 (${response.status})`);
    }

    // 同一 id 保留更新时间较新的那条
    function mergeHistoryRecords(primary, secondary, getTime) {
        const byId = new Map();
        [...(primary || []), ...(secondary || [])].forEach(record => {
            if (!record) return;
            const existing = byId.get(record.id);
            if (!existing || getTime(record) > getTime(existing)) byId.set(record.id, record);
        });
        return [...byId.values()].sort((a, b) => getTime(b) - getTime(a));
    }

    // 启动时读取历史文件；第一次运行时把 settings 里的旧记录迁移过去，回读确认后才从 settings 删掉
    async function loadHistoryStore() {
        const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
        const storedSettings = context?.extensionSettings?.[EXTENSION_NAME] || {};
        const hasLegacy = Object.hasOwn(storedSettings, 'discussSessionHistory');

        try {
            const stored = await readHistoryFile();
            if (stored) {
                const storedSessions = Array.isArray(stored.discussSessionHistory) ? stored.discussSessionHistory : [];
                // settings 里还有旧记录（上次迁移后没来得及清理，或文件曾不可用）时合并，避免丢记录
                settings.discussSessionHistory = hasLegacy
                    ? mergeHistoryRecords(storedSessions, settings.discussSessionHistory, record => record.updatedAt || 0)
                    : storedSessions;
                // 用文件原内容比较：文件里还留着已移除的开场白历史时，会重写一次把它去掉
                lastSavedHistoryJson = JSON.stringify(stored);
            }

            const json = serializeHistory();
            if (json !== lastSavedHistoryJson) {
                await writeHistoryFile(json);
                const written = await readHistoryFile();
                if (!written || JSON.stringify(written) !== json) {
                    throw new Error('历史文件回读内容不一致');
                }
                lastSavedHistoryJson = json;
            }

            historyFileReady = true;
            if (hasLegacy) {
                saveSettings();
                console.log('[开场白生成器] 讨论会话已迁移到', `user/files/${HISTORY_FILE_NAME}`);
            }
        } catch (e) {
            console.warn('[开场白生成器] 历史记录文件不可用，继续存在 settings 里:', e);
        }
    }

    function scheduleHistorySave() {
        clearTimeout(historySaveTimer);
        historySaveTimer = setTimeout(() => {
            historySaveChain = historySaveChain.then(saveHistoryNow);
        }, HISTORY_SAVE_DELAY);
    }

    async function saveHistoryNow() {
        if (!historyFileReady) return;
        const json = serializeHistory();
        if (json === lastSavedHistoryJson) return;
        try {
            await writeHistoryFile(json);
            lastSavedHistoryJson = json;
        } catch (e) {
            // 写不进文件时退回存在 settings 里，至少不丢记录
            console.error('[开场白生成器] 保存历史记录文件失败，改存到 settings:', e);
            historyFileReady = false;
            saveSettings();
            if (typeof toastr !== 'undefined') toastr.warning('历史记录文件保存失败，已临时改存到设置里');
        }
    }

    // ========================================
    // UI创建
    // ========================================

    function createUI() {
        createMenuButton();
        createPopup();
    }

    function createMenuButton() {
        const extensionsMenu = document.getElementById('extensionsMenu');
        if (!extensionsMenu) {
            console.warn('[开场白生成器] 未找到扩展菜单，延迟重试...');
            setTimeout(createMenuButton, 1000);
            return;
        }

        if (document.getElementById('fmg-wand-container')) return;

        const container = document.createElement('div');
        container.id = 'fmg-wand-container';
        container.className = 'extension_container interactable';
        container.setAttribute('tabindex', '0');

        const menuItem = document.createElement('div');
        menuItem.className = 'list-group-item flex-container flexGap5 interactable';
        menuItem.setAttribute('tabindex', '0');
        menuItem.setAttribute('role', 'listitem');
        menuItem.title = '角色卡编辑器';

        const icon = document.createElement('div');
        icon.className = 'fa-fw fa-solid fa-message extensionsMenuExtensionButton';

        const text = document.createElement('span');
        text.textContent = '角色卡编辑器';

        menuItem.appendChild(icon);
        menuItem.appendChild(text);
        container.appendChild(menuItem);
        extensionsMenu.appendChild(container);

        menuItem.addEventListener('click', openPopup);
    }

    function createPopup() {
        if (document.getElementById('fmg-popup')) return;

        const overlay = document.createElement('div');
        overlay.id = 'fmg-overlay';
        document.body.appendChild(overlay);

        const popup = document.createElement('div');
        popup.id = 'fmg-popup';
        popup.innerHTML = `
            <div class="fmg-header">
                <h3>💬 角色卡编辑器</h3>
                <button class="fmg-close-btn">×</button>
            </div>
            
            <div class="fmg-tabs">
                <button class="fmg-tab active" data-tab="discuss">讨论/世界书</button>
                <button class="fmg-tab" data-tab="sessions">会话</button>
                <button class="fmg-tab" data-tab="api">API</button>
            </div>
            
            <div class="fmg-content">
                <!-- 讨论页 -->
                <div class="fmg-tab-content active" data-tab="discuss">
                    <div class="fmg-discuss-container">
                        <div class="fmg-chat-header">
                            <span class="fmg-chat-char-info" id="fmg-discuss-char-name">未选择角色</span>
                            <div class="fmg-btn-group">
                                <button class="fmg-btn-small" id="fmg-discuss-focus-toggle" title="切换聊天专注模式">↕ 专注聊天</button>
                                <button class="fmg-btn-small" id="fmg-discuss-refresh" title="刷新角色数据">🔄 刷新</button>
                                <button class="fmg-btn-small" id="fmg-discuss-undo" title="撤回上一轮并恢复到输入框" disabled>↩ 撤回上一轮</button>
                                <button class="fmg-btn-small fmg-btn-danger-small" id="fmg-discuss-clear" title="清空对话">🗑️ 清空</button>
                                <span class="fmg-token-badge" id="fmg-discuss-token-total" title="估算当前讨论会话发送内容的总 token">总Token --</span>
                            </div>
                            <button class="fmg-btn-small fmg-focus-close" id="fmg-discuss-close" title="关闭角色卡编辑器">✕</button>
                        </div>

                        <!-- 角色卡完整内容折叠预览 -->
                        <div class="fmg-discuss-info-panel fmg-discuss-focus-hidden" id="fmg-discuss-info-panel">
                            <div class="fmg-collapse-section">
                                <div class="fmg-collapse-header" data-target="fmg-collapse-fullcard">
                                    <span>📋 角色卡完整内容</span>
                                    <span class="fmg-collapse-arrow">▶</span>
                                </div>
                                <div class="fmg-collapse-body" id="fmg-collapse-fullcard">
                                    <div class="fmg-collapse-content" id="fmg-discuss-fullcard" style="white-space: pre-wrap;">暂无数据</div>
                                </div>
                            </div>
                            
                            <!-- 世界书选择 -->
                            <div class="fmg-discuss-wi-bar">
                                <span>📚 世界书</span>
                                <div class="fmg-btn-group">
                                    <span class="fmg-count" id="fmg-discuss-wi-count">0/0</span>
                                    <button class="fmg-btn-small fmg-btn-open" id="fmg-discuss-wi-open">选择条目</button>
                                </div>
                            </div>
                        </div>
                        
                        <!-- 提示浮在聊天区底部，不占布局高度 -->
                        <div class="fmg-chat-messages-wrap">
                            <div class="fmg-chat-messages" id="fmg-chat-messages">
                                <div class="fmg-chat-welcome">
                                    <div class="fmg-chat-welcome-icon">💬</div>
                                    <div>选择角色后，可以在这里讨论角色卡和世界书设定</div>
                                    <div style="font-size:11px;color:#888;margin-top:4px;">需要沉淀设定时，直接要求 AI 输出世界书条目即可一键添加</div>
                                </div>
                            </div>
                            <div id="fmg-discuss-status" class="fmg-status fmg-status-toast" style="display: none;" title="点击关闭"></div>
                        </div>
                        <div class="fmg-chat-input-area">
                            <textarea id="fmg-discuss-input" class="fmg-chat-input" placeholder="输入消息讨论角色卡、修改字段，或要求 AI 输出世界书条目..." rows="2"></textarea>
                            <button class="fmg-btn fmg-btn-primary fmg-chat-send" id="fmg-discuss-send">发送</button>
                        </div>
                    </div>
                </div>

                <!-- 会话页 -->
                <div class="fmg-tab-content" data-tab="sessions">
                    <div class="fmg-chat-header">
                        <span class="fmg-chat-char-info" id="fmg-session-char-name">未选择角色</span>
                        <div class="fmg-btn-group">
                            <span class="fmg-count" id="fmg-session-count">0/${CHAT_SESSION_HISTORY_LIMIT}</span>
                            <button class="fmg-btn-small fmg-btn-open" id="fmg-session-new" title="开始一个空白会话，当前会话仍保留在列表里">＋ 新建会话</button>
                        </div>
                    </div>
                    <div class="fmg-session-list" id="fmg-session-list"></div>
                </div>

                <!-- API设置页 -->
                <div class="fmg-tab-content" data-tab="api">
                    <div class="fmg-form-group">
                        <label>配置方案</label>
                        <div class="fmg-form-row">
                            <select id="fmg-api-profile">
                                <option value="">（新建配置）</option>
                            </select>
                            <button class="fmg-btn fmg-btn-secondary" id="fmg-api-profile-new" title="清空表单，填写新配置">➕ 新建</button>
                            <button class="fmg-btn fmg-btn-danger" id="fmg-api-profile-delete" title="删除当前方案">🗑 删除</button>
                        </div>
                    </div>

                    <div class="fmg-form-group">
                        <label>方案名称（留空则自动命名）</label>
                        <input type="text" id="fmg-api-profile-name" placeholder="例如：中转站 / 官方 Gemini">
                    </div>

                    <div class="fmg-form-group">
                        <label>API类型</label>
                        <select id="fmg-api-type">
                            <option value="openai">OpenAI 格式</option>
                            <option value="gemini">Gemini 格式</option>
                        </select>
                    </div>
                    
                    <div class="fmg-form-group">
                        <label>API URL</label>
                        <input type="text" id="fmg-api-url" placeholder="https://api.openai.com/v1">
                    </div>
                    
                    <div class="fmg-form-group">
                        <label>API Key（本地模型可留空）</label>
                        <input type="password" id="fmg-api-key" placeholder="sk-...">
                    </div>
                    
                    <div class="fmg-form-group">
                        <label>模型</label>
                        <div class="fmg-form-row">
                            <select id="fmg-model">
                                <option value="">请先获取模型列表</option>
                            </select>
                            <button class="fmg-btn fmg-btn-secondary" id="fmg-get-models">获取</button>
                        </div>
                    </div>

                    <div class="fmg-form-group">
                        <label>温度（0~2，越高越发散）</label>
                        <input type="number" id="fmg-api-temperature" min="0" max="2" step="0.1" placeholder="0.8">
                    </div>

                    <div class="fmg-form-group">
                        <label>最大输出 token（留空不限制）</label>
                        <input type="number" id="fmg-api-max-tokens" min="1" step="1" placeholder="不限制">
                    </div>
                    
                    <div class="fmg-actions">
                        <button class="fmg-btn fmg-btn-secondary" id="fmg-test">🔌 测试</button>
                        <button class="fmg-btn fmg-btn-primary" id="fmg-save-api">💾 保存</button>
                    </div>
                    
                    <div id="fmg-api-status" class="fmg-status" style="display: none;"></div>
                </div>
            </div>
        `;

        document.body.appendChild(popup);
        loadSettingsToForm();
    }

    function loadSettingsToForm() {
        renderApiProfileSelect();
        fillApiForm({
            name: getActiveApiProfile()?.name || '',
            apiType: settings.apiType,
            apiUrl: settings.apiUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            models: settings.models,
            temperature: settings.temperature,
            maxTokens: settings.maxTokens
        });
    }

    function renderApiProfileSelect() {
        const select = document.getElementById('fmg-api-profile');
        if (!select) return;
        const profiles = getApiProfiles();
        select.innerHTML = '<option value="">（新建配置）</option>' + profiles.map(p =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || '未命名')}</option>`
        ).join('');
        select.value = getActiveApiProfile() ? settings.activeApiProfileId : '';

        const deleteBtn = document.getElementById('fmg-api-profile-delete');
        if (deleteBtn) deleteBtn.style.display = getActiveApiProfile() ? '' : 'none';
    }

    function fillApiForm(data) {
        document.getElementById('fmg-api-profile-name').value = data.name || '';
        document.getElementById('fmg-api-type').value = data.apiType || 'openai';
        document.getElementById('fmg-api-url').value = data.apiUrl || '';
        document.getElementById('fmg-api-key').value = data.apiKey || '';
        document.getElementById('fmg-api-temperature').value = String(normalizeTemperature(data.temperature));
        document.getElementById('fmg-api-max-tokens').value = normalizeMaxTokens(data.maxTokens) ?? '';

        const modelSelect = document.getElementById('fmg-model');
        modelSelect.innerHTML = '';
        if (data.models && data.models.length > 0) {
            data.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                modelSelect.appendChild(opt);
            });
            modelSelect.value = data.model || '';
        } else {
            modelSelect.innerHTML = '<option value="">请先获取模型列表</option>';
        }
    }

    // 切换方案：立即应用为当前生效配置
    function switchApiProfile(profileId) {
        if (!profileId) {
            // 选择“新建配置”：清空表单，但不改变当前生效的配置
            fillApiForm({ apiType: 'openai', apiUrl: '', apiKey: '', model: '', models: [] });
            const deleteBtn = document.getElementById('fmg-api-profile-delete');
            if (deleteBtn) deleteBtn.style.display = 'none';
            showStatus('fmg-api-status', 'success', '请填写新配置后点击保存');
            return;
        }
        const profile = getApiProfiles().find(p => p.id === profileId);
        if (!profile) return;
        applyApiProfile(profile);
        saveSettings();
        renderApiProfileSelect();
        fillApiForm(profile);
        showStatus('fmg-api-status', 'success', `已切换到「${profile.name}」`);
    }

    function newApiProfile() {
        const select = document.getElementById('fmg-api-profile');
        if (select) select.value = '';
        switchApiProfile('');
    }

    function deleteApiProfile() {
        const profile = getActiveApiProfile();
        if (!profile) return;
        if (!confirm(`确定删除方案「${profile.name}」？`)) return;

        const profiles = getApiProfiles();
        const idx = profiles.findIndex(p => p.id === profile.id);
        if (idx >= 0) profiles.splice(idx, 1);

        const next = profiles[idx] || profiles[idx - 1] || null;
        if (next) {
            applyApiProfile(next);
        } else {
            settings.activeApiProfileId = '';
            settings.apiType = 'openai';
            settings.apiUrl = '';
            settings.apiKey = '';
            settings.model = '';
            settings.models = [];
            settings.temperature = DEFAULT_SETTINGS.temperature;
            settings.maxTokens = null;
        }
        saveSettings();
        loadSettingsToForm();
        showStatus('fmg-api-status', 'success', `已删除「${profile.name}」` + (next ? `，当前使用「${next.name}」` : ''));
    }

    // ========================================
    // 事件绑定
    // ========================================

    // 只处理插件自己界面内的事件，避免 ST 页面上任何操作都触发保存或 token 统计
    const FMG_EVENT_SCOPE = '#fmg-popup, #fmg-overlay';

    function toggleCollapse(header, body) {
        if (!body) return;
        const isOpen = body.classList.toggle('open');
        const arrow = header.querySelector('.fmg-collapse-arrow');
        if (arrow) arrow.textContent = isOpen ? '▼' : '▶';
    }

    function isTouchDevice() {
        return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    }

    // 按元素 id 分发的点击操作
    const CLICK_ACTIONS = {
        'fmg-overlay': () => closePopup(),
        'fmg-discuss-close': () => closePopup(),
        'fmg-test': () => testConnection(),
        'fmg-get-models': () => getModels(),
        'fmg-save-api': () => saveApiSettings(),
        'fmg-api-profile-new': () => newApiProfile(),
        'fmg-api-profile-delete': () => deleteApiProfile(),
        // 发送按钮在生成中充当停止按钮
        'fmg-discuss-send': () => (isDiscussGenerating ? stopDiscussGeneration() : sendDiscussMessage()),
        'fmg-discuss-undo': () => undoLastDiscussRound(),
        'fmg-discuss-clear': () => clearDiscussion(),
        'fmg-discuss-refresh': () => loadCharacterData(),
        'fmg-discuss-focus-toggle': () => setDiscussFocusMode(!discussFocusMode),
        'fmg-discuss-wi-open': () => openSelectionModal(),
        'fmg-session-new': () => {
            if (startNewChatSession()) switchTab('discuss');
        }
    };

    // 按选择器分发的点击操作（按顺序匹配第一个）
    const DELEGATED_CLICK_ACTIONS = [
        ['.fmg-tab', (el) => switchTab(el.dataset.tab)],
        ['#fmg-popup .fmg-close-btn', () => closePopup()],
        ['.fmg-session-open', (el) => {
            if (!loadChatSession(el.dataset.sessionId)) return;
            // 渲染时讨论页还隐藏着，滚动不生效；切过去之后再滚到底部
            switchTab('discuss');
            scrollDiscussToBottom();
        }],
        ['.fmg-session-delete', (el) => {
            const record = getChatSessionHistory().find(item => item.id === el.dataset.sessionId);
            if (!record || !confirm(`确定删除会话「${record.title || '未命名会话'}」？`)) return;
            deleteChatSession(record.id);
        }],
        ['.fmg-edit-apply', (el) => {
            const editData = window._fmgPendingEdits?.[el.dataset.editKey];
            if (!editData) return;
            el.disabled = true;
            el.textContent = '⏳ 应用中...';
            applyCharacterEdit(editData.field, editData.content, el, { patches: editData.patches });
        }],
        ['.fmg-chat-apply-all', (el) => applyAllDiscussCards(el)],
        ['.fmg-worldbook-apply', (el) => {
            const entryData = window._fmgPendingWorldbookEntries?.[el.dataset.entryKey];
            if (!entryData) return;
            el.disabled = true;
            el.textContent = '⏳ 添加中...';
            applyWorldbookEntry(entryData, el);
        }],
        ['.fmg-edit-ignore, .fmg-worldbook-ignore', (el) => {
            setCardState(el.closest('.fmg-edit-card, .fmg-worldbook-card'), 'ignored');
        }],
        ['.fmg-status-toast', (el) => hideStatus(el.id)],
        ['.fmg-edit-card-old .fmg-edit-card-label', (el) => toggleCollapse(el, el.nextElementSibling)],
        ['.fmg-collapse-header', (el) => toggleCollapse(el, document.getElementById(el.dataset.target))]
    ];

    function handleClick(e) {
        if (!e.target.closest(FMG_EVENT_SCOPE)) return;

        const idTarget = e.target.closest('[id]');
        const idAction = idTarget && CLICK_ACTIONS[idTarget.id];
        if (idAction) {
            if (!idTarget.disabled) idAction(idTarget);
            return;
        }

        for (const [selector, action] of DELEGATED_CLICK_ACTIONS) {
            const el = e.target.closest(selector);
            if (el) {
                if (!el.disabled) action(el);
                return;
            }
        }
    }

    function handleChange(e) {
        const target = e.target;
        if (!target.closest(FMG_EVENT_SCOPE)) return;

        if (target.id === 'fmg-api-profile') {
            switchApiProfile(target.value);
            return;
        }

        if (target.classList.contains('fmg-worldbook-position-select')) {
            handleWorldbookCardPositionChange(target);
        } else if (target.classList.contains('fmg-worldbook-state-input')) {
            handleWorldbookCardStateChange(target);
        }
    }

    function handleInput(e) {
        const target = e.target;
        if (!target.closest(FMG_EVENT_SCOPE)) return;

        if (target.id === 'fmg-discuss-input') {
            requestDiscussTokenCountUpdate(120);
        } else if (target.classList.contains('fmg-worldbook-order-input')) {
            handleWorldbookCardOrderInput(target);
        }
    }

    function handleKeydown(e) {
        if (e.key === 'Escape') {
            handleEscape();
            return;
        }

        // 输入法组字时的回车用于上屏，不发送；触屏设备上回车换行，用按钮发送
        if (e.target.id === 'fmg-discuss-input' && e.key === 'Enter' && !e.shiftKey
            && !e.isComposing && e.keyCode !== 229 && !isTouchDevice()) {
            e.preventDefault();
            if (!isDiscussGenerating) sendDiscussMessage();
        }
    }

    // ESC 优先关闭顶层弹窗，最后关闭主弹窗
    function handleEscape() {
        const selectModal = document.getElementById('fmg-selection-modal');
        if (selectModal) {
            selectModal.remove();
            return;
        }

        if (document.getElementById('fmg-popup')?.classList.contains('show')) {
            closePopup();
        }
    }

    function handleWorldbookCardPositionChange(positionSelect) {
        const entryData = window._fmgPendingWorldbookEntries?.[positionSelect.dataset.entryKey];
        if (!entryData) return;

        const nextPosition = normalizeWorldbookPosition(positionSelect.value);
        entryData.position = nextPosition;

        if (nextPosition === WORLDBOOK_POSITIONS.atDepth) {
            entryData.depth = Number.isFinite(Number(entryData.depth)) ? Number(entryData.depth) : 4;
            const selectedOption = positionSelect.options[positionSelect.selectedIndex];
            const selectedRole = normalizeWorldbookRole(selectedOption?.dataset?.role);
            entryData.role = Number.isFinite(Number(selectedRole))
                ? Number(selectedRole)
                : WORLDBOOK_DEPTH_ROLES.system;
        } else if (nextPosition !== WORLDBOOK_POSITIONS.outlet) {
            entryData.role = null;
        }

        const valueEl = positionSelect.closest('.fmg-worldbook-card')?.querySelector('.fmg-worldbook-position-value');
        if (valueEl) {
            valueEl.textContent = getWorldbookPositionLabel(nextPosition, entryData.role, entryData.outlet_name);
        }
    }

    function handleWorldbookCardStateChange(stateInput) {
        const entryData = window._fmgPendingWorldbookEntries?.[stateInput.dataset.entryKey];
        if (!entryData) return;

        entryData.constant = stateInput.dataset.state === 'constant';
        entryData.vectorized = false;
        entryData.selective = entryData.constant ? false : entryData.selective !== false;

        const card = stateInput.closest('.fmg-worldbook-card');
        if (card) {
            card.querySelectorAll('.fmg-worldbook-state-input').forEach(input => {
                input.checked = input === stateInput;
            });

            const triggerEl = card.querySelector('.fmg-worldbook-trigger-value');
            if (triggerEl) {
                triggerEl.textContent = entryData.constant ? '常驻条目' : '关键词触发';
            }
        }
    }

    function handleWorldbookCardOrderInput(orderInput) {
        const entryData = window._fmgPendingWorldbookEntries?.[orderInput.dataset.entryKey];
        if (!entryData) return;

        const isBlank = orderInput.value.trim() === '';
        const nextOrder = !isBlank && Number.isFinite(Number(orderInput.value)) ? Number(orderInput.value) : 100;
        const keepOriginal = isBlank && entryData.keep_placement;
        entryData.insertion_order = keepOriginal ? null : nextOrder;

        const valueEl = orderInput.closest('.fmg-worldbook-card')?.querySelector('.fmg-worldbook-order-value');
        if (valueEl) {
            valueEl.textContent = keepOriginal ? '保持原设置' : String(nextOrder);
        }
    }

    function bindEvents() {
        const discussContainer = document.getElementById('fmg-chat-messages');
        if (discussContainer) {
            discussContainer.addEventListener('scroll', () => {
                discussAutoScroll = isDiscussNearBottom(discussContainer);
            });
        }

        document.addEventListener('click', handleClick);
        document.addEventListener('change', handleChange);
        document.addEventListener('input', handleInput);
        document.addEventListener('keydown', handleKeydown);
    }

    // ========================================
    // 弹窗控制
    // ========================================

    function openPopup() {
        document.getElementById('fmg-overlay').classList.add('show');
        document.getElementById('fmg-popup').classList.add('show');
        updatePopupFocusState();
        loadCharacterData();
    }

    function closePopup() {
        document.getElementById('fmg-overlay').classList.remove('show');
        document.getElementById('fmg-popup').classList.remove('show');
        
        // 同时清理可能正在打开的子弹窗
        const selectModal = document.getElementById('fmg-selection-modal');
        if (selectModal) selectModal.remove();
    }

    function switchTab(tabName) {
        document.querySelectorAll('.fmg-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.fmg-tab-content').forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tabName);
        });
        updatePopupFocusState(tabName);
        renderChatSessionControls();
    }

    function updatePopupFocusState(activeTabName = null) {
        const popup = document.getElementById('fmg-popup');
        if (!popup) return;

        const activeTab = activeTabName
            || document.querySelector('.fmg-tab.active')?.dataset?.tab
            || '';
        const isFocusedChatTab = activeTab === 'discuss' && discussFocusMode;

        popup.classList.toggle('fmg-mobile-chat-focus-active', isFocusedChatTab);
    }

    // ========================================
    // 数据加载
    // ========================================

    async function loadCharacterData() {
        try {
            const context = SillyTavern.getContext();

            if (context.characterId !== undefined && context.characters[context.characterId]) {
                const char = context.characters[context.characterId];

                const desc = char.description || char.data?.description;
                const pers = char.personality || char.data?.personality;
                const scen = char.scenario || char.data?.scenario;
                const first = char.first_mes || char.data?.first_mes;

                // 缓存角色数据（包含全部字段）
                const d = char.data || {};
                window._fmgCharData = {
                    name: char.name,
                    avatar: char.avatar || '',
                    desc, pers, scen, first,
                    mes_example: d.mes_example || char.mes_example || '',
                    system_prompt: d.system_prompt || '',
                    post_history_instructions: d.post_history_instructions || '',
                    creator_notes: d.creator_notes || '',
                    creator: d.creator || '',
                    character_version: d.character_version || '',
                    tags: d.tags || char.tags || [],
                    alternate_greetings: d.alternate_greetings || [],
                    extensions: d.extensions || {},
                    talkativeness: d.extensions?.talkativeness || '',
                    depth_prompt: d.extensions?.depth_prompt || null,
                    fav: char.fav || false,
                    spec: d.spec || '',
                    spec_version: d.spec_version || '',
                    _raw: d
                };
                resetChatSessionsForCharacter(getCharacterKey(window._fmgCharData));

            } else {
                window._fmgCharData = null;
                resetChatSessionsForCharacter(null);
            }

            // 加载世界书条目
            await loadWorldInfoList(context);

            // 更新讨论页面板
            updateDiscussPanel();
        } catch (e) {
            console.error('[开场白生成器] 加载数据失败:', e);
            showStatus('fmg-discuss-status', 'error', '加载数据失败: ' + e.message);
        }
    }

    async function syncWorldInfoDisplay(worldName, worldData) {
        try {
            if (!worldName || !worldData) return;

            if (typeof window.worldInfoCache !== 'undefined' && typeof window.worldInfoCache.set === 'function') {
                window.worldInfoCache.set(worldName, worldData);
            }

            if (typeof $ !== 'undefined') {
                const editorSelect = $('#world_editor_select');
                if (editorSelect.length > 0) {
                    const selectedText = String(editorSelect.find(':selected').text() || '').trim();
                    if (selectedText === worldName) {
                        editorSelect.trigger('change');
                    }
                }
            }

            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            const eventType = context?.eventTypes?.WORLDINFO_SETTINGS_UPDATED;
            if (eventType && context?.eventSource?.emit) {
                await context.eventSource.emit(eventType);
            }
        } catch (error) {
            console.warn('[开场白生成器] 同步世界书显示失败:', error);
        }
    }

    async function loadWorldInfoList(context, forceRefresh = true) {
        window._fmgWorldEntries = [];
        currentWorldInfoSelectionScope = 'global';

        try {
            let entries = [];

            // 获取外部关联的世界书
            if (context.characters && context.characterId !== undefined) {
                const char = context.characters[context.characterId];
                const worldName = char?.data?.extensions?.world;

                if (worldName) {
                    currentWorldInfoSelectionScope = `world:${worldName}`;

                    try {
                        const headers = typeof context.getRequestHeaders === 'function'
                            ? context.getRequestHeaders()
                            : { 'Content-Type': 'application/json' };

                        const response = await fetch('/api/worldinfo/get', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ name: worldName })
                        });

                        if (response.ok) {
                            const worldData = await response.json();
                            entries = extractEntriesFromWorldData(worldData);

                            if (forceRefresh && typeof window.worldInfoCache !== 'undefined') {
                                window.worldInfoCache.set(worldName, worldData);
                            }
                        } else {
                            console.warn('[开场白生成器] API返回错误:', response.status);
                            if (typeof window.worldInfoCache !== 'undefined' && window.worldInfoCache.has(worldName)) {
                                const worldData = window.worldInfoCache.get(worldName);
                                entries = extractEntriesFromWorldData(worldData);
                            }
                        }
                    } catch (e) {
                        console.warn('[开场白生成器] 加载外部世界书失败:', e);
                        if (typeof window.worldInfoCache !== 'undefined' && window.worldInfoCache.has(worldName)) {
                            const worldData = window.worldInfoCache.get(worldName);
                            entries = extractEntriesFromWorldData(worldData);
                        }
                    }
                }

                // 如果外部世界书为空，尝试从角色卡内嵌的character_book获取
                if (entries.length === 0) {
                    currentWorldInfoSelectionScope = `character:${char?.avatar || char?.name || context.characterId}`;
                    entries = getCharacterBookEntries(context);
                }
            }


            window._fmgWorldEntries = entries;

            if (!settings.worldInfoSelectionInitializedByScope?.[getCurrentWorldInfoSelectionScope()]
                && !hasAnyScopedWorldInfoSelection()
                && Array.isArray(settings.selectedWorldEntries)
                && settings.selectedWorldEntries.length > 0) {
                setSavedWorldInfoSelections(settings.selectedWorldEntries);
                saveSettings();
            }

            // 如果没有保存的选择，初始化为启用的条目
            if (!hasInitializedWorldInfoSelection()) {
                const defaultSelections = [];
                entries.forEach((entry, idx) => {
                    if (entry.enabled !== false) {
                        const identifier = getWorldInfoIdentifier(entry, idx);
                        defaultSelections.push(identifier);
                    }
                });
                setSavedWorldInfoSelections(defaultSelections);
                saveSettings();
            }

            // 更新计数
            updateCounts();

        } catch (e) {
            console.error('[开场白生成器] 加载世界书失败:', e);
        }
    }

    function getCharacterBookEntries(context) {
        const entries = [];

        if (context.characters && context.characterId !== undefined) {
            const char = context.characters[context.characterId];

            // 尝试多种访问路径
            let book = null;

            if (char?.data?.character_book) {
                book = char.data.character_book;
            } else if (char?.character_book) {
                book = char.character_book;
            }

            if (book && book.entries) {
                const bookEntries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries);

                for (const entry of bookEntries) {
                    if (entry.content) {
                        entries.push({
                            uid: Number.isFinite(Number(entry.uid ?? entry.id)) ? Number(entry.uid ?? entry.id) : null,
                            name: entry.comment || entry.name || entry.keys?.[0] || '未命名',
                            comment: entry.comment || entry.name || entry.keys?.[0] || '未命名',
                            key: Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : [],
                            keysecondary: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
                            content: entry.content || '',
                            constant: entry.constant || false,
                            enabled: entry.enabled !== false && entry.disable !== true,
                            position: entry.position || null
                        });
                    }
                }
            }
        }

        return entries;
    }

    function extractEntriesFromWorldData(worldData) {
        const entries = [];

        if (!worldData || !worldData.entries) {
            return entries;
        }

        const rawEntries = Array.isArray(worldData.entries) ? worldData.entries : Object.values(worldData.entries);

        for (const entry of rawEntries) {
            if (entry.content) {
                entries.push({
                    uid: Number.isFinite(Number(entry.uid ?? entry.id)) ? Number(entry.uid ?? entry.id) : null,
                    name: entry.comment || entry.name || entry.key?.[0] || entry.keys?.[0] || '未命名',
                    comment: entry.comment || entry.name || entry.key?.[0] || entry.keys?.[0] || '未命名',
                    key: Array.isArray(entry.key) ? entry.key : Array.isArray(entry.keys) ? entry.keys : [],
                    keysecondary: Array.isArray(entry.keysecondary) ? entry.keysecondary : Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
                    content: entry.content || '',
                    constant: entry.constant || false,
                    enabled: entry.enabled !== false && entry.disable !== true,
                    position: entry.position ?? null,
                    depth: Number.isFinite(Number(entry.depth)) ? Number(entry.depth) : null,
                    role: entry.role !== null && Number.isFinite(Number(entry.role)) ? Number(entry.role) : null,
                    order: Number.isFinite(Number(entry.order ?? entry.insertion_order)) ? Number(entry.order ?? entry.insertion_order) : null,
                    outletName: String(entry.outletName || entry.outlet_name || '')
                });
            }
        }

        return entries;
    }

    function getCurrentWorldInfoSelectionScope() {
        return currentWorldInfoSelectionScope || 'global';
    }

    function ensureWorldInfoSelectionStorage() {
        if (!settings.worldInfoSelectionsByScope || typeof settings.worldInfoSelectionsByScope !== 'object') {
            settings.worldInfoSelectionsByScope = {};
        }
        if (!settings.worldInfoSelectionInitializedByScope || typeof settings.worldInfoSelectionInitializedByScope !== 'object') {
            settings.worldInfoSelectionInitializedByScope = {};
        }
    }

    function hasAnyScopedWorldInfoSelection() {
        ensureWorldInfoSelectionStorage();
        return Object.values(settings.worldInfoSelectionInitializedByScope).some(value => value === true);
    }

    function getSavedWorldInfoSelections(scope = getCurrentWorldInfoSelectionScope()) {
        ensureWorldInfoSelectionStorage();
        if (settings.worldInfoSelectionInitializedByScope[scope] === true) {
            return Array.isArray(settings.worldInfoSelectionsByScope[scope])
                ? settings.worldInfoSelectionsByScope[scope]
                : [];
        }
        if (hasAnyScopedWorldInfoSelection()) {
            return [];
        }
        return Array.isArray(settings.selectedWorldEntries) ? settings.selectedWorldEntries : [];
    }

    function hasInitializedWorldInfoSelection(scope = getCurrentWorldInfoSelectionScope()) {
        ensureWorldInfoSelectionStorage();
        return settings.worldInfoSelectionInitializedByScope[scope] === true
            || (!hasAnyScopedWorldInfoSelection()
                && Array.isArray(settings.selectedWorldEntries)
                && settings.selectedWorldEntries.length > 0);
    }

    function setSavedWorldInfoSelections(selectedIdentifiers, scope = getCurrentWorldInfoSelectionScope()) {
        ensureWorldInfoSelectionStorage();
        const normalizedSelections = Array.from(new Set((selectedIdentifiers || []).filter(Boolean)));
        settings.worldInfoSelectionsByScope[scope] = normalizedSelections;
        settings.worldInfoSelectionInitializedByScope[scope] = true;
        settings.selectedWorldEntries = normalizedSelections;
    }

    function getWorldInfoIdentifier(entry, idx = 0) {
        const numericUid = Number(entry?.uid);
        if (Number.isFinite(numericUid)) {
            return `uid:${numericUid}`;
        }

        const fallbackName = entry?.comment || entry?.name || entry?.key?.[0] || entry?.keys?.[0] || `wi_${idx}`;
        return `name:${String(fallbackName)}`;
    }

    function getLegacyWorldInfoIdentifiers(entry, idx = 0) {
        const identifiers = new Set();
        identifiers.add(entry?.name || `wi_${idx}`);

        if (entry?.comment) identifiers.add(entry.comment);
        if (entry?.name) identifiers.add(entry.name);

        const primaryKey = Array.isArray(entry?.key)
            ? entry.key[0]
            : Array.isArray(entry?.keys)
                ? entry.keys[0]
                : null;
        if (primaryKey) identifiers.add(primaryKey);

        return Array.from(identifiers).filter(Boolean);
    }

    function isWorldInfoEntrySelected(entry, idx, selectedIdentifiers) {
        const identifiers = [getWorldInfoIdentifier(entry, idx), ...getLegacyWorldInfoIdentifiers(entry, idx)];
        return identifiers.some(identifier => selectedIdentifiers.includes(identifier));
    }

    function getSelectedWorldInfo() {
        const entries = window._fmgWorldEntries || [];
        const savedSelections = getSavedWorldInfoSelections();
        const selected = [];

        // 使用保存的选择
        entries.forEach((entry, idx) => {
            if (isWorldInfoEntrySelected(entry, idx, savedSelections)) {
                selected.push(entry);
            }
        });

        return selected;
    }

    function formatSelectedWorldInfoForUpdate(entries) {
        if (!entries || entries.length === 0) {
            return '（当前没有选中的世界书条目，所以如果要更新旧条目，你需要先在本页选择条目后再让 AI 更新）';
        }

        return entries.map((entry, index) => {
            const title = entry.comment || entry.name || `条目${index + 1}`;
            const uidText = entry.uid !== null && entry.uid !== undefined ? String(entry.uid) : '无可用UID';
            const keysText = Array.isArray(entry.key) && entry.key.length > 0 ? entry.key.join(', ') : '（无）';
            const secondaryText = Array.isArray(entry.keysecondary) && entry.keysecondary.length > 0 ? entry.keysecondary.join(', ') : '（无）';
            const contentPreview = String(entry.content || '').trim() || '（空）';

            return [
                `### ${title}`,
                `UID: ${uidText}`,
                `主关键词: ${keysText}`,
                `次关键词: ${secondaryText}`,
                `触发方式: ${entry.constant ? '常驻（蓝灯）' : '关键词触发（绿灯）'}`,
                `插入位置: ${formatWorldInfoPlacement(entry)}`,
                `插入顺序: ${entry.order ?? '未知'}`,
                `内容: ${contentPreview}`
            ].join('\n');
        }).join('\n\n');
    }

    function formatWorldInfoPlacement(entry) {
        const position = normalizeWorldbookPosition(entry.position);
        if (position === null) return '未知';

        const details = [`position=${getWorldbookPositionKey(position)}`];
        if (position === WORLDBOOK_POSITIONS.atDepth) {
            details.push(`depth=${entry.depth ?? 4}`, `role=${getWorldbookRoleLabel(entry.role)}`);
        } else if (position === WORLDBOOK_POSITIONS.outlet && entry.outletName) {
            details.push(`outlet_name=${entry.outletName}`);
        }
        return `${getWorldbookPositionLabel(position, entry.role, entry.outletName)}（${details.join(', ')}）`;
    }

    function updateCounts() {
        updateDiscussWiCount();
    }

    function renderSelectionItem(entry, index, savedSelections) {
        const name = entry.name || `条目${index + 1}`;
        const identifier = getWorldInfoIdentifier(entry, index);
        const isChecked = isWorldInfoEntrySelected(entry, index, savedSelections);

        const badges = [entry.constant ? '<span class="fmg-badge">常驻</span>' : '<span class="fmg-badge fmg-badge-green">绿灯</span>'];
        if (entry.enabled === false) badges.push('<span class="fmg-badge-off">禁用</span>');

        // 搜索文本：名称、关键词和内容
        const searchText = [name, ...(entry.key || []), entry.content || ''].join('\n').toLowerCase();

        return `
            <div class="fmg-select-item" data-search="${escapeHtml(searchText)}">
                <label>
                    <input type="checkbox" class="fmg-select-cb" data-identifier="${escapeHtml(identifier)}" ${isChecked ? 'checked' : ''}>
                    <span class="fmg-select-name">${escapeHtml(name)}</span>
                    ${badges.join('')}
                </label>
            </div>
        `;
    }

    // 只读复用 ST-Grouping 插件的世界书分组（extensionSettings.worldinfo_groups），没有分组时返回 null
    function getWorldInfoGroupSections(entries) {
        const scope = getCurrentWorldInfoSelectionScope();
        if (!scope.startsWith('world:')) return null;

        const worldName = scope.slice('world:'.length);
        const extensionSettings = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext()?.extensionSettings : null;
        const worldbook = extensionSettings?.worldinfo_groups?.worldbooks?.[worldName];
        const groups = worldbook?.groups;
        if (!groups || typeof groups !== 'object') return null;

        const orderedIds = (order, map) => [...(Array.isArray(order) ? order : []), ...Object.keys(map)]
            .filter((id, i, ids) => map[id] && ids.indexOf(id) === i);

        const indexByUid = new Map();
        entries.forEach((entry, index) => {
            if (entry.uid !== null) indexByUid.set(Number(entry.uid), index);
        });

        // 每个条目只放进第一个包含它的分组；组内按世界书原顺序排列
        const placed = new Set();
        const take = (uids) => {
            const indexes = [...new Set((Array.isArray(uids) ? uids : []).map(uid => indexByUid.get(Number(uid))))]
                .filter(index => index !== undefined && !placed.has(index))
                .sort((a, b) => a - b);
            indexes.forEach(index => placed.add(index));
            return indexes;
        };

        const sections = orderedIds(worldbook.groupOrder, groups).map(groupId => {
            const group = groups[groupId];
            const subgroups = group.subgroups && typeof group.subgroups === 'object' ? group.subgroups : {};
            return {
                name: group.name || '分组',
                indexes: take(group.entries),
                subgroups: orderedIds(group.subgroupOrder, subgroups)
                    .map(id => ({ name: subgroups[id].name || '子分组', indexes: take(subgroups[id].entries), subgroups: [] }))
                    .filter(subgroup => subgroup.indexes.length > 0)
            };
        }).filter(section => section.indexes.length > 0 || section.subgroups.length > 0);

        if (sections.length === 0) return null;

        const ungrouped = entries.map((_, index) => index).filter(index => !placed.has(index));
        if (ungrouped.length > 0) sections.push({ name: '未分组', indexes: ungrouped, subgroups: [] });
        return sections;
    }

    function renderSelectionGroup(section, renderItem) {
        return `
            <div class="fmg-select-group fmg-collapsed">
                <div class="fmg-select-group-header">
                    <input type="checkbox" class="fmg-select-group-cb" title="勾选或取消本组的全部条目">
                    <span class="fmg-select-group-arrow">▸</span>
                    <span class="fmg-select-group-name">${escapeHtml(section.name)}</span>
                    <span class="fmg-select-group-count"></span>
                </div>
                <div class="fmg-select-group-body">
                    ${section.subgroups.map(subgroup => renderSelectionGroup(subgroup, renderItem)).join('')}
                    ${section.indexes.map(renderItem).join('')}
                </div>
            </div>
        `;
    }

    function openSelectionModal() {
        // 移除已存在的弹窗
        const existing = document.getElementById('fmg-selection-modal');
        if (existing) existing.remove();

        const title = '📚 选择世界书条目';
        const entries = window._fmgWorldEntries || [];
        const savedSelections = getSavedWorldInfoSelections();

        if (entries.length === 0) {
            if (typeof toastr !== 'undefined') {
                toastr.warning('没有可用的条目');
            }
            return;
        }

        const renderItem = (index) => renderSelectionItem(entries[index], index, savedSelections);
        const groupSections = getWorldInfoGroupSections(entries);
        const listHtml = groupSections
            ? groupSections.map(section => renderSelectionGroup(section, renderItem)).join('')
            : entries.map((_, index) => renderItem(index)).join('');

        const modal = document.createElement('div');
        modal.id = 'fmg-selection-modal';
        modal.innerHTML = `
            <div class="fmg-select-overlay"></div>
            <div class="fmg-select-content">
                <div class="fmg-select-header">
                    <h4>${title}</h4>
                    <div class="fmg-btn-group">
                        <button class="fmg-btn-small" id="fmg-select-all" title="勾选当前搜索结果中的全部条目">全选</button>
                        <button class="fmg-btn-small" id="fmg-select-none" title="取消勾选当前搜索结果中的全部条目">清空</button>
                    </div>
                </div>
                <div class="fmg-select-search">
                    <input type="search" id="fmg-select-search" placeholder="搜索名称、关键词或内容">
                </div>
                <div class="fmg-select-body">
                    ${listHtml}
                    <div class="fmg-select-empty" style="display:none;">没有匹配的条目</div>
                </div>
                <div class="fmg-select-footer">
                    <span class="fmg-select-info" id="fmg-select-info">已选择 0 项</span>
                    <div class="fmg-btn-group">
                        <button class="fmg-btn fmg-btn-secondary" id="fmg-select-cancel">取消</button>
                        <button class="fmg-btn fmg-btn-primary" id="fmg-select-confirm">确认</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const items = Array.from(modal.querySelectorAll('.fmg-select-item'));
        const groupEls = Array.from(modal.querySelectorAll('.fmg-select-group'));
        // 搜索结果内的条目（折叠的分组里的也算）
        const visibleCheckboxes = (root = modal) => Array.from(root.querySelectorAll('.fmg-select-item'))
            .filter(item => item.style.display !== 'none')
            .map(item => item.querySelector('.fmg-select-cb'));

        // 更新选中计数和分组勾选状态
        const updateSelectInfo = () => {
            const count = modal.querySelectorAll('.fmg-select-cb:checked').length;
            const infoEl = document.getElementById('fmg-select-info');
            if (infoEl) infoEl.textContent = `已选择 ${count} 项`;

            groupEls.forEach(groupEl => {
                const total = groupEl.querySelectorAll('.fmg-select-cb').length;
                const checked = groupEl.querySelectorAll('.fmg-select-cb:checked').length;
                const groupCb = groupEl.querySelector('.fmg-select-group-cb');
                groupCb.checked = total > 0 && checked === total;
                groupCb.indeterminate = checked > 0 && checked < total;
                groupEl.querySelector('.fmg-select-group-count').textContent = `${checked}/${total}`;
            });
        };
        updateSelectInfo();

        // 绑定事件
        modal.querySelector('.fmg-select-overlay').onclick = () => modal.remove();
        modal.querySelector('#fmg-select-cancel').onclick = () => modal.remove();

        modal.querySelector('#fmg-select-search').oninput = (e) => {
            const terms = e.target.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
            let visibleCount = 0;
            items.forEach(item => {
                const visible = terms.every(term => item.dataset.search.includes(term));
                item.style.display = visible ? '' : 'none';
                if (visible) visibleCount++;
            });
            // 搜索时展开所有分组，并隐藏没有匹配条目的分组
            modal.querySelector('.fmg-select-body').classList.toggle('fmg-searching', terms.length > 0);
            groupEls.forEach(groupEl => {
                groupEl.style.display = terms.length > 0 && visibleCheckboxes(groupEl).length === 0 ? 'none' : '';
            });
            modal.querySelector('.fmg-select-empty').style.display = visibleCount === 0 ? '' : 'none';
        };

        groupEls.forEach(groupEl => {
            const groupCb = groupEl.querySelector('.fmg-select-group-cb');
            groupCb.onchange = () => {
                visibleCheckboxes(groupEl).forEach(cb => cb.checked = groupCb.checked);
                updateSelectInfo();
            };
            groupEl.querySelector('.fmg-select-group-header').onclick = (e) => {
                if (e.target === groupCb) return;
                groupEl.classList.toggle('fmg-collapsed');
            };
        });

        modal.querySelector('#fmg-select-all').onclick = () => {
            visibleCheckboxes().forEach(cb => cb.checked = true);
            updateSelectInfo();
        };

        modal.querySelector('#fmg-select-none').onclick = () => {
            visibleCheckboxes().forEach(cb => cb.checked = false);
            updateSelectInfo();
        };

        modal.querySelectorAll('.fmg-select-cb').forEach(cb => {
            cb.onchange = updateSelectInfo;
        });

        modal.querySelector('#fmg-select-confirm').onclick = () => {
            const selectedIdentifiers = [];
            modal.querySelectorAll('.fmg-select-cb:checked').forEach(cb => {
                selectedIdentifiers.push(cb.dataset.identifier);
            });

            setSavedWorldInfoSelections(selectedIdentifiers);
            saveSettings();
            updateCounts();
            modal.remove();
            requestDiscussTokenCountUpdate();
        };
    }

    // ========================================
    // 角色卡讨论 - 多轮对话
    // ========================================

    // 讨论对话历史
    // 每个角色保留最近 10 个会话；所有角色合计超过 200 个时删掉最旧的，避免历史文件无限增长
    const CHAT_SESSION_HISTORY_LIMIT = 10;
    const CHAT_SESSION_TOTAL_LIMIT = 200;
    let discussMessages = [];
    let chatMessageIdCounter = 0;
    let discussFocusMode = false;
    let discussTokenUpdateTimer = null;
    let discussTokenUpdateVersion = 0;
    let discussAbortController = null;
    let isDiscussGenerating = false;
    let discussAutoScroll = true;
    let currentDiscussSessionId = null;
    let currentChatSessionCharacterKey = null;

    function isDiscussNearBottom(container) {
        if (!container) return true;
        const threshold = 24;
        return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
    }

    function scrollDiscussToBottom() {
        const container = document.getElementById('fmg-chat-messages');
        discussAutoScroll = true;
        if (container) container.scrollTop = container.scrollHeight;
    }

    function createChatMessage(role, content) {
        chatMessageIdCounter += 1;
        return {
            id: `chat_${chatMessageIdCounter}`,
            role,
            content
        };
    }

    function ensureChatMessageIds(messages) {
        messages.forEach(message => {
            if (!message || message.role === 'system' || message.id) return;
            chatMessageIdCounter += 1;
            message.id = `chat_${chatMessageIdCounter}`;
        });
    }

    // 用头像文件名区分角色（同名角色不会串会话），取不到时退回角色名
    function getCharacterKey(charData = window._fmgCharData) {
        return charData ? (charData.avatar || charData.name || null) : null;
    }

    function resetChatSessionsForCharacter(charKey) {
        const normalizedKey = charKey || null;
        if (currentChatSessionCharacterKey === normalizedKey) return;

        currentChatSessionCharacterKey = normalizedKey;
        currentDiscussSessionId = null;
        discussMessages = [];
        renderDiscussionHistory();
        renderChatSessionControls();
    }

    function getVisibleChatSessionMessages(messages) {
        return (messages || [])
            .filter(message => message && message.role !== 'system' && String(message.content || '').trim())
            .map(message => ({
                id: message.id || '',
                role: message.role,
                content: String(message.content || ''),
                ...(message.cardStates ? { cardStates: { ...message.cardStates } } : {})
            }));
    }

    function getChatSessionHistory() {
        if (!Array.isArray(settings.discussSessionHistory)) {
            settings.discussSessionHistory = [];
        }
        return settings.discussSessionHistory;
    }

    // 旧记录只有 charName，按名字匹配；保存时会补上 charKey
    function isSessionOfCharacter(record, charData = window._fmgCharData) {
        if (!record || !charData) return false;
        return record.charKey ? record.charKey === getCharacterKey(charData) : record.charName === charData.name;
    }

    function getCurrentChatSessionRecords() {
        return getChatSessionHistory()
            .filter(record => isSessionOfCharacter(record))
            .slice(0, CHAT_SESSION_HISTORY_LIMIT);
    }

    function createChatSessionId() {
        return `discuss_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function getChatSessionPreview(messages, role) {
        const preferred = [...messages].reverse().find(message => message.role === role && String(message.content || '').trim());
        const fallback = messages.find(message => String(message.content || '').trim());
        return String((preferred || fallback)?.content || '').trim();
    }

    function clipText(text, maxLength) {
        const value = String(text || '').replace(/\s+/g, ' ').trim();
        return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;
    }

    function saveChatSession() {
        const charData = window._fmgCharData;
        if (!charData) return;

        const messages = getVisibleChatSessionMessages(discussMessages);
        const hasUser = messages.some(message => message.role === 'user');
        const hasAssistant = messages.some(message => message.role === 'assistant');

        if (!hasUser || !hasAssistant) {
            if (currentDiscussSessionId && messages.length === 0) {
                deleteChatSession(currentDiscussSessionId, true);
                currentDiscussSessionId = null;
            }
            renderChatSessionControls();
            return;
        }

        const id = currentDiscussSessionId || createChatSessionId();
        const firstUserText = getChatSessionPreview(messages, 'user');
        const lastAssistantText = getChatSessionPreview(messages, 'assistant');
        const now = new Date();
        const record = {
            id,
            charKey: getCharacterKey(charData),
            charName: charData.name,
            title: clipText(firstUserText, 32) || '未命名会话',
            preview: clipText(lastAssistantText, 72) || clipText(firstUserText, 72),
            messageCount: messages.length,
            timestamp: now.toLocaleString('zh-CN'),
            updatedAt: now.getTime(),
            messages
        };

        const history = getChatSessionHistory();
        const otherCharacters = history.filter(item => !isSessionOfCharacter(item, charData));
        const sameCharacter = history.filter(item => isSessionOfCharacter(item, charData) && item.id !== id);
        const keptSame = [record, ...sameCharacter].slice(0, CHAT_SESSION_HISTORY_LIMIT);
        // 其他角色的会话按更新时间保留最近的，避免历史文件无限增长
        const keptOthers = otherCharacters
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
            .slice(0, Math.max(0, CHAT_SESSION_TOTAL_LIMIT - keptSame.length));

        settings.discussSessionHistory = keptSame.concat(keptOthers);
        currentDiscussSessionId = id;
        saveSettings();
        renderChatSessionControls();
    }

    // 会话标签页：列出当前角色的会话，当前会话高亮
    function renderChatSessionControls() {
        const charData = window._fmgCharData;
        const sessions = charData ? getCurrentChatSessionRecords() : [];

        const nameEl = document.getElementById('fmg-session-char-name');
        if (nameEl) {
            nameEl.textContent = charData ? `🎭 ${charData.name || '未命名角色'}` : '未选择角色';
            nameEl.classList.toggle('active', !!charData);
        }
        const countEl = document.getElementById('fmg-session-count');
        if (countEl) countEl.textContent = `${sessions.length}/${CHAT_SESSION_HISTORY_LIMIT}`;
        const newBtn = document.getElementById('fmg-session-new');
        if (newBtn) newBtn.disabled = !charData;

        const list = document.getElementById('fmg-session-list');
        if (!list) return;

        if (!charData) {
            list.innerHTML = '<div class="fmg-discuss-history-empty">请先在 ST 里选择一个角色</div>';
            return;
        }
        if (sessions.length === 0) {
            list.innerHTML = '<div class="fmg-discuss-history-empty">暂无讨论会话，在讨论页聊过之后会自动保存在这里</div>';
            return;
        }

        list.innerHTML = sessions.map(record => {
            const isCurrent = record.id === currentDiscussSessionId;
            return `
                <div class="fmg-discuss-session-card${isCurrent ? ' active' : ''}" data-session-id="${escapeHtml(record.id)}">
                    <div class="fmg-discuss-session-header">
                        <span class="fmg-discuss-session-title">${escapeHtml(record.title || '未命名会话')}</span>
                        ${isCurrent ? '<span class="fmg-session-current-badge">当前</span>' : ''}
                    </div>
                    <div class="fmg-discuss-session-preview">${escapeHtml(record.preview || '')}</div>
                    <div class="fmg-session-footer">
                        <span class="fmg-discuss-session-meta">${escapeHtml(record.timestamp || '')} · ${escapeHtml(String(record.messageCount || 0))} 条消息</span>
                        <div class="fmg-btn-group">
                            <button class="fmg-btn-small fmg-btn-danger-small fmg-session-delete" data-session-id="${escapeHtml(record.id)}">删除</button>
                            <button class="fmg-btn-small fmg-btn-open fmg-session-open" data-session-id="${escapeHtml(record.id)}">${isCurrent ? '回到讨论' : '进入'}</button>
                        </div>
                    </div>
                </div>
            `.trim();
        }).join('');
    }

    function deleteChatSession(sessionId, silent = false) {
        if (!sessionId) return;

        settings.discussSessionHistory = getChatSessionHistory().filter(record => record.id !== sessionId);
        if (currentDiscussSessionId === sessionId) {
            currentDiscussSessionId = null;
        }

        saveSettings();
        renderChatSessionControls();
        if (!silent && typeof toastr !== 'undefined') {
            toastr.info('会话已删除');
        }
    }

    function isDiscussBusy() {
        return isDiscussGenerating;
    }

    // 返回是否进入成功
    function loadChatSession(sessionId) {
        if (isDiscussBusy()) {
            if (typeof toastr !== 'undefined') toastr.warning('请先等待当前回复生成完，再切换会话');
            showStatus('fmg-discuss-status', 'error', '请先等待当前操作完成，再进入历史会话');
            return false;
        }

        const record = getChatSessionHistory().find(item => item.id === sessionId);
        if (!record) return false;
        if (record.id === currentDiscussSessionId) return true;

        const messages = getVisibleChatSessionMessages(record.messages);
        ensureChatMessageIds(messages);

        discussMessages = messages;
        syncDiscussSystemPrompt();
        currentDiscussSessionId = record.id;
        renderDiscussionHistory();
        updateDiscussPanel();
        renderChatSessionControls();
        showStatus('fmg-discuss-status', 'success', '已进入会话');
        return true;
    }

    function startNewChatSession() {
        if (isDiscussBusy()) {
            if (typeof toastr !== 'undefined') toastr.warning('请先等待当前回复生成完，再新建会话');
            showStatus('fmg-discuss-status', 'error', '请先等待当前操作完成，再新建会话');
            return false;
        }

        // 清空只重置当前会话，已保存的记录仍保留在会话页
        saveChatSession();
        clearDiscussion();
        showStatus('fmg-discuss-status', 'success', '已新建会话，之前的会话仍可在「会话」页进入');
        return true;
    }

    function getDiscussWelcomeHtml() {
        return `
            <div class="fmg-chat-welcome">
                <div class="fmg-chat-welcome-icon">💬</div>
                <div>选择角色后，可以在这里讨论角色卡和世界书设定</div>
                <div style="font-size:11px;color:#888;margin-top:4px;">需要沉淀设定时，直接要求 AI 输出世界书条目即可一键添加</div>
            </div>
        `;
    }

    function renderDiscussionHistory() {
        const container = document.getElementById('fmg-chat-messages');
        if (!container) return;

        ensureChatMessageIds(discussMessages);
        const visibleMessages = discussMessages.filter(msg => msg.role !== 'system');

        window._fmgPendingEdits = {};
        window._fmgPendingWorldbookEntries = {};
        _editIdCounter = 0;
        _worldbookEntryIdCounter = 0;
        container.innerHTML = '';

        if (visibleMessages.length === 0) {
            container.innerHTML = getDiscussWelcomeHtml();
            discussAutoScroll = true;
            updateDiscussUndoButton();
            requestDiscussTokenCountUpdate();
            return;
        }

        visibleMessages.forEach(msg => appendChatMessage(msg.role, msg.content, false, msg.id));
        scrollDiscussToBottom();
        updateDiscussUndoButton();
        requestDiscussTokenCountUpdate();
    }

    function updateDiscussUndoButton() {
        const undoBtn = document.getElementById('fmg-discuss-undo');
        if (!undoBtn) return;

        const hasUndoableRound = discussMessages.some(msg => msg.role === 'user');
        undoBtn.disabled = isDiscussGenerating || !hasUndoableRound;
    }

    function syncDiscussSystemPrompt() {
        const systemPrompt = buildDiscussSystemPrompt();
        discussMessages = discussMessages.filter(msg => msg.role !== 'system');

        if (systemPrompt) {
            discussMessages.unshift({ role: 'system', content: systemPrompt });
        }
    }

    function setDiscussFocusMode(enabled) {
        discussFocusMode = enabled === true;

        const container = document.querySelector('.fmg-discuss-container');
        if (container) {
            container.classList.toggle('chat-focused', discussFocusMode);
        }

        const toggleBtn = document.getElementById('fmg-discuss-focus-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = discussFocusMode ? '↕ 展开' : '↕ 专注';
            toggleBtn.title = discussFocusMode ? '显示讨论页的其他操作区' : '收起非聊天区域，只保留聊天区';
            toggleBtn.classList.toggle('active', discussFocusMode);
        }

        updatePopupFocusState();
    }

    function requestDiscussTokenCountUpdate(delay = 0) {
        if (discussTokenUpdateTimer) {
            clearTimeout(discussTokenUpdateTimer);
        }

        discussTokenUpdateTimer = setTimeout(() => {
            discussTokenUpdateTimer = null;
            updateDiscussTokenCount();
        }, Math.max(0, delay));
    }

    async function updateDiscussTokenCount() {
        const counterEl = document.getElementById('fmg-discuss-token-total');
        if (!counterEl) return;

        const version = ++discussTokenUpdateVersion;
        counterEl.textContent = '总Token ...';

        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (!context || typeof context.getTokenCountAsync !== 'function') {
                counterEl.textContent = '总Token --';
                return;
            }

            const chunks = [];
            const systemPrompt = buildDiscussSystemPrompt();
            if (systemPrompt) chunks.push(systemPrompt);

            discussMessages
                .filter(msg => msg.role !== 'system' && String(msg.content || '').trim())
                .forEach(msg => chunks.push(String(msg.content)));

            const inputEl = document.getElementById('fmg-discuss-input');
            const draftText = inputEl && typeof inputEl.value === 'string' ? inputEl.value.trim() : '';
            if (draftText) chunks.push(draftText);

            const counts = await Promise.all(chunks.map(chunk => context.getTokenCountAsync(String(chunk), 0)));
            if (version !== discussTokenUpdateVersion) return;

            const total = counts.reduce((sum, count) => sum + (Number.isFinite(Number(count)) ? Number(count) : 0), 0);
            counterEl.textContent = `总Token ${total}`;
        } catch (error) {
            console.warn('[开场白生成器] 统计讨论 token 失败:', error);
            if (version === discussTokenUpdateVersion) {
                counterEl.textContent = '总Token --';
            }
        }
    }

    function updateDiscussPanel() {
        // 更新角色名
        const nameEl = document.getElementById('fmg-discuss-char-name');
        const charData = window._fmgCharData;
        if (nameEl) {
            if (charData && charData.name) {
                nameEl.textContent = '🎭 ' + charData.name;
                nameEl.classList.add('active');
            } else {
                nameEl.textContent = '未选择角色';
                nameEl.classList.remove('active');
            }
        }

        // 更新角色卡完整内容预览
        const fullcardEl = document.getElementById('fmg-discuss-fullcard');
        if (fullcardEl && charData) {
            const sections = [];
            const field = (label, value) => {
                if (Array.isArray(value)) {
                    if (value.length === 0) return `【${label}】\n（空）`;
                    return `【${label}】\n${value.map((v, i) => `  [${i + 1}] ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n')}`;
                }
                if (typeof value === 'object' && value !== null) {
                    return `【${label}】\n${JSON.stringify(value, null, 2)}`;
                }
                return `【${label}】\n${value || '（空）'}`;
            };

            sections.push(field('角色名', charData.name));
            sections.push(field('描述 (description)', charData.desc));
            sections.push(field('性格 (personality)', charData.pers));
            sections.push(field('场景 (scenario)', charData.scen));
            sections.push(field('开场白 (first_mes)', charData.first));
            sections.push(field('可选开场白 (alternate_greetings)', charData.alternate_greetings));
            sections.push(field('对话示例 (mes_example)', charData.mes_example));
            sections.push(field('系统提示词 (system_prompt)', charData.system_prompt));
            sections.push(field('越权提示词 (post_history_instructions)', charData.post_history_instructions));
            sections.push(field('创作者备注 (creator_notes)', charData.creator_notes));
            sections.push(field('创作者 (creator)', charData.creator));
            sections.push(field('版本 (character_version)', charData.character_version));
            sections.push(field('标签 (tags)', charData.tags));
            sections.push(field('规格 (spec)', charData.spec));
            sections.push(field('规格版本 (spec_version)', charData.spec_version));
            if (charData.depth_prompt) {
                sections.push(field('深度提示词 (depth_prompt)', charData.depth_prompt));
            }
            sections.push(field('扩展数据 (extensions)', charData.extensions));

            fullcardEl.textContent = sections.join('\n\n');
        } else if (fullcardEl) {
            fullcardEl.textContent = '暂无数据';
        }

        // 显示/隐藏信息面板
        const panel = document.getElementById('fmg-discuss-info-panel');
        if (panel) {
            panel.style.display = charData ? '' : 'none';
        }

        // 更新讨论页世界书计数
        updateDiscussWiCount();
        renderChatSessionControls();
        setDiscussFocusMode(discussFocusMode);
        requestDiscussTokenCountUpdate();
    }

    function updateDiscussWiCount() {
        const wiEntries = window._fmgWorldEntries || [];
        const wiSelected = getSelectedWorldInfo().length;
        const el = document.getElementById('fmg-discuss-wi-count');
        if (el) el.textContent = `${wiSelected}/${wiEntries.length}`;
    }

    function buildDiscussSystemPrompt() {
        const charData = window._fmgCharData;
        if (!charData) return null;

        const parts = [];
        parts.push(`你是一个专业的角色卡分析助手。以下是当前角色"${charData.name}"的完整角色卡信息（包含所有字段），请基于这些信息与用户讨论角色卡的设计、内容、改进建议等。`);

        if (charData.desc) parts.push(`【描述 description】\n${charData.desc}`);
        if (charData.pers) parts.push(`【性格 personality】\n${charData.pers}`);
        if (charData.scen) parts.push(`【场景 scenario】\n${charData.scen}`);
        if (charData.first) parts.push(`【开场白 first_mes】\n${charData.first}`);
        if (charData.alternate_greetings && charData.alternate_greetings.length > 0) {
            parts.push(`【可选开场白 alternate_greetings】\n${charData.alternate_greetings.map((g, i) => `[${i + 1}] ${g}`).join('\n\n')}`);
        }
        if (charData.mes_example) parts.push(`【对话示例 mes_example】\n${charData.mes_example}`);
        if (charData.system_prompt) parts.push(`【系统提示词 system_prompt】\n${charData.system_prompt}`);
        if (charData.post_history_instructions) parts.push(`【越权提示词 post_history_instructions】\n${charData.post_history_instructions}`);
        if (charData.creator_notes) parts.push(`【创作者备注 creator_notes】\n${charData.creator_notes}`);
        if (charData.creator) parts.push(`【创作者】${charData.creator}`);
        if (charData.character_version) parts.push(`【版本】${charData.character_version}`);
        if (charData.tags && charData.tags.length > 0) parts.push(`【标签】${charData.tags.join(', ')}`);
        if (charData.depth_prompt) parts.push(`【深度提示词 depth_prompt】\n${JSON.stringify(charData.depth_prompt)}`);

        // 世界书 - 使用已选择的条目
        const worldInfo = getSelectedWorldInfo();
        if (worldInfo.length > 0) {
            const wiText = worldInfo.map(e => `[${e.name}]: ${e.content}`).join('\n\n');
            parts.push(`【世界书设定】\n${wiText}`);
        }

        const editableEntriesText = formatSelectedWorldInfoForUpdate(worldInfo);

        // 编辑格式说明
        parts.push(`【修改角色卡格式说明】
当用户要求你修改角色卡的某个字段时，请使用以下格式输出修改建议：
[EDIT:字段名]
修改后的完整内容
[/EDIT]

常用字段名：description, personality, scenario, first_mes, alternate_greetings, mes_example, system_prompt, post_history_instructions, creator_notes, tags, creator, character_version, extensions.depth_prompt
如果要修改没有列出的角色卡 data 字段，也可以直接使用字段名或字段路径，例如：
- [EDIT:extensions.depth_prompt]
- [EDIT:extensions.talkativeness]
- [EDIT:tags]

数组或对象字段请输出完整 JSON，例如 tags 使用 ["标签1","标签2"]，alternate_greetings 使用 ["开场白1","开场白2"]。

示例（小改 - 修改单个字段）：
我建议将描述修改为以下内容：
[EDIT:description]
这里是修改后的完整描述内容...
[/EDIT]

示例（大改 - 同时修改多个字段）：
[EDIT:description]
新的描述...
[/EDIT]

[EDIT:personality]
新的性格...
[/EDIT]

重要规则：
1. 只有在用户明确要求修改时才使用此格式
2. 普通讨论时不要使用此格式
3. [EDIT:xxx] 块内应包含该字段修改后的完整内容；只改其中一部分时改用下面的 [PATCH] 局部修改格式，不要整篇重写
4. 可以在 [EDIT] 块前后添加普通文字解释你的修改理由`);

        parts.push(`【局部修改格式说明（只改一部分时优先使用）】
只改角色卡字段或已有世界书条目正文的一部分（改几句话、改一段、删一句、加一段）时，用 [PATCH] 只输出要改的地方，插件会在原文中找到这段文字并替换：
[PATCH:目标]
<<<<<<< SEARCH
要被替换的原文（从当前内容中逐字复制）
=======
替换后的新文本
>>>>>>> REPLACE
[/PATCH]

示例（改描述里的一句话）：
[PATCH:description]
<<<<<<< SEARCH
她总是独来独往，不愿与人交谈。
=======
她习惯独来独往，但对熟人会意外地话多。
>>>>>>> REPLACE
[/PATCH]

局部修改规则：
1. 目标写角色卡字段名（如 description、personality、first_mes、alternate_greetings），或写 wi:UID 指定已选世界书条目的正文（如 [PATCH:wi:12]，UID 见下方已选条目清单）。
2. SEARCH 必须从当前内容中逐字复制，包括标点和换行，不要改写、缩写或省略；它在目标内容中只能出现一次，不够唯一时多带一两句上下文。
3. SEARCH 尽量短，只包含要改的句子和必要的上下文，不要大段复制。
4. 一个 [PATCH] 块里可以有多组 SEARCH/REPLACE，按原文顺序排列，彼此不要重叠。
5. 删除内容时 REPLACE 部分留空；新增内容时用相邻的一句原文作 SEARCH，在 REPLACE 中保留这句并接上新内容。
6. 可选开场白直接写 [PATCH:alternate_greetings]，插件会在所有可选开场白中定位；SEARCH 不要带 [1] 这样的序号。
7. 只适用于文本内容；tags 这类数组或对象字段、世界书条目的关键词和触发设置，仍用 [EDIT] 或 [WORLDBOOK_ENTRY]。
8. 改动超过原文一半或需要整体重写时，改用 [EDIT] 或 [WORLDBOOK_ENTRY] 输出完整内容。
9. 只有在用户明确要求修改时才使用此格式。`);

        parts.push(`【世界书条目输出格式说明】
当用户明确要求“输出世界书条目”“给我可直接添加的版本”“生成可写入世界书的内容”“把刚才讨论的设定沉淀到世界书”时，你可以在解释后输出一个或多个世界书条目块。

【当前已选条目清单（更新已有条目时优先使用这些 UID）】
${editableEntriesText}

条目块必须使用下面的精确格式，不要使用 markdown 代码块包裹：
[WORLDBOOK_ENTRY]
{
  "operation": "create",
  "comment": "条目标题或备注",
  "keys": ["主关键词1", "主关键词2"],
  "secondary_keys": ["次级关键词"],
  "content": "条目完整正文",
  "constant": false,
  "selective": true,
  "position": "at_depth",
  "depth": 4,
  "role": "system",
  "placement_reason": "这条更像写作约束与持续生效的规则，放在 depth system 比普通前置世界书更稳定。",
  "insertion_order": 100
}
[/WORLDBOOK_ENTRY]

世界书规则：
1. 新建条目时 operation 必须是 "create"，不要填写 uid。
2. 更新已有条目时 operation 必须是 "update"，并填写当前已选条目清单中对应的 uid。更新时插入位置、深度、role 和顺序会自动沿用清单中原条目的设置（用户自己设置的，不要改动），可以省略 position、depth、role、insertion_order 和 placement_reason。更新时没写的字段（content、keys、secondary_keys、comment、constant 等）都保持原值，只写要改的字段即可，例如只改关键词时不用再输出 content；只改正文的一部分时用 [PATCH:wi:UID]。
3. 新建条目时由你根据内容决定 position、depth、role 和 insertion_order，并参考清单中已有条目的位置和顺序安排先后，同时给出 placement_reason。
4. 常驻条目 constant=true 时 keys 应为空数组；非常驻条目 keys 至少有一个主关键词。
5. position 可用值：before_char, after_char, before_author_note, after_author_note, before_example_messages, after_example_messages, at_depth, outlet。
6. position 为 at_depth 时必须提供 depth 和 role，role 只能是 system、user、assistant。
7. position 为 outlet 时必须提供 outlet_name。
8. 写了 content 时，它必须是完整可直接使用的最终条目内容，不要写“同上”“略”或备注占位符。
9. 条目块内部必须是严格 JSON，必须能被 JSON.parse 直接解析：
   - 字符串值必须使用英文双引号包裹
   - 字符串内部需要换行时写成 \\n，不要直接在字符串中换行
   - 字符串内部需要英文双引号时写成 \\"
   - 最后一个字段或数组元素后面不要加逗号
10. 只有在用户明确要求产出世界书条目时才输出 [WORLDBOOK_ENTRY] 块；普通讨论和角色字段修改时不要输出世界书条目块。
11. 如果用户同时要求修改角色卡和生成世界书，可以同时输出 [EDIT] 块和 [WORLDBOOK_ENTRY] 块，但每个块都必须格式完整。`);

        return parts.join('\n\n');
    }

    function appendChatMessage(role, content, isStreaming = false, messageId = '') {
        const container = document.getElementById('fmg-chat-messages');
        if (!container) return;
        const shouldAutoScroll = role === 'user' || discussAutoScroll || isDiscussNearBottom(container);

        // 首次发消息时移除欢迎提示
        const welcome = container.querySelector('.fmg-chat-welcome');
        if (welcome) welcome.remove();

        // 查找是否有正在流式更新的气泡
        let bubble = container.querySelector('.fmg-chat-bubble.streaming');

        if (!bubble || role === 'user') {
            bubble = document.createElement('div');
            bubble.className = `fmg-chat-bubble ${role}`;
            if (isStreaming) bubble.classList.add('streaming');

            const label = document.createElement('div');
            label.className = 'fmg-chat-label';
            label.textContent = role === 'user' ? '👤 你' : '🤖 AI';
            bubble.appendChild(label);

            const text = document.createElement('div');
            text.className = 'fmg-chat-text';
            bubble.appendChild(text);

            container.appendChild(bubble);
        }

        const textEl = bubble.querySelector('.fmg-chat-text');
        if (isStreaming) {
            textEl.innerHTML = escapeHtml(content) + '<span class="fmg-cursor">▌</span>';
        } else {
            bubble.dataset.messageId = messageId || '';
            if (role === 'assistant') {
                textEl.innerHTML = renderAssistantContent(content);
                const message = messageId && discussMessages.find(msg => msg.id === messageId);
                restoreCardStates(textEl, message?.cardStates);
            } else {
                textEl.innerHTML = escapeHtml(content);
            }
            bubble.classList.remove('streaming');
        }

        // 自动滚动到底部
        if (shouldAutoScroll) {
            container.scrollTop = container.scrollHeight;
            discussAutoScroll = true;
        }

        return bubble;
    }

    function undoLastDiscussRound() {
        if (isDiscussGenerating) {
            showStatus('fmg-discuss-status', 'error', '请先停止当前生成，再撤回上一轮');
            return;
        }

        let lastUserIndex = -1;
        for (let i = discussMessages.length - 1; i >= 0; i--) {
            if (discussMessages[i].role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        if (lastUserIndex < 0) {
            showStatus('fmg-discuss-status', 'error', '当前没有可撤回的上一轮');
            return;
        }

        const restoredText = discussMessages[lastUserIndex].content || '';
        discussMessages.splice(lastUserIndex);

        if (discussMessages.every(msg => msg.role === 'system')) {
            discussMessages = [];
        }

        saveChatSession();
        renderDiscussionHistory();

        const input = document.getElementById('fmg-discuss-input');
        if (input) {
            input.value = restoredText;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }

        showStatus('fmg-discuss-status', 'success', '已撤回上一轮，并恢复到输入框');
    }

    // ========================================
    // 编辑块解析与渲染
    // ========================================

    window._fmgPendingEdits = {};
    let _editIdCounter = 0;

    function parseEditBlocks(text) {
        const regex = /\[EDIT:([^\]\s]+)\]([\s\S]*?)\[\/EDIT\]/g;
        const edits = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const field = normalizeEditFieldName(match[1]);
            if (!field) continue;

            edits.push({
                field: field,
                content: match[2].trim(),
                start: match.index,
                end: regex.lastIndex
            });
        }
        return edits;
    }

    function normalizeEditFieldName(field) {
        const normalized = String(field || '').trim().replace(/\[(\w+)\]/g, '.$1');
        if (!normalized) return '';

        const withoutDataPrefix = normalized.startsWith('data.')
            ? normalized.slice('data.'.length)
            : normalized;
        const aliased = EDIT_FIELD_ALIASES[withoutDataPrefix] || withoutDataPrefix;
        const segments = aliased.split('.').filter(Boolean);

        if (segments.length === 0) return '';
        if (segments.some(segment => !/^[A-Za-z0-9_-]+$/.test(segment))) return '';
        if (segments.some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) return '';

        return segments.join('.');
    }

    function getEditFieldLabel(field) {
        return FIELD_LABELS[field] || FIELD_LABELS[field?.split('.')?.pop()] || field;
    }

    function getNestedValue(source, path) {
        if (!source || !path) return undefined;
        return path.split('.').reduce((value, key) => {
            if (value === undefined || value === null) return undefined;
            return value[key];
        }, source);
    }

    function setNestedValue(target, path, value) {
        const segments = path.split('.').filter(Boolean);
        if (segments.length === 0) return;

        let cursor = target;
        for (let i = 0; i < segments.length - 1; i++) {
            const key = segments[i];
            if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
                cursor[key] = {};
            }
            cursor = cursor[key];
        }
        cursor[segments[segments.length - 1]] = value;
    }

    function buildNestedDataPayload(path, value, existingData) {
        const segments = path.split('.').filter(Boolean);
        if (segments.length === 0) return {};
        if (segments.length === 1) return { [segments[0]]: value };

        const rootKey = segments[0];
        const rootClone = existingData?.[rootKey] && typeof existingData[rootKey] === 'object'
            ? structuredClone(existingData[rootKey])
            : {};
        setNestedValue(rootClone, segments.slice(1).join('.'), value);
        return { [rootKey]: rootClone };
    }

    function parseEditFieldValue(field, rawValue, currentValue) {
        const text = String(rawValue ?? '').trim();
        const expectsJson = Array.isArray(currentValue)
            || (currentValue && typeof currentValue === 'object')
            || ['tags', 'alternate_greetings', 'extensions'].includes(field);

        if (expectsJson || /^[\[{]/.test(text)) {
            try {
                return JSON.parse(text);
            } catch (_) {
                if (Array.isArray(currentValue) || ['tags', 'alternate_greetings'].includes(field)) {
                    return text
                        .split(/\n|,/)
                        .map(item => item.trim())
                        .filter(Boolean);
                }
            }
        }

        if (typeof currentValue === 'boolean') {
            return ['true', '1', 'yes', '是', '开启'].includes(text.toLowerCase());
        }

        if (typeof currentValue === 'number' && Number.isFinite(Number(text))) {
            return Number(text);
        }

        return rawValue;
    }

    // 开场白生成页已移除；旧会话里的开场白大纲块按原文显示，但仍占一个卡片序号，
    // 保证之后卡片的已应用/已忽略状态（按序号保存）不会错位
    function parseLegacyFirstMessagePlanBlocks(text) {
        const regex = /\[FIRST_MESSAGE_PLAN\]([\s\S]*?)\[\/FIRST_MESSAGE_PLAN\]/g;
        const blocks = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            blocks.push({ raw: match[0], start: match.index, end: regex.lastIndex });
        }
        return blocks;
    }

    // ========================================
    // 局部修改（PATCH）：AI 只给出“原文 → 新文”，在本地定位替换
    // ========================================

    const PATCH_WORLDBOOK_TARGET = /^(?:wi|worldbook|world_info|worldinfo|uid)[:：](\d+)$/i;

    function parsePatchHunks(body) {
        const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
        const hunks = [];
        let state = 'idle';
        let find = [];
        let replace = [];

        for (const line of lines) {
            const marker = line.trim();
            if (/^<{5,}\s*(?:SEARCH|FIND|原文)?$/i.test(marker)) {
                if (state !== 'idle') throw new Error('替换块缺少结束标记 >>>>>>> REPLACE');
                state = 'find';
                find = [];
                replace = [];
            } else if (state === 'find' && /^={5,}$/.test(marker)) {
                state = 'replace';
            } else if (state === 'replace' && /^>{5,}\s*(?:REPLACE|新文)?$/i.test(marker)) {
                hunks.push({ find: find.join('\n'), replace: replace.join('\n') });
                state = 'idle';
            } else if (state === 'find') {
                find.push(line);
            } else if (state === 'replace') {
                replace.push(line);
            }
        }

        if (state !== 'idle') throw new Error('替换块不完整，缺少 ======= 或 >>>>>>> REPLACE');
        if (hunks.length === 0) throw new Error('没有找到 <<<<<<< SEARCH / ======= / >>>>>>> REPLACE 替换块');
        if (hunks.some(hunk => !hunk.find.trim())) throw new Error('SEARCH 部分为空，无法定位要修改的原文');
        return hunks;
    }

    function parsePatchBlocks(text) {
        const regex = /\[PATCH:([^\]\s]+)\]([\s\S]*?)\[\/PATCH\]/g;
        const patches = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            const target = match[1].trim();
            const base = { target, start: match.index, end: regex.lastIndex };
            try {
                const hunks = parsePatchHunks(match[2]);
                const worldbookMatch = target.match(PATCH_WORLDBOOK_TARGET);
                if (worldbookMatch) {
                    patches.push({ ...base, kind: 'worldbook', uid: Number(worldbookMatch[1]), hunks });
                    continue;
                }

                const field = normalizeEditFieldName(target).replace(/\.\d+$/, '');
                if (!field) throw new Error(`无法识别的修改目标：${target}`);
                patches.push({ ...base, kind: 'character', field, hunks });
            } catch (error) {
                patches.push({ ...base, invalid: true, raw: match[2].trim(), error: error.message });
            }
        }

        return patches;
    }

    // 模糊匹配时忽略空白，并把全角/中英文标点统一，map 记录每个字符在原文中的位置
    const PATCH_CHAR_MAP = {
        '，': ',', '。': '.', '：': ':', '；': ';', '！': '!', '？': '?', '、': ',',
        '（': '(', '）': ')', '【': '[', '】': ']', '《': '<', '》': '>',
        '“': '"', '”': '"', '„': '"', '「': '"', '」': '"', '『': '"', '』': '"',
        '‘': "'", '’': "'", '…': '...', '—': '-', '–': '-', '～': '~', '·': '.'
    };

    function normalizeForPatch(text) {
        const chars = [];
        const map = [];
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (/\s/.test(ch)) continue;
            let out = PATCH_CHAR_MAP[ch];
            if (out === undefined) {
                const code = ch.charCodeAt(0);
                out = code >= 0xFF01 && code <= 0xFF5E ? String.fromCharCode(code - 0xFEE0) : ch;
            }
            for (const c of out) {
                chars.push(c);
                map.push(i);
            }
        }
        return { text: chars.join(''), map };
    }

    function findAllIndexes(haystack, needle) {
        const indexes = [];
        if (!needle) return indexes;
        let index = haystack.indexOf(needle);
        while (index !== -1) {
            indexes.push(index);
            index = haystack.indexOf(needle, index + 1);
        }
        return indexes;
    }

    function findPatchMatches(text, find, fuzzy) {
        if (!fuzzy) {
            return findAllIndexes(text, find).map(start => ({ start, end: start + find.length, fuzzy: false }));
        }
        const normText = normalizeForPatch(text);
        const normFind = normalizeForPatch(find).text;
        return findAllIndexes(normText.text, normFind).map(start => ({
            start: normText.map[start],
            end: normText.map[start + normFind.length - 1] + 1,
            fuzzy: true
        }));
    }

    // 先精确匹配，找不到再模糊匹配；必须恰好命中一处
    function locatePatchHunk(texts, find) {
        for (const fuzzy of [false, true]) {
            const matches = texts.flatMap((text, index) => findPatchMatches(text, find, fuzzy).map(match => ({ ...match, index })));
            if (matches.length === 1) return matches[0];
            if (matches.length > 1) {
                throw new Error(`这段原文出现了 ${matches.length} 处，无法确定改哪一处，请让 AI 多引用一点上下文`);
            }
        }
        throw new Error('找不到这段原文：内容可能已经改过，或 AI 引用得不准确');
    }

    const PATCH_ALREADY_APPLIED_MESSAGE = '找不到这段原文，但修改后的内容已经在里面了，可能已经应用过';

    // 原文找不到时，看修改后的文字是否恰好出现一处，用来提示「已经改过了」
    function isHunkAlreadyApplied(texts, hunk) {
        if (!hunk.replace.trim()) return false;
        try {
            locatePatchHunk(texts, hunk.replace);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 把替换块依次应用到文本（或字符串数组，如可选开场白）上，返回新值，不修改传入的值。
     * 任一处定位失败都会抛错，不会只改一半。
     */
    function applyPatchHunks(value, hunks) {
        const isArray = Array.isArray(value);
        if ((isArray && value.some(item => typeof item !== 'string'))
            || (!isArray && value !== undefined && value !== null && typeof value !== 'string')) {
            throw new Error('只能局部修改文本内容，这个字段请用整段修改');
        }

        const texts = isArray ? [...value] : [String(value ?? '')];
        hunks.forEach((hunk, i) => {
            let match;
            try {
                match = locatePatchHunk(texts, hunk.find);
            } catch (error) {
                const message = isHunkAlreadyApplied(texts, hunk) ? PATCH_ALREADY_APPLIED_MESSAGE : error.message;
                throw new Error(hunks.length > 1 ? `第 ${i + 1} 处修改：${message}` : message);
            }
            // 模糊匹配的范围不含首尾空白，替换文本也去掉首尾空白，保留原文的换行和缩进
            const replacement = match.fuzzy ? hunk.replace.trim() : hunk.replace;
            const text = texts[match.index];
            texts[match.index] = text.slice(0, match.start) + replacement + text.slice(match.end);
        });
        return isArray ? texts : texts[0];
    }

    function formatEditFieldValue(value) {
        if (value === undefined || value === null || value === '') return '（空）';
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }

    function getCharacterDataFieldValue(field) {
        const charData = window._fmgCharData;
        if (!charData) return undefined;

        const cacheKey = FIELD_TO_CACHE_KEY[field] || field;
        if (charData[cacheKey] !== undefined) return charData[cacheKey];
        return getNestedValue(charData._raw, field);
    }

    function renderAssistantContent(content) {
        const blocks = [
            ...parseEditBlocks(content).map(edit => ({ type: 'edit', start: edit.start, end: edit.end, data: edit })),
            ...parseLegacyFirstMessagePlanBlocks(content).map(plan => ({ type: 'legacy-plan', start: plan.start, end: plan.end, data: plan })),
            ...parseWorldbookEntryBlocks(content).map(entry => ({ type: 'worldbook', start: entry.start, end: entry.end, data: entry })),
            ...parsePatchBlocks(content).map(patch => ({ type: 'patch', start: patch.start, end: patch.end, data: patch }))
        ].sort((a, b) => a.start - b.start || a.end - b.end);

        if (blocks.length === 0) {
            return escapeHtml(content);
        }

        let html = '';
        let lastIndex = 0;
        let editCount = 0;
        let worldbookCount = 0;
        // 卡片在本条回复中的序号，用于把应用/忽略状态存进会话
        let cardIndex = 0;

        for (const block of blocks) {
            if (block.start < lastIndex) continue;
            cardIndex++;

            if (block.start > lastIndex) {
                const plainText = content.substring(lastIndex, block.start).trim();
                if (plainText) {
                    html += '<div class="fmg-chat-plain">' + escapeHtml(plainText) + '</div>';
                }
            }

            if (block.type === 'edit') {
                const edit = block.data;
                const editKey = 'edit_' + (++_editIdCounter);
                window._fmgPendingEdits[editKey] = { field: edit.field, content: edit.content };
                editCount++;
                html += renderEditCard(edit, editKey, cardIndex).trim();
            } else if (block.type === 'legacy-plan') {
                html += '<div class="fmg-chat-plain">' + escapeHtml(block.data.raw) + '</div>';
            } else if (block.type === 'patch') {
                const patch = block.data;
                if (patch.invalid) {
                    html += renderInvalidPatchCard(patch).trim();
                } else if (patch.kind === 'worldbook') {
                    const entryKey = 'worldbook_' + (++_worldbookEntryIdCounter);
                    const existing = findLoadedWorldEntry(patch.uid);
                    // 只带 uid 和替换块，其余字段为空表示沿用原条目
                    window._fmgPendingWorldbookEntries[entryKey] = {
                        operation: 'update',
                        uid: patch.uid,
                        patches: patch.hunks,
                        keep_placement: true,
                        label: existing?.comment || `#${patch.uid}`
                    };
                    worldbookCount++;
                    html += renderPatchCard(patch, { key: entryKey, cardIndex, existing }).trim();
                } else {
                    const editKey = 'edit_' + (++_editIdCounter);
                    window._fmgPendingEdits[editKey] = { field: patch.field, patches: patch.hunks };
                    editCount++;
                    html += renderPatchCard(patch, { key: editKey, cardIndex }).trim();
                }
            } else {
                const entry = block.data;
                const entryKey = 'worldbook_' + (++_worldbookEntryIdCounter);
                if (!entry.invalid) {
                    worldbookCount++;
                    window._fmgPendingWorldbookEntries[entryKey] = {
                        operation: entry.operation,
                        uid: entry.uid,
                        comment: entry.comment,
                        keys: entry.keys,
                        secondary_keys: entry.secondary_keys,
                        content: entry.content,
                        constant: entry.constant,
                        // 更新时沿用原条目的向量化设置
                        vectorized: entry.operation === 'update' ? null : false,
                        selective: entry.selective,
                        position: entry.position,
                        depth: entry.depth,
                        role: entry.role,
                        outlet_name: entry.outlet_name,
                        placement_reason: entry.placement_reason,
                        insertion_order: entry.insertion_order,
                        enabled: entry.enabled,
                        keep_placement: entry.keep_placement === true
                    };
                }
                html += renderWorldbookEntryCard(entry, entryKey, cardIndex).trim();
            }
            lastIndex = block.end;
        }

        if (lastIndex < content.length) {
            const remaining = content.substring(lastIndex).trim();
            if (remaining) {
                html += '<div class="fmg-chat-plain">' + escapeHtml(remaining) + '</div>';
            }
        }

        if (editCount + worldbookCount >= 2) {
            html += renderApplyAllBar(editCount, worldbookCount).trim();
        }
        return html;
    }

    function renderApplyAllBar(editCount, worldbookCount) {
        const summary = [
            editCount > 0 ? `${editCount} 项修改` : '',
            worldbookCount > 0 ? `${worldbookCount} 个世界书条目` : ''
        ].filter(Boolean).join('、');

        return `
            <div class="fmg-chat-apply-all-bar">
                <span class="fmg-chat-apply-all-summary">本条回复共 ${summary}</span>
                <button class="fmg-btn fmg-btn-primary fmg-chat-apply-all" title="按顺序应用本条回复中所有未应用、未忽略的修改和世界书条目">✅ 全部应用</button>
            </div>
        `;
    }

    const CARD_STATE_BADGES = {
        applied: '<span class="fmg-edit-applied-badge">✅ 已应用</span>',
        added: '<span class="fmg-edit-applied-badge">✅ 已添加到世界书</span>',
        updated: '<span class="fmg-edit-applied-badge">✅ 已更新到世界书</span>',
        ignored: '<span class="fmg-edit-ignored-badge">❌ 已忽略</span>'
    };

    /**
     * 把卡片标记为已应用/已添加/已更新/已忽略。
     * record 为 true 时把状态记到所属消息上并保存会话，重新渲染或切换会话后仍保留。
     */
    function setCardState(card, state, { record = true } = {}) {
        if (!card || !CARD_STATE_BADGES[state]) return;
        card.classList.add(state === 'ignored' ? 'ignored' : 'applied');
        const actionsEl = card.querySelector('.fmg-edit-card-actions');
        if (actionsEl) actionsEl.innerHTML = CARD_STATE_BADGES[state];
        if (record) recordCardState(card, state);
        refreshApplyAllBar(card.closest('.fmg-chat-text'));
    }

    function recordCardState(card, state) {
        const messageId = card.closest('.fmg-chat-bubble')?.dataset.messageId;
        const cardIndex = card.dataset.cardIndex;
        const message = messageId && discussMessages.find(msg => msg.id === messageId);
        if (!message || cardIndex === undefined) return;

        message.cardStates = { ...(message.cardStates || {}), [cardIndex]: state };
        saveChatSession();
    }

    function restoreCardStates(textEl, cardStates) {
        if (!textEl || !cardStates) return;
        textEl.querySelectorAll('[data-card-index]').forEach(card => {
            const state = cardStates[card.dataset.cardIndex];
            if (!state) return;
            // 局部修改的预览是按现在的内容算的；已处理过的卡片，这份预览已经过时（应用后原文找不到了），去掉只留改动对照
            if (card.classList.contains('fmg-patch-card')) {
                card.querySelectorAll('.fmg-patch-note, .fmg-edit-card-old').forEach(el => el.remove());
            }
            setCardState(card, state, { record: false });
        });
    }

    // 本条回复的卡片都处理完后，把「全部应用」栏换成完成提示
    function refreshApplyAllBar(textEl) {
        const bar = textEl?.querySelector('.fmg-chat-apply-all-bar');
        if (!bar) return;
        const pending = textEl.querySelectorAll(
            '.fmg-edit-card[data-edit-key]:not(.applied):not(.ignored), .fmg-worldbook-card[data-entry-key]:not(.applied):not(.ignored)'
        ).length;
        if (pending === 0) {
            bar.innerHTML = '<span class="fmg-edit-applied-badge">✅ 已全部处理</span>';
        }
    }

    async function applyAllDiscussCards(buttonEl) {
        const scope = buttonEl.closest('.fmg-chat-text');
        if (!scope) return;

        const cards = Array.from(scope.querySelectorAll('.fmg-edit-card[data-edit-key], .fmg-worldbook-card[data-entry-key]'))
            .filter(card => !card.classList.contains('applied') && !card.classList.contains('ignored'));

        if (cards.length === 0) {
            showStatus('fmg-discuss-status', 'success', '本条回复没有待应用的修改或条目');
            return;
        }

        buttonEl.disabled = true;
        buttonEl.textContent = '⏳ 应用中...';

        let editApplied = 0;
        let worldbookApplied = 0;
        let latestContext = null;
        const failures = [];

        for (const card of cards) {
            const isEdit = card.classList.contains('fmg-edit-card');
            const cardBtn = card.querySelector(isEdit ? '.fmg-edit-apply' : '.fmg-worldbook-apply');
            // 单条按钮已禁用说明它正在单独应用中，跳过避免重复写入
            if (!cardBtn || cardBtn.disabled) continue;

            if (isEdit) {
                const editData = window._fmgPendingEdits?.[cardBtn.dataset.editKey];
                if (!editData) continue;
                cardBtn.disabled = true;
                cardBtn.textContent = '⏳ 应用中...';
                const ok = await applyCharacterEdit(editData.field, editData.content, cardBtn, { silent: true, patches: editData.patches });
                if (ok) {
                    editApplied++;
                } else {
                    failures.push(getEditFieldLabel(editData.field));
                }
            } else {
                const entryData = window._fmgPendingWorldbookEntries?.[cardBtn.dataset.entryKey];
                if (!entryData) continue;
                cardBtn.disabled = true;
                cardBtn.textContent = '⏳ 添加中...';
                try {
                    const result = await persistWorldbookEntry(entryData);
                    latestContext = result.context;
                    setCardState(card, result.isUpdate ? 'updated' : 'added');
                    worldbookApplied++;
                } catch (error) {
                    console.error('[开场白生成器] 批量添加世界书条目失败:', error);
                    failures.push(`${entryData.label || entryData.comment || '未命名条目'}（${error.message}）`);
                    cardBtn.textContent = '⚠️ 重试';
                    cardBtn.disabled = false;
                }
            }
        }

        if (editApplied > 0) {
            updateDiscussPanel();
            await refreshCharacterEditor();
        }
        if (latestContext) await loadWorldInfoList(latestContext, true);
        requestDiscussTokenCountUpdate();

        const doneText = `已应用 ${editApplied} 项修改、${worldbookApplied} 个世界书条目`;
        if (failures.length > 0) {
            showStatus('fmg-discuss-status', 'error', `${doneText}；${failures.length} 项失败：${failures.join('；')}`);
            if (typeof toastr !== 'undefined') toastr.warning(`${doneText}，${failures.length} 项失败`);
            buttonEl.disabled = false;
            buttonEl.textContent = '⚠️ 重试失败项';
        } else {
            showStatus('fmg-discuss-status', 'success', doneText);
            if (typeof toastr !== 'undefined') toastr.success(doneText);
        }
    }

    function renderEditCard(edit, editKey, cardIndex) {
        const fieldLabel = getEditFieldLabel(edit.field);
        const currentValue = window._fmgCharData ? getCharacterDataFieldValue(edit.field) : '（无角色数据）';

        return `
            <div class="fmg-edit-card" data-edit-key="${editKey}" data-card-index="${cardIndex}">
                <div class="fmg-edit-card-header">
                    <span>✏️ 修改建议：${escapeHtml(fieldLabel)} (${escapeHtml(edit.field)})</span>
                </div>
                <div class="fmg-edit-card-old">
                    <div class="fmg-edit-card-label">📄 当前值 <span class="fmg-collapse-arrow">▶</span></div>
                    <div class="fmg-edit-card-old-content">${escapeHtml(formatEditFieldValue(currentValue))}</div>
                </div>
                <div class="fmg-edit-card-new">
                    <div class="fmg-edit-card-label-static">✨ 建议修改为</div>
                    <div class="fmg-edit-card-new-content">${escapeHtml(edit.content)}</div>
                </div>
                <div class="fmg-edit-card-actions">
                    <button class="fmg-btn fmg-btn-primary fmg-edit-apply" data-edit-key="${editKey}">✅ 应用</button>
                    <button class="fmg-btn fmg-btn-secondary fmg-edit-ignore" data-edit-key="${editKey}">❌ 忽略</button>
                </div>
            </div>
        `;
    }

    function findLoadedWorldEntry(uid) {
        return (window._fmgWorldEntries || []).find(item => Number(item.uid) === Number(uid)) || null;
    }

    // 去掉新旧文本相同的开头和结尾，只高亮中间真正改动的部分
    function renderPatchDiffPair(oldText, newText) {
        const max = Math.min(oldText.length, newText.length);
        let prefix = 0;
        while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
        // 不把代理对（emoji 等）拆开
        if (prefix > 0 && /[\uD800-\uDBFF]/.test(oldText[prefix - 1])) prefix--;
        let suffix = 0;
        while (suffix < max - prefix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) suffix++;
        if (suffix > 0 && /[\uDC00-\uDFFF]/.test(oldText[oldText.length - suffix])) suffix--;

        const render = (text, markClass) => {
            const middle = text.slice(prefix, text.length - suffix);
            return escapeHtml(text.slice(0, prefix))
                + (middle ? `<span class="${markClass}">${escapeHtml(middle)}</span>` : '')
                + escapeHtml(text.slice(text.length - suffix));
        };
        return {
            oldHtml: render(oldText, 'fmg-patch-mark-del'),
            newHtml: newText ? render(newText, 'fmg-patch-mark-ins') : '<span class="fmg-patch-empty">（删除这段）</span>'
        };
    }

    function formatPatchedValue(value) {
        if (Array.isArray(value)) return value.map((item, index) => `[${index + 1}] ${item}`).join('\n\n');
        return formatEditFieldValue(value);
    }

    function renderInvalidPatchCard(patch) {
        return `
            <div class="fmg-edit-card fmg-patch-card invalid">
                <div class="fmg-edit-card-header">⚠️ 局部修改解析失败（${escapeHtml(patch.target)}）</div>
                <div class="fmg-worldbook-meta">
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">原因</span><span>${escapeHtml(patch.error || '未知错误')}</span></div>
                </div>
                <div class="fmg-edit-card-new">
                    <div class="fmg-edit-card-label-static">原始内容</div>
                    <div class="fmg-edit-card-new-content">${escapeHtml(patch.raw || '')}</div>
                </div>
            </div>
        `;
    }

    function renderPatchCard(patch, { key, cardIndex, existing = null }) {
        const isWorldbook = patch.kind === 'worldbook';
        let currentValue;
        let title;
        if (isWorldbook) {
            currentValue = existing ? existing.content : undefined;
            title = `✂️ 局部修改世界书：#${patch.uid}${existing ? ` ${existing.comment || existing.name || ''}` : ''}`;
        } else {
            currentValue = window._fmgCharData ? getCharacterDataFieldValue(patch.field) : undefined;
            title = `✂️ 局部修改：${getEditFieldLabel(patch.field)} (${patch.field})`;
        }

        // 按当前内容预览；真正应用时会按写入前的最新内容重新定位
        let previewHtml = '';
        if (currentValue === undefined) {
            previewHtml = `<div class="fmg-patch-note">${isWorldbook ? '这个条目不在已选条目里' : '没有读取到这个字段'}，应用时会按最新内容定位</div>`;
        } else {
            try {
                const patched = applyPatchHunks(currentValue, patch.hunks);
                previewHtml = `
                    <div class="fmg-edit-card-old">
                        <div class="fmg-edit-card-label">📄 修改后全文 <span class="fmg-collapse-arrow">▶</span></div>
                        <div class="fmg-edit-card-old-content">${escapeHtml(formatPatchedValue(patched))}</div>
                    </div>
                `;
            } catch (error) {
                previewHtml = `<div class="fmg-patch-note warning">⚠️ ${escapeHtml(error.message)}</div>`;
            }
        }

        const hunksHtml = patch.hunks.map(hunk => {
            const { oldHtml, newHtml } = renderPatchDiffPair(hunk.find, hunk.replace);
            return `
                <div class="fmg-patch-hunk">
                    <div class="fmg-patch-old">${oldHtml}</div>
                    <div class="fmg-patch-new">${newHtml}</div>
                </div>
            `;
        }).join('');

        const cardClass = isWorldbook ? 'fmg-worldbook-card' : 'fmg-edit-card';
        const keyAttr = isWorldbook ? 'data-entry-key' : 'data-edit-key';
        const applyClass = isWorldbook ? 'fmg-worldbook-apply' : 'fmg-edit-apply';
        const ignoreClass = isWorldbook ? 'fmg-worldbook-ignore' : 'fmg-edit-ignore';

        return `
            <div class="${cardClass} fmg-patch-card" ${keyAttr}="${key}" data-card-index="${cardIndex}">
                <div class="${isWorldbook ? 'fmg-worldbook-card-header' : 'fmg-edit-card-header'}">${escapeHtml(title)}</div>
                <div class="fmg-patch-hunks">${hunksHtml}</div>
                ${previewHtml}
                <div class="fmg-edit-card-actions">
                    <button class="fmg-btn fmg-btn-primary ${applyClass}" ${keyAttr}="${key}">${isWorldbook ? '✅ 更新世界书条目' : '✅ 应用'}</button>
                    <button class="fmg-btn fmg-btn-secondary ${ignoreClass}" ${keyAttr}="${key}">❌ 忽略</button>
                </div>
            </div>
        `;
    }

    // 写入前确认 ST 当前角色仍是插件读取数据时的那个角色，防止把修改写到别的角色上
    function getCurrentCharacterForWrite(context) {
        if (context.characterId === undefined) throw new Error('未选择角色');

        const char = context.characters[context.characterId];
        if (!char) throw new Error('角色数据不存在');

        const loadedAvatar = window._fmgCharData?.avatar;
        if (loadedAvatar && char.avatar !== loadedAvatar) {
            throw new Error('当前角色已切换，请点击刷新后再应用');
        }
        return char;
    }

    // 角色卡保存后重新选中当前角色，让 ST 角色编辑面板显示新值；
    // 否则之后在面板里编辑任意字段时，ST 会把面板里的旧值整体保存回去
    async function refreshCharacterEditor() {
        try {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined || typeof context.selectCharacterById !== 'function') return;
            await context.selectCharacterById(Number(context.characterId), { switchMenu: false });
        } catch (error) {
            console.warn('[开场白生成器] 刷新角色编辑面板失败:', error);
        }
    }

    // silent: 批量应用时由调用方统一刷新面板和提示；返回是否成功
    // patches: 局部修改的替换块，按写入前的最新字段值定位替换，此时忽略 newValue
    async function applyCharacterEdit(field, newValue, buttonEl, { silent = false, patches = null } = {}) {
        try {
            const context = SillyTavern.getContext();
            const char = getCurrentCharacterForWrite(context);
            if (!char.data) char.data = {};

            const dataPath = normalizeEditFieldName(field);
            if (!dataPath) throw new Error('字段名无效');

            const currentValue = getNestedValue(char.data, dataPath)
                ?? (TOP_LEVEL_CHARACTER_FIELDS[dataPath] ? char[TOP_LEVEL_CHARACTER_FIELDS[dataPath]] : undefined);
            const parsedValue = patches
                ? applyPatchHunks(currentValue, patches)
                : parseEditFieldValue(dataPath, newValue, currentValue);

            // 调用 SillyTavern API 保存，成功后再更新内存，避免保存失败时内存与服务器不一致
            const headers = typeof context.getRequestHeaders === 'function'
                ? context.getRequestHeaders()
                : { 'Content-Type': 'application/json' };

            const response = await fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    avatar: char.avatar,
                    data: buildNestedDataPayload(dataPath, parsedValue, char.data)
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            setNestedValue(char.data, dataPath, parsedValue);
            if (TOP_LEVEL_CHARACTER_FIELDS[dataPath]) {
                char[TOP_LEVEL_CHARACTER_FIELDS[dataPath]] = parsedValue;
            }

            // 更新缓存
            const cacheKey = FIELD_TO_CACHE_KEY[dataPath] || dataPath;
            if (window._fmgCharData) {
                if (!window._fmgCharData._raw) window._fmgCharData._raw = {};
                setNestedValue(window._fmgCharData._raw, dataPath, parsedValue);

                if (cacheKey.includes('.')) {
                    setNestedValue(window._fmgCharData, cacheKey, parsedValue);
                } else {
                    window._fmgCharData[cacheKey] = parsedValue;
                }

                if (dataPath.startsWith('extensions.')) {
                    window._fmgCharData.extensions = window._fmgCharData._raw.extensions || {};
                    const extensionKey = dataPath.split('.').slice(1).join('.');
                    if (extensionKey === 'depth_prompt') window._fmgCharData.depth_prompt = parsedValue;
                    if (extensionKey === 'talkativeness') window._fmgCharData.talkativeness = parsedValue;
                }
            }

            // 更新卡片状态
            if (buttonEl) {
                setCardState(buttonEl.closest('.fmg-edit-card'), 'applied');
            }

            if (!silent) {
                updateDiscussPanel();
                await refreshCharacterEditor();
                if (typeof toastr !== 'undefined') toastr.success(`${getEditFieldLabel(dataPath)} 已更新`);
            }
            return true;

        } catch (e) {
            console.error('[开场白生成器] 应用修改失败:', e);
            if (!silent && typeof toastr !== 'undefined') toastr.error('应用修改失败: ' + e.message);
            if (buttonEl) {
                buttonEl.textContent = '⚠️ 重试';
                buttonEl.disabled = false;
            }
            return false;
        }
    }

    // ========================================
    // 世界书讨论与条目应用
    // ========================================

    window._fmgPendingWorldbookEntries = {};
    let _worldbookEntryIdCounter = 0;

    function normalizeStringArray(value) {
        if (Array.isArray(value)) {
            return Array.from(new Set(value.map(item => String(item || '').trim()).filter(Boolean)));
        }
        if (typeof value === 'string') {
            return Array.from(new Set(value.split(/[\n,|]/).map(item => item.trim()).filter(Boolean)));
        }
        return [];
    }

    function normalizeWorldbookPosition(value) {
        if (value === undefined || value === null || value === '') return null;
        if (Number.isFinite(Number(value))) return Number(value);

        const normalized = String(value).trim().toLowerCase();
        switch (normalized) {
            case '0':
            case 'before_char':
            case 'before':
                return WORLDBOOK_POSITIONS.before;
            case '1':
            case 'after_char':
            case 'after':
                return WORLDBOOK_POSITIONS.after;
            case '2':
            case 'before_author_note':
            case 'author_note_before':
            case 'an_before':
                return WORLDBOOK_POSITIONS.authorNoteBefore;
            case '3':
            case 'after_author_note':
            case 'author_note_after':
            case 'an_after':
                return WORLDBOOK_POSITIONS.authorNoteAfter;
            case '4':
            case 'at_depth':
            case 'depth':
                return WORLDBOOK_POSITIONS.atDepth;
            case '5':
            case 'before_example_messages':
            case 'example_before':
            case 'em_before':
                return WORLDBOOK_POSITIONS.exampleBefore;
            case '6':
            case 'after_example_messages':
            case 'example_after':
            case 'em_after':
                return WORLDBOOK_POSITIONS.exampleAfter;
            case '7':
            case 'outlet':
                return WORLDBOOK_POSITIONS.outlet;
            default:
                return null;
        }
    }

    function normalizeWorldbookRole(value) {
        if (value === undefined || value === null || value === '') return null;
        if (Number.isFinite(Number(value))) return Number(value);

        const normalized = String(value).trim().toLowerCase();
        switch (normalized) {
            case 'system':
                return WORLDBOOK_DEPTH_ROLES.system;
            case 'user':
                return WORLDBOOK_DEPTH_ROLES.user;
            case 'assistant':
                return WORLDBOOK_DEPTH_ROLES.assistant;
            default:
                return null;
        }
    }

    function getWorldbookPositionKey(position) {
        switch (Number(position)) {
            case WORLDBOOK_POSITIONS.after: return 'after_char';
            case WORLDBOOK_POSITIONS.authorNoteBefore: return 'before_author_note';
            case WORLDBOOK_POSITIONS.authorNoteAfter: return 'after_author_note';
            case WORLDBOOK_POSITIONS.atDepth: return 'at_depth';
            case WORLDBOOK_POSITIONS.exampleBefore: return 'before_example_messages';
            case WORLDBOOK_POSITIONS.exampleAfter: return 'after_example_messages';
            case WORLDBOOK_POSITIONS.outlet: return 'outlet';
            default: return 'before_char';
        }
    }

    function getWorldbookPositionLabel(position, role = null, outletName = '') {
        switch (Number(position)) {
            case WORLDBOOK_POSITIONS.after:
                return '角色卡后';
            case WORLDBOOK_POSITIONS.authorNoteBefore:
                return '作者注前';
            case WORLDBOOK_POSITIONS.authorNoteAfter:
                return '作者注后';
            case WORLDBOOK_POSITIONS.atDepth:
                return Number(role) === WORLDBOOK_DEPTH_ROLES.user ? '用户在深度' : '系统在深度';
            case WORLDBOOK_POSITIONS.exampleBefore:
                return '示例对话前';
            case WORLDBOOK_POSITIONS.exampleAfter:
                return '示例对话后';
            case WORLDBOOK_POSITIONS.outlet:
                return outletName ? `Outlet (${outletName})` : 'Outlet';
            default:
                return '角色卡前';
        }
    }

    function getWorldbookRoleLabel(role) {
        switch (Number(role)) {
            case WORLDBOOK_DEPTH_ROLES.user:
                return 'user';
            case WORLDBOOK_DEPTH_ROLES.assistant:
                return 'assistant';
            default:
                return 'system';
        }
    }

    function getWorldbookPositionOptions(entry) {
        const options = [
            { value: WORLDBOOK_POSITIONS.before, label: '角色卡前' },
            { value: WORLDBOOK_POSITIONS.after, label: '角色卡后' },
            { value: WORLDBOOK_POSITIONS.authorNoteBefore, label: '作者注前' },
            { value: WORLDBOOK_POSITIONS.authorNoteAfter, label: '作者注后' },
            { value: WORLDBOOK_POSITIONS.atDepth, label: '系统在深度', role: WORLDBOOK_DEPTH_ROLES.system },
            { value: WORLDBOOK_POSITIONS.atDepth, label: '用户在深度', role: WORLDBOOK_DEPTH_ROLES.user },
            { value: WORLDBOOK_POSITIONS.exampleBefore, label: '示例对话前' },
            { value: WORLDBOOK_POSITIONS.exampleAfter, label: '示例对话后' }
        ];

        if (entry?.outlet_name) {
            options.push({ value: WORLDBOOK_POSITIONS.outlet, label: `Outlet (${entry.outlet_name})` });
        }

        return options;
    }

    function renderWorldbookSelectOptions(options, currentValue, currentRole = null) {
        return options.map(option => {
            const isSelected = Number(option.value) === Number(currentValue)
                && (Number(option.value) !== WORLDBOOK_POSITIONS.atDepth || Number(option.role ?? WORLDBOOK_DEPTH_ROLES.system) === Number(currentRole ?? WORLDBOOK_DEPTH_ROLES.system));
            const roleAttr = option.role !== undefined ? ` data-role="${escapeHtml(String(option.role))}"` : '';
            return `<option value="${escapeHtml(String(option.value))}"${roleAttr} ${isSelected ? 'selected' : ''}>${escapeHtml(option.label)}</option>`;
        }).join('');
    }

    const WORLDBOOK_ENTRY_JSON_FIELDS = [
        'operation',
        'action',
        'mode',
        'update',
        'uid',
        'comment',
        'title',
        'name',
        'keys',
        'key',
        'secondary_keys',
        'keysecondary',
        'secondaryKeys',
        'content',
        'entry_content',
        'text',
        'constant',
        'selective',
        'position',
        'depth',
        'role',
        'outlet_name',
        'outletName',
        'placement_reason',
        'position_reason',
        'reason',
        'insertion_order',
        'order',
        'enabled'
    ];

    function cleanWorldbookJsonBlock(rawBlock) {
        let block = String(rawBlock || '').trim();

        if (block.startsWith('```')) {
            block = block.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        }

        const objectStart = block.indexOf('{');
        const objectEnd = block.lastIndexOf('}');
        if (objectStart !== -1 && objectEnd > objectStart) {
            block = block.slice(objectStart, objectEnd + 1).trim();
        }

        return block;
    }

    function parseWorldbookJsonValue(rawValue, fieldName) {
        let value = String(rawValue || '').trim();
        value = value.replace(/,\s*$/, '').trim();

        if (!value) return undefined;

        try {
            return JSON.parse(value);
        } catch (_) {
            // Fall through to tolerant field-level parsing for common model output mistakes.
        }

        const normalizedField = String(fieldName || '').toLowerCase();

        if (normalizedField === 'uid' || normalizedField === 'depth' || normalizedField === 'insertion_order' || normalizedField === 'order') {
            const numericValue = Number(value.replace(/^['"]|['"]$/g, '').trim());
            return Number.isFinite(numericValue) ? numericValue : undefined;
        }

        if (normalizedField === 'constant' || normalizedField === 'selective' || normalizedField === 'enabled' || normalizedField === 'update') {
            const booleanText = value.replace(/^['"]|['"]$/g, '').trim().toLowerCase();
            if (booleanText === 'true') return true;
            if (booleanText === 'false') return false;
            return undefined;
        }

        if (normalizedField === 'keys' || normalizedField === 'key' || normalizedField === 'secondary_keys' || normalizedField === 'keysecondary' || normalizedField === 'secondarykeys') {
            const arrayText = value.replace(/^\[/, '').replace(/\]$/, '').trim();
            if (!arrayText) return [];

            const quotedItems = [];
            arrayText.replace(/["']([^"']+)["']/g, (_, item) => {
                quotedItems.push(item.trim());
                return '';
            });

            if (quotedItems.length > 0) {
                return quotedItems;
            }

            return arrayText
                .split(/[\n,|]/)
                .map(item => item.replace(/^['"]|['"]$/g, '').trim())
                .filter(Boolean);
        }

        return parseWorldbookJsonStringValue(value);
    }

    function parseWorldbookJsonStringValue(value) {
        let text = String(value || '').trim();
        const quote = text[0];

        if ((quote === '"' || quote === "'") && text.endsWith(quote)) {
            text = text.slice(1, -1);
        } else if (quote === '"' || quote === "'") {
            text = text.slice(1);
        }

        return text
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'")
            .replace(/\\\\/g, '\\')
            .trim();
    }

    function parseLooseWorldbookJsonObject(rawBlock) {
        let body = cleanWorldbookJsonBlock(rawBlock);

        if (body.startsWith('{') && body.endsWith('}')) {
            body = body.slice(1, -1);
        }

        const fieldPattern = new RegExp(`(^|[\\n\\r,])\\s*["']?(${WORLDBOOK_ENTRY_JSON_FIELDS.join('|')})["']?\\s*:`, 'g');
        const matches = [];
        let match;

        while ((match = fieldPattern.exec(body)) !== null) {
            matches.push({
                name: match[2],
                start: match.index,
                valueStart: fieldPattern.lastIndex
            });
        }

        if (matches.length === 0) {
            throw new Error('未找到可识别的世界书字段');
        }

        const parsed = {};
        for (let i = 0; i < matches.length; i++) {
            const current = matches[i];
            const next = matches[i + 1];
            const rawValue = body.slice(current.valueStart, next ? next.start : body.length);
            const parsedValue = parseWorldbookJsonValue(rawValue, current.name);

            if (parsedValue !== undefined) {
                parsed[current.name] = parsedValue;
            }
        }

        return parsed;
    }

    function parseWorldbookJsonObject(rawBlock) {
        const cleanedBlock = cleanWorldbookJsonBlock(rawBlock);
        const candidates = [
            cleanedBlock,
            cleanedBlock.replace(/,\s*([}\]])/g, '$1')
        ];
        let strictError = null;

        for (const candidate of candidates) {
            try {
                return JSON.parse(candidate);
            } catch (error) {
                strictError = error;
            }
        }

        try {
            return parseLooseWorldbookJsonObject(cleanedBlock);
        } catch (looseError) {
            throw new Error(`${strictError?.message || 'JSON 解析失败'}；宽松解析也失败: ${looseError.message}`);
        }
    }

    function normalizeWorldbookOperation(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized === 'update' || normalized === 'edit' || normalized === 'modify' || normalized === '更新') {
            return 'update';
        }
        return 'create';
    }

    function parseWorldbookEntryBlocks(text) {
        const regex = /\[(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\]([\s\S]*?)\[\/(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\]/g;
        const entries = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            const rawBlock = match[1].trim();
            try {
                const parsed = parseWorldbookJsonObject(rawBlock);
                const content = String(parsed.content || parsed.entry_content || parsed.text || '').trim();
                const keys = normalizeStringArray(parsed.keys ?? parsed.key);
                const secondaryKeys = normalizeStringArray(parsed.secondary_keys ?? parsed.keysecondary ?? parsed.secondaryKeys);

                const operation = normalizeWorldbookOperation(
                    parsed.operation ?? parsed.action ?? parsed.mode ?? (parsed.update === true ? 'update' : 'create')
                );
                const isUpdate = operation === 'update';
                const parsedUid = Number.isFinite(Number(parsed.uid)) ? Number(parsed.uid) : null;
                if (isUpdate && parsedUid === null) {
                    throw new Error('operation 为 update 时必须提供 uid');
                }

                // 更新时没写的字段为 null，保存时沿用原条目的值
                const has = (...names) => names.some(name => parsed[name] !== undefined && parsed[name] !== null);
                const keepIfMissing = (provided, value) => (isUpdate && !provided ? null : value);

                if (!content && !isUpdate) {
                    throw new Error('缺少 content 字段');
                }

                const fields = {
                    comment: keepIfMissing(has('comment', 'title', 'name'), String(parsed.comment || parsed.title || parsed.name || keys[0] || '未命名条目').trim()),
                    keys: keepIfMissing(has('keys', 'key'), keys),
                    secondary_keys: keepIfMissing(has('secondary_keys', 'keysecondary', 'secondaryKeys'), secondaryKeys),
                    content: content || null,
                    constant: keepIfMissing(has('constant'), parsed.constant === true),
                    selective: keepIfMissing(has('selective'), parsed.selective !== undefined ? Boolean(parsed.selective) : parsed.constant !== true),
                    enabled: keepIfMissing(has('enabled'), parsed.enabled !== false)
                };
                if (isUpdate && Object.values(fields).every(value => value === null)) {
                    throw new Error('更新条目时没有写任何要修改的字段');
                }

                entries.push({
                    operation,
                    uid: isUpdate ? parsedUid : null,
                    comment: fields.comment,
                    keys: fields.keys,
                    secondary_keys: fields.secondary_keys,
                    content: fields.content,
                    constant: fields.constant,
                    selective: fields.selective,
                    position: normalizeWorldbookPosition(parsed.position),
                    depth: Number.isFinite(Number(parsed.depth)) ? Number(parsed.depth) : null,
                    role: normalizeWorldbookRole(parsed.role),
                    outlet_name: String(parsed.outlet_name || parsed.outletName || '').trim(),
                    placement_reason: String(parsed.placement_reason || parsed.position_reason || parsed.reason || '').trim(),
                    insertion_order: Number.isFinite(Number(parsed.insertion_order ?? parsed.order))
                        ? Number(parsed.insertion_order ?? parsed.order)
                        : 100,
                    enabled: fields.enabled,
                    start: match.index,
                    end: regex.lastIndex
                });
                if (operation === 'update') {
                    keepExistingWorldbookPlacement(entries[entries.length - 1]);
                }
            } catch (error) {
                entries.push({
                    invalid: true,
                    raw: rawBlock,
                    error: error.message,
                    start: match.index,
                    end: regex.lastIndex
                });
            }
        }

        return entries;
    }

    // 更新已有条目时沿用用户原本的位置、深度、role 和顺序，不采用 AI 给出的值。
    // 找不到已加载的原条目时置空，保存时会回落到世界书里该条目的现有设置。
    function keepExistingWorldbookPlacement(entry) {
        const existing = (window._fmgWorldEntries || []).find(item => Number(item.uid) === Number(entry.uid)) || null;

        entry.keep_placement = true;
        entry.position = existing ? normalizeWorldbookPosition(existing.position) : null;
        entry.depth = existing?.depth ?? null;
        entry.role = existing?.role ?? null;
        entry.outlet_name = existing?.outletName || '';
        entry.insertion_order = existing?.order ?? null;
        entry.placement_reason = '';
    }

    function renderWorldbookEntryCard(entry, entryKey, cardIndex) {
        if (entry.invalid) {
            return `
                <div class="fmg-worldbook-card invalid">
                    <div class="fmg-worldbook-card-header">⚠️ 世界书条目解析失败</div>
                    <div class="fmg-worldbook-meta">
                        <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">原因</span><span>${escapeHtml(entry.error || '未知错误')}</span></div>
                    </div>
                    <div class="fmg-edit-card-new">
                        <div class="fmg-edit-card-label-static">原始内容</div>
                        <div class="fmg-edit-card-new-content">${escapeHtml(entry.raw || '')}</div>
                    </div>
                </div>
            `;
        }

        // 更新时没写的字段（null）显示原条目的值并标注沿用
        const existing = entry.uid !== null ? findLoadedWorldEntry(entry.uid) : null;
        const keptText = (value) => (existing ? `${value}（沿用）` : '沿用原设置');
        const listText = (list) => (list.length > 0 ? list.join(', ') : '（无）');
        const effectiveConstant = entry.constant ?? existing?.constant ?? false;
        const triggerLabel = effectiveConstant ? '常驻条目' : '关键词触发';
        const triggerMode = entry.constant === null ? keptText(triggerLabel) : triggerLabel;
        const keysText = entry.keys === null ? keptText(listText(existing?.key || [])) : listText(entry.keys);
        const secondaryText = entry.secondary_keys === null
            ? keptText(listText(existing?.keysecondary || []))
            : listText(entry.secondary_keys);
        const contentText = entry.content === null ? '（沿用原内容，不修改）' : entry.content;
        const titleText = entry.comment || existing?.comment || (entry.uid !== null ? `#${entry.uid}` : '未命名条目');
        const modeLabel = entry.uid !== null ? `更新现有条目 #${entry.uid}（沿用原位置/深度/顺序）` : '新增条目';
        const hasPosition = entry.position !== null && entry.position !== undefined;
        const hasOrder = Number.isFinite(Number(entry.insertion_order)) && entry.insertion_order !== null;
        const actionLabel = entry.uid !== null ? '✅ 更新世界书条目' : '✅ 添加到世界书';
        const positionDetail = Number(entry.position) === WORLDBOOK_POSITIONS.atDepth
            ? `depth=${entry.depth ?? 4}, role=${getWorldbookRoleLabel(entry.role)}`
            : Number(entry.position) === WORLDBOOK_POSITIONS.outlet
                ? (entry.outlet_name || '未指定')
                : '';
        const currentPosition = entry.position ?? WORLDBOOK_POSITIONS.before;
        const currentRole = entry.role ?? WORLDBOOK_DEPTH_ROLES.system;
        const currentOrder = hasOrder ? Number(entry.insertion_order) : 100;
        const positionText = hasPosition || !entry.keep_placement
            ? getWorldbookPositionLabel(currentPosition, currentRole, entry.outlet_name)
            : '保持原设置';
        const orderText = hasOrder || !entry.keep_placement ? String(currentOrder) : '保持原设置';
        const positionOptionsHtml = renderWorldbookSelectOptions(getWorldbookPositionOptions(entry), currentPosition, currentRole);

        return `
            <div class="fmg-worldbook-card" data-entry-key="${entryKey}" data-card-index="${cardIndex}">
                <div class="fmg-worldbook-card-header">📚 世界书条目建议：${escapeHtml(titleText)}</div>
                <div class="fmg-worldbook-meta">
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">操作类型</span><span>${escapeHtml(modeLabel)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">主关键词</span><span>${escapeHtml(keysText)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">次关键词</span><span>${escapeHtml(secondaryText)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">触发方式</span><span class="fmg-worldbook-trigger-value">${escapeHtml(triggerMode)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">注入位置</span><span class="fmg-worldbook-position-value">${escapeHtml(positionText)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">插入顺序</span><span class="fmg-worldbook-order-value">${escapeHtml(orderText)}</span></div>
                    ${positionDetail ? `<div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">位置细节</span><span>${escapeHtml(positionDetail)}</span></div>` : ''}
                    ${entry.placement_reason ? `<div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">放置理由</span><span>${escapeHtml(entry.placement_reason)}</span></div>` : ''}
                </div>
                <div class="fmg-edit-card-new">
                    <div class="fmg-edit-card-label-static">📝 条目内容</div>
                    <div class="fmg-edit-card-new-content">${escapeHtml(contentText)}</div>
                </div>
                <div class="fmg-worldbook-controls">
                    <div class="fmg-worldbook-control-row">
                        <span class="fmg-worldbook-control-label">状态</span>
                        <div class="fmg-worldbook-state-group">
                            <label class="fmg-worldbook-state-chip blue">
                                <input class="fmg-worldbook-state-input" type="checkbox" data-entry-key="${entryKey}" data-state="constant" ${effectiveConstant ? 'checked' : ''}>
                                <span>蓝灯</span>
                            </label>
                            <label class="fmg-worldbook-state-chip green">
                                <input class="fmg-worldbook-state-input" type="checkbox" data-entry-key="${entryKey}" data-state="normal" ${effectiveConstant ? '' : 'checked'}>
                                <span>绿灯</span>
                            </label>
                        </div>
                    </div>
                    <div class="fmg-worldbook-control-row">
                        <label class="fmg-worldbook-control-label" for="fmg-worldbook-position-${escapeHtml(entryKey)}">位置</label>
                        <select class="fmg-worldbook-select fmg-worldbook-position-select" id="fmg-worldbook-position-${escapeHtml(entryKey)}" data-entry-key="${entryKey}">
                            ${positionOptionsHtml}
                        </select>
                    </div>
                    <div class="fmg-worldbook-control-row">
                        <label class="fmg-worldbook-control-label" for="fmg-worldbook-order-${escapeHtml(entryKey)}">顺序</label>
                        <input class="fmg-worldbook-input fmg-worldbook-order-input" id="fmg-worldbook-order-${escapeHtml(entryKey)}" data-entry-key="${entryKey}" type="number" step="1" value="${hasOrder || !entry.keep_placement ? escapeHtml(String(currentOrder)) : ''}" placeholder="保持原顺序">
                    </div>
                </div>
                <div class="fmg-edit-card-actions">
                    <button class="fmg-btn fmg-btn-primary fmg-worldbook-apply" data-entry-key="${entryKey}">${actionLabel}</button>
                    <button class="fmg-btn fmg-btn-secondary fmg-worldbook-ignore" data-entry-key="${entryKey}">❌ 忽略</button>
                </div>
            </div>
        `;
    }

    // 新条目使用干净的默认值，不复制已有条目（否则会继承它的概率、分组、sticky 等设置）
    function createWorldbookEntryShell(existingEntries) {
        const nextNumber = (field) => {
            const values = existingEntries.map(entry => Number(entry[field])).filter(Number.isFinite);
            return values.length > 0 ? Math.max(...values) + 1 : 0;
        };

        return {
            uid: nextNumber('uid'),
            displayIndex: nextNumber('displayIndex'),
            key: [],
            keysecondary: [],
            comment: '',
            content: '',
            constant: false,
            vectorized: false,
            selective: true,
            selectiveLogic: 0,
            addMemo: false,
            order: 100,
            position: 0,
            disable: false,
            ignoreBudget: false,
            excludeRecursion: false,
            preventRecursion: false,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            delayUntilRecursion: 0,
            probability: 100,
            useProbability: true,
            depth: 4,
            outletName: '',
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: null,
            matchWholeWords: null,
            useGroupScoring: null,
            automationId: '',
            role: 0,
            sticky: null,
            cooldown: null,
            delay: null
        };
    }

    let worldbookSaveQueue = Promise.resolve();

    // 以 ST 的内存缓存为准：saveWorldInfo 默认防抖 1 秒才写盘，这段时间里服务器上还是旧数据，
    // 从服务器读会丢掉刚添加的条目和世界书编辑器里尚未写盘的修改
    async function loadWorldInfoDataForSave(context, worldName) {
        const data = await context.loadWorldInfo(worldName);
        return data ? structuredClone(data) : null;
    }

    // 立即写盘并回读确认；ST 的 _save 不检查响应状态，失败时不会报错
    async function saveWorldInfoNow(context, worldName, data, expectedEntry) {
        await context.saveWorldInfo(worldName, data, true);

        const headers = typeof context.getRequestHeaders === 'function'
            ? context.getRequestHeaders()
            : { 'Content-Type': 'application/json' };
        const response = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers,
            body: JSON.stringify({ name: worldName }),
            cache: 'no-cache'
        });
        if (!response.ok) {
            throw new Error(`保存后读取世界书失败 (${response.status})，请到世界书页确认是否已保存`);
        }

        const savedData = await response.json();
        const savedEntry = savedData?.entries
            ? Object.values(savedData.entries).find(entry => Number(entry.uid) === Number(expectedEntry.uid))
            : null;
        if (!savedEntry || savedEntry.content !== expectedEntry.content) {
            throw new Error('保存后校验失败：服务器上的世界书没有这条内容，请重试');
        }
    }

    async function persistWorldbookEntry(entryData) {
        const queuedSave = worldbookSaveQueue
            .catch(() => {})
            .then(() => persistWorldbookEntryUnlocked(entryData));

        worldbookSaveQueue = queuedSave.catch(() => {});
        return queuedSave;
    }

    async function persistWorldbookEntryUnlocked(entryData) {
        const context = SillyTavern.getContext();
        const char = getCurrentCharacterForWrite(context);
        const worldName = char?.data?.extensions?.world;
        if (!worldName) throw new Error('角色未关联外部世界书，请先在角色卡中关联世界书');
        if (typeof context.loadWorldInfo !== 'function' || typeof context.saveWorldInfo !== 'function') {
            throw new Error('当前 ST 上下文缺少世界书保存接口');
        }

        const loadedData = await loadWorldInfoDataForSave(context, worldName);
        const worldEntries = loadedData?.entries ? Object.values(loadedData.entries) : [];
        const shouldUpdate = entryData.operation === 'update';
        const requestedUid = shouldUpdate && Number.isFinite(Number(entryData.uid)) ? Number(entryData.uid) : null;
        let targetEntry = null;
        let isUpdate = false;

        if (shouldUpdate) {
            if (requestedUid === null) {
                throw new Error('更新世界书条目时缺少有效 uid');
            }

            targetEntry = worldEntries.find(entry => Number(entry.uid) === requestedUid);
            if (!targetEntry) {
                throw new Error(`找不到要更新的世界书条目 #${requestedUid}`);
            }
            isUpdate = true;
        }

        if (!targetEntry) {
            targetEntry = createWorldbookEntryShell(worldEntries);
            worldEntries.push(targetEntry);
        }

        // 更新时没给的字段（null/undefined）沿用原条目；局部修改按写入前的最新正文定位替换
        if (entryData.patches && !isUpdate) throw new Error('局部修改只能用于已有条目');
        const content = entryData.patches
            ? applyPatchHunks(String(targetEntry.content ?? ''), entryData.patches)
            : (entryData.content ?? targetEntry.content ?? '');
        const keys = entryData.keys ?? targetEntry.key ?? [];
        const constant = (entryData.constant ?? targetEntry.constant) === true;
        if (!constant && keys.length === 0) {
            throw new Error('非常驻条目至少需要一个主关键词');
        }
        const comment = entryData.comment ?? targetEntry.comment ?? '';
        const resolvedPosition = entryData.position ?? targetEntry.position ?? WORLDBOOK_POSITIONS.before;

        Object.assign(targetEntry, {
            key: keys,
            keysecondary: entryData.secondary_keys ?? targetEntry.keysecondary ?? [],
            comment,
            content,
            constant,
            vectorized: (entryData.vectorized ?? targetEntry.vectorized) === true,
            selective: constant ? false : (entryData.selective ?? targetEntry.selective) !== false,
            order: entryData.insertion_order ?? targetEntry.order ?? 100,
            position: resolvedPosition,
            depth: resolvedPosition === WORLDBOOK_POSITIONS.atDepth
                ? (entryData.depth ?? targetEntry.depth ?? 4)
                : targetEntry.depth ?? 4,
            role: resolvedPosition === WORLDBOOK_POSITIONS.atDepth
                ? (entryData.role ?? targetEntry.role ?? WORLDBOOK_DEPTH_ROLES.system)
                : null,
            outletName: resolvedPosition === WORLDBOOK_POSITIONS.outlet
                ? (entryData.outlet_name || targetEntry.outletName || '')
                : '',
            disable: entryData.enabled === null || entryData.enabled === undefined
                ? targetEntry.disable === true
                : entryData.enabled === false,
            addMemo: !!comment
        });

        if (targetEntry.position === WORLDBOOK_POSITIONS.outlet && !targetEntry.outletName) {
            throw new Error('position 为 outlet 时必须提供 outlet_name');
        }

        const finalFormat = {
            ...(loadedData && typeof loadedData === 'object' ? loadedData : {}),
            entries: Object.fromEntries(worldEntries.map(entry => [entry.uid, entry]))
        };
        await saveWorldInfoNow(context, worldName, finalFormat, targetEntry);
        await syncWorldInfoDisplay(worldName, finalFormat);
        if (typeof context.reloadWorldInfoEditor === 'function') {
            context.reloadWorldInfoEditor(worldName, true);
        }

        const savedSelections = getSavedWorldInfoSelections();
        // 只记录 uid；按标题或关键词记录会顺带勾选同名的其他条目
        const persistedIdentifier = getWorldInfoIdentifier(targetEntry, worldEntries.indexOf(targetEntry));
        const mergedSelections = [...new Set([...savedSelections, persistedIdentifier])];
        if (mergedSelections.length !== savedSelections.length) {
            setSavedWorldInfoSelections(mergedSelections);
            saveSettings();
        }

        return {
            context,
            targetEntry,
            worldName,
            isUpdate
        };
    }

    async function applyWorldbookEntry(entryData, buttonEl) {
        const statusId = 'fmg-discuss-status';
        try {
            const result = await persistWorldbookEntry(entryData);

            if (buttonEl) {
                setCardState(buttonEl.closest('.fmg-worldbook-card'), result.isUpdate ? 'updated' : 'added');
            }

            showStatus(statusId, 'success', `已${result.isUpdate ? '更新' : '添加'}世界书：${result.targetEntry.comment || entryData.label || '未命名条目'}`);
            if (typeof toastr !== 'undefined') toastr.success(`世界书条目已${result.isUpdate ? '更新' : '添加'}`);
            await loadWorldInfoList(result.context, true);
            requestDiscussTokenCountUpdate();

        } catch (error) {
            console.error('[开场白生成器] 添加世界书条目失败:', error);
            showStatus(statusId, 'error', '添加失败: ' + error.message);
            if (typeof toastr !== 'undefined') toastr.error('添加世界书条目失败: ' + error.message);
            if (buttonEl) {
                buttonEl.textContent = '⚠️ 重试';
                buttonEl.disabled = false;
            }
        }
    }

    async function sendDiscussMessage() {
        if (isDiscussGenerating) return;

        const input = document.getElementById('fmg-discuss-input');
        const userText = input.value.trim();
        if (!userText) return;

        if (!settings.apiUrl) {
            showStatus('fmg-discuss-status', 'error', '请先在API页面配置API');
            return;
        }

        // 检查角色数据
        if (!window._fmgCharData) {
            showStatus('fmg-discuss-status', 'error', '请先选择角色并刷新数据');
            return;
        }

        // 清空输入框
        input.value = '';

        const userMessage = createChatMessage('user', userText);

        // 显示用户消息
        appendChatMessage('user', userText, false, userMessage.id);

        syncDiscussSystemPrompt();

        // 添加用户消息到历史
        discussMessages.push(userMessage);
        requestDiscussTokenCountUpdate();

        // 开始流式生成
        isDiscussGenerating = true;
        const sendBtn = document.getElementById('fmg-discuss-send');
        if (sendBtn) {
            sendBtn.textContent = '⏹ 停止';
            sendBtn.classList.remove('fmg-btn-primary');
            sendBtn.classList.add('fmg-btn-danger');
        }
        updateDiscussUndoButton();

        try {
            const { controller, promise } = startChatStream([...discussMessages], {
                onChunk: (content) => {
                    appendChatMessage('assistant', content, true);
                },
                onDone: (finalContent) => {
                    const assistantMessage = createChatMessage('assistant', finalContent);
                    discussMessages.push(assistantMessage);
                    appendChatMessage('assistant', finalContent, false, assistantMessage.id);
                    saveChatSession();
                    requestDiscussTokenCountUpdate();
                    finishDiscussGeneration();
                },
                onError: (error) => {
                    appendChatMessage('assistant', '❌ 错误: ' + error.message, false);
                    finishDiscussGeneration();
                    showStatus('fmg-discuss-status', 'error', '生成失败: ' + error.message);
                }
            });
            discussAbortController = controller;
            await promise;
            if (discussAbortController === controller) discussAbortController = null;
        } catch (e) {
            appendChatMessage('assistant', '❌ 错误: ' + e.message, false);
            finishDiscussGeneration();
        }
    }

    function stopDiscussGeneration() {
        if (discussAbortController) {
            discussAbortController.abort();
            discussAbortController = null;
        }
        // 移除流式标记，保留已生成内容
        const streaming = document.querySelector('.fmg-chat-bubble.streaming');
        if (streaming) {
            streaming.classList.remove('streaming');
            const cursor = streaming.querySelector('.fmg-cursor');
            if (cursor) cursor.remove();
            // 保存已生成的内容到历史
            const textEl = streaming.querySelector('.fmg-chat-text');
            if (textEl && textEl.textContent.trim()) {
                discussMessages.push(createChatMessage('assistant', textEl.textContent));
                saveChatSession();
                requestDiscussTokenCountUpdate();
                renderDiscussionHistory();
            }
        }
        finishDiscussGeneration();
    }

    function finishDiscussGeneration() {
        isDiscussGenerating = false;
        const sendBtn = document.getElementById('fmg-discuss-send');
        if (sendBtn) {
            sendBtn.textContent = '发送';
            sendBtn.classList.remove('fmg-btn-danger');
            sendBtn.classList.add('fmg-btn-primary');
        }
        updateDiscussUndoButton();
    }

    function clearDiscussion() {
        // 停止进行中的生成
        if (isDiscussGenerating) stopDiscussGeneration();

        discussMessages = [];
        currentDiscussSessionId = null;
        discussAutoScroll = true;
        renderDiscussionHistory();
        requestDiscussTokenCountUpdate();
        renderChatSessionControls();

        hideStatus('fmg-discuss-status');
    }

    // ========================================
    // 流式 API 调用
    // ========================================

    /**
     * 发起一次流式对话请求，每次调用使用独立的 AbortController。
     * 完成时调用 onDone，出错时调用 onError，被中断时两者都不调用。
     * @returns {{ controller: AbortController, promise: Promise<void> }}
     */
    function startChatStream(messages, { onChunk, onDone, onError }) {
        const controller = new AbortController();
        const promise = streamChat(messages, { signal: controller.signal, onChunk })
            .then(onDone, (error) => {
                if (error?.name === 'AbortError') {
                    console.log('[开场白生成器] 请求已中断');
                    return;
                }
                onError(error);
            });
        return { controller, promise };
    }

    async function streamChat(messages, { signal, onChunk }) {
        const isOpenAI = settings.apiType === 'openai';
        const request = isOpenAI ? buildOpenAIRequest(messages) : buildGeminiRequest(messages);
        const response = await fetch(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify(request.body),
            signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const extractChunk = isOpenAI ? extractOpenAIChunk : extractGeminiChunk;
        let fullContent = '';
        let finishReason = '';

        await readEventStream(response, (json) => {
            const { text, finish, error } = extractChunk(json);
            if (error) throw new Error(error);
            if (finish) finishReason = finish;
            if (text) {
                fullContent += text;
                if (onChunk) onChunk(fullContent);
            }
        });

        // 被安全过滤或上游出错时可能只返回结束原因，不能当作空回复静默成功
        if (!fullContent.trim()) {
            throw new Error(finishReason ? `模型没有返回内容（结束原因：${finishReason}）` : '模型没有返回内容');
        }
        return fullContent;
    }

    function buildOpenAIRequest(messages) {
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;

        return {
            url: settings.apiUrl.replace(/\/$/, '') + '/chat/completions',
            headers,
            body: {
                model: settings.model,
                messages,
                temperature: normalizeTemperature(settings.temperature),
                ...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
                stream: true
            }
        };
    }

    function buildGeminiRequest(messages) {
        const systemParts = [];
        const contents = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemParts.push(msg.content);
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content }]
                });
            }
        }

        const body = {
            contents,
            generationConfig: {
                temperature: normalizeTemperature(settings.temperature),
                ...(settings.maxTokens ? { maxOutputTokens: settings.maxTokens } : {})
            }
        };
        if (systemParts.length > 0) {
            body.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
        }

        // Key 放在查询参数里，兼容只认 ?key= 的 Gemini 格式中转
        const keyParam = settings.apiKey ? `key=${encodeURIComponent(settings.apiKey)}&` : '';
        return {
            url: `${settings.apiUrl.replace(/\/$/, '')}/models/${settings.model}:streamGenerateContent?${keyParam}alt=sse`,
            headers: { 'Content-Type': 'application/json' },
            body
        };
    }

    // 同时兼容流式增量（delta）和不支持流式时返回的完整消息（message）
    function extractOpenAIChunk(json) {
        if (json.error) {
            return { error: `API错误: ${json.error.message || JSON.stringify(json.error)}` };
        }
        const choice = json.choices?.[0];
        return {
            text: choice?.delta?.content ?? choice?.message?.content ?? '',
            finish: choice?.finish_reason || ''
        };
    }

    function extractGeminiChunk(json) {
        if (json.error) {
            return { error: `Gemini错误: ${json.error.message || JSON.stringify(json.error)}` };
        }
        const candidate = json.candidates?.[0];
        const text = (candidate?.content?.parts || [])
            .filter(part => !part.thought)
            .map(part => part.text || '')
            .join('');
        return {
            text,
            finish: json.promptFeedback?.blockReason || candidate?.finishReason || ''
        };
    }

    /**
     * 逐条解析 SSE（data: ...）事件。响应不是 SSE 时，把整个响应体当作一个 JSON 事件。
     */
    async function readEventStream(response, onEvent) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let rawText = '';
        let sawEvent = false;

        const handleLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const data = trimmed.slice(5).trim();
            sawEvent = true;
            if (!data || data === '[DONE]') return;

            let json;
            try {
                json = JSON.parse(data);
            } catch (e) {
                console.warn('[开场白生成器] 解析流数据失败:', data, e);
                return;
            }
            onEvent(json);
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            rawText += text;
            buffer += text;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            lines.forEach(handleLine);
        }

        const tail = decoder.decode();
        rawText += tail;
        buffer += tail;
        if (buffer) handleLine(buffer);

        if (!sawEvent && rawText.trim()) {
            let json;
            try {
                json = JSON.parse(rawText);
            } catch (_) {
                throw new Error('无法解析 API 响应：' + rawText.trim().slice(0, 200));
            }
            onEvent(json);
        }
    }

    // ========================================
    // API功能
    // ========================================

    async function testConnection() {
        const statusEl = document.getElementById('fmg-api-status');
        const apiType = document.getElementById('fmg-api-type').value;
        const apiUrl = document.getElementById('fmg-api-url').value.trim();
        const apiKey = document.getElementById('fmg-api-key').value.trim();

        if (!apiUrl) {
            showStatus('fmg-api-status', 'error', '请填写API URL');
            return;
        }

        showStatus('fmg-api-status', 'loading', '测试连接中...');

        try {
            if (apiType === 'openai') {
                await testOpenAI(apiUrl, apiKey);
            } else {
                await testGemini(apiUrl, apiKey);
            }
            showStatus('fmg-api-status', 'success', '连接成功！');
        } catch (e) {
            showStatus('fmg-api-status', 'error', '连接失败: ' + e.message);
        }
    }

    async function testOpenAI(baseUrl, apiKey) {
        const url = baseUrl.replace(/\/$/, '') + '/models';
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const response = await fetch(url, { method: 'GET', headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    async function testGemini(baseUrl, apiKey) {
        const url = baseUrl.replace(/\/$/, '') + '/models' + (apiKey ? `?key=${encodeURIComponent(apiKey)}` : '');
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    async function getModels() {
        const statusEl = document.getElementById('fmg-api-status');
        const modelSelect = document.getElementById('fmg-model');
        const apiType = document.getElementById('fmg-api-type').value;
        const apiUrl = document.getElementById('fmg-api-url').value.trim();
        const apiKey = document.getElementById('fmg-api-key').value.trim();

        if (!apiUrl) {
            showStatus('fmg-api-status', 'error', '请填写API URL');
            return;
        }

        showStatus('fmg-api-status', 'loading', '获取模型列表...');

        try {
            let models = [];

            if (apiType === 'openai') {
                const result = await testOpenAI(apiUrl, apiKey);
                models = (result.data || []).map(m => m.id).sort();
            } else {
                const result = await testGemini(apiUrl, apiKey);
                models = (result.models || []).map(m => m.name.replace('models/', '')).sort();
            }

            if (models.length === 0) {
                showStatus('fmg-api-status', 'error', '未找到可用模型');
                return;
            }

            modelSelect.innerHTML = models.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
            // 模型列表只暂存在下拉框中，点击保存时才写入方案

            showStatus('fmg-api-status', 'success', `找到 ${models.length} 个模型，选择后请点击保存`);
        } catch (e) {
            showStatus('fmg-api-status', 'error', '获取失败: ' + e.message);
        }
    }

    function saveApiSettings() {
        const apiType = document.getElementById('fmg-api-type').value;
        const apiUrl = document.getElementById('fmg-api-url').value.trim();
        const apiKey = document.getElementById('fmg-api-key').value.trim();
        const model = document.getElementById('fmg-model').value;
        const temperature = normalizeTemperature(document.getElementById('fmg-api-temperature').value);
        const maxTokens = normalizeMaxTokens(document.getElementById('fmg-api-max-tokens').value);
        const modelSelect = document.getElementById('fmg-model');
        const models = Array.from(modelSelect.options).map(o => o.value).filter(Boolean);
        let name = document.getElementById('fmg-api-profile-name').value.trim();

        if (!apiUrl) {
            showStatus('fmg-api-status', 'error', '请填写API URL');
            return;
        }
        if (!name) name = buildProfileName(apiType, apiUrl, model) || '未命名配置';

        const profiles = getApiProfiles();
        const selectedId = document.getElementById('fmg-api-profile').value;
        let profile = selectedId ? profiles.find(p => p.id === selectedId) : null;
        const isNew = !profile;

        if (!profile) {
            profile = { id: generateProfileId() };
            profiles.push(profile);
        }
        Object.assign(profile, { name, apiType, apiUrl, apiKey, model, models, temperature, maxTokens });

        applyApiProfile(profile);
        saveSettings();
        renderApiProfileSelect();
        document.getElementById('fmg-api-profile-name').value = name;
        showStatus('fmg-api-status', 'success', isNew ? `已新建并启用「${name}」` : `「${name}」已保存并启用`);
    }

    // ========================================
    // 工具函数
    // ========================================

    // 浮动提示（讨论页）自动消失的时间；loading 一直显示，直到被下一条替换
    const STATUS_TOAST_DURATION = { success: 2500, error: 6000 };
    const statusToastTimers = {};

    function hideStatus(elementId) {
        clearTimeout(statusToastTimers[elementId]);
        const el = document.getElementById(elementId);
        if (el) el.style.display = 'none';
    }

    function showStatus(elementId, type, message) {
        const el = document.getElementById(elementId);
        if (!el) return;

        const isToast = el.classList.contains('fmg-status-toast');
        el.style.display = 'block';
        el.className = 'fmg-status ' + (isToast ? 'fmg-status-toast ' : '') + type;

        if (type === 'loading') {
            el.innerHTML = '<span class="fmg-loading"></span>' + escapeHtml(message);
        } else {
            el.textContent = message;
        }

        if (isToast) {
            clearTimeout(statusToastTimers[elementId]);
            const duration = STATUS_TOAST_DURATION[type];
            if (duration) statusToastTimers[elementId] = setTimeout(() => hideStatus(elementId), duration);
        }
    }

    const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    // 同时转义引号，结果也能安全放进 HTML 属性值
    function escapeHtml(text) {
        return String(text ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]);
    }

    // ========================================
    // 启动
    // ========================================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(init, 1000);
        });
    } else {
        setTimeout(init, 1000);
    }

})();
