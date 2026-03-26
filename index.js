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
        selectedWorldEntries: [],
        // 预设条目相关
        includePresetPrompts: false,
        selectedPresetPrompts: []
    };

    let settings = { ...DEFAULT_SETTINGS };

    // 可编辑字段标签映射
    const FIELD_LABELS = {
        description: '描述',
        personality: '性格',
        scenario: '场景',
        first_mes: '开场白',
        mes_example: '对话示例',
        system_prompt: '系统提示词',
        post_history_instructions: '越权提示词',
        creator_notes: '创作者备注'
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
        creator_notes: 'creator_notes'
    };

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
                <button class="fmg-tab" data-tab="statusbar">状态栏</button>
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
                    <div class="fmg-section fmg-section-compact">
                        <div class="fmg-section-header">
                            <h4>📚 世界书条目</h4>
                            <div class="fmg-btn-group">
                                <span class="fmg-count" id="fmg-wi-count">0/0</span>
                                <button class="fmg-btn-small fmg-btn-open" id="fmg-wi-open">选择条目</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- 预设条目区 -->
                    <div class="fmg-section fmg-section-compact">
                        <div class="fmg-section-header">
                            <h4>📋 预设条目</h4>
                            <div class="fmg-btn-group">
                                <label style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;">
                                    <input type="checkbox" id="fmg-inc-preset"> 包含
                                </label>
                                <span class="fmg-count" id="fmg-preset-count">0/0</span>
                                <button class="fmg-btn-small fmg-btn-open" id="fmg-preset-open">选择条目</button>
                            </div>
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
                
                
                <!-- 状态栏页 -->
                <div class="fmg-tab-content" data-tab="statusbar">
                    <div class="fmg-sb-container">
                        <div class="fmg-chat-header">
                            <span class="fmg-chat-char-info" id="fmg-sb-char-name">未选择角色</span>
                            <button class="fmg-btn-small" id="fmg-sb-refresh" title="刷新角色数据">🔄 刷新</button>
                            <button class="fmg-btn-small fmg-btn-danger-small" id="fmg-sb-clear" title="清除状态栏并重置">🗑️ 清除</button>
                        </div>
                        
                        <!-- 需求输入 -->
                        <div class="fmg-section">
                            <label>✍️ 描述你想要的状态栏</label>
                            <textarea id="fmg-sb-prompt" class="fmg-textarea" 
                                placeholder="描述你想要的状态栏样式和内容...&#10;例如：包含日期、时间、地点、心情、穿着，用羊皮纸风格美化"></textarea>
                        </div>
                        
                        <div class="fmg-actions">
                            <button class="fmg-btn fmg-btn-primary" id="fmg-sb-generate">✨ 生成状态栏</button>
                        </div>
                        
                        <!-- 预览区 -->
                        <div id="fmg-sb-preview-area" style="display:none;">
                            <!-- 视觉效果预览 -->
                            <div class="fmg-sb-preview-section">
                                <div class="fmg-sb-preview-header" data-target="fmg-sb-visual-body">
                                    <span>👁️ 效果预览</span>
                                    <span class="fmg-collapse-arrow">▼</span>
                                </div>
                                <div class="fmg-sb-preview-body open" id="fmg-sb-visual-body">
                                    <div class="fmg-sb-visual-content" id="fmg-sb-visual-content">等待生成...</div>
                                </div>
                            </div>

                            <!-- 世界书条目预览 -->
                            <div class="fmg-sb-preview-section">
                                <div class="fmg-sb-preview-header" data-target="fmg-sb-wi-body">
                                    <span>📋 世界书条目预览</span>
                                    <span class="fmg-collapse-arrow">▼</span>
                                </div>
                                <div class="fmg-sb-preview-body open" id="fmg-sb-wi-body">
                                    <pre class="fmg-sb-code" id="fmg-sb-wi-content">等待生成...</pre>
                                </div>
                            </div>
                            
                            <!-- 正则脚本预览 -->
                            <div class="fmg-sb-preview-section">
                                <div class="fmg-sb-preview-header" data-target="fmg-sb-regex-body">
                                    <span>🎨 正则脚本预览</span>
                                    <span class="fmg-collapse-arrow">▼</span>
                                </div>
                                <div class="fmg-sb-preview-body open" id="fmg-sb-regex-body">
                                    <div class="fmg-sb-regex-field">
                                        <label>查找正则</label>
                                        <pre class="fmg-sb-code" id="fmg-sb-regex-find">等待生成...</pre>
                                    </div>
                                    <div class="fmg-sb-regex-field">
                                        <label>替换为 (HTML/CSS)</label>
                                        <pre class="fmg-sb-code fmg-sb-code-large" id="fmg-sb-regex-replace">等待生成...</pre>
                                    </div>
                                    <div class="fmg-sb-regex-field">
                                        <label>修剪掉</label>
                                        <pre class="fmg-sb-code" id="fmg-sb-regex-trim">等待生成...</pre>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- 应用按钮 -->
                            <div class="fmg-actions">
                                <button class="fmg-btn fmg-btn-secondary" id="fmg-sb-apply-wi">📋 应用世界书条目</button>
                                <button class="fmg-btn fmg-btn-primary" id="fmg-sb-apply-regex">🎨 应用正则脚本</button>
                                <button class="fmg-btn" id="fmg-sb-regenerate" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2);">🔄 重新生成</button>
                            </div>
                        </div>
                        
                        <div id="fmg-sb-status" class="fmg-status" style="display: none;"></div>
                    </div>
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

        // 世界书选择弹窗
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wi-open') openSelectionModal('worldinfo');
        });

        // 预设条目选择弹窗
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-preset-open') openSelectionModal('preset');
        });

        // 预设总开关变化
        document.addEventListener('change', (e) => {
            if (e.target.id === 'fmg-inc-preset') {
                settings.includePresetPrompts = e.target.checked;
                saveSettings();
            }
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

        // 状态栏页 - 生成/重新生成
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-sb-generate' || e.target.id === 'fmg-sb-regenerate') generateStatusBar();
        });

        // 状态栏页 - 刷新
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-sb-clear') clearStatusBar();
            if (e.target.id === 'fmg-sb-refresh') {
                loadCharacterData();
                updateSbCharName();
            }
        });

        // 状态栏页 - 应用世界书
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-sb-apply-wi') applyStatusBarWorldEntry();
        });

        // 状态栏页 - 应用正则
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-sb-apply-regex') applyStatusBarRegex();
        });

        // 状态栏页 - 预览区折叠
        document.addEventListener('click', (e) => {
            const header = e.target.closest('.fmg-sb-preview-header');
            if (header) {
                const targetId = header.dataset.target;
                const body = document.getElementById(targetId);
                const arrow = header.querySelector('.fmg-collapse-arrow');
                if (body) {
                    const isOpen = body.classList.toggle('open');
                    if (arrow) arrow.textContent = isOpen ? '▼' : '▶';
                }
            }
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

                // 缓存角色数据（包含全部字段）
                const d = char.data || {};
                window._fmgCharData = {
                    name: char.name,
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

            } else {
                charNameEl.textContent = '未选择角色';
                charNameEl.classList.remove('active');
                dataPreviewEl.innerHTML = '<span style="color: #ff6464; font-size: 11px;">请先选择一个角色</span>';
                window._fmgCharData = null;
            }

            // 加载世界书条目
            loadWorldInfoList(context);

            // 加载预设条目
            loadPresetPrompts(context);

            // 更新状态栏数据并触发角色切换清理检测
            updateSbCharName();

        } catch (e) {
            console.error('[开场白生成器] 加载数据失败:', e);
            showStatus('fmg-status', 'error', '加载数据失败: ' + e.message);
        }
    }

    async function loadWorldInfoList(context, forceRefresh = true) {
        window._fmgWorldEntries = [];

        try {
            let entries = [];

            // 获取外部关联的世界书
            if (context.characters && context.characterId !== undefined) {
                const char = context.characters[context.characterId];
                const worldName = char?.data?.extensions?.world;

                if (worldName) {
                    console.log('[开场白生成器] 发现外部关联世界书:', worldName);

                    try {
                        const headers = typeof context.getRequestHeaders === 'function'
                            ? context.getRequestHeaders()
                            : { 'Content-Type': 'application/json' };

                        console.log('[开场白生成器] 从API强制刷新世界书数据...');
                        const response = await fetch('/api/worldinfo/get', {
                            method: 'POST',
                            headers: headers,
                            body: JSON.stringify({ name: worldName })
                        });

                        if (response.ok) {
                            const worldData = await response.json();
                            console.log('[开场白生成器] 从API获取世界书数据成功');
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
                    entries = getCharacterBookEntries(context);
                    console.log('[开场白生成器] 内嵌世界书条目数:', entries.length);
                }
            }

            console.log('[开场白生成器] 最终获取到世界书条目数:', entries.length);

            window._fmgWorldEntries = entries;

            // 如果没有保存的选择，初始化为启用的条目
            if (!settings.selectedWorldEntries || settings.selectedWorldEntries.length === 0) {
                const defaultSelections = [];
                entries.forEach((entry, idx) => {
                    if (entry.enabled !== false) {
                        const identifier = entry.name || `wi_${idx}`;
                        defaultSelections.push(identifier);
                    }
                });
                settings.selectedWorldEntries = defaultSelections;
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
        const savedSelections = settings.selectedWorldEntries || [];
        const selected = [];

        // 使用保存的选择
        entries.forEach((entry, idx) => {
            const identifier = entry.name || `wi_${idx}`;
            if (savedSelections.includes(identifier)) {
                selected.push(entry);
            }
        });

        return selected;
    }

    function updateCounts() {
        // 更新世界书计数
        const wiEntries = window._fmgWorldEntries || [];
        const wiSelected = (settings.selectedWorldEntries || []).length;
        const wiCountEl = document.getElementById('fmg-wi-count');
        if (wiCountEl) {
            wiCountEl.textContent = `${wiSelected}/${wiEntries.length}`;
        }

        // 更新预设计数
        const presetEntries = window._fmgPresetPrompts || [];
        const presetSelected = (settings.selectedPresetPrompts || []).length;
        const presetCountEl = document.getElementById('fmg-preset-count');
        if (presetCountEl) {
            presetCountEl.textContent = `${presetSelected}/${presetEntries.length}`;
        }

    }

    function openSelectionModal(type) {
        // 移除已存在的弹窗
        const existing = document.getElementById('fmg-selection-modal');
        if (existing) existing.remove();

        const isWorldInfo = type === 'worldinfo';
        const title = isWorldInfo ? '📚 选择世界书条目' : '📋 选择预设条目';
        const entries = isWorldInfo ? (window._fmgWorldEntries || []) : (window._fmgPresetPrompts || []);
        const savedSelections = isWorldInfo
            ? (settings.selectedWorldEntries || [])
            : (settings.selectedPresetPrompts || []);

        if (entries.length === 0) {
            if (typeof toastr !== 'undefined') {
                toastr.warning('没有可用的条目');
            }
            return;
        }

        // 生成列表HTML
        const listHtml = entries.map((entry, index) => {
            const name = isWorldInfo
                ? (entry.name || `条目${index + 1}`)
                : (entry.name || entry.identifier || `条目${index + 1}`);
            const identifier = isWorldInfo
                ? (entry.name || `wi_${index}`)
                : (entry.identifier || entry.name || `prompt_${index}`);
            const isEnabled = entry.enabled !== false;
            const isChecked = savedSelections.includes(identifier);

            const badges = [];
            if (isWorldInfo) {
                if (entry.constant) badges.push('<span class="fmg-badge">常驻</span>');
                if (!isEnabled) badges.push('<span class="fmg-badge-off">禁用</span>');
            } else {
                badges.push(isEnabled ? '<span class="fmg-badge">启用</span>' : '<span class="fmg-badge-off">禁用</span>');
                if (entry.role) badges.push(`<span class="fmg-badge" style="background:rgba(100,200,255,0.2);color:#64c8ff;">${entry.role}</span>`);
            }

            return `
                <div class="fmg-select-item">
                    <label>
                        <input type="checkbox" class="fmg-select-cb" data-identifier="${escapeHtml(identifier)}" ${isChecked ? 'checked' : ''}>
                        <span class="fmg-select-name">${escapeHtml(name)}</span>
                        ${badges.join('')}
                    </label>
                </div>
            `;
        }).join('');

        const modal = document.createElement('div');
        modal.id = 'fmg-selection-modal';
        modal.innerHTML = `
            <div class="fmg-select-overlay"></div>
            <div class="fmg-select-content">
                <div class="fmg-select-header">
                    <h4>${title}</h4>
                    <div class="fmg-btn-group">
                        <button class="fmg-btn-small" id="fmg-select-all">全选</button>
                        <button class="fmg-btn-small" id="fmg-select-none">清空</button>
                    </div>
                </div>
                <div class="fmg-select-body">
                    ${listHtml}
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

        // 更新选中计数
        const updateSelectInfo = () => {
            const count = modal.querySelectorAll('.fmg-select-cb:checked').length;
            const infoEl = document.getElementById('fmg-select-info');
            if (infoEl) infoEl.textContent = `已选择 ${count} 项`;
        };
        updateSelectInfo();

        // 绑定事件
        modal.querySelector('.fmg-select-overlay').onclick = () => modal.remove();
        modal.querySelector('#fmg-select-cancel').onclick = () => modal.remove();

        modal.querySelector('#fmg-select-all').onclick = () => {
            modal.querySelectorAll('.fmg-select-cb').forEach(cb => cb.checked = true);
            updateSelectInfo();
        };

        modal.querySelector('#fmg-select-none').onclick = () => {
            modal.querySelectorAll('.fmg-select-cb').forEach(cb => cb.checked = false);
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

            if (isWorldInfo) {
                settings.selectedWorldEntries = selectedIdentifiers;
            } else {
                settings.selectedPresetPrompts = selectedIdentifiers;
            }
            saveSettings();
            updateCounts();
            modal.remove();

            console.log(`[开场白生成器] 已保存${isWorldInfo ? '世界书' : '预设'}选择:`, selectedIdentifiers);
        };
    }

    // ========================================
    // 预设条目
    // ========================================

    function loadPresetPrompts(context) {
        const incPresetCheckbox = document.getElementById('fmg-inc-preset');
        window._fmgPresetPrompts = [];

        try {
            // 获取 Chat Completion 设置
            const chatSettings = context.chatCompletionSettings;
            console.log('[开场白生成器] chatCompletionSettings:', chatSettings);

            if (!chatSettings || !chatSettings.prompts) {
                updateCounts();
                return;
            }

            // 获取 prompts 数组
            const prompts = chatSettings.prompts || [];
            console.log('[开场白生成器] prompts:', prompts);

            // 过滤出有内容的条目
            const validPrompts = prompts.filter(p => p && (p.content || p.prompt));

            window._fmgPresetPrompts = validPrompts;

            // 恢复总开关状态
            if (incPresetCheckbox) {
                incPresetCheckbox.checked = settings.includePresetPrompts;
            }

            // 如果没有保存的选择，初始化为启用的条目
            if (!settings.selectedPresetPrompts || settings.selectedPresetPrompts.length === 0) {
                const defaultSelections = [];
                validPrompts.forEach((prompt, idx) => {
                    if (prompt.enabled !== false) {
                        const identifier = prompt.identifier || prompt.name || `prompt_${idx}`;
                        defaultSelections.push(identifier);
                    }
                });
                settings.selectedPresetPrompts = defaultSelections;
                saveSettings();
            }

            // 更新计数
            updateCounts();

        } catch (e) {
            console.error('[开场白生成器] 加载预设条目失败:', e);
        }
    }

    function savePresetSelections() {
        const selectedIdentifiers = [];
        document.querySelectorAll('.fmg-preset-cb:checked').forEach(cb => {
            const identifier = cb.dataset.identifier;
            if (identifier) {
                selectedIdentifiers.push(identifier);
            }
        });
        settings.selectedPresetPrompts = selectedIdentifiers;
        saveSettings();
        console.log('[开场白生成器] 已保存预设勾选状态:', selectedIdentifiers);
    }

    function selectAllPresets(select) {
        document.querySelectorAll('.fmg-preset-cb').forEach(cb => {
            cb.checked = select;
        });
        // 保存勾选状态
        savePresetSelections();
    }

    function getSelectedPresets() {
        const prompts = window._fmgPresetPrompts || [];
        const savedSelections = settings.selectedPresetPrompts || [];
        const selected = [];

        prompts.forEach((prompt, idx) => {
            const identifier = prompt.identifier || prompt.name || `prompt_${idx}`;
            if (savedSelections.includes(identifier)) {
                selected.push(prompt);
            }
        });

        return selected;
    }

    // ========================================
    // ========================================
    // 状态栏生成与应用
    // ========================================

    // 缓存生成结果
    window._fmgStatusBarResult = null;

    function updateSbCharName() {
        const nameEl = document.getElementById('fmg-sb-char-name');
        const charData = window._fmgCharData;
        if (nameEl) {
            if (charData && charData.name) {
                if (window._fmgCurrentSbCharacterId !== undefined && window._fmgCurrentSbCharacterId !== charData.name) {
                    clearStatusBar();
                }
                window._fmgCurrentSbCharacterId = charData.name;
                nameEl.textContent = '🎭 ' + charData.name;
                nameEl.classList.add('active');
            } else {
                if (window._fmgCurrentSbCharacterId) clearStatusBar();
                window._fmgCurrentSbCharacterId = null;
                nameEl.textContent = '未选择角色';
                nameEl.classList.remove('active');
            }
        }
    }

    function clearStatusBar() {
        window._fmgStatusBarResult = null;
        const promptInput = document.getElementById('fmg-sb-prompt');
        if (promptInput) promptInput.value = '';
        const previewArea = document.getElementById('fmg-sb-preview-area');
        if (previewArea) previewArea.style.display = 'none';
        
        const resetEls = ['fmg-sb-visual-content', 'fmg-sb-wi-content', 'fmg-sb-regex-find', 'fmg-sb-regex-replace', 'fmg-sb-regex-trim'];
        resetEls.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '等待生成...';
        });
        const statusEl = document.getElementById('fmg-sb-status');
        if (statusEl) statusEl.style.display = 'none';
    }

    async function generateStatusBar() {
        const promptInput = document.getElementById('fmg-sb-prompt');
        const userPrompt = promptInput.value.trim();

        if (!userPrompt) {
            showStatus('fmg-sb-status', 'error', '请描述你想要的状态栏');
            return;
        }
        if (!settings.apiUrl || !settings.apiKey) {
            showStatus('fmg-sb-status', 'error', '请先在API页面配置API');
            return;
        }
        if (!window._fmgCharData) {
            showStatus('fmg-sb-status', 'error', '请先选择角色并刷新数据');
            return;
        }

        showStatus('fmg-sb-status', 'loading', '正在生成状态栏...');
        const genBtn = document.getElementById('fmg-sb-generate');
        if (genBtn) genBtn.disabled = true;

        try {
            const charData = window._fmgCharData;
            const worldInfo = getSelectedWorldInfo();
            const wiText = worldInfo.length > 0
                ? worldInfo.map(e => `[${e.name}]: ${e.content}`).join('\n\n')
                : '无世界书条目';

            const systemPrompt = `你是一个专业的 SillyTavern 状态栏设计师。根据用户的需求，生成状态栏的世界书条目内容和正则脚本。

当前角色: ${charData.name}
角色描述: ${charData.desc || '（空）'}
角色性格: ${charData.pers || '（空）'}
角色场景: ${charData.scen || '（空）'}
世界书设定: ${wiText}

你必须返回一个严格的 JSON 对象，不要包含任何其他文字，格式如下:
{
  "worldbook_content": "世界书条目的完整内容，包含 status_block 和 status 标签的状态栏模板",
  "regex_name": "状态栏",
  "regex_find": "用于匹配状态栏 XML 标签的正则表达式",
  "regex_replace": "用 HTML/CSS 美化的替换代码，将 XML 标签转换为漂亮的状态栏 UI",
  "regex_trim": "需要修剪掉的标签（每行一个）"
}

重要规则:
1. worldbook_content 必须包含 <status_block>...</status_block> 包裹，内部使用 <status>...</status> 定义各个字段
2. 状态栏字段用 XML 标签如 <title>, <date>, <time>, <location>, <mood> 等
3. regex_find 必须能匹配整个 status 块的内容，使用捕获组提取各字段
4. regex_replace 使用 $1, $2 等引用捕获组，生成精美的 HTML/CSS 状态栏
5. regex_trim 列出需要从显示中移除的标签
6. CSS 样式应该内联在 HTML 中，使用深色主题配色
7. 只输出 JSON，不要有任何额外文字或 markdown 代码块标记`;

            const userMessage = `请为角色"${charData.name}"生成状态栏，需求如下：\n${userPrompt}`;

            let fullContent = '';
            await callAPIStreamMessages(
                [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMessage }],
                (content) => { fullContent = content; },
                (finalContent) => {
                    try {
                        // 清理可能的 markdown 代码块包裹
                        let cleaned = finalContent.trim();
                        if (cleaned.startsWith('```')) {
                            cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
                        }
                        const result = JSON.parse(cleaned);
                        window._fmgStatusBarResult = result;

                        // 填充预览区代码
                        document.getElementById('fmg-sb-wi-content').textContent = result.worldbook_content || '';
                        document.getElementById('fmg-sb-regex-find').textContent = result.regex_find || '';
                        document.getElementById('fmg-sb-regex-replace').textContent = result.regex_replace || '';
                        document.getElementById('fmg-sb-regex-trim').textContent = result.regex_trim || '';
                        
                        // 尝试渲染效果预览（不依赖 AI 的正则匹配，而是手动提取标签值填入 HTML 模板）
                        try {
                            let previewText = result.worldbook_content || '';
                            if (result.regex_find && result.regex_replace) {
                                
                                // 方案：从 regex_find 提取捕获组对应的 XML 标签名，
                                // 再从模板中提取这些标签的内容，
                                // 最后把 $1, $2... 替换进 regex_replace 的 HTML 里。
                                
                                // 1. 从 regex_find 中按顺序提取所有捕获组对应的标签名
                                //    AI 通常写类似 <title>(.*?)</title> 或 <title>([^<]*)</title>
                                const groupTagPattern = /<(\w+)>\s*\([^)]*\)\s*<\/\1>/g;
                                const groupTags = [];
                                let gm;
                                while ((gm = groupTagPattern.exec(result.regex_find)) !== null) {
                                    groupTags.push(gm[1]);
                                }
                                
                                // 2. 从模板中提取 <status>...</status> 区块
                                let statusMatch = previewText.match(/<status[\s>][\s\S]*?<\/status>/i);
                                let tpl = statusMatch ? statusMatch[0] : previewText;
                                
                                // 3. 构建最终 HTML：取 regex_replace，将 $1..$N 替换为对应标签的示例值
                                let htmlPreview = result.regex_replace;
                                
                                if (groupTags.length > 0) {
                                    for (let i = 0; i < groupTags.length; i++) {
                                        const tagName = groupTags[i];
                                        // 从模板提取标签内容
                                        const tagRe = new RegExp('<' + tagName + '>([\\s\\S]*?)</' + tagName + '>', 'i');
                                        const tagMatch = tpl.match(tagRe);
                                        let val = tagMatch ? tagMatch[1].trim() : tagName;
                                        // 清理 {{变量}} 占位符，替换为示例文字
                                        val = val.replace(/\{\{([^}]*)\}\}/g, (_, v) => v.trim() || '...');
                                        // 替换 $1, $2...
                                        htmlPreview = htmlPreview.replace(new RegExp('\\$' + (i + 1), 'g'), val);
                                    }
                                    document.getElementById('fmg-sb-visual-content').innerHTML = htmlPreview;
                                } else {
                                    // 如果没提取到捕获组，退而求其次：直接把 $N 替换为示例文字
                                    htmlPreview = htmlPreview.replace(/\$(\d+)/g, (_, n) => '示例内容' + n );
                                    document.getElementById('fmg-sb-visual-content').innerHTML = htmlPreview;
                                }
                            } else {
                                document.getElementById('fmg-sb-visual-content').textContent = "需要同时有正则查找和替换才能渲染预览！";
                            }
                        } catch (e) {
                            console.error('[开场白生成器] 预览渲染失败:', e);
                            document.getElementById('fmg-sb-visual-content').textContent = "预览渲染失败: " + e.message;
                        }

                        document.getElementById('fmg-sb-preview-area').style.display = '';

                        showStatus('fmg-sb-status', 'success', '生成完成！请预览并应用');
                    } catch (e) {
                        console.error('[开场白生成器] 解析状态栏结果失败:', e, finalContent);
                        showStatus('fmg-sb-status', 'error', '解析生成结果失败，请重试');
                    }
                    if (genBtn) genBtn.disabled = false;
                },
                (error) => {
                    showStatus('fmg-sb-status', 'error', '生成失败: ' + error.message);
                    if (genBtn) genBtn.disabled = false;
                }
            );
        } catch (e) {
            showStatus('fmg-sb-status', 'error', '生成失败: ' + e.message);
            if (genBtn) genBtn.disabled = false;
        }
    }

    async function applyStatusBarWorldEntry() {
        const result = window._fmgStatusBarResult;
        if (!result || !result.worldbook_content) {
            showStatus('fmg-sb-status', 'error', '请先生成状态栏');
            return;
        }

        try {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined) throw new Error('未选择角色');

            const char = context.characters[context.characterId];
            const worldName = char?.data?.extensions?.world;
            if (!worldName) throw new Error('角色未关联世界书，请先关联一个世界书');

            const headers = typeof context.getRequestHeaders === 'function'
                ? context.getRequestHeaders()
                : { 'Content-Type': 'application/json' };

            // 获取当前世界书数据
            const getResp = await fetch('/api/worldinfo/get', {
                method: 'POST', headers,
                body: JSON.stringify({ name: worldName })
            });
            if (!getResp.ok) throw new Error('获取世界书失败');
            const worldData = await getResp.json();

            // 创建新条目
            const entries = worldData.entries || {};
            const newId = Object.keys(entries).length > 0
                ? Math.max(...Object.keys(entries).map(Number)) + 1 : 0;

            entries[newId] = {
                uid: newId,
                key: ['状态栏'],
                keysecondary: [],
                comment: '状态栏模板',
                content: result.worldbook_content,
                constant: true,
                selective: false,
                order: 999,
                position: 4,
                depth: 0,
                disable: false,
                enabled: true,
                excludeRecursion: false,
                preventRecursion: false,
                delayUntilRecursion: false,
                probability: 100,
                useProbability: true,
                group: '',
                groupOverride: false,
                groupWeight: 100,
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                automationId: '',
                role: 0,
                vectorized: false,
                sticky: null,
                cooldown: null,
                delay: null
            };

            worldData.entries = entries;

            // 保存世界书
            const saveResp = await fetch('/api/worldinfo/edit', {
                method: 'POST', headers,
                body: JSON.stringify({ name: worldName, data: worldData })
            });
            if (!saveResp.ok) throw new Error(`保存世界书失败: HTTP ${saveResp.status}`);

            showStatus('fmg-sb-status', 'success', '世界书条目已创建！');
            if (typeof toastr !== 'undefined') toastr.success('状态栏世界书条目已添加');

            // 刷新世界书列表
            loadWorldInfoList(context, true);

        } catch (e) {
            console.error('[开场白生成器] 应用世界书条目失败:', e);
            showStatus('fmg-sb-status', 'error', '应用失败: ' + e.message);
        }
    }

    async function applyStatusBarRegex() {
        const result = window._fmgStatusBarResult;
        if (!result || !result.regex_find) {
            showStatus('fmg-sb-status', 'error', '请先生成状态栏');
            return;
        }

        try {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined) throw new Error('未选择角色');

            const char = context.characters[context.characterId];
            if (!char) throw new Error('角色数据不存在');

            // 构建正则脚本对象
            const newScript = {
                scriptName: result.regex_name || '状态栏',
                findRegex: result.regex_find,
                replaceString: result.regex_replace,
                trimStrings: result.regex_trim ? result.regex_trim.split('\n').filter(s => s.trim()) : [],
                placement: [2], // 2 = AI输出
                disabled: false,
                markdownOnly: true,
                promptOnly: false,
                runOnEdit: true,
                substituteRegex: 0,
                minDepth: null,
                maxDepth: null
            };

            // 获取当前的 regex_scripts
            const currentScripts = char.data?.extensions?.regex_scripts || [];

            // 检查是否已有同名脚本，如有则替换
            const existingIdx = currentScripts.findIndex(s => s.scriptName === newScript.scriptName);
            if (existingIdx >= 0) {
                currentScripts[existingIdx] = newScript;
            } else {
                currentScripts.push(newScript);
            }

            // 通过 merge-attributes 保存
            const headers = typeof context.getRequestHeaders === 'function'
                ? context.getRequestHeaders()
                : { 'Content-Type': 'application/json' };

            // 更新内存
            if (!char.data.extensions) char.data.extensions = {};
            char.data.extensions.regex_scripts = currentScripts;

            const response = await fetch('/api/characters/merge-attributes', {
                method: 'POST', headers,
                body: JSON.stringify({
                    avatar: char.avatar,
                    data: { extensions: { regex_scripts: currentScripts } }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            showStatus('fmg-sb-status', 'success', '正则脚本已应用！刷新页面后可在局部正则中查看');
            if (typeof toastr !== 'undefined') toastr.success('状态栏正则脚本已应用');

        } catch (e) {
            console.error('[开场白生成器] 应用正则脚本失败:', e);
            showStatus('fmg-sb-status', 'error', '应用失败: ' + e.message);
        }
    }


    // ========================================
    // 流式 API 调用
    // ========================================

    let apiAbortController = null;

    async function callAPIStreamMessages(messages, onChunk, onDone, onError) {
        apiAbortController = new AbortController();

        try {
            if (settings.apiType === 'openai') {
                await callOpenAIStreamMessages(messages, onChunk, onDone, apiAbortController.signal);
            } else {
                await callGeminiStreamMessages(messages, onChunk, onDone, apiAbortController.signal);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[开场白生成器] API请求已中断');
                return;
            }
            onError(e);
        } finally {
            apiAbortController = null;
        }
    }

    async function callOpenAIStreamMessages(messages, onChunk, onDone, signal) {
        const url = settings.apiUrl.replace(/\/$/, '') + '/chat/completions';

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: settings.model,
                messages: messages,
                temperature: 0.8,
                stream: true
            }),
            signal: signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const text = json.choices?.[0]?.delta?.content || '';
                        if (text) {
                            fullContent += text;
                            onChunk(fullContent);
                        }
                    } catch (e) {
                        console.warn('[开场白生成器] 解析流数据失败:', trimmed, e);
                    }
                }
            }
        }
        onDone(fullContent);
    }

    async function callGeminiStreamMessages(messages, onChunk, onDone, signal) {
        const url = settings.apiUrl.replace(/\/$/, '') + '/models/' + settings.model + ':streamGenerateContent?key=' + settings.apiKey + '&alt=sse';

        // 将 messages 转换为 Gemini 格式
        let systemInstruction = null;
        const contents = [];

        for (const msg of messages) {
            if (msg.role === 'system') {
                systemInstruction = { parts: [{ text: msg.content }] };
            } else {
                contents.push({
                    role: msg.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: msg.content }]
                });
            }
        }

        const body = {
            contents: contents,
            generationConfig: { temperature: 0.8 }
        };
        if (systemInstruction) {
            body.systemInstruction = systemInstruction;
        }

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (text) {
                            fullContent += text;
                            onChunk(fullContent);
                        }
                    } catch (e) {
                        console.warn('[开场白生成器] 解析Gemini流数据失败:', trimmed, e);
                    }
                }
            }
        }
        onDone(fullContent);
    }

    // ========================================
    // 生成开场白
    // ========================================

    // 全局控制器用于中断流式生成
    let currentAbortController = null;

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

            // 收集预设条目（如果启用）
            let presetText = '';
            const incPresetCheckbox = document.getElementById('fmg-inc-preset');
            if (incPresetCheckbox && incPresetCheckbox.checked) {
                const presets = getSelectedPresets();
                if (presets.length > 0) {
                    presetText = presets.map(p => {
                        const name = p.name || p.identifier || '未命名';
                        const content = p.content || p.prompt || '';
                        return `【${name}】\n${content}`;
                    }).join('\n\n');
                }
            }

            // 构建提示词
            const prompt = buildPrompt(char.name, charInfo.join('\n\n'), worldInfoText, presetText, userPrompt);

            // 显示流式预览弹窗
            showStreamPreview();

            // 流式调用API
            await callAPIStream(
                prompt,
                // onChunk: 每次收到新内容
                (content) => {
                    updateStreamPreview(content, false);
                },
                // onDone: 生成完成
                (finalContent) => {
                    updateStreamPreview(finalContent, true);
                    showStatus('fmg-status', 'success', '生成完成！请预览并确认');
                },
                // onError: 出错
                (error) => {
                    updateStreamPreviewError(error.message);
                    showStatus('fmg-status', 'error', '生成失败: ' + error.message);
                }
            );

        } catch (e) {
            console.error('[开场白生成器] 生成失败:', e);
            showStatus('fmg-status', 'error', '生成失败: ' + e.message);
        }
    }

    function buildPrompt(charName, charInfo, worldInfo, presetInfo, userRequest) {
        let presetSection = '';
        if (presetInfo && presetInfo.trim()) {
            presetSection = `\n## 预设要求（重要！请严格遵守）\n${presetInfo}\n`;
        }

        return `你是一个专业的角色扮演开场白撰写助手。请根据以下信息，为角色"${charName}"创作一段开场白。

## 角色信息
${charInfo || '无'}

## 世界书设定
${worldInfo}
${presetSection}
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

    // ========================================
    // 流式预览弹窗
    // ========================================

    function showStreamPreview() {
        const existingPreview = document.getElementById('fmg-preview-modal');
        if (existingPreview) existingPreview.remove();

        const modal = document.createElement('div');
        modal.id = 'fmg-preview-modal';
        modal.innerHTML = `
            <div class="fmg-preview-overlay"></div>
            <div class="fmg-preview-content">
                <div class="fmg-preview-header">
                    <h4>📝 开场白生成中...</h4>
                    <button class="fmg-close-btn" id="fmg-preview-close">×</button>
                </div>
                <div class="fmg-preview-body">
                    <div class="fmg-preview-text fmg-streaming" id="fmg-stream-content">
                        <span class="fmg-cursor">▌</span>
                    </div>
                </div>
                <div class="fmg-preview-footer">
                    <button class="fmg-btn fmg-btn-danger" id="fmg-stream-stop">⏹ 停止生成</button>
                    <button class="fmg-btn fmg-btn-primary" id="fmg-preview-apply" disabled>✅ 应用到开场白</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定事件
        document.getElementById('fmg-preview-close').onclick = () => {
            stopGeneration();
            closePreview();
        };
        document.getElementById('fmg-stream-stop').onclick = stopGeneration;
        document.getElementById('fmg-preview-apply').onclick = applyFirstMessage;
    }

    function updateStreamPreview(content, isDone) {
        const contentEl = document.getElementById('fmg-stream-content');
        const headerEl = document.querySelector('#fmg-preview-modal .fmg-preview-header h4');
        const stopBtn = document.getElementById('fmg-stream-stop');
        const applyBtn = document.getElementById('fmg-preview-apply');

        if (!contentEl) return;

        // 缓存内容
        window._fmgPendingContent = content;

        if (isDone) {
            // 生成完成
            contentEl.innerHTML = escapeHtml(content);
            contentEl.classList.remove('fmg-streaming');
            if (headerEl) headerEl.textContent = '📝 开场白预览';
            if (stopBtn) stopBtn.style.display = 'none';
            if (applyBtn) applyBtn.disabled = false;
        } else {
            // 流式更新中
            contentEl.innerHTML = escapeHtml(content) + '<span class="fmg-cursor">▌</span>';
        }
    }

    function updateStreamPreviewError(errorMsg) {
        const contentEl = document.getElementById('fmg-stream-content');
        const headerEl = document.querySelector('#fmg-preview-modal .fmg-preview-header h4');
        const stopBtn = document.getElementById('fmg-stream-stop');

        if (contentEl) {
            contentEl.innerHTML = `<span style="color: #ff6464;">❌ 生成失败: ${escapeHtml(errorMsg)}</span>`;
            contentEl.classList.remove('fmg-streaming');
        }
        if (headerEl) headerEl.textContent = '📝 生成失败';
        if (stopBtn) stopBtn.style.display = 'none';
    }

    function stopGeneration() {
        if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
            console.log('[开场白生成器] 用户中断生成');
        }

        // 更新UI
        const stopBtn = document.getElementById('fmg-stream-stop');
        const applyBtn = document.getElementById('fmg-preview-apply');
        const headerEl = document.querySelector('#fmg-preview-modal .fmg-preview-header h4');
        const contentEl = document.getElementById('fmg-stream-content');

        if (stopBtn) stopBtn.style.display = 'none';
        if (headerEl) headerEl.textContent = '📝 生成已停止';
        if (contentEl) contentEl.classList.remove('fmg-streaming');

        // 如果有内容，允许应用
        const content = window._fmgPendingContent;
        if (content && content.trim() && applyBtn) {
            applyBtn.disabled = false;
        }

        showStatus('fmg-status', 'success', '生成已停止');
    }

    // 兼容旧的非流式预览（保留以防需要）
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

    // ========================================
    // 流式API调用
    // ========================================

    async function callAPIStream(prompt, onChunk, onDone, onError) {
        currentAbortController = new AbortController();

        try {
            if (settings.apiType === 'openai') {
                await callOpenAIStream(prompt, onChunk, onDone, currentAbortController.signal);
            } else {
                await callGeminiStream(prompt, onChunk, onDone, currentAbortController.signal);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[开场白生成器] 请求已中断');
                return;
            }
            onError(e);
        } finally {
            currentAbortController = null;
        }
    }

    async function callOpenAIStream(prompt, onChunk, onDone, signal) {
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
                temperature: 0.8,
                stream: true  // 启用流式
            }),
            signal: signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // 处理 SSE 格式数据
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留不完整的行

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const text = json.choices?.[0]?.delta?.content || '';
                        if (text) {
                            fullContent += text;
                            onChunk(fullContent);
                        }
                    } catch (e) {
                        console.warn('[开场白生成器] 解析流数据失败:', trimmed, e);
                    }
                }
            }
        }

        onDone(fullContent);
    }

    async function callGeminiStream(prompt, onChunk, onDone, signal) {
        // Gemini 使用 streamGenerateContent 端点
        const url = settings.apiUrl.replace(/\/$/, '') + '/models/' + settings.model + ':streamGenerateContent?key=' + settings.apiKey + '&alt=sse';

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8 }
            }),
            signal: signal
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`API错误: ${response.status} - ${error}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // 处理 SSE 格式
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;

                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (text) {
                            fullContent += text;
                            onChunk(fullContent);
                        }
                    } catch (e) {
                        console.warn('[开场白生成器] 解析Gemini流数据失败:', trimmed, e);
                    }
                }
            }
        }

        onDone(fullContent);
    }

    // 保留非流式版本（用于测试或回退）
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

        if (!result.choices || !result.choices[0]) {
            console.error('[开场白生成器] API响应异常:', result);
            throw new Error('API响应格式异常，请检查API类型是否选择正确');
        }
        if (!result.choices[0].message || !result.choices[0].message.content) {
            console.error('[开场白生成器] API响应内容缺失:', result);
            throw new Error('API未返回有效内容，请检查模型是否正确');
        }

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

        if (!result.candidates || !result.candidates[0]) {
            console.error('[开场白生成器] Gemini响应异常:', result);
            if (result.error) {
                throw new Error(`Gemini错误: ${result.error.message || JSON.stringify(result.error)}`);
            }
            throw new Error('Gemini响应格式异常，请检查API配置');
        }
        if (!result.candidates[0].content || !result.candidates[0].content.parts) {
            console.error('[开场白生成器] Gemini响应内容缺失:', result);
            throw new Error('Gemini未返回有效内容，可能是模型拒绝生成或配置错误');
        }

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
