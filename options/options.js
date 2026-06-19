// Options page script

const $ = id => document.getElementById(id);

const AI_BASES = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  custom: ''
};

const AI_MODELS = {
  openai: 'gpt-4o-mini',
  deepseek: 'deepseek-chat',
  custom: ''
};

document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  chrome.storage.sync.get(['aiProvider', 'apiKey', 'apiBase', 'aiModel', 'whisperServerUrl'], (settings) => {
    $('aiProvider').value = settings.aiProvider || '';
    $('apiKey').value = settings.apiKey || '';
    $('apiBase').value = settings.apiBase || '';
    $('aiModel').value = settings.aiModel || '';
    $('whisperServerUrl').value = settings.whisperServerUrl || 'http://localhost:8787';
    toggleFields();
  });

  $('aiProvider').addEventListener('change', toggleFields);

  $('saveBtn').addEventListener('click', () => {
    const settings = {
      aiProvider: $('aiProvider').value,
      apiKey: $('apiKey').value,
      apiBase: $('apiBase').value,
      aiModel: $('aiModel').value,
      whisperServerUrl: $('whisperServerUrl').value || 'http://localhost:8787'
    };
    chrome.storage.sync.set(settings, () => {
      $('savedHint').classList.add('show');
      setTimeout(() => $('savedHint').classList.remove('show'), 2000);
    });
  });

  $('testWhisperBtn').addEventListener('click', async () => {
    const url = $('whisperServerUrl').value || 'http://127.0.0.1:8787';
    const resultEl = $('whisperTestResult');
    resultEl.textContent = '连接中...';
    resultEl.style.color = '#666';

    try {
      const resp = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) });
      const data = await resp.json();
      const phase = data.phase || (data.ready ? 'ready' : 'not_ready');
      if (phase === 'ready') {
        resultEl.textContent = `已连接 (模型: ${data.model || 'unknown'})`;
        resultEl.style.color = '#00a86b';
      } else if (phase === 'downloading_model' || phase === 'loading_model') {
        resultEl.textContent = `模型 ${phase === 'downloading_model' ? '下载' : '加载'}中... ${data.progress || 0}%`;
        resultEl.style.color = '#faad14';
      } else if (phase === 'failed') {
        resultEl.textContent = `错误: ${data.error_message || '未知错误'}`;
        resultEl.style.color = '#ff4d4f';
      } else {
        resultEl.textContent = '服务已启动，模型加载中...';
        resultEl.style.color = '#faad14';
      }
    } catch {
      resultEl.textContent = '无法连接，请确认 Whisper 服务已启动';
      resultEl.style.color = '#ff4d4f';
    }
  });

  $('whisperRepairBtn').addEventListener('click', () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup/install_wizard.html'),
      type: 'popup',
      width: 540,
      height: 600,
    });
  });
});

function toggleFields() {
  const provider = $('aiProvider').value;
  const show = provider !== '';
  $('apiKeyField').hidden = !show;
  $('apiBaseField').hidden = !show;
  $('aiModelField').hidden = !show;

  if (show && !$('apiBase').value) {
    $('apiBase').value = AI_BASES[provider] || '';
  }
  if (show && !$('aiModel').value) {
    $('aiModel').value = AI_MODELS[provider] || '';
  }
}
