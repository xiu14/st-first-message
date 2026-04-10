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
        selectedPresetPrompts: [],
        // 开场白历史记录（最多5条）
        firstMessageHistory: []
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
                <button class="fmg-tab" data-tab="discuss">讨论</button>
                <button class="fmg-tab" data-tab="worldbook">世界书</button>
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
                    
                    <!-- 最近生成记录 -->
                    <div class="fmg-section fmg-history-section" id="fmg-history-section" style="display: none;">
                        <div class="fmg-section-header">
                            <h4>📋 最近生成记录</h4>
                            <div class="fmg-btn-group">
                                <span class="fmg-count" id="fmg-history-count">0/5</span>
                                <button class="fmg-btn-small fmg-btn-danger-small" id="fmg-history-clear">🗑 清除</button>
                            </div>
                        </div>
                        <div class="fmg-history-list" id="fmg-history-list"></div>
                    </div>
                </div>
                
                <!-- 讨论页 -->
                <div class="fmg-tab-content" data-tab="discuss">
                    <div class="fmg-discuss-container">
                        <div class="fmg-chat-header">
                            <span class="fmg-chat-char-info" id="fmg-discuss-char-name">未选择角色</span>
                            <div class="fmg-btn-group">
                                <button class="fmg-btn-small" id="fmg-discuss-focus-toggle" title="切换聊天专注模式">↕ 专注聊天</button>
                                <button class="fmg-btn-small" id="fmg-discuss-worldbook-toggle" title="勾选 AI 回复并直接转成世界书条目">📚 转世界书</button>
                                <button class="fmg-btn-small" id="fmg-discuss-worldbook-apply" title="将勾选的 AI 回复直接添加到世界书" style="display:none;" disabled>✅ 添加所选</button>
                                <button class="fmg-btn-small" id="fmg-discuss-worldbook-cancel" title="退出世界书勾选模式" style="display:none;">✖ 取消</button>
                                <button class="fmg-btn-small" id="fmg-discuss-refresh" title="刷新角色数据">🔄 刷新</button>
                                <button class="fmg-btn-small" id="fmg-discuss-undo" title="撤回上一轮并恢复到输入框" disabled>↩ 撤回上一轮</button>
                                <button class="fmg-btn-small fmg-btn-danger-small" id="fmg-discuss-clear" title="清空对话">🗑️ 清空</button>
                                <span class="fmg-token-badge" id="fmg-discuss-token-total" title="估算当前讨论会话发送内容的总 token">总Token --</span>
                            </div>
                        </div>

                        <div class="fmg-discuss-worldbook-toolbar" id="fmg-discuss-worldbook-toolbar" style="display:none;">
                            <div class="fmg-discuss-worldbook-toolbar-row">
                                <span class="fmg-discuss-worldbook-toolbar-label">状态</span>
                                <div class="fmg-worldbook-state-group">
                                    <label class="fmg-worldbook-state-chip blue">
                                        <input id="fmg-discuss-worldbook-constant" type="checkbox" checked>
                                        <span>蓝灯</span>
                                    </label>
                                    <label class="fmg-worldbook-state-chip green">
                                        <input id="fmg-discuss-worldbook-normal" type="checkbox">
                                        <span>绿灯</span>
                                    </label>
                                </div>
                            </div>
                            <div class="fmg-discuss-worldbook-toolbar-row">
                                <label class="fmg-discuss-worldbook-toolbar-label" for="fmg-discuss-worldbook-position">位置</label>
                                <select class="fmg-worldbook-select" id="fmg-discuss-worldbook-position"></select>
                            </div>
                            <div class="fmg-discuss-worldbook-toolbar-row">
                                <label class="fmg-discuss-worldbook-toolbar-label" for="fmg-discuss-worldbook-depth">深度</label>
                                <input class="fmg-worldbook-input" id="fmg-discuss-worldbook-depth" type="number" step="1" value="4">
                            </div>
                            <div class="fmg-discuss-worldbook-toolbar-row">
                                <label class="fmg-discuss-worldbook-toolbar-label" for="fmg-discuss-worldbook-order">顺序</label>
                                <input class="fmg-worldbook-input" id="fmg-discuss-worldbook-order" type="number" step="1" value="100">
                            </div>
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
                        
                        <div class="fmg-chat-messages" id="fmg-chat-messages">
                            <div class="fmg-chat-welcome">
                                <div class="fmg-chat-welcome-icon">💬</div>
                                <div>选择角色后，可以在这里讨论角色卡的内容</div>
                                <div style="font-size:11px;color:#888;margin-top:4px;">角色卡信息和世界书将自动作为上下文注入</div>
                            </div>
                        </div>
                        <div class="fmg-chat-input-area">
                            <textarea id="fmg-discuss-input" class="fmg-chat-input" placeholder="输入消息讨论角色卡内容..." rows="2"></textarea>
                            <button class="fmg-btn fmg-btn-primary fmg-chat-send" id="fmg-discuss-send">发送</button>
                        </div>
                        <div id="fmg-discuss-status" class="fmg-status" style="display: none;"></div>
                    </div>
                </div>

                <!-- 世界书页 -->
                <div class="fmg-tab-content" data-tab="worldbook">
                    <div class="fmg-worldbook-container">
                        <div class="fmg-chat-header">
                            <span class="fmg-chat-char-info" id="fmg-wb-char-name">未选择角色</span>
                            <div class="fmg-btn-group">
                                <button class="fmg-btn-small" id="fmg-wb-focus-toggle" title="切换聊天专注模式">↕ 专注聊天</button>
                                <button class="fmg-btn-small" id="fmg-wb-refresh" title="刷新角色数据">🔄 刷新</button>
                                <button class="fmg-btn-small" id="fmg-wb-undo" title="撤回上一轮并恢复到输入框" disabled>↩ 撤回上一轮</button>
                                <button class="fmg-btn-small fmg-btn-danger-small" id="fmg-wb-clear" title="清空对话">🗑️ 清空</button>
                                <span class="fmg-token-badge" id="fmg-wb-token-total" title="估算当前世界书会话发送内容的总 token">总Token --</span>
                            </div>
                        </div>

                        <div class="fmg-worldbook-focus-hidden">
                        <div class="fmg-section">
                            <div class="fmg-section-header">
                                <h4>👤 角色参考信息</h4>
                                <span class="fmg-char-name" id="fmg-wb-char-badge">未选择角色</span>
                            </div>
                            <div class="fmg-checkbox-group">
                                <label><input type="checkbox" id="fmg-wb-inc-desc" checked> 描述</label>
                                <label><input type="checkbox" id="fmg-wb-inc-pers" checked> 性格</label>
                                <label><input type="checkbox" id="fmg-wb-inc-scen" checked> 场景</label>
                                <label><input type="checkbox" id="fmg-wb-inc-first" checked> 当前开场白</label>
                            </div>
                            <div class="fmg-data-preview" id="fmg-wb-data-preview">
                                <div style="color: #888; font-size: 11px;">点击刷新加载数据预览</div>
                            </div>
                            <div class="fmg-worldbook-hint">已勾选字段会作为世界书设计上下文自动注入。</div>
                        </div>

                        <div class="fmg-section fmg-section-compact">
                            <div class="fmg-section-header">
                                <h4>📚 世界书条目</h4>
                                <div class="fmg-btn-group">
                                    <span class="fmg-count" id="fmg-wb-wi-count">0/0</span>
                                    <button class="fmg-btn-small fmg-btn-open" id="fmg-wb-wi-open">选择条目</button>
                                </div>
                            </div>
                        </div>
                        </div>

                        <div class="fmg-chat-messages" id="fmg-wb-chat-messages">
                            <div class="fmg-chat-welcome">
                                <div class="fmg-chat-welcome-icon">📚</div>
                                <div>选择角色后，可以在这里讨论并生成可直接写入世界书的条目</div>
                                <div style="font-size:11px;color:#888;margin-top:4px;">当你要求“输出世界书条目”时，AI 会给出可一键添加的卡片</div>
                            </div>
                        </div>
                        <div class="fmg-chat-input-area">
                            <textarea id="fmg-wb-input" class="fmg-chat-input" placeholder="输入你想补充到世界书的设定，或要求 AI 直接产出可添加条目..." rows="2"></textarea>
                            <button class="fmg-btn fmg-btn-primary fmg-chat-send" id="fmg-wb-send">发送</button>
                        </div>
                        <div id="fmg-wb-status" class="fmg-status" style="display: none;"></div>
                    </div>
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

        syncCharacterIncludeControls();
    }

    function syncCharacterIncludeControls() {
        const controlMap = [
            ['fmg-inc-desc', settings.includeDescription],
            ['fmg-inc-pers', settings.includePersonality],
            ['fmg-inc-scen', settings.includeScenario],
            ['fmg-inc-first', settings.includeCurrentFirstMes],
            ['fmg-wb-inc-desc', settings.includeDescription],
            ['fmg-wb-inc-pers', settings.includePersonality],
            ['fmg-wb-inc-scen', settings.includeScenario],
            ['fmg-wb-inc-first', settings.includeCurrentFirstMes]
        ];

        controlMap.forEach(([id, checked]) => {
            const el = document.getElementById(id);
            if (el) el.checked = checked;
        });
    }

    // ========================================
    // 事件绑定
    // ========================================

    function bindEvents() {
        const discussContainer = document.getElementById('fmg-chat-messages');
        if (discussContainer) {
            discussContainer.addEventListener('scroll', () => {
                discussAutoScroll = isDiscussNearBottom(discussContainer);
            });
        }

        const worldbookContainer = document.getElementById('fmg-wb-chat-messages');
        if (worldbookContainer) {
            worldbookContainer.addEventListener('scroll', () => {
                worldbookAutoScroll = isDiscussNearBottom(worldbookContainer);
            });
        }

        // 关闭和遮罩 - 只关闭主弹窗（排除预览弹窗的关闭按钮）
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('fmg-close-btn') && e.target.closest('#fmg-popup')) closePopup();
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

        // ESC关闭 - 优先关闭顶层弹窗，最后关闭主弹窗
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const historyModal = document.getElementById('fmg-history-detail-modal');
                if (historyModal) {
                    historyModal.remove();
                    return;
                }

                const selectModal = document.getElementById('fmg-selection-modal');
                if (selectModal) {
                    selectModal.remove();
                    return;
                }

                const previewModal = document.getElementById('fmg-preview-modal');
                if (previewModal) {
                    stopGeneration();
                    closePreview();
                    return;
                }
                
                closePopup();
            }
        });

        // 复选框变化保存
        document.addEventListener('change', (e) => {
            if (e.target.id === 'fmg-inc-desc' || e.target.id === 'fmg-wb-inc-desc') settings.includeDescription = e.target.checked;
            if (e.target.id === 'fmg-inc-pers' || e.target.id === 'fmg-wb-inc-pers') settings.includePersonality = e.target.checked;
            if (e.target.id === 'fmg-inc-scen' || e.target.id === 'fmg-wb-inc-scen') settings.includeScenario = e.target.checked;
            if (e.target.id === 'fmg-inc-first' || e.target.id === 'fmg-wb-inc-first') settings.includeCurrentFirstMes = e.target.checked;
            syncCharacterIncludeControls();
            saveSettings();
            requestDiscussTokenCountUpdate();
            requestWorldbookTokenCountUpdate();
        });

        // 讨论页 - 发送
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-send') sendDiscussMessage();
        });

        // 讨论页 - 撤回上一轮
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-undo') undoLastDiscussRound();
        });

        // 讨论页 - 清空
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-clear') clearDiscussion();
        });

        // 讨论页 - 刷新
        document.addEventListener('click', async (e) => {
            if (e.target.id === 'fmg-discuss-refresh') {
                await loadCharacterData();
                updateDiscussPanel();
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-focus-toggle') {
                setDiscussFocusMode(!discussFocusMode);
            }
        });

        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-worldbook-toggle') {
                setDiscussWorldbookSelectionMode(true);
                showStatus('fmg-discuss-status', 'success', '已进入世界书勾选模式，请勾选 AI 回复并设置位置、深度、顺序和蓝绿灯');
            }
            if (e.target.id === 'fmg-discuss-worldbook-cancel') {
                setDiscussWorldbookSelectionMode(false);
                showStatus('fmg-discuss-status', 'success', '已退出世界书勾选模式');
            }
            if (e.target.id === 'fmg-discuss-worldbook-apply') {
                generateWorldbookFromDiscussSelection();
            }
        });

        document.addEventListener('change', (e) => {
            if (!e.target.classList.contains('fmg-discuss-worldbook-check')) return;
            const messageId = e.target.dataset.messageId;
            if (!messageId) return;

            if (e.target.checked) {
                selectedDiscussWorldbookMessageIds.add(messageId);
            } else {
                selectedDiscussWorldbookMessageIds.delete(messageId);
            }
            updateDiscussWorldbookSelectionUI();
        });

        document.addEventListener('change', (e) => {
            if (e.target.id === 'fmg-discuss-worldbook-constant') {
                discussWorldbookDraftConfig.constant = e.target.checked ? true : false;
                updateDiscussWorldbookToolbarControls();
            }
            if (e.target.id === 'fmg-discuss-worldbook-normal') {
                discussWorldbookDraftConfig.constant = e.target.checked ? false : true;
                updateDiscussWorldbookToolbarControls();
            }
            if (e.target.id === 'fmg-discuss-worldbook-position') {
                const selectedOption = e.target.options[e.target.selectedIndex];
                discussWorldbookDraftConfig.position = Number(e.target.value);
                discussWorldbookDraftConfig.role = selectedOption?.dataset?.role !== undefined
                    ? Number(selectedOption.dataset.role)
                    : WORLDBOOK_DEPTH_ROLES.system;
                updateDiscussWorldbookToolbarControls();
            }
            if (e.target.id === 'fmg-discuss-worldbook-depth') {
                discussWorldbookDraftConfig.depth = Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 4;
            }
            if (e.target.id === 'fmg-discuss-worldbook-order') {
                discussWorldbookDraftConfig.order = Number.isFinite(Number(e.target.value))
                    ? Number(e.target.value)
                    : 100;
            }
        });

        // 讨论页 - 世界书选择
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-discuss-wi-open') openSelectionModal('worldinfo');
        });

        // 世界书页 - 发送
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wb-send') sendWorldbookMessage();
        });

        // 世界书页 - 撤回上一轮
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wb-undo') undoLastWorldbookRound();
        });

        // 世界书页 - 清空
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wb-clear') clearWorldbookDiscussion();
        });

        // 世界书页 - 刷新
        document.addEventListener('click', async (e) => {
            if (e.target.id === 'fmg-wb-refresh') {
                await loadCharacterData();
                updateWorldbookPanel();
            }
        });

        // 世界书页 - 聊天专注模式
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wb-focus-toggle') {
                setWorldbookFocusMode(!worldbookFocusMode);
            }
        });

        // 世界书页 - 世界书选择
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-wb-wi-open') openSelectionModal('worldinfo');
        });

        // 讨论页 - 折叠切换
        document.addEventListener('click', (e) => {
            const header = e.target.closest('.fmg-collapse-header');
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

        // 讨论页 - Enter发送 / Shift+Enter换行
        document.addEventListener('keydown', (e) => {
            if (e.target.id === 'fmg-discuss-input' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendDiscussMessage();
            }
        });

        // 世界书页 - Enter发送 / Shift+Enter换行
        document.addEventListener('keydown', (e) => {
            if (e.target.id === 'fmg-wb-input' && e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendWorldbookMessage();
            }
        });

        document.addEventListener('input', (e) => {
            if (e.target.id === 'fmg-discuss-input') {
                requestDiscussTokenCountUpdate(120);
            }
            if (e.target.id === 'fmg-wb-input') {
                requestWorldbookTokenCountUpdate(120);
            }
        });

        // 编辑卡片 - 应用修改
        document.addEventListener('click', (e) => {
            const applyBtn = e.target.closest('.fmg-edit-apply');
            if (applyBtn) {
                const key = applyBtn.dataset.editKey;
                const editData = window._fmgPendingEdits?.[key];
                if (editData) {
                    applyBtn.disabled = true;
                    applyBtn.textContent = '⏳ 应用中...';
                    applyCharacterEdit(editData.field, editData.content, applyBtn);
                }
            }
        });

        // 编辑卡片 - 忽略
        document.addEventListener('click', (e) => {
            const ignoreBtn = e.target.closest('.fmg-edit-ignore');
            if (ignoreBtn) {
                const card = ignoreBtn.closest('.fmg-edit-card');
                if (card) {
                    card.classList.add('ignored');
                    const actionsEl = card.querySelector('.fmg-edit-card-actions');
                    if (actionsEl) actionsEl.innerHTML = '<span class="fmg-edit-ignored-badge">❌ 已忽略</span>';
                }
            }
        });

        // 世界书卡片 - 应用
        document.addEventListener('click', (e) => {
            const applyBtn = e.target.closest('.fmg-worldbook-apply');
            if (applyBtn) {
                const key = applyBtn.dataset.entryKey;
                const entryData = window._fmgPendingWorldbookEntries?.[key];
                if (entryData) {
                    applyBtn.disabled = true;
                    applyBtn.textContent = '⏳ 添加中...';
                    applyWorldbookEntry(entryData, applyBtn);
                }
            }
        });

        // 世界书卡片 - 忽略
        document.addEventListener('click', (e) => {
            const ignoreBtn = e.target.closest('.fmg-worldbook-ignore');
            if (ignoreBtn) {
                const card = ignoreBtn.closest('.fmg-worldbook-card');
                if (card) {
                    card.classList.add('ignored');
                    const actionsEl = card.querySelector('.fmg-edit-card-actions');
                    if (actionsEl) actionsEl.innerHTML = '<span class="fmg-edit-ignored-badge">❌ 已忽略</span>';
                }
            }
        });

        // 世界书卡片 - 手动调整位置
        document.addEventListener('change', (e) => {
            const positionSelect = e.target.closest('.fmg-worldbook-position-select');
            if (!positionSelect) return;

            const key = positionSelect.dataset.entryKey;
            const entryData = window._fmgPendingWorldbookEntries?.[key];
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

            const card = positionSelect.closest('.fmg-worldbook-card');
            const valueEl = card?.querySelector('.fmg-worldbook-position-value');
            if (valueEl) {
                valueEl.textContent = getWorldbookPositionLabel(nextPosition, entryData.role, entryData.outlet_name);
            }
        });

        // 世界书卡片 - 蓝灯/绿灯状态
        document.addEventListener('change', (e) => {
            const stateInput = e.target.closest('.fmg-worldbook-state-input');
            if (!stateInput) return;

            const key = stateInput.dataset.entryKey;
            const entryData = window._fmgPendingWorldbookEntries?.[key];
            if (!entryData) return;

            const nextState = stateInput.dataset.state;
            const card = stateInput.closest('.fmg-worldbook-card');
            if (nextState === 'constant') {
                entryData.constant = true;
                entryData.vectorized = false;
                entryData.selective = false;
            } else {
                entryData.constant = false;
                entryData.vectorized = false;
                entryData.selective = entryData.selective !== false ? true : entryData.selective;
            }

            if (card) {
                card.querySelectorAll('.fmg-worldbook-state-input').forEach(input => {
                    input.checked = input === stateInput;
                });

                const triggerEl = card.querySelector('.fmg-worldbook-trigger-value');
                if (triggerEl) {
                    triggerEl.textContent = entryData.constant ? '常驻条目' : '关键词触发';
                }
            }
        });

        // 世界书卡片 - 手动调整顺序
        document.addEventListener('input', (e) => {
            const orderInput = e.target.closest('.fmg-worldbook-order-input');
            if (!orderInput) return;

            const key = orderInput.dataset.entryKey;
            const entryData = window._fmgPendingWorldbookEntries?.[key];
            if (!entryData) return;

            const nextOrder = Number.isFinite(Number(orderInput.value)) ? Number(orderInput.value) : 100;
            entryData.insertion_order = nextOrder;

            const card = orderInput.closest('.fmg-worldbook-card');
            const valueEl = card?.querySelector('.fmg-worldbook-order-value');
            if (valueEl) {
                valueEl.textContent = String(nextOrder);
            }
        });

        // 编辑卡片 - 旧值折叠切换
        document.addEventListener('click', (e) => {
            const label = e.target.closest('.fmg-edit-card-old .fmg-edit-card-label');
            if (label) {
                const contentEl = label.nextElementSibling;
                const arrow = label.querySelector('.fmg-collapse-arrow');
                if (contentEl) {
                    const isOpen = contentEl.classList.toggle('open');
                    if (arrow) arrow.textContent = isOpen ? '▼' : '▶';
                }
            }
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

        // 历史记录卡片点击
        document.addEventListener('click', (e) => {
            const card = e.target.closest('.fmg-history-card');
            if (card) {
                const index = parseInt(card.dataset.historyIndex);
                if (!isNaN(index)) {
                    showHistoryDetail(index);
                }
            }
        });

        // 历史记录清除按钮
        document.addEventListener('click', (e) => {
            if (e.target.id === 'fmg-history-clear') clearAllHistory();
        });
    }

    // ========================================
    // 弹窗控制
    // ========================================

    function openPopup() {
        document.getElementById('fmg-overlay').classList.add('show');
        document.getElementById('fmg-popup').classList.add('show');
        loadCharacterData();
        renderHistoryList();
    }

    function closePopup() {
        document.getElementById('fmg-overlay').classList.remove('show');
        document.getElementById('fmg-popup').classList.remove('show');
        
        // 同时清理可能正在打开的子弹窗
        const previewModal = document.getElementById('fmg-preview-modal');
        if (previewModal) previewModal.remove();
        
        const historyModal = document.getElementById('fmg-history-detail-modal');
        if (historyModal) historyModal.remove();
        
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
    }

    // ========================================
    // 数据加载
    // ========================================

    async function loadCharacterData() {
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

                const desc = char.description || char.data?.description;
                const pers = char.personality || char.data?.personality;
                const scen = char.scenario || char.data?.scenario;
                const first = char.first_mes || char.data?.first_mes;

                dataPreviewEl.innerHTML = buildCharacterDataPreviewHtml({ desc, pers, scen, first });
                const wbPreviewEl = document.getElementById('fmg-wb-data-preview');
                if (wbPreviewEl) {
                    wbPreviewEl.innerHTML = buildCharacterDataPreviewHtml({ desc, pers, scen, first });
                }

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
                const wbPreviewEl = document.getElementById('fmg-wb-data-preview');
                if (wbPreviewEl) {
                    wbPreviewEl.innerHTML = '<span style="color: #ff6464; font-size: 11px;">请先选择一个角色</span>';
                }
                window._fmgCharData = null;
            }

            // 加载世界书条目
            await loadWorldInfoList(context);

            // 加载预设条目
            loadPresetPrompts(context);

            // 更新讨论页面板
            updateDiscussPanel();

            // 更新世界书页面板
            updateWorldbookPanel();

        
            // 更新状态栏数据并触发角色切换清理检测
            updateSbCharName();

} catch (e) {
            console.error('[开场白生成器] 加载数据失败:', e);
            showStatus('fmg-status', 'error', '加载数据失败: ' + e.message);
        }
    }

    function buildCharacterDataPreviewHtml({ desc, pers, scen, first }) {
        const previews = [];

        if (desc) previews.push('<span class="fmg-tag-ok">描述✓</span>');
        else previews.push('<span class="fmg-tag-empty">描述✗</span>');

        if (pers) previews.push('<span class="fmg-tag-ok">性格✓</span>');
        else previews.push('<span class="fmg-tag-empty">性格✗</span>');

        if (scen) previews.push('<span class="fmg-tag-ok">场景✓</span>');
        else previews.push('<span class="fmg-tag-empty">场景✗</span>');

        if (first) previews.push('<span class="fmg-tag-ok">开场白✓</span>');
        else previews.push('<span class="fmg-tag-empty">开场白✗</span>');

        return previews.join(' ');
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

    function buildOriginalWorldInfoEntry(entry, uid, displayIndex = 0) {
        const numericPosition = Number(entry.position ?? 0);
        const stringPosition = numericPosition === 1 ? 'after_char' : 'before_char';

        return {
            id: uid,
            keys: Array.isArray(entry.keys) ? entry.keys : [],
            secondary_keys: Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [],
            comment: entry.comment || '',
            content: entry.content || '',
            constant: entry.constant === true,
            selective: entry.constant === true ? false : entry.selective !== false,
            insertion_order: entry.insertion_order ?? 100,
            enabled: entry.enabled !== false,
            position: stringPosition,
            use_regex: true,
            extensions: {
                position: numericPosition,
                exclude_recursion: false,
                display_index: displayIndex,
                probability: 100,
                useProbability: true,
                depth: entry.depth ?? (numericPosition === 4 ? 0 : 4),
                selectiveLogic: 0,
                group: '',
                group_override: false,
                group_weight: 100,
                prevent_recursion: false,
                delay_until_recursion: false,
                scan_depth: null,
                match_whole_words: false,
                use_group_scoring: false,
                case_sensitive: null,
                automation_id: '',
                role: 0,
                vectorized: false,
                sticky: 0,
                cooldown: 0,
                delay: 0
            }
        };
    }

    function appendOriginalWorldInfoEntry(worldData, entry, uid) {
        if (!worldData.originalData || typeof worldData.originalData !== 'object') {
            worldData.originalData = { entries: [] };
        }
        if (!Array.isArray(worldData.originalData.entries)) {
            worldData.originalData.entries = [];
        }

        const displayIndex = worldData.originalData.entries.length;
        worldData.originalData.entries.push(buildOriginalWorldInfoEntry(entry, uid, displayIndex));
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
                        const identifier = getWorldInfoIdentifier(entry, idx);
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
            console.log('[开场白生成器] 世界书数据无效');
            return entries;
        }

        const rawEntries = Array.isArray(worldData.entries) ? worldData.entries : Object.values(worldData.entries);
        console.log('[开场白生成器] 外部世界书条目数:', rawEntries.length);

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
                    position: entry.position ?? null
                });
            }
        }

        return entries;
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
                `内容: ${contentPreview}`
            ].join('\n');
        }).join('\n\n');
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

        // 同步讨论页世界书计数
        updateDiscussWiCount();

        // 同步世界书页世界书计数
        updateWorldbookWiCount();
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
                ? getWorldInfoIdentifier(entry, index)
                : (entry.identifier || entry.name || `prompt_${index}`);
            const isEnabled = entry.enabled !== false;
            const isChecked = isWorldInfo
                ? isWorldInfoEntrySelected(entry, index, savedSelections)
                : savedSelections.includes(identifier);

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
            if (isWorldInfo) {
                requestDiscussTokenCountUpdate();
                requestWorldbookTokenCountUpdate();
            }

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

    function getSelectedCharacterInfoBlocks() {
        const charData = window._fmgCharData;
        if (!charData) return [];

        const blocks = [];
        if (settings.includeDescription && charData.desc) {
            blocks.push({ label: '描述', key: 'description', value: charData.desc });
        }
        if (settings.includePersonality && charData.pers) {
            blocks.push({ label: '性格', key: 'personality', value: charData.pers });
        }
        if (settings.includeScenario && charData.scen) {
            blocks.push({ label: '场景', key: 'scenario', value: charData.scen });
        }
        if (settings.includeCurrentFirstMes && charData.first) {
            blocks.push({ label: '当前开场白', key: 'first_mes', value: charData.first });
        }

        return blocks;
    }

    function getSelectedCharacterInfoText() {
        const blocks = getSelectedCharacterInfoBlocks();
        if (blocks.length === 0) {
            return '（未勾选任何角色字段，或这些字段为空）';
        }
        return blocks.map(block => `【${block.label} ${block.key}】\n${block.value}`).join('\n\n');
    }

    // ========================================
    // 角色卡讨论 - 多轮对话
    // ========================================

    // 讨论对话历史
    let discussMessages = [];
    let chatMessageIdCounter = 0;
    let discussFocusMode = false;
    let discussTokenUpdateTimer = null;
    let discussTokenUpdateVersion = 0;
    let discussAbortController = null;
    let isDiscussGenerating = false;
    let discussAutoScroll = true;
    let discussWorldbookSelectionMode = false;
    let isDiscussWorldbookApplying = false;
    const selectedDiscussWorldbookMessageIds = new Set();
    const discussWorldbookDraftConfig = {
        constant: true,
        position: WORLDBOOK_POSITIONS.before,
        role: WORLDBOOK_DEPTH_ROLES.system,
        depth: 4,
        order: 100
    };
    let worldbookMessages = [];
    let worldbookFocusMode = false;
    let worldbookTokenUpdateTimer = null;
    let worldbookTokenUpdateVersion = 0;
    let worldbookAbortController = null;
    let isWorldbookGenerating = false;
    let worldbookAutoScroll = true;

    function isDiscussNearBottom(container) {
        if (!container) return true;
        const threshold = 24;
        return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
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

    function pruneDiscussWorldbookSelection() {
        const validIds = new Set(
            discussMessages
                .filter(msg => msg.role === 'assistant' && msg.id)
                .map(msg => msg.id)
        );

        Array.from(selectedDiscussWorldbookMessageIds).forEach(messageId => {
            if (!validIds.has(messageId)) {
                selectedDiscussWorldbookMessageIds.delete(messageId);
            }
        });
    }

    function updateDiscussWorldbookSelectionUI() {
        const toggleBtn = document.getElementById('fmg-discuss-worldbook-toggle');
        const applyBtn = document.getElementById('fmg-discuss-worldbook-apply');
        const cancelBtn = document.getElementById('fmg-discuss-worldbook-cancel');
        const toolbar = document.getElementById('fmg-discuss-worldbook-toolbar');
        const selectedCount = selectedDiscussWorldbookMessageIds.size;

        if (toggleBtn) {
            toggleBtn.textContent = discussWorldbookSelectionMode ? '📚 选取中' : '📚 转世界书';
            toggleBtn.title = discussWorldbookSelectionMode
                ? '正在勾选 AI 回复，确认参数后点击“添加所选”'
                : '进入世界书勾选模式，从多条 AI 回复中挑选需要沉淀的设定';
            toggleBtn.classList.toggle('active', discussWorldbookSelectionMode);
            toggleBtn.disabled = isDiscussWorldbookApplying;
        }

        if (applyBtn) {
            applyBtn.style.display = discussWorldbookSelectionMode ? '' : 'none';
            applyBtn.disabled = isDiscussWorldbookApplying || selectedCount === 0 || isDiscussGenerating;
            applyBtn.textContent = isDiscussWorldbookApplying
                ? '⏳ 添加中...'
                : selectedCount > 0
                    ? `✅ 添加所选(${selectedCount})`
                    : '✅ 添加所选';
        }

        if (cancelBtn) {
            cancelBtn.style.display = discussWorldbookSelectionMode ? '' : 'none';
            cancelBtn.disabled = isDiscussWorldbookApplying;
        }

        if (toolbar) {
            toolbar.style.display = discussWorldbookSelectionMode ? '' : 'none';
        }

        updateDiscussWorldbookToolbarControls();
    }

    function updateDiscussWorldbookToolbarControls() {
        const positionEl = document.getElementById('fmg-discuss-worldbook-position');
        const depthEl = document.getElementById('fmg-discuss-worldbook-depth');
        const orderEl = document.getElementById('fmg-discuss-worldbook-order');
        const constantEl = document.getElementById('fmg-discuss-worldbook-constant');
        const normalEl = document.getElementById('fmg-discuss-worldbook-normal');

        if (positionEl) {
            if (!positionEl.dataset.optionsBound) {
                positionEl.innerHTML = renderWorldbookSelectOptions(
                    getWorldbookPositionOptions(null),
                    discussWorldbookDraftConfig.position,
                    discussWorldbookDraftConfig.role
                );
                positionEl.dataset.optionsBound = 'true';
            }

            Array.from(positionEl.options).forEach(option => {
                const optionRole = option.dataset.role !== undefined
                    ? Number(option.dataset.role)
                    : null;
                option.selected = Number(option.value) === Number(discussWorldbookDraftConfig.position)
                    && (Number(option.value) !== WORLDBOOK_POSITIONS.atDepth || Number(optionRole ?? WORLDBOOK_DEPTH_ROLES.system) === Number(discussWorldbookDraftConfig.role));
            });
            positionEl.disabled = isDiscussWorldbookApplying;
        }

        if (depthEl) {
            depthEl.value = String(discussWorldbookDraftConfig.depth);
            depthEl.disabled = isDiscussWorldbookApplying || Number(discussWorldbookDraftConfig.position) !== WORLDBOOK_POSITIONS.atDepth;
        }

        if (orderEl) {
            orderEl.value = String(discussWorldbookDraftConfig.order);
            orderEl.disabled = isDiscussWorldbookApplying;
        }

        if (constantEl) {
            constantEl.checked = discussWorldbookDraftConfig.constant === true;
            constantEl.disabled = isDiscussWorldbookApplying;
        }

        if (normalEl) {
            normalEl.checked = discussWorldbookDraftConfig.constant !== true;
            normalEl.disabled = isDiscussWorldbookApplying;
        }
    }

    function setDiscussWorldbookSelectionMode(enabled) {
        discussWorldbookSelectionMode = enabled === true;
        if (!discussWorldbookSelectionMode) {
            selectedDiscussWorldbookMessageIds.clear();
        } else {
            pruneDiscussWorldbookSelection();
        }
        renderDiscussionHistory();
        updateDiscussWorldbookSelectionUI();
    }

    function getSelectedDiscussAssistantMessages() {
        ensureChatMessageIds(discussMessages);
        pruneDiscussWorldbookSelection();
        return discussMessages
            .filter(msg => msg.role === 'assistant' && selectedDiscussWorldbookMessageIds.has(msg.id));
    }

    function getDiscussWelcomeHtml() {
        return `
            <div class="fmg-chat-welcome">
                <div class="fmg-chat-welcome-icon">💬</div>
                <div>选择角色后，可以在这里讨论角色卡的内容</div>
                <div style="font-size:11px;color:#888;margin-top:4px;">角色卡信息和世界书将自动作为上下文注入</div>
            </div>
        `;
    }

    function renderDiscussionHistory() {
        const container = document.getElementById('fmg-chat-messages');
        if (!container) return;

        ensureChatMessageIds(discussMessages);
        pruneDiscussWorldbookSelection();
        const visibleMessages = discussMessages.filter(msg => msg.role !== 'system');

        window._fmgPendingEdits = {};
        _editIdCounter = 0;
        container.innerHTML = '';

        if (visibleMessages.length === 0) {
            container.innerHTML = getDiscussWelcomeHtml();
            discussAutoScroll = true;
            updateDiscussUndoButton();
            updateDiscussWorldbookSelectionUI();
            requestDiscussTokenCountUpdate();
            return;
        }

        visibleMessages.forEach(msg => appendChatMessage(msg.role, msg.content, false, msg.id));
        discussAutoScroll = true;
        container.scrollTop = container.scrollHeight;
        updateDiscussUndoButton();
        updateDiscussWorldbookSelectionUI();
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
        setDiscussFocusMode(discussFocusMode);
        updateDiscussWorldbookSelectionUI();
        requestDiscussTokenCountUpdate();
    }

    function updateDiscussWiCount() {
        const wiEntries = window._fmgWorldEntries || [];
        const wiSelected = (settings.selectedWorldEntries || []).length;
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

        // 编辑格式说明
        parts.push(`【修改角色卡格式说明】
当用户要求你修改角色卡的某个字段时，请使用以下格式输出修改建议：
[EDIT:字段名]
修改后的完整内容
[/EDIT]

支持的字段名：description, personality, scenario, first_mes, mes_example, system_prompt, post_history_instructions, creator_notes

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
3. [EDIT:xxx] 块内应包含该字段修改后的完整内容，而不是差异或补丁
4. 可以在 [EDIT] 块前后添加普通文字解释你的修改理由`);

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
        const existingToolbar = bubble.querySelector('.fmg-chat-assistant-toolbar');
        if (isStreaming) {
            textEl.innerHTML = escapeHtml(content) + '<span class="fmg-cursor">▌</span>';
            if (existingToolbar) existingToolbar.remove();
        } else {
            bubble.dataset.messageId = messageId || '';
            if (role === 'assistant') {
                textEl.innerHTML = renderAssistantContent(content);
                if (discussWorldbookSelectionMode && messageId) {
                    let toolbar = existingToolbar;
                    if (!toolbar) {
                        toolbar = document.createElement('div');
                        toolbar.className = 'fmg-chat-assistant-toolbar';
                        bubble.insertBefore(toolbar, textEl);
                    }
                    const checked = selectedDiscussWorldbookMessageIds.has(messageId);
                    toolbar.innerHTML = `
                        <label class="fmg-chat-assistant-pick">
                            <input
                                type="checkbox"
                                class="fmg-discuss-worldbook-check"
                                data-message-id="${escapeHtml(messageId)}"
                                ${checked ? 'checked' : ''}
                                ${isDiscussWorldbookApplying ? 'disabled' : ''}
                            >
                            <span>转世界书</span>
                        </label>
                    `;
                } else if (existingToolbar) {
                    existingToolbar.remove();
                }
            } else {
                textEl.innerHTML = escapeHtml(content);
                if (existingToolbar) existingToolbar.remove();
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
        const regex = /\[EDIT:(\w+)\]([\s\S]*?)\[\/EDIT\]/g;
        const edits = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const field = match[1];
            if (FIELD_LABELS[field]) {
                edits.push({
                    field: field,
                    content: match[2].trim(),
                    start: match.index,
                    end: regex.lastIndex
                });
            }
        }
        return edits;
    }

    function renderAssistantContent(content) {
        const edits = parseEditBlocks(content);
        if (edits.length === 0) {
            return escapeHtml(content);
        }

        let html = '';
        let lastIndex = 0;

        for (const edit of edits) {
            if (edit.start > lastIndex) {
                const plainText = content.substring(lastIndex, edit.start).trim();
                if (plainText) {
                    html += '<div class="fmg-chat-plain">' + escapeHtml(plainText) + '</div>';
                }
            }
            const editKey = 'edit_' + (++_editIdCounter);
            window._fmgPendingEdits[editKey] = { field: edit.field, content: edit.content };
            html += renderEditCard(edit, editKey);
            lastIndex = edit.end;
        }

        if (lastIndex < content.length) {
            const remaining = content.substring(lastIndex).trim();
            if (remaining) {
                html += '<div class="fmg-chat-plain">' + escapeHtml(remaining) + '</div>';
            }
        }
        return html;
    }

    function renderEditCard(edit, editKey) {
        const fieldLabel = FIELD_LABELS[edit.field] || edit.field;
        const charData = window._fmgCharData;
        const cacheKey = FIELD_TO_CACHE_KEY[edit.field] || edit.field;
        const currentValue = charData ? (charData[cacheKey] || '（空）') : '（无角色数据）';

        return `
            <div class="fmg-edit-card" data-edit-key="${editKey}">
                <div class="fmg-edit-card-header">
                    <span>✏️ 修改建议：${escapeHtml(fieldLabel)} (${escapeHtml(edit.field)})</span>
                </div>
                <div class="fmg-edit-card-old">
                    <div class="fmg-edit-card-label">📄 当前值 <span class="fmg-collapse-arrow">▶</span></div>
                    <div class="fmg-edit-card-old-content">${escapeHtml(currentValue)}</div>
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

    async function applyCharacterEdit(field, newValue, buttonEl) {
        try {
            const context = SillyTavern.getContext();
            if (context.characterId === undefined) throw new Error('未选择角色');

            const char = context.characters[context.characterId];
            if (!char) throw new Error('角色数据不存在');

            // 更新内存中的数据
            if (char.data) char.data[field] = newValue;
            const topLevelFields = ['description', 'personality', 'scenario', 'first_mes', 'mes_example'];
            if (topLevelFields.includes(field)) char[field] = newValue;

            // 调用 SillyTavern API 保存
            const headers = typeof context.getRequestHeaders === 'function'
                ? context.getRequestHeaders()
                : { 'Content-Type': 'application/json' };

            const response = await fetch('/api/characters/merge-attributes', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    avatar: char.avatar,
                    data: { [field]: newValue }
                })
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errText}`);
            }

            // 更新缓存
            const cacheKey = FIELD_TO_CACHE_KEY[field] || field;
            if (window._fmgCharData) {
                window._fmgCharData[cacheKey] = newValue;
                if (window._fmgCharData._raw) window._fmgCharData._raw[field] = newValue;
            }

            // 更新卡片状态
            if (buttonEl) {
                const card = buttonEl.closest('.fmg-edit-card');
                if (card) {
                    card.classList.add('applied');
                    const actionsEl = card.querySelector('.fmg-edit-card-actions');
                    if (actionsEl) actionsEl.innerHTML = '<span class="fmg-edit-applied-badge">✅ 已应用</span>';
                }
            }

            updateDiscussPanel();
            if (typeof toastr !== 'undefined') toastr.success(`${FIELD_LABELS[field] || field} 已更新`);

        } catch (e) {
            console.error('[开场白生成器] 应用修改失败:', e);
            if (typeof toastr !== 'undefined') toastr.error('应用修改失败: ' + e.message);
            if (buttonEl) {
                buttonEl.textContent = '⚠️ 重试';
                buttonEl.disabled = false;
            }
        }
    }

    // ========================================
    // 世界书讨论与条目应用
    // ========================================

    window._fmgPendingWorldbookEntries = {};
    let _worldbookEntryIdCounter = 0;

    function getWorldbookWelcomeHtml() {
        return `
            <div class="fmg-chat-welcome">
                <div class="fmg-chat-welcome-icon">📚</div>
                <div>选择角色后，可以在这里讨论世界设定并产出可直接写入世界书的条目</div>
                <div style="font-size:11px;color:#888;margin-top:4px;">要求 AI “输出世界书条目”时，它会返回可一键添加的条目卡片</div>
            </div>
        `;
    }

    function updateWorldbookPanel() {
        const charData = window._fmgCharData;
        const headerNameEl = document.getElementById('fmg-wb-char-name');
        const badgeNameEl = document.getElementById('fmg-wb-char-badge');

        [headerNameEl, badgeNameEl].forEach(el => {
            if (!el) return;
            if (charData && charData.name) {
                el.textContent = el.id === 'fmg-wb-char-name' ? `🎭 ${charData.name}` : charData.name;
                el.classList.add('active');
            } else {
                el.textContent = '未选择角色';
                el.classList.remove('active');
            }
        });

        updateWorldbookWiCount();
        updateWorldbookUndoButton();
        setWorldbookFocusMode(worldbookFocusMode);
        requestWorldbookTokenCountUpdate();
    }

    function updateWorldbookWiCount() {
        const wiEntries = window._fmgWorldEntries || [];
        const wiSelected = (settings.selectedWorldEntries || []).length;
        const el = document.getElementById('fmg-wb-wi-count');
        if (el) el.textContent = `${wiSelected}/${wiEntries.length}`;
    }

    function renderWorldbookHistory() {
        const container = document.getElementById('fmg-wb-chat-messages');
        if (!container) return;

        const visibleMessages = worldbookMessages.filter(msg => msg.role !== 'system');
        window._fmgPendingWorldbookEntries = {};
        _worldbookEntryIdCounter = 0;
        container.innerHTML = '';

        if (visibleMessages.length === 0) {
            container.innerHTML = getWorldbookWelcomeHtml();
            worldbookAutoScroll = true;
            updateWorldbookUndoButton();
            return;
        }

        visibleMessages.forEach(msg => appendWorldbookMessage(msg.role, msg.content, false));
        worldbookAutoScroll = true;
        container.scrollTop = container.scrollHeight;
        updateWorldbookUndoButton();
        requestWorldbookTokenCountUpdate();
    }

    function updateWorldbookUndoButton() {
        const undoBtn = document.getElementById('fmg-wb-undo');
        if (!undoBtn) return;

        const hasUndoableRound = worldbookMessages.some(msg => msg.role === 'user');
        undoBtn.disabled = isWorldbookGenerating || !hasUndoableRound;
    }

    function setWorldbookFocusMode(enabled) {
        worldbookFocusMode = enabled === true;

        const container = document.querySelector('.fmg-worldbook-container');
        if (container) {
            container.classList.toggle('chat-focused', worldbookFocusMode);
        }

        const toggleBtn = document.getElementById('fmg-wb-focus-toggle');
        if (toggleBtn) {
            toggleBtn.textContent = worldbookFocusMode ? '↕ 展开' : '↕ 专注';
            toggleBtn.title = worldbookFocusMode ? '显示世界书页面的其他操作区' : '收起非聊天区域，只保留聊天区';
            toggleBtn.classList.toggle('active', worldbookFocusMode);
        }
    }

    function requestWorldbookTokenCountUpdate(delay = 0) {
        if (worldbookTokenUpdateTimer) {
            clearTimeout(worldbookTokenUpdateTimer);
        }

        worldbookTokenUpdateTimer = setTimeout(() => {
            worldbookTokenUpdateTimer = null;
            updateWorldbookTokenCount();
        }, Math.max(0, delay));
    }

    async function updateWorldbookTokenCount() {
        const counterEl = document.getElementById('fmg-wb-token-total');
        if (!counterEl) return;

        const version = ++worldbookTokenUpdateVersion;
        counterEl.textContent = '总Token ...';

        try {
            const context = typeof SillyTavern !== 'undefined' ? SillyTavern.getContext() : null;
            if (!context || typeof context.getTokenCountAsync !== 'function') {
                counterEl.textContent = '总Token --';
                return;
            }

            const chunks = [];
            const systemPrompt = buildWorldbookSystemPrompt();
            if (systemPrompt) chunks.push(systemPrompt);

            worldbookMessages
                .filter(msg => msg.role !== 'system' && String(msg.content || '').trim())
                .forEach(msg => chunks.push(String(msg.content)));

            const inputEl = document.getElementById('fmg-wb-input');
            const draftText = inputEl && typeof inputEl.value === 'string' ? inputEl.value.trim() : '';
            if (draftText) chunks.push(draftText);

            const counts = await Promise.all(chunks.map(chunk => context.getTokenCountAsync(String(chunk), 0)));
            if (version !== worldbookTokenUpdateVersion) return;

            const total = counts.reduce((sum, count) => sum + (Number.isFinite(Number(count)) ? Number(count) : 0), 0);
            counterEl.textContent = `总Token ${total}`;
        } catch (error) {
            console.warn('[开场白生成器] 统计世界书 token 失败:', error);
            if (version === worldbookTokenUpdateVersion) {
                counterEl.textContent = '总Token --';
            }
        }
    }

    function syncWorldbookSystemPrompt() {
        const systemPrompt = buildWorldbookSystemPrompt();
        worldbookMessages = worldbookMessages.filter(msg => msg.role !== 'system');

        if (systemPrompt) {
            worldbookMessages.unshift({ role: 'system', content: systemPrompt });
        }
    }

    function buildWorldbookSystemPrompt() {
        const charData = window._fmgCharData;
        if (!charData) return null;

        const worldInfo = getSelectedWorldInfo();
        const worldInfoText = worldInfo.length > 0
            ? worldInfo.map(e => `[${e.name}]: ${e.content}`).join('\n\n')
            : '（未选择任何世界书条目）';
        const editableEntriesText = formatSelectedWorldInfoForUpdate(worldInfo);

        return `你是一个专业的 SillyTavern 世界书（Lorebook）设计助手。

当前角色：${charData.name}

【角色参考信息】
${getSelectedCharacterInfoText()}

【已选择的世界书上下文】
${worldInfoText}

【当前已选条目清单（更新已有条目时优先使用这些 UID）】
${editableEntriesText}

【工作方式】
1. 如果用户在讨论设定、拆分信息结构、询问条目设计建议，请直接自然回答。
2. 如果用户明确要求“输出世界书条目”“给我可直接添加的版本”“生成可写入世界书的内容”，你必须在解释后输出一个或多个条目块。
3. 条目块必须使用下面的精确格式，不要使用 markdown 代码块包裹：
[WORLDBOOK_ENTRY]
{
  "uid": 15,
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
4. 如果是更新已有条目，必须填写 "uid" 为对应条目的 id；如果是新建条目，不要填写 uid。
5. 如果条目应当常驻，请将 "constant" 设为 true，并将 "keys" 设为空数组。
6. 如果条目不是常驻条目，"keys" 至少要有一个触发关键词。
7. "position" 可用值有：
   - "before_char": 放在角色定义前的普通世界书
   - "after_char": 放在角色定义后的普通世界书
   - "before_author_note": 放在作者注前
   - "after_author_note": 放在作者注后
   - "before_example_messages": 放在示例对话前
   - "after_example_messages": 放在示例对话后
   - "at_depth": 作为 depth 注入，此时还要提供 "depth" 和 "role"
   - "outlet": 发送到指定 outlet，此时还要提供 "outlet_name"
8. 当 position 为 "at_depth" 时：
   - "depth" 必须是数字，默认可用 4
   - "role" 只能是 "system"、"user"、"assistant"
9. 当 position 为 "outlet" 时，必须提供 "outlet_name"。
10. 请同时给出 "placement_reason"，用一句话说明为什么这个条目更适合放在这个位置。
11. 如果用户要求你“帮我判断这个条目应该放在哪里”，你要主动分析它更适合普通世界书、作者注附近、depth 注入还是 outlet，并在输出条目块时填好对应字段。
12. "content" 必须是完整可直接使用的最终条目内容，不要写“同上”“略”或备注占位符。
13. 如果用户说“更新某个已有条目”，优先从“当前已选条目清单”里选择最匹配的条目，并自动填写对应 uid，不要反问用户去查 uid。
14. 只有在你无法从“当前已选条目清单”中可靠定位目标条目时，才向用户确认具体要更新哪一条。
15. 只有在用户明确要求产出条目时才输出条目块；普通讨论时不要输出条目块。`;
    }

    function stripDiscussMessageBlocks(content) {
        return String(content || '')
            .replace(/\[EDIT:\w+\][\s\S]*?\[\/EDIT\]/g, '')
            .replace(/\[(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\][\s\S]*?\[\/(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\]/g, '')
            .trim();
    }

    function deriveWorldbookCommentFromDiscuss(content, index) {
        const lines = stripDiscussMessageBlocks(content)
            .split('\n')
            .map(line => line.replace(/^[#*\-\d.\s>]+/, '').trim())
            .filter(Boolean);

        const firstLine = lines[0] || `讨论条目 ${index + 1}`;
        return firstLine.length > 24 ? `${firstLine.slice(0, 24).trim()}...` : firstLine;
    }

    function deriveWorldbookKeysFromDiscuss(comment, content) {
        const normalizedComment = String(comment || '').replace(/[：:。！？!?,，、；;（）()\[\]【】]/g, ' ').trim();
        const candidates = normalizedComment
            .split(/\s+/)
            .map(part => part.trim())
            .filter(Boolean)
            .slice(0, 3);

        if (candidates.length > 0) {
            return candidates;
        }

        const stripped = stripDiscussMessageBlocks(content);
        if (!stripped) {
            return ['讨论条目'];
        }

        const fallback = stripped.slice(0, 18).trim();
        return [fallback || '讨论条目'];
    }

    function buildDirectWorldbookEntriesFromDiscuss(messages) {
        return messages.map((message, index) => {
            const cleanedContent = stripDiscussMessageBlocks(message.content);
            const comment = deriveWorldbookCommentFromDiscuss(cleanedContent, index);
            const keys = discussWorldbookDraftConfig.constant
                ? []
                : deriveWorldbookKeysFromDiscuss(comment, cleanedContent);

            return {
                uid: null,
                comment,
                keys,
                secondary_keys: [],
                content: cleanedContent,
                constant: discussWorldbookDraftConfig.constant === true,
                selective: discussWorldbookDraftConfig.constant === true ? false : true,
                position: discussWorldbookDraftConfig.position,
                depth: Number.isFinite(Number(discussWorldbookDraftConfig.depth))
                    ? Number(discussWorldbookDraftConfig.depth)
                    : 4,
                role: discussWorldbookDraftConfig.position === WORLDBOOK_POSITIONS.atDepth
                    ? discussWorldbookDraftConfig.role
                    : null,
                outlet_name: '',
                placement_reason: '由讨论页勾选内容直接转存为世界书草稿。',
                insertion_order: Number.isFinite(Number(discussWorldbookDraftConfig.order))
                    ? Number(discussWorldbookDraftConfig.order)
                    : 100,
                enabled: true,
                vectorized: false
            };
        }).filter(entry => String(entry.content || '').trim());
    }

    async function generateWorldbookFromDiscussSelection() {
        if (isDiscussWorldbookApplying) return;
        if (isDiscussGenerating) {
            showStatus('fmg-discuss-status', 'error', '请先等待当前讨论回复完成，再转世界书');
            return;
        }
        if (!window._fmgCharData) {
            showStatus('fmg-discuss-status', 'error', '请先选择角色并刷新数据');
            return;
        }

        const selectedMessages = getSelectedDiscussAssistantMessages();
        if (selectedMessages.length === 0) {
            showStatus('fmg-discuss-status', 'error', '请先勾选至少一条 AI 回复');
            return;
        }

        isDiscussWorldbookApplying = true;
        renderDiscussionHistory();
        updateDiscussWorldbookSelectionUI();
        showStatus('fmg-discuss-status', 'loading', `正在把 ${selectedMessages.length} 条 AI 回复直接写入世界书...`);

        try {
            const directEntries = buildDirectWorldbookEntriesFromDiscuss(selectedMessages);
            if (directEntries.length === 0) {
                throw new Error('勾选的消息里没有可直接写入的正文内容');
            }

            const results = await applyWorldbookEntriesBatch(directEntries);
            const successResults = results.filter(result => result.isFailed !== true);
            const failedCount = results.filter(result => result.isFailed === true).length;
            if (successResults.length === 0) {
                throw new Error(results[0]?.error?.message || '没有条目成功写入世界书');
            }

            const addedCount = successResults.filter(result => result.isUpdate !== true).length;
            const updatedCount = successResults.filter(result => result.isUpdate === true).length;
            const summaryParts = [];

            if (addedCount > 0) summaryParts.push(`新增 ${addedCount} 条`);
            if (updatedCount > 0) summaryParts.push(`更新 ${updatedCount} 条`);
            if (failedCount > 0) summaryParts.push(`${failedCount} 条写入失败`);

            setDiscussWorldbookSelectionMode(false);
            showStatus('fmg-discuss-status', 'success', `已写入世界书：${summaryParts.join('，') || `共 ${successResults.length} 条`}`);
            if (typeof toastr !== 'undefined') {
                toastr.success(`世界书条目已写入：${summaryParts.join('，') || `共 ${successResults.length} 条`}`);
            }
        } catch (error) {
            console.error('[开场白生成器] 讨论内容转世界书失败:', error);
            showStatus('fmg-discuss-status', 'error', '转世界书失败: ' + error.message);
            if (typeof toastr !== 'undefined') {
                toastr.error('转世界书失败: ' + error.message);
            }
        } finally {
            isDiscussWorldbookApplying = false;
            renderDiscussionHistory();
            updateDiscussWorldbookSelectionUI();
        }
    }

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

    function parseWorldbookEntryBlocks(text) {
        const regex = /\[(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\]([\s\S]*?)\[\/(?:WORLDBOOK_ENTRY|WORLDINFO_ENTRY)\]/g;
        const entries = [];
        let match;

        while ((match = regex.exec(text)) !== null) {
            const rawBlock = match[1].trim();
            try {
                const parsed = JSON.parse(rawBlock);
                const content = String(parsed.content || parsed.entry_content || parsed.text || '').trim();
                const keys = normalizeStringArray(parsed.keys ?? parsed.key);
                const secondaryKeys = normalizeStringArray(parsed.secondary_keys ?? parsed.keysecondary ?? parsed.secondaryKeys);

                if (!content) {
                    throw new Error('缺少 content 字段');
                }

                entries.push({
                    uid: Number.isFinite(Number(parsed.uid)) ? Number(parsed.uid) : null,
                    comment: String(parsed.comment || parsed.title || parsed.name || keys[0] || '未命名条目').trim(),
                    keys: keys,
                    secondary_keys: secondaryKeys,
                    content: content,
                    constant: parsed.constant === true,
                    selective: parsed.selective !== undefined ? Boolean(parsed.selective) : parsed.constant !== true,
                    position: normalizeWorldbookPosition(parsed.position),
                    depth: Number.isFinite(Number(parsed.depth)) ? Number(parsed.depth) : null,
                    role: normalizeWorldbookRole(parsed.role),
                    outlet_name: String(parsed.outlet_name || parsed.outletName || '').trim(),
                    placement_reason: String(parsed.placement_reason || parsed.position_reason || parsed.reason || '').trim(),
                    insertion_order: Number.isFinite(Number(parsed.insertion_order ?? parsed.order))
                        ? Number(parsed.insertion_order ?? parsed.order)
                        : 100,
                    enabled: parsed.enabled !== false,
                    start: match.index,
                    end: regex.lastIndex
                });
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

    function renderWorldbookEntryCard(entry, entryKey) {
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

        const triggerMode = entry.constant ? '常驻条目' : '关键词触发';
        const keysText = entry.keys.length > 0 ? entry.keys.join(', ') : '（无）';
        const secondaryText = entry.secondary_keys.length > 0 ? entry.secondary_keys.join(', ') : '（无）';
        const modeLabel = entry.uid !== null ? `更新现有条目 #${entry.uid}` : '新增条目';
        const actionLabel = entry.uid !== null ? '✅ 更新世界书条目' : '✅ 添加到世界书';
        const positionDetail = Number(entry.position) === WORLDBOOK_POSITIONS.atDepth
            ? `depth=${entry.depth ?? 4}, role=${getWorldbookRoleLabel(entry.role)}`
            : Number(entry.position) === WORLDBOOK_POSITIONS.outlet
                ? (entry.outlet_name || '未指定')
                : '';
        const currentPosition = entry.position ?? WORLDBOOK_POSITIONS.before;
        const currentRole = entry.role ?? WORLDBOOK_DEPTH_ROLES.system;
        const currentOrder = Number.isFinite(Number(entry.insertion_order)) ? Number(entry.insertion_order) : 100;
        const positionOptionsHtml = renderWorldbookSelectOptions(getWorldbookPositionOptions(entry), currentPosition, currentRole);

        return `
            <div class="fmg-worldbook-card" data-entry-key="${entryKey}">
                <div class="fmg-worldbook-card-header">📚 世界书条目建议：${escapeHtml(entry.comment || '未命名条目')}</div>
                <div class="fmg-worldbook-meta">
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">操作类型</span><span>${escapeHtml(modeLabel)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">主关键词</span><span>${escapeHtml(keysText)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">次关键词</span><span>${escapeHtml(secondaryText)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">触发方式</span><span class="fmg-worldbook-trigger-value">${escapeHtml(triggerMode)}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">注入位置</span><span class="fmg-worldbook-position-value">${escapeHtml(getWorldbookPositionLabel(currentPosition, currentRole, entry.outlet_name))}</span></div>
                    <div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">插入顺序</span><span class="fmg-worldbook-order-value">${escapeHtml(String(currentOrder))}</span></div>
                    ${positionDetail ? `<div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">位置细节</span><span>${escapeHtml(positionDetail)}</span></div>` : ''}
                    ${entry.placement_reason ? `<div class="fmg-worldbook-meta-row"><span class="fmg-worldbook-meta-label">放置理由</span><span>${escapeHtml(entry.placement_reason)}</span></div>` : ''}
                </div>
                <div class="fmg-edit-card-new">
                    <div class="fmg-edit-card-label-static">📝 条目内容</div>
                    <div class="fmg-edit-card-new-content">${escapeHtml(entry.content)}</div>
                </div>
                <div class="fmg-worldbook-controls">
                    <div class="fmg-worldbook-control-row">
                        <span class="fmg-worldbook-control-label">状态</span>
                        <div class="fmg-worldbook-state-group">
                            <label class="fmg-worldbook-state-chip blue">
                                <input class="fmg-worldbook-state-input" type="checkbox" data-entry-key="${entryKey}" data-state="constant" ${entry.constant ? 'checked' : ''}>
                                <span>蓝灯</span>
                            </label>
                            <label class="fmg-worldbook-state-chip green">
                                <input class="fmg-worldbook-state-input" type="checkbox" data-entry-key="${entryKey}" data-state="normal" ${entry.constant ? '' : 'checked'}>
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
                        <input class="fmg-worldbook-input fmg-worldbook-order-input" id="fmg-worldbook-order-${escapeHtml(entryKey)}" data-entry-key="${entryKey}" type="number" step="1" value="${escapeHtml(String(currentOrder))}">
                    </div>
                </div>
                <div class="fmg-edit-card-actions">
                    <button class="fmg-btn fmg-btn-primary fmg-worldbook-apply" data-entry-key="${entryKey}">${actionLabel}</button>
                    <button class="fmg-btn fmg-btn-secondary fmg-worldbook-ignore" data-entry-key="${entryKey}">❌ 忽略</button>
                </div>
            </div>
        `;
    }

    function renderWorldbookAssistantContent(content) {
        const entries = parseWorldbookEntryBlocks(content);
        if (entries.length === 0) {
            return escapeHtml(content);
        }

        let html = '';
        let lastIndex = 0;

        for (const entry of entries) {
            if (entry.start > lastIndex) {
                const plainText = content.substring(lastIndex, entry.start).trim();
                if (plainText) {
                    html += '<div class="fmg-chat-plain">' + escapeHtml(plainText) + '</div>';
                }
            }

            const entryKey = 'worldbook_' + (++_worldbookEntryIdCounter);
            if (!entry.invalid) {
                window._fmgPendingWorldbookEntries[entryKey] = {
                    uid: entry.uid,
                    comment: entry.comment,
                    keys: entry.keys,
                    secondary_keys: entry.secondary_keys,
                    content: entry.content,
                    constant: entry.constant,
                    vectorized: false,
                    selective: entry.selective,
                    position: entry.position,
                    depth: entry.depth,
                    role: entry.role,
                    outlet_name: entry.outlet_name,
                    placement_reason: entry.placement_reason,
                    insertion_order: entry.insertion_order,
                    enabled: entry.enabled
                };
            }
            html += renderWorldbookEntryCard(entry, entryKey);
            lastIndex = entry.end;
        }

        if (lastIndex < content.length) {
            const remaining = content.substring(lastIndex).trim();
            if (remaining) {
                html += '<div class="fmg-chat-plain">' + escapeHtml(remaining) + '</div>';
            }
        }

        return html;
    }

    function appendWorldbookMessage(role, content, isStreaming = false) {
        const container = document.getElementById('fmg-wb-chat-messages');
        if (!container) return;
        const shouldAutoScroll = role === 'user' || worldbookAutoScroll || isDiscussNearBottom(container);

        const welcome = container.querySelector('.fmg-chat-welcome');
        if (welcome) welcome.remove();

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
            textEl.innerHTML = role === 'assistant' ? renderWorldbookAssistantContent(content) : escapeHtml(content);
            bubble.classList.remove('streaming');
        }

        if (shouldAutoScroll) {
            container.scrollTop = container.scrollHeight;
            worldbookAutoScroll = true;
        }

        return bubble;
    }

    function undoLastWorldbookRound() {
        if (isWorldbookGenerating) {
            showStatus('fmg-wb-status', 'error', '请先停止当前生成，再撤回上一轮');
            return;
        }

        let lastUserIndex = -1;
        for (let i = worldbookMessages.length - 1; i >= 0; i--) {
            if (worldbookMessages[i].role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        if (lastUserIndex < 0) {
            showStatus('fmg-wb-status', 'error', '当前没有可撤回的上一轮');
            return;
        }

        const restoredText = worldbookMessages[lastUserIndex].content || '';
        worldbookMessages.splice(lastUserIndex);

        if (worldbookMessages.every(msg => msg.role === 'system')) {
            worldbookMessages = [];
        }

        renderWorldbookHistory();

        const input = document.getElementById('fmg-wb-input');
        if (input) {
            input.value = restoredText;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        }

        showStatus('fmg-wb-status', 'success', '已撤回上一轮，并恢复到输入框');
    }

    function clearWorldbookDiscussion() {
        if (isWorldbookGenerating) stopWorldbookGeneration();

        worldbookMessages = [];
        worldbookAutoScroll = true;
        renderWorldbookHistory();

        const statusEl = document.getElementById('fmg-wb-status');
        if (statusEl) statusEl.style.display = 'none';
    }

    async function callWorldbookStreamMessages(messages, onChunk, onDone, onError) {
        worldbookAbortController = new AbortController();

        try {
            if (settings.apiType === 'openai') {
                await callOpenAIStreamMessages(messages, onChunk, onDone, worldbookAbortController.signal);
            } else {
                await callGeminiStreamMessages(messages, onChunk, onDone, worldbookAbortController.signal);
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('[开场白生成器] 世界书请求已中断');
                return;
            }
            onError(error);
        } finally {
            worldbookAbortController = null;
        }
    }

    async function sendWorldbookMessage() {
        if (isWorldbookGenerating) return;

        const input = document.getElementById('fmg-wb-input');
        const userText = input.value.trim();
        if (!userText) return;

        if (!settings.apiUrl || !settings.apiKey) {
            showStatus('fmg-wb-status', 'error', '请先在API页面配置API');
            return;
        }

        if (!window._fmgCharData) {
            showStatus('fmg-wb-status', 'error', '请先选择角色并刷新数据');
            return;
        }

        input.value = '';
        appendWorldbookMessage('user', userText);

        syncWorldbookSystemPrompt();

        worldbookMessages.push({ role: 'user', content: userText });
        requestWorldbookTokenCountUpdate();

        isWorldbookGenerating = true;
        const sendBtn = document.getElementById('fmg-wb-send');
        if (sendBtn) {
            sendBtn.textContent = '⏹ 停止';
            sendBtn.classList.remove('fmg-btn-primary');
            sendBtn.classList.add('fmg-btn-danger');
            sendBtn.onclick = () => stopWorldbookGeneration();
        }
        updateWorldbookUndoButton();

        try {
            await callWorldbookStreamMessages(
                [...worldbookMessages],
                (content) => {
                    appendWorldbookMessage('assistant', content, true);
                },
                (finalContent) => {
                    appendWorldbookMessage('assistant', finalContent, false);
                    worldbookMessages.push({ role: 'assistant', content: finalContent });
                    requestWorldbookTokenCountUpdate();
                    finishWorldbookGeneration();
                },
                (error) => {
                    appendWorldbookMessage('assistant', '❌ 错误: ' + error.message, false);
                    finishWorldbookGeneration();
                    showStatus('fmg-wb-status', 'error', '生成失败: ' + error.message);
                }
            );
        } catch (error) {
            appendWorldbookMessage('assistant', '❌ 错误: ' + error.message, false);
            finishWorldbookGeneration();
        }
    }

    function stopWorldbookGeneration() {
        if (worldbookAbortController) {
            worldbookAbortController.abort();
            worldbookAbortController = null;
        }

        const streaming = document.querySelector('#fmg-wb-chat-messages .fmg-chat-bubble.streaming');
        if (streaming) {
            streaming.classList.remove('streaming');
            const cursor = streaming.querySelector('.fmg-cursor');
            if (cursor) cursor.remove();

            const textEl = streaming.querySelector('.fmg-chat-text');
            if (textEl && textEl.textContent.trim()) {
                const partialContent = textEl.textContent;
                textEl.innerHTML = renderWorldbookAssistantContent(partialContent);
                worldbookMessages.push({ role: 'assistant', content: partialContent });
                requestWorldbookTokenCountUpdate();
            }
        }

        finishWorldbookGeneration();
    }

    function finishWorldbookGeneration() {
        isWorldbookGenerating = false;
        const sendBtn = document.getElementById('fmg-wb-send');
        if (sendBtn) {
            sendBtn.textContent = '发送';
            sendBtn.classList.remove('fmg-btn-danger');
            sendBtn.classList.add('fmg-btn-primary');
            sendBtn.onclick = null;
        }
        updateWorldbookUndoButton();
    }

    function createWorldbookEntryShell(existingEntries) {
        const numericIds = existingEntries.map(entry => Number(entry.uid)).filter(Number.isFinite);
        const newUid = numericIds.length > 0 ? Math.max(...numericIds) + 1 : 0;
        const lastEntry = existingEntries.length > 0 ? structuredClone(existingEntries[existingEntries.length - 1]) : null;

        if (lastEntry) {
            lastEntry.uid = newUid;
            return lastEntry;
        }

        return {
            uid: newUid,
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

    async function persistWorldbookEntry(entryData) {
        const context = SillyTavern.getContext();
        if (context.characterId === undefined) throw new Error('未选择角色');

        const char = context.characters[context.characterId];
        const worldName = char?.data?.extensions?.world;
        if (!worldName) throw new Error('角色未关联外部世界书，请先在角色卡中关联世界书');
        if (!entryData.constant && (!entryData.keys || entryData.keys.length === 0)) {
            throw new Error('非常驻条目至少需要一个主关键词');
        }
        if (typeof context.loadWorldInfo !== 'function' || typeof context.saveWorldInfo !== 'function') {
            throw new Error('当前 ST 上下文缺少世界书保存接口');
        }

        const loadedData = await context.loadWorldInfo(worldName);
        const worldEntries = loadedData?.entries ? Object.values(loadedData.entries) : [];
        const requestedUid = Number.isFinite(Number(entryData.uid)) ? Number(entryData.uid) : null;
        let targetEntry = requestedUid !== null
            ? worldEntries.find(entry => Number(entry.uid) === requestedUid)
            : null;
        const isUpdate = !!targetEntry;

        if (!targetEntry) {
            targetEntry = createWorldbookEntryShell(worldEntries);
            worldEntries.push(targetEntry);
        }

        const resolvedPosition = entryData.position ?? targetEntry.position ?? WORLDBOOK_POSITIONS.before;

        Object.assign(targetEntry, {
            key: entryData.keys || [],
            keysecondary: entryData.secondary_keys || [],
            comment: entryData.comment || '',
            content: entryData.content || '',
            constant: entryData.constant === true,
            vectorized: entryData.vectorized === true,
            selective: entryData.constant === true ? false : entryData.selective !== false,
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
            disable: entryData.enabled === false,
            addMemo: !!entryData.comment
        });

        if (targetEntry.position === WORLDBOOK_POSITIONS.outlet && !targetEntry.outletName) {
            throw new Error('position 为 outlet 时必须提供 outlet_name');
        }

        const finalFormat = { entries: Object.fromEntries(worldEntries.map(entry => [entry.uid, entry])) };
        await context.saveWorldInfo(worldName, finalFormat);
        if (typeof context.reloadWorldInfoEditor === 'function') {
            context.reloadWorldInfoEditor(worldName, true);
        }

        const savedSelections = settings.selectedWorldEntries || [];
        const persistedIdentifier = getWorldInfoIdentifier(targetEntry, worldEntries.indexOf(targetEntry));
        const legacyIdentifiers = getLegacyWorldInfoIdentifiers(targetEntry, worldEntries.indexOf(targetEntry));
        const mergedSelections = [...new Set([...savedSelections, persistedIdentifier, ...legacyIdentifiers])];
        if (mergedSelections.length !== savedSelections.length) {
            settings.selectedWorldEntries = mergedSelections;
            saveSettings();
        }

        return {
            context,
            targetEntry,
            worldName,
            isUpdate
        };
    }

    async function applyWorldbookEntriesBatch(entries) {
        const results = [];
        let latestContext = null;

        for (const entry of entries) {
            try {
                const result = await persistWorldbookEntry(entry);
                latestContext = result.context;
                results.push(result);
            } catch (error) {
                results.push({
                    entry,
                    error,
                    isFailed: true
                });
            }
        }

        if (latestContext) {
            await loadWorldInfoList(latestContext, true);
        }
        requestWorldbookTokenCountUpdate();
        return results;
    }

    async function applyWorldbookEntry(entryData, buttonEl) {
        try {
            const result = await persistWorldbookEntry(entryData);

            if (buttonEl) {
                const card = buttonEl.closest('.fmg-worldbook-card');
                if (card) {
                    card.classList.add('applied');
                    const actionsEl = card.querySelector('.fmg-edit-card-actions');
                    if (actionsEl) actionsEl.innerHTML = `<span class="fmg-edit-applied-badge">✅ 已${result.isUpdate ? '更新' : '添加'}到世界书</span>`;
                }
            }

            showStatus('fmg-wb-status', 'success', `已${result.isUpdate ? '更新' : '添加'}世界书：${entryData.comment || '未命名条目'}`);
            if (typeof toastr !== 'undefined') toastr.success(`世界书条目已${result.isUpdate ? '更新' : '添加'}`);
            await loadWorldInfoList(result.context, true);
            requestWorldbookTokenCountUpdate();

        } catch (error) {
            console.error('[开场白生成器] 添加世界书条目失败:', error);
            showStatus('fmg-wb-status', 'error', '添加失败: ' + error.message);
            if (typeof toastr !== 'undefined') toastr.error('添加世界书条目失败: ' + error.message);
            if (buttonEl) {
                buttonEl.textContent = '⚠️ 重试';
                buttonEl.disabled = false;
            }
        }
    }

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
  "worldbook_content": "世界书条目的完整内容。除了状态栏模板外，必须在前面包含一段指导大模型输出状态栏的文字指令（例如：请在每次回复的最末尾，根据当前情境输出以下格式的状态栏：）",
  "regex_name": "状态栏",
  "regex_find": "用于匹配状态栏 XML 标签的正则表达式",
  "regex_replace": "用 HTML/CSS 美化的替换代码，将 XML 标签转换为漂亮的状态栏 UI",
  "regex_trim": "需要修剪掉的标签（每行一个）"
}

重要规则:
1. worldbook_content 必须包含指导说明和模板。指导说明必须明确要求在回复末尾输出状态栏；模板必须且只能包含一个 <status_block>...</status_block> 包裹，内部使用 <status>...</status> 定义各个字段
2. 状态栏字段用 XML 标签如 <title>, <date>, <time>, <location>, <mood> 等
3. regex_find 必须能匹配整个 status 块的内容，使用捕获组提取各字段，且必须满足以下严格技术约束：
   - 不要使用 (?s) 或结尾的 /s 标志
   - 若需匹配包含换行符在内的任意字符，请统一使用 [\\s\\S]*? 代替 .*?
   - 必须对所有的正斜杠（/）进行反斜杠转义（即写成 \\/）
   - 请使用非贪婪模式，防止匹配越界
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
            if (typeof context.loadWorldInfo !== 'function' || typeof context.saveWorldInfo !== 'function') {
                throw new Error('当前 ST 上下文缺少世界书保存接口');
            }

            const loadedData = await context.loadWorldInfo(worldName);
            const worldEntries = loadedData?.entries ? Object.values(loadedData.entries) : [];
            const newEntry = createWorldbookEntryShell(worldEntries);

            Object.assign(newEntry, {
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
                addMemo: true
            });

            worldEntries.push(newEntry);
            const finalFormat = { entries: Object.fromEntries(worldEntries.map(entry => [entry.uid, entry])) };
            await context.saveWorldInfo(worldName, finalFormat);
            if (typeof context.reloadWorldInfoEditor === 'function') {
                context.reloadWorldInfoEditor(worldName, true);
            }

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

    async function sendDiscussMessage() {
        if (isDiscussGenerating) return;

        const input = document.getElementById('fmg-discuss-input');
        const userText = input.value.trim();
        if (!userText) return;

        if (!settings.apiUrl || !settings.apiKey) {
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
            sendBtn.onclick = () => stopDiscussGeneration();
        }
        updateDiscussUndoButton();

        try {
            await callAPIStreamMessages(
                [...discussMessages],
                (content) => {
                    appendChatMessage('assistant', content, true);
                },
                (finalContent) => {
                    const assistantMessage = createChatMessage('assistant', finalContent);
                    discussMessages.push(assistantMessage);
                    appendChatMessage('assistant', finalContent, false, assistantMessage.id);
                    requestDiscussTokenCountUpdate();
                    finishDiscussGeneration();
                },
                (error) => {
                    appendChatMessage('assistant', '❌ 错误: ' + error.message, false);
                    finishDiscussGeneration();
                    showStatus('fmg-discuss-status', 'error', '生成失败: ' + error.message);
                }
            );
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
            sendBtn.onclick = null; // 恢复由事件委托处理
        }
        updateDiscussUndoButton();
        updateDiscussWorldbookSelectionUI();
    }

    function clearDiscussion() {
        // 停止进行中的生成
        if (isDiscussGenerating) stopDiscussGeneration();

        discussMessages = [];
        discussAutoScroll = true;
        selectedDiscussWorldbookMessageIds.clear();
        discussWorldbookSelectionMode = false;
        renderDiscussionHistory();
        requestDiscussTokenCountUpdate();

        const statusEl = document.getElementById('fmg-discuss-status');
        if (statusEl) statusEl.style.display = 'none';
    }

    // ========================================
    // 多轮对话流式 API 调用
    // ========================================

    async function callAPIStreamMessages(messages, onChunk, onDone, onError) {
        discussAbortController = new AbortController();

        try {
            if (settings.apiType === 'openai') {
                await callOpenAIStreamMessages(messages, onChunk, onDone, discussAbortController.signal);
            } else {
                await callGeminiStreamMessages(messages, onChunk, onDone, discussAbortController.signal);
            }
        } catch (e) {
            if (e.name === 'AbortError') {
                console.log('[开场白生成器] 讨论请求已中断');
                return;
            }
            onError(e);
        } finally {
            discussAbortController = null;
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
                    // 保存到历史记录
                    saveToHistory(userPrompt, finalContent, char.name);
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
    // 历史记录功能
    // ========================================

    function saveToHistory(prompt, content, charName) {
        if (!settings.firstMessageHistory) {
            settings.firstMessageHistory = [];
        }

        const record = {
            id: Date.now(),
            prompt: prompt,
            content: content,
            charName: charName || '未知角色',
            timestamp: new Date().toLocaleString('zh-CN')
        };

        // 插入到最前面
        settings.firstMessageHistory.unshift(record);

        // 最多保留5条
        if (settings.firstMessageHistory.length > 5) {
            settings.firstMessageHistory = settings.firstMessageHistory.slice(0, 5);
        }

        saveSettings();
        renderHistoryList();
    }

    function renderHistoryList() {
        const section = document.getElementById('fmg-history-section');
        const listEl = document.getElementById('fmg-history-list');
        const countEl = document.getElementById('fmg-history-count');
        const allHistory = settings.firstMessageHistory || [];

        if (!section || !listEl) return;

        // 获取当前角色名，按角色过滤
        const currentCharName = window._fmgCharData ? window._fmgCharData.name : null;
        const history = currentCharName
            ? allHistory.filter(r => r.charName === currentCharName)
            : [];

        if (history.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = '';
        if (countEl) countEl.textContent = `${history.length}/5`;

        listEl.innerHTML = history.map((record) => {
            // 找到该记录在完整列表中的真实 index
            const realIndex = allHistory.indexOf(record);
            const promptPreview = (record.prompt || '').substring(0, 40) + (record.prompt && record.prompt.length > 40 ? '...' : '');
            const contentPreview = (record.content || '').substring(0, 60) + (record.content && record.content.length > 60 ? '...' : '');
            return `
                <div class="fmg-history-card" data-history-index="${realIndex}">
                    <div class="fmg-history-card-header">
                        <span class="fmg-history-char">${escapeHtml(record.charName || '')}</span>
                        <span class="fmg-history-time">${escapeHtml(record.timestamp || '')}</span>
                    </div>
                    <div class="fmg-history-card-body">
                        <div class="fmg-history-prompt-preview">📝 ${escapeHtml(promptPreview)}</div>
                        <div class="fmg-history-content-preview">${escapeHtml(contentPreview)}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function showHistoryDetail(index) {
        const history = settings.firstMessageHistory || [];
        if (index < 0 || index >= history.length) return;

        const record = history[index];

        // 移除已存在的弹窗
        const existing = document.getElementById('fmg-history-detail-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'fmg-history-detail-modal';
        modal.innerHTML = `
            <div class="fmg-preview-overlay"></div>
            <div class="fmg-preview-content fmg-history-detail-content">
                <div class="fmg-preview-header">
                    <h4>📜 历史记录详情</h4>
                    <button class="fmg-close-btn" id="fmg-history-detail-close">×</button>
                </div>
                <div class="fmg-preview-body">
                    <div class="fmg-history-detail-meta">
                        <span class="fmg-history-detail-char">🎭 ${escapeHtml(record.charName || '未知角色')}</span>
                        <span class="fmg-history-detail-time">🕐 ${escapeHtml(record.timestamp || '')}</span>
                    </div>
                    <div class="fmg-history-detail-section">
                        <div class="fmg-history-detail-label">📝 开场白需求</div>
                        <div class="fmg-history-detail-text fmg-history-prompt-text">${escapeHtml(record.prompt || '')}</div>
                    </div>
                    <div class="fmg-history-detail-section">
                        <div class="fmg-history-detail-label">✨ 生成的开场白</div>
                        <div class="fmg-history-detail-text fmg-history-content-text">${escapeHtml(record.content || '')}</div>
                    </div>
                </div>
                <div class="fmg-preview-footer">
                    <button class="fmg-btn fmg-btn-danger-small fmg-btn" id="fmg-history-delete" data-index="${index}">🗑️ 删除</button>
                    <button class="fmg-btn fmg-btn-primary" id="fmg-history-apply" data-index="${index}">✅ 应用到新的开场白</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // 绑定事件
        document.getElementById('fmg-history-detail-close').onclick = () => modal.remove();
        modal.querySelector('.fmg-preview-overlay').onclick = () => modal.remove();

        document.getElementById('fmg-history-apply').onclick = () => {
            applyHistoryToFirstMessage(index);
            modal.remove();
        };

        document.getElementById('fmg-history-delete').onclick = () => {
            deleteHistoryRecord(index);
            modal.remove();
        };
    }

    async function applyHistoryToFirstMessage(index) {
        const history = settings.firstMessageHistory || [];
        if (index < 0 || index >= history.length) return;

        const record = history[index];
        const content = record.content;
        if (!content) return;

        try {
            const context = SillyTavern.getContext();

            if (!context.chat || context.chat.length === 0) {
                showStatus('fmg-status', 'error', '当前没有聊天记录');
                return;
            }

            // 更新第0楼消息
            context.chat[0].mes = content;

            // 更新DOM显示
            const firstMessage = document.querySelector('#chat .mes:first-child .mes_text');
            if (firstMessage) {
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

            showStatus('fmg-status', 'success', '历史开场白已应用到第0楼！');
            closePopup();

            if (typeof toastr !== 'undefined') {
                toastr.success('历史开场白已应用到第0楼');
            }

        } catch (e) {
            console.error('[开场白生成器] 应用历史记录失败:', e);
            showStatus('fmg-status', 'error', '应用失败: ' + e.message);
        }
    }

    function deleteHistoryRecord(index) {
        const history = settings.firstMessageHistory || [];
        if (index < 0 || index >= history.length) return;

        history.splice(index, 1);
        settings.firstMessageHistory = history;
        saveSettings();
        renderHistoryList();

        if (typeof toastr !== 'undefined') {
            toastr.info('历史记录已删除');
        }
    }

    function clearAllHistory() {
        const currentCharName = window._fmgCharData ? window._fmgCharData.name : null;
        if (!currentCharName) return;

        // 只清除当前角色的记录
        settings.firstMessageHistory = (settings.firstMessageHistory || []).filter(
            r => r.charName !== currentCharName
        );
        saveSettings();
        renderHistoryList();

        if (typeof toastr !== 'undefined') {
            toastr.info(`已清除 ${currentCharName} 的历史记录`);
        }
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
