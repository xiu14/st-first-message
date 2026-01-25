/**
 * 开场白生成器 - SillyTavern Extension
 * 功能：选择预设、世界书条目、角色卡信息，通过AI生成开场白并应用
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
        // 数据选择状态
        includeDescription: true,
        includePersonality: true,
        includeScenario: true,
        includeCurrentFirstMes: true,
        selectedWorldEntries: []
    };

    let settings = { ...DEFAULT_SETTINGS };

    // ========================================
    // 初始化
    // ========================================

    async function init() {
        console.log('[开场白生成器] 初始化中...');

        loadSettings();
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
                return;
            }

            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
                console.log('[开场白生成器] 从 localStorage 加载设置');
                saveSettings();
            }
        } catch (e) {
            console.error('[开场白生成器] 加载设置失败:', e);
        }
    }

    async function saveSettings() {
        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (context && context.extensionSettings) {
                context.extensionSettings[EXTENSION_NAME] = { ...settings };
                if (typeof context.saveSettingsDebounced === 'function') {
                    context.saveSettingsDebounced();
                }
                console.log('[开场白生成器] 设置已保存');
            }
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
        } catch (e) {
            console.error('[开场白生成器] 保存设置失败:', e);
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
        menuItem.title = '开场白生成器';

        const icon = document.createElement('div');
        icon.className = 'fa-fw fa-solid fa-message extensionsMenuExtensionButton';

        const text = document.createElement('span');
        text.textContent = '开场白生成器';

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
                <h3>💬 开场白生成器</h3>
                <button class="fmg-close-btn">×</button>
            </div>
            
            <div class="fmg-tabs">
                <button class="fmg-tab active" data-tab="generate">生成</button>
                <button class="fmg-tab" data-tab="api">API</button>
            </div>
            
            <div class="fmg-content">
                <!-- 生成页 -->
                <div class="fmg-tab-content active" data-tab="generate">
                    <!-- 角色信息区 -->
                    <div class="fmg-section">
                        <div class="fmg-section-header">
                            <h4>👤 角色信息</h4>
                            <span class="fmg-char-name" id="fmg-char-name">未选择角色</span>
                        </div>
                        <div class="fmg-checkbox-group">
                            <label><input type="checkbox" id="fmg-inc-desc" checked> 描述</label>
                            <label><input type="checkbox" id="fmg-inc-pers" checked> 性格</label>
                            <label><input type="checkbox" id="fmg-inc-scen" checked> 场景</label>
                            <label><input type="checkbox" id="fmg-inc-first" checked> 当前开场白</label>
                        </div>
                        <div class="fmg-data-preview" id="fmg-data-preview">
                            <div style="color: #888; font-size: 11px;">点击刷新加载数据预览</div>
                        </div>
                    </div>
                    
                    <!-- 世界书区 -->
                    <div class="fmg-section">
                        <div class="fmg-section-header">
                            <h4>📚 世界书条目</h4>
                            <div class="fmg-btn-group">
                                <button class="fmg-btn-small" id="fmg-wi-all">全选</button>
                                <button class="fmg-btn-small" id="fmg-wi-none">清空</button>
                            </div>
                        </div>
                        <div class="fmg-wi-list" id="fmg-wi-list">
                            <div style="color: #888;">加载中...</div>
                        </div>
                    </div>
                    
                    <!-- 需求输入 -->
                    <div class="fmg-section">
                        <label>✍️ 开场白需求</label>
                        <textarea id="fmg-prompt" class="fmg-textarea" 
                            placeholder="描述你想要的开场白风格...&#10;例如：神秘感、第一人称视角、包含环境描写"></textarea>
                    </div>
                    
                    <!-- 操作按钮 -->
                    <div class="fmg-actions">
                        <button class="fmg-btn fmg-btn-secondary" id="fmg-refresh">🔄 刷新</button>
                        <button class="fmg-btn fmg-btn-primary" id="fmg-generate">✨ 生成开场白</button>
                    </div>
                    
                    <div id="fmg-status" class="fmg-status" style="display: none;"></div>
                </div>
                
                <!-- API设置页 -->
                <div class="fmg-tab-content" data-tab="api">
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
                        <label>API Key</label>
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
        document.getElementById('fmg-api-type').value = settings.apiType;
        document.getElementById('fmg-api-url').value = settings.apiUrl;
        document.getElementById('fmg-api-key').value = settings.apiKey;

        const modelSelect = document.getElementById('fmg-model');
        modelSelect.innerHTML = '';
        if (settings.models && settings.models.length > 0) {
            settings.models.forEach(m => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                modelSelect.appendChild(opt);
            });
            modelSelect.value = settings.model;
        } else {
            modelSelect.innerHTML = '<option value="">请先获取模型列表</option>';
        }

        document.getElementById('fmg-inc-desc').checked = settings.includeDescription;
        document.getElementById('fmg-inc-pers').checked = settings.includePersonality;
        document.getElementById('fmg-inc-scen').checked = settings.includeScenario;
        document.getElementById('fmg-inc-first').checked = settings.includeCurrentFirstMes;
    }

    // ========================================
    // 事件绑定
    // ========================================

    function bindEvents() {
        // 关闭和遮罩
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('fmg-close-btn')) closePopup();
            if (e.target.id === 'fmg-overlay') closePopup();
        });

        // 标签页
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('fmg-tab')) {
                switchTab(e.target.dataset.tab);
            }
        });

        // 刷新
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-refresh') loadCharacterData();
        });

        // 生成
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-generate') generateFirstMessage();
        });

        // API相关
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-test') testConnection();
            if (e.target.id === 'fmg-get-models') getModels();
            if (e.target.id === 'fmg-save-api') saveApiSettings();
        });

        // 世界书全选/清空
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wi-all') selectAllWorldInfo(true);
            if (e.target.id === 'fmg-wi-none') selectAllWorldInfo(false);
        });

        // ESC关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closePopup();
        });

        // 复选框变化保存
        document.addEventListener('change', (e) => {
            if (e.target.id === 'fmg-inc-desc') settings.includeDescription = e.target.checked;
            if (e.target.id === 'fmg-inc-pers') settings.includePersonality = e.target.checked;
            if (e.target.id === 'fmg-inc-scen') settings.includeScenario = e.target.checked;
            if (e.target.id === 'fmg-inc-first') settings.includeCurrentFirstMes = e.target.checked;
        });
    }

    // ========================================
    // 弹窗控制
    // ========================================

    function openPopup() {
        document.getElementById('fmg-overlay').classList.add('show');
        document.getElementById('fmg-popup').classList.add('show');
        loadCharacterData();
    }

    function closePopup() {
        document.getElementById('fmg-overlay').classList.remove('show');
        document.getElementById('fmg-popup').classList.remove('show');
    }

    function switchTab(tabName) {
        document.querySelectorAll('.fmg-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });
        document.querySelectorAll('.fmg-tab-content').forEach(content => {
            content.classList.toggle('active', content.dataset.tab === tabName);
        });
    }

    // ========================================
    // 数据加载
    // ========================================

    function loadCharacterData() {
        try {
            const context = SillyTavern.getContext();
            console.log('[开场白生成器] context:', context);
            console.log('[开场白生成器] characterId:', context.characterId);

            // 显示角色名
            const charNameEl = document.getElementById('fmg-char-name');
            const dataPreviewEl = document.getElementById('fmg-data-preview');

            if (context.characterId !== undefined && context.characters[context.characterId]) {
                const char = context.characters[context.characterId];
                console.log('[开场白生成器] 角色数据:', char);
                console.log('[开场白生成器] char.data:', char.data);
                console.log('[开场白生成器] character_book:', char.data?.character_book);

                charNameEl.textContent = char.name || '未命名角色';
                charNameEl.classList.add('active');

                // 生成数据预览
                const previews = [];
                const desc = char.description || char.data?.description;
                const pers = char.personality || char.data?.personality;
                const scen = char.scenario || char.data?.scenario;
                const first = char.first_mes || char.data?.first_mes;

                if (desc) previews.push('<span class="fmg-tag-ok">描述✓</span>');
                else previews.push('<span class="fmg-tag-empty">描述✗</span>');

                if (pers) previews.push('<span class="fmg-tag-ok">性格✓</span>');
                else previews.push('<span class="fmg-tag-empty">性格✗</span>');

                if (scen) previews.push('<span class="fmg-tag-ok">场景✓</span>');
                else previews.push('<span class="fmg-tag-empty">场景✗</span>');

                if (first) previews.push('<span class="fmg-tag-ok">开场白✓</span>');
                else previews.push('<span class="fmg-tag-empty">开场白✗</span>');

                dataPreviewEl.innerHTML = previews.join(' ');

                // 缓存角色数据
                window._fmgCharData = { desc, pers, scen, first, name: char.name };

            } else {
                charNameEl.textContent = '未选择角色';
                charNameEl.classList.remove('active');
                dataPreviewEl.innerHTML = '<span style="color: #ff6464; font-size: 11px;">请先选择一个角色</span>';
                window._fmgCharData = null;
            }

            // 加载世界书条目
            loadWorldInfoList(context);

        } catch (e) {
            console.error('[开场白生成器] 加载数据失败:', e);
            showStatus('fmg-status', 'error', '加载数据失败: ' + e.message);
        }
    }

    async function loadWorldInfoList(context) {
        const container = document.getElementById('fmg-wi-list');
        window._fmgWorldEntries = [];
        container.innerHTML = '<div style="color: #888;">加载中...</div>';

        try {
            let entries = [];

            // 方式1: 从角色卡内嵌的character_book获取
            entries = getCharacterBookEntries(context);
            console.log('[开场白生成器] 内嵌世界书条目数:', entries.length);

            // 方式2: 从外部关联的世界书获取
            if (entries.length === 0 && context.characters && context.characterId !== undefined) {
                const char = context.characters[context.characterId];
                const worldName = char?.data?.extensions?.world;

                if (worldName) {
                    console.log('[开场白生成器] 发现外部关联世界书:', worldName);

                    // 尝试从worldInfoCache获取
                    if (typeof window.worldInfoCache !== 'undefined' && window.worldInfoCache.has(worldName)) {
                        const worldData = window.worldInfoCache.get(worldName);
                        console.log('[开场白生成器] 从cache获取世界书数据');
                        entries = extractEntriesFromWorldData(worldData);
                    }
                    // 尝试通过fetch加载
                    else {
                        try {
                            // 获取SillyTavern请求头
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
                                console.log('[开场白生成器] 从API获取世界书数据');
                                entries = extractEntriesFromWorldData(worldData);
                            } else {
                                console.warn('[开场白生成器] API返回错误:', response.status);
                            }
                        } catch (e) {
                            console.warn('[开场白生成器] 加载外部世界书失败:', e);
                        }
                    }
                } else {
                    console.log('[开场白生成器] 无外部关联世界书 (extensions.world为空)');
                }
            }

            console.log('[开场白生成器] 最终获取到世界书条目数:', entries.length);

            if (entries.length === 0) {
                container.innerHTML = '<div style="color: #888;">无可用条目</div>';
                return;
            }

            window._fmgWorldEntries = entries;
            const selected = settings.selectedWorldEntries || [];

            container.innerHTML = entries.map((entry, index) => {
                // 默认只勾选启用的条目
                const isChecked = entry.enabled !== false;
                const badge = entry.constant ? '<span class="fmg-badge">常驻</span>' : '';
                const disabledBadge = entry.enabled === false ? '<span class="fmg-badge-off">禁用</span>' : '';

                return `
                    <div class="fmg-wi-item">
                        <label>
                            <input type="checkbox" class="fmg-wi-cb" data-index="${index}" ${isChecked ? 'checked' : ''}>
                            ${escapeHtml(entry.name)} ${badge}${disabledBadge}
                        </label>
                    </div>
                `;
            }).join('');

        } catch (e) {
            console.error('[开场白生成器] 加载世界书失败:', e);
            container.innerHTML = '<div style="color: #ff6464;">加载失败: ' + e.message + '</div>';
        }
    }

    function getCharacterBookEntries(context) {
        const entries = [];

        if (context.characters && context.characterId !== undefined) {
            const char = context.characters[context.characterId];
            console.log('[开场白生成器] 检查角色:', char?.name);

            // 尝试多种访问路径
            let book = null;

            if (char?.data?.character_book) {
                book = char.data.character_book;
                console.log('[开场白生成器] 找到 char.data.character_book');
            } else if (char?.character_book) {
                book = char.character_book;
                console.log('[开场白生成器] 找到 char.character_book');
            }

            if (book && book.entries) {
                const bookEntries = Array.isArray(book.entries) ? book.entries : Object.values(book.entries);
                console.log('[开场白生成器] 内嵌条目数量:', bookEntries.length);

                for (const entry of bookEntries) {
                    if (entry.content) {
                        entries.push({
                            name: entry.comment || entry.name || entry.keys?.[0] || '未命名',
                            content: entry.content || '',
                            constant: entry.constant || false,
                            enabled: entry.enabled !== false && entry.disable !== true
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
            console.log('[开场白生成器] 世界书数据无效');
            return entries;
        }

        const rawEntries = Array.isArray(worldData.entries) ? worldData.entries : Object.values(worldData.entries);
        console.log('[开场白生成器] 外部世界书条目数:', rawEntries.length);

        for (const entry of rawEntries) {
            if (entry.content) {
                entries.push({
                    name: entry.comment || entry.name || entry.key?.[0] || entry.keys?.[0] || '未命名',
                    content: entry.content || '',
                    constant: entry.constant || false,
                    enabled: entry.enabled !== false && entry.disable !== true
                });
            }
        }

        return entries;
    }

    function selectAllWorldInfo(select) {
        document.querySelectorAll('.fmg-wi-cb').forEach(cb => {
            cb.checked = select;
        });
    }

    function getSelectedWorldInfo() {
        const entries = window._fmgWorldEntries || [];
        const selected = [];

        document.querySelectorAll('.fmg-wi-cb:checked').forEach(cb => {
            const idx = parseInt(cb.dataset.index);
            if (entries[idx]) {
                selected.push(entries[idx]);
            }
        });

        return selected;
    }

    // ========================================
    // 生成开场白
    // ========================================

    async function generateFirstMessage() {
        const statusEl = document.getElementById('fmg-status');
        const promptInput = document.getElementById('fmg-prompt');
        const userPrompt = promptInput.value.trim();

        if (!userPrompt) {
            showStatus('fmg-status', 'error', '请输入开场白需求描述');
            return;
        }

        if (!settings.apiUrl || !settings.apiKey) {
            showStatus('fmg-status', 'error', '请先在API页面配置API');
            return;
        }

        showStatus('fmg-status', 'loading', '正在生成开场白...');

        try {
            const context = SillyTavern.getContext();

            if (context.characterId === undefined) {
                showStatus('fmg-status', 'error', '请先选择一个角色');
                return;
            }

            const char = context.characters[context.characterId];

            // 收集角色信息
            const charInfo = [];
            if (settings.includeDescription && (char.description || char.data?.description)) {
                charInfo.push(`【描述】\n${char.description || char.data?.description}`);
            }
            if (settings.includePersonality && (char.personality || char.data?.personality)) {
                charInfo.push(`【性格】\n${char.personality || char.data?.personality}`);
            }
            if (settings.includeScenario && (char.scenario || char.data?.scenario)) {
                charInfo.push(`【场景】\n${char.scenario || char.data?.scenario}`);
            }
            if (settings.includeCurrentFirstMes && (char.first_mes || char.data?.first_mes)) {
                charInfo.push(`【当前开场白】\n${char.first_mes || char.data?.first_mes}`);
            }

            // 收集世界书
            const worldInfo = getSelectedWorldInfo();
            const worldInfoText = worldInfo.length > 0
                ? worldInfo.map(e => `[${e.name}]: ${e.content}`).join('\n\n')
                : '无选择的世界书条目';

            // 构建提示词
            const prompt = buildPrompt(char.name, charInfo.join('\n\n'), worldInfoText, userPrompt);

            // 调用API
            const result = await callAPI(prompt);

            // 显示预览
            showPreview(result);
            showStatus('fmg-status', 'success', '生成完成！请预览并确认');

        } catch (e) {
            console.error('[开场白生成器] 生成失败:', e);
            showStatus('fmg-status', 'error', '生成失败: ' + e.message);
        }
    }

    function buildPrompt(charName, charInfo, worldInfo, userRequest) {
        return `你是一个专业的角色扮演开场白撰写助手。请根据以下信息，为角色"${charName}"创作一段开场白。

## 角色信息
${charInfo || '无'}

## 世界书设定
${worldInfo}

## 用户需求
${userRequest}

## 要求
1. 完全符合角色设定和性格特点
2. 符合用户描述的风格需求
3. 语言自然流畅，有沉浸感
4. 只输出开场白内容本身，不要任何解释、前缀或额外说明`;
    }

    // ========================================
    // 预览弹窗
    // ========================================

    function showPreview(content) {
        const existingPreview = document.getElementById('fmg-preview-modal');
        if (existingPreview) existingPreview.remove();

        const modal = document.createElement('div');
        modal.id = 'fmg-preview-modal';
        modal.innerHTML = `
            <div class="fmg-preview-overlay"></div>
            <div class="fmg-preview-content">
                <div class="fmg-preview-header">
                    <h4>📝 开场白预览</h4>
                    <button class="fmg-close-btn" id="fmg-preview-close">×</button>
                </div>
                <div class="fmg-preview-body">
                    <div class="fmg-preview-text">${escapeHtml(content)}</div>
                </div>
                <div class="fmg-preview-footer">
                    <button class="fmg-btn fmg-btn-secondary" id="fmg-preview-cancel">取消</button>
                    <button class="fmg-btn fmg-btn-primary" id="fmg-preview-apply">✅ 应用到开场白</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 缓存内容
        window._fmgPendingContent = content;

        // 绑定事件
        document.getElementById('fmg-preview-close').onclick = closePreview;
        document.getElementById('fmg-preview-cancel').onclick = closePreview;
        document.getElementById('fmg-preview-apply').onclick = applyFirstMessage;
    }

    function closePreview() {
        const preview = document.getElementById('fmg-preview-modal');
        if (preview) preview.remove();
        window._fmgPendingContent = null;
    }

    async function applyFirstMessage() {
        const content = window._fmgPendingContent;
        if (!content) return;

        try {
            const context = SillyTavern.getContext();

            // 检查是否有聊天记录
            if (!context.chat || context.chat.length === 0) {
                showStatus('fmg-status', 'error', '当前没有聊天记录');
                return;
            }

            // 更新第0楼消息
            context.chat[0].mes = content;

            // 更新DOM显示
            const firstMessage = document.querySelector('#chat .mes:first-child .mes_text');
            if (firstMessage) {
                // 使用messageFormatting如果可用
                if (typeof context.messageFormatting === 'function') {
                    firstMessage.innerHTML = context.messageFormatting(content, context.chat[0].name, context.chat[0].is_user, context.chat[0].is_system, 0);
                } else {
                    firstMessage.innerHTML = content.replace(/\n/g, '<br>');
                }
            }

            // 保存聊天记录
            if (typeof context.saveChatDebounced === 'function') {
                context.saveChatDebounced();
            } else if (typeof context.saveChat === 'function') {
                await context.saveChat();
            }

            showStatus('fmg-status', 'success', '开场白已应用到第0楼！');
            closePreview();
            closePopup();

            // 显示toast提示
            if (typeof toastr !== 'undefined') {
                toastr.success('第0楼消息已更新');
            }

        } catch (e) {
            console.error('[开场白生成器] 应用失败:', e);
            showStatus('fmg-status', 'error', '应用失败: ' + e.message);
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

        if (!apiUrl || !apiKey) {
            showStatus('fmg-api-status', 'error', '请填写API URL和Key');
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
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    }

    async function testGemini(baseUrl, apiKey) {
        const url = baseUrl.replace(/\/$/, '') + '/models?key=' + apiKey;
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

        if (!apiUrl || !apiKey) {
            showStatus('fmg-api-status', 'error', '请填写API URL和Key');
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

            modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
            settings.models = models;

            showStatus('fmg-api-status', 'success', `找到 ${models.length} 个模型`);
        } catch (e) {
            showStatus('fmg-api-status', 'error', '获取失败: ' + e.message);
        }
    }

    function saveApiSettings() {
        settings.apiType = document.getElementById('fmg-api-type').value;
        settings.apiUrl = document.getElementById('fmg-api-url').value.trim();
        settings.apiKey = document.getElementById('fmg-api-key').value.trim();
        settings.model = document.getElementById('fmg-model').value;

        saveSettings();
        showStatus('fmg-api-status', 'success', '设置已保存！');
    }

    async function callAPI(prompt) {
        if (settings.apiType === 'openai') {
            return await callOpenAI(prompt);
        } else {
            return await callGemini(prompt);
        }
    }

    async function callOpenAI(prompt) {
        const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: settings.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const result = await response.json();
        return result.choices[0].message.content;
    }

    async function callGemini(prompt) {
        const url = settings.apiUrl.replace(/\/$/, '') + '/models/' + settings.model + ':generateContent?key=' + settings.apiKey;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8 }
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const result = await response.json();
        return result.candidates[0].content.parts[0].text;
    }

    // ========================================
    // 工具函数
    // ========================================

    function showStatus(elementId, type, message) {
        const el = document.getElementById(elementId);
        if (!el) return;

        el.style.display = 'block';
        el.className = 'fmg-status ' + type;

        if (type === 'loading') {
            el.innerHTML = '<span class="fmg-loading"></span>' + message;
        } else {
            el.textContent = message;
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
