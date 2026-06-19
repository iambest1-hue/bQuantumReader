/**
 * Install Wizard - shared logic for popup/options pages.
 *
 * Provides:
 *  - getExtensionId(): returns chrome.runtime.id
 *  - getInstallDir(): returns whisper_server directory path
 *  - checkInstallState(): queries native host for install_state.json
 *  - checkNativeHostInstalled(): tests if native host is registered
 *  - getInstallCommand(): returns the command to run
 *  - renderInstallStatus(container, state): renders status check results
 */

/**
 * Get the current extension ID.
 */
export function getExtensionId() {
  return chrome.runtime.id;
}

/**
 * Get the absolute path to whisper_server directory.
 * (Best-effort: from background page URL)
 */
export function getInstallDir() {
  // The extension's root URL is chrome-extension://<id>/
  // We can't get the filesystem path from JS in MV3 directly,
  // but we can show the extension directory hint.
  const url = chrome.runtime.getURL('whisper_server/');
  return url; // chrome-extension://id/whisper_server/
}

/**
 * Check if native host is installed by attempting to connect.
 * @returns {Promise<{installed:boolean, error?:string}>}
 */
export function checkNativeHostInstalled() {
  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative('com.bquantum.whisper');
      port.onDisconnect.addListener(() => {
        // If chrome.runtime.lastError exists, native host is not installed
        resolve({ installed: !chrome.runtime.lastError, error: chrome.runtime.lastError?.message });
      });
      // If we can postMessage, it's installed (even if it disconnects later)
      try {
        port.postMessage({ command: 'status' });
        resolve({ installed: true });
      } catch {
        resolve({ installed: false });
      }
    } catch (err) {
      resolve({ installed: false, error: err.message });
    }
  });
}

/**
 * Query native host for install state.
 * @param {function} sendMessageFn - e.g. (msg) => chrome.runtime.sendMessage(msg)
 * @returns {Promise<object|null>} install_state.json content or null
 */
export async function checkInstallState() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'NATIVE_COMMAND', command: 'install_check' });
    if (resp?.status === 'ok' && resp.install_state) {
      return resp.install_state;
    }
  } catch {}
  return null;
}

/**
 * Render install status into a container element.
 * @param {HTMLElement} container
 * @param {object|null} state - install_state.json content
 */
export function renderInstallStatus(container, state) {
  container.innerHTML = '';

  if (!state) {
    container.innerHTML = `<p style="color:#999;text-align:center;padding:16px;">
      未检测到安装状态，请先运行安装脚本。
    </p>`;
    return;
  }

  const { errors, native_host_registered, ffmpeg_path, model_path, venv_python } = state;
  const hasErrors = errors && errors.length > 0;

  const steps = [
    { label: 'Python 虚拟环境', ok: !!venv_python },
    { label: 'Python 依赖包', ok: !hasErrors || !errors.includes('import_check_failed') },
    { label: '语音模型 (small)', ok: !hasErrors || !errors.includes('model_download_failed') },
    { label: 'ffmpeg', ok: !!ffmpeg_path },
    { label: 'Native Host 注册', ok: !!native_host_registered },
  ];

  const html = steps.map(s => `
    <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
      <span style="color:${s.ok ? '#00a86b' : '#ff4d4f'}">${s.ok ? '✅' : '❌'}</span>
      <span style="font-size:13px;">${s.label}</span>
    </div>
  `).join('');

  if (hasErrors) {
    container.innerHTML = html + `
      <div style="margin-top:8px;padding:8px;background:#fff1f0;border-radius:4px;font-size:12px;color:#cf1322;">
        ⚠ 告警/错误：${errors.join(', ')}
      </div>`;
  } else {
    container.innerHTML = html + `
      <div style="margin-top:8px;padding:8px;background:#f6ffed;border-radius:4px;font-size:12px;color:#389e0d;">
        ✅ 安装状态正常
      </div>`;
  }
}
