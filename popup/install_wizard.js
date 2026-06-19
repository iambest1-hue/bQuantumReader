/**
 * Install Wizard page script (popup/install_wizard.html)
 */
document.addEventListener('DOMContentLoaded', async () => {
  const $ = id => document.getElementById(id);

  // ── Extension ID ──
  const extId = chrome.runtime.id;
  $('extensionId').value = extId;

  // ── Install directory ──
  $('installDir').value = `扩展目录/whisper_server/`;
  $('installDir').title = chrome.runtime.getURL('whisper_server/');

  // ── Install command ──
  const installCmd = `install.bat -ExtensionId ${extId}`;
  $('commandBox').textContent = installCmd;

  // ── Copy command ──
  $('copyCmdBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(installCmd);
      $('copyHint').classList.add('show');
      setTimeout(() => $('copyHint').classList.remove('show'), 2000);
    } catch {
      // Fallback: select the text
      const range = document.createRange();
      range.selectNodeContents($('commandBox'));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  });

  // ── Check status ──
  $('checkStatusBtn').addEventListener('click', async () => {
    const container = $('statusContainer');
    container.innerHTML = '<div class="loading-text">⏳ 正在检查...</div>';

    try {
      // Try via native host
      const state = await queryInstallState();
      renderStatus(container, state);
    } catch (err) {
      container.innerHTML = `<div class="error">检查失败: ${err.message}</div>`;
    }
  });

  // Auto-check on load
  $('checkStatusBtn').click();
});

async function queryInstallState() {
  // Try native host first
  const resp = await chrome.runtime.sendMessage({ type: 'NATIVE_COMMAND', command: 'install_check' }).catch(() => null);

  if (resp?.status === 'ok' && resp.install_state) {
    return resp.install_state;
  }

  // Fallback: check if native host is registered
  const nativeCheck = await checkNativeHost();
  return {
    native_host_registered: nativeCheck,
    errors: nativeCheck ? [] : ['native_host_not_found'],
    venv_python: null,
    ffmpeg_path: null,
    model_path: null,
    extension_id: chrome.runtime.id,
  };
}

function checkNativeHost() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative('com.bquantum.whisper');
      const timer = setTimeout(() => {
        port.disconnect();
        resolve(false);
      }, 1000);
      port.onMessage.addListener(() => {
        clearTimeout(timer);
        resolve(true);
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(timer);
        resolve(false);
      });
      port.postMessage({ command: 'status' });
    } catch {
      resolve(false);
    }
  });
}

function renderStatus(container, state) {
  if (!state) {
    container.innerHTML = `<p style="color:#999;text-align:center;padding:16px;">
      未检测到安装状态。请先运行安装脚本。
    </p>`;
    return;
  }

  const { errors, native_host_registered, ffmpeg_path, model_path, venv_python, installed_at } = state;
  const hasErrors = errors && errors.length > 0;

  const steps = [
    { label: 'Python 虚拟环境 (.venv)', ok: !!venv_python },
    { label: 'Python 依赖包已安装', ok: !hasErrors },
    { label: '语音模型 (small) 已预下载', ok: !!model_path },
    { label: 'ffmpeg 可用', ok: !!ffmpeg_path },
    { label: 'Native Host 已注册到 Chrome', ok: !!native_host_registered },
  ];

  let html = steps.map(s => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <span style="color:${s.ok ? '#00a86b' : '#ff4d4f'}">${s.ok ? '✅' : '❌'}</span>
      <span style="font-size:13px;">${s.label}</span>
    </div>
  `).join('');

  if (installed_at) {
    html += `<div style="margin-top:8px;font-size:11px;color:#999;">安装时间: ${new Date(installed_at).toLocaleString()}</div>`;
  }

  if (hasErrors) {
    html += `<div style="margin-top:8px;padding:8px;background:#fff1f0;border-radius:4px;font-size:12px;color:#cf1322;">⚠ 告警/错误: ${errors.join(', ')}</div>`;
    html += `<div style="margin-top:8px;font-size:12px;color:#666;">
      <p>💡 请打开 whisper_server 目录，运行以下命令修复：</p>
      <code style="display:block;background:#1e1e1e;color:#d4d4d4;padding:6px;margin:4px 0;border-radius:4px;font-size:12px;">install.bat -ExtensionId ${chrome.runtime.id} -Repair</code>
    </div>`;
  } else if (native_host_registered) {
    html += `<div style="margin-top:8px;padding:8px;background:#f6ffed;border-radius:4px;font-size:13px;color:#389e0d;">
      ✅ 安装完成！请重启 Chrome，然后点击扩展的「🚀 一键启动」按钮。
    </div>`;
  } else {
    html += `<div style="margin-top:8px;padding:8px;background:#fffbe6;border-radius:4px;font-size:12px;color:#ad6800;">
      ⚠ Native Host 未注册。请运行安装命令并确保 -ExtensionId 参数正确。
    </div>`;
  }

  container.innerHTML = html;
}
