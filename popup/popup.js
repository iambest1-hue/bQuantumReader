import { generateMarkdown, sanitizeFilename } from '../shared/markdown.js';

const $ = id => document.getElementById(id);

let currentResult = null;
let whisperServerUrl = '';
let currentBvid = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Window mode: 从 storage.session 获取创建窗口时存储的标签 ID
  const { activeTabId } = await chrome.storage.session.get('activeTabId');
  if (!activeTabId) {
    $('notBilibili').hidden = false;
    $('mainPanel').hidden = true;
    $('notBilibili').textContent = '无法获取视频页面信息，请从B站视频页重新打开扩展';
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.get(activeTabId);
  } catch (e) {
    $('notBilibili').hidden = false;
    $('mainPanel').hidden = true;
    $('notBilibili').textContent = '视频页面已关闭，请刷新后重试';
    return;
  }

  if (!tab.url || !tab.url.includes('bilibili.com/video/')) {
    $('notBilibili').hidden = false;
    $('mainPanel').hidden = true;
    return;
  }

  $('notBilibili').hidden = true;
  $('mainPanel').hidden = false;

  // Extract bvid from URL immediately (not async, available right away)
  currentBvid = tab.url.match(/\/video\/(BV\w+)/)?.[1] || null;

  // Get video info from content script (async, for display)
  chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      $('videoTitle').textContent = '无法获取视频信息';
      return;
    }
    $('videoTitle').textContent = response.title || '未知标题';
    $('videoUp').textContent = response.upName ? `UP: ${response.upName}` : '';
    $('videoDuration').textContent = response.duration || '';
  });

  // Check Whisper server status
  loadWhisperStatus();

  // Buttons
  $('extractBtn').addEventListener('click', () => handleExtract(tab));
  $('asrBtn').addEventListener('click', () => handleASR(tab));
  $('downloadBtn').addEventListener('click', handleDownload);
  $('cancelBtn').addEventListener('click', handleCancel);
  $('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
  $('helpBtn').addEventListener('click', () => {
    chrome.windows.create({
      url: 'help/help.html',
      type: 'popup',
      width: 720,
      height: 640,
    });
  });
  $('startServiceBtn').addEventListener('click', handleStartService);

  // Restore any existing ASR task state (if same video)
  restoreAsrState();
});

function loadWhisperStatus() {
  chrome.storage.sync.get(['whisperServerUrl'], async (settings) => {
    whisperServerUrl = settings.whisperServerUrl || 'http://localhost:8787';

    const statusEl = $('whisperStatus');
    const dotEl = statusEl.querySelector('.whisper-dot');
    const textEl = $('whisperStatusText');

    statusEl.hidden = false;

    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'CHECK_WHISPER', serverUrl: whisperServerUrl },
        (r) => resolve(r || { available: false })
      );
    });

    if (resp.available) {
      dotEl.className = 'whisper-dot online';
      textEl.textContent = `Whisper: 已连接 (${resp.model || 'unknown'})`;

      const modelInfo = $('whisperModelInfo');
      modelInfo.hidden = false;
      const parts = [];
      if (resp.model) parts.push(`模型: ${resp.model}`);
      if (resp.device) parts.push(`设备: ${resp.device}`);
      if (resp.compute_type) parts.push(`精度: ${resp.compute_type}`);
      modelInfo.textContent = parts.join(' | ');

      $('asrBtn').hidden = false;
      $('startServiceBtn').hidden = true;
    } else {
      dotEl.className = 'whisper-dot offline';
      textEl.textContent = 'Whisper: 未连接';
      $('whisperModelInfo').hidden = true;
      $('asrBtn').hidden = false;
      $('asrBtn').disabled = true;
      $('startServiceBtn').hidden = false;
    }
  });
}

async function handleExtract(tab) {
  const extractStartTime = Date.now();
  const extractBtn = $('extractBtn');
  const asrBtn = $('asrBtn');
  const progress = $('progress');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const resultPanel = $('resultPanel');
  const errorMsg = $('errorMsg');

  extractBtn.disabled = true;
  if (asrBtn) asrBtn.disabled = true;
  errorMsg.hidden = true;
  resultPanel.hidden = true;
  progress.hidden = false;
  progressFill.classList.add('indeterminate');
  progressText.textContent = `正在提取「${$('videoTitle').textContent}」的视频内容...`;
  $('stayOnTabWarning').hidden = false;

  try {
    const videoInfo = await getVideoInfoFromPage(tab);
    if (!videoInfo.bvid) throw new Error('无法获取视频BV号');

    progressText.textContent = `正在获取「${$('videoTitle').textContent}」的字幕...`;

    const result = await sendMessage({
      type: 'EXTRACT_SUBTITLE',
      bvid: videoInfo.bvid,
      cid: videoInfo.cid
    });

    currentResult = result;

    if (!result.hasSubtitle) {
      progress.hidden = true;
      showError(result.message);
      if (asrBtn) asrBtn.disabled = false;
      extractBtn.disabled = false;
      return;
    }

    progressText.textContent = '正在生成 Markdown...';

    const markdown = generateMarkdown({
      title: result.videoInfo.title,
      url: result.videoInfo.url,
      upName: result.videoInfo.upName,
      duration: result.videoInfo.duration,
      pubdate: result.videoInfo.pubdate,
      subtitles: result.subtitles,
      comments: result.comments
    });

    currentResult.markdown = markdown;

    progress.hidden = true;
    resultPanel.hidden = false;

    const charCount = result.subtitles.reduce((sum, s) => sum + s.content.length, 0);
    const source = result.asrDuration ? '语音识别' : 'CC字幕';
    const elapsed = ((Date.now() - extractStartTime) / 1000).toFixed(1);
    $('resultStats').textContent = `共 ${result.subtitles.length} 条 (${source})，约 ${charCount} 字 | 用时 ${elapsed}s`;

    const previewText = markdown.length > 3000 ? markdown.slice(0, 3000) + '\n\n... (预览截断，下载查看完整内容)' : markdown;
    $('preview').textContent = previewText;
    sendCompletionNotification(result.videoInfo.title, '字幕提取');

  } catch (err) {
    progress.hidden = true;
    showError(err.message);
  } finally {
    extractBtn.disabled = false;
    if (asrBtn) asrBtn.disabled = false;
    $('stayOnTabWarning').hidden = true;
  }
}

async function handleASR(tab) {
  const extractBtn = $('extractBtn');
  const asrBtn = $('asrBtn');
  const progress = $('progress');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const resultPanel = $('resultPanel');
  const errorMsg = $('errorMsg');

  extractBtn.disabled = true;
  asrBtn.disabled = true;
  errorMsg.hidden = true;
  resultPanel.hidden = true;
  progress.hidden = false;
  progressFill.classList.remove('indeterminate');
  progressFill.style.width = '0%';
  progressText.textContent = `正在获取「${$('videoTitle').textContent}」的音频流...`;
  $('stayOnTabWarning').hidden = false;

  try {
    const videoInfo = await getVideoInfoFromPage(tab);
    if (!videoInfo.bvid) throw new Error('无法获取视频BV号');
    currentBvid = videoInfo.bvid;

    // Step 1: Get audio URL + comments from background (fast)
    const { audioUrl, videoInfo: info, comments } = await sendMessage({
      type: 'GET_AUDIO_INFO',
      bvid: videoInfo.bvid,
      cid: videoInfo.cid
    });

    currentResult = { videoInfo: info, comments: comments || [] };

    // Step 2: Directly call Whisper server from popup (simpler, for testing)
    progressFill.style.width = '10%';
    progressText.textContent = `正在转录「${info.title}」0s...`;
    $('cancelBtn').hidden = false;

    const controller = new AbortController();
    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      progressText.textContent = `正在转录「${info.title}」${elapsed}秒...`;
      progressFill.style.width = `${Math.min(10 + (elapsed % 40), 60)}%`;
    }, 1000);

    let data;
    try {
      const resp = await fetch(`${whisperServerUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ audio_url: audioUrl, language: 'zh' })
      });
      data = await resp.json();
      if (!resp.ok) throw new Error(data.error || `转录失败 (${resp.status})`);
    } finally {
      clearInterval(timer);
    }

    progressText.textContent = '正在生成 Markdown...';
    progressFill.style.width = '80%';

    const markdown = generateMarkdown({
      title: info.title, url: info.url, upName: info.upName,
      duration: info.duration, pubdate: info.pubdate,
      subtitles: data.segments, comments: comments
    });

    currentResult = { ...currentResult, markdown };

    progressFill.style.width = '100%';
    progress.hidden = true;
    resultPanel.hidden = false;
    $('cancelBtn').hidden = true;

    const charCount = data.segments.reduce((sum, s) => sum + s.content.length, 0);
    const audioMinutes = Math.round((data.duration || 0) / 60000);
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    $('resultStats').textContent = `语音识别: ${audioMinutes}分钟音频 → ${data.segments.length} 条文本，约 ${charCount} 字 | 用时 ${totalElapsed}s`;
    const previewText = markdown.length > 3000 ? markdown.slice(0, 3000) + '\n\n... (预览截断)' : markdown;
    $('preview').textContent = previewText;
    sendCompletionNotification(info.title, '语音识别');

  } catch (err) {
    progress.hidden = true;
    $('cancelBtn').hidden = true;
    showError(`转录失败: ${err.message}`);
  } finally {
    extractBtn.disabled = false;
    asrBtn.disabled = false;
    $('stayOnTabWarning').hidden = true;
  }
}

function showAsrResult(task) {
  const progress = $('progress');
  const resultPanel = $('resultPanel');

  progress.hidden = true;
  resultPanel.hidden = false;
  $('cancelBtn').hidden = true;

  const asrResult = {
    hasSubtitle: true,
    videoInfo: task.videoInfo,
    subtitles: task.segments,
    asrDuration: task.duration,
    asrLanguage: task.language,
    comments: task.comments
  };

  currentResult = asrResult;

  const markdown = generateMarkdown({
    title: task.videoInfo.title,
    url: task.videoInfo.url,
    upName: task.videoInfo.upName,
    duration: task.videoInfo.duration,
    pubdate: task.videoInfo.pubdate,
    subtitles: task.segments,
    comments: task.comments
  });

  currentResult.markdown = markdown;

  const charCount = task.segments.reduce((sum, s) => sum + s.content.length, 0);
  const audioMinutes = Math.round((task.duration || 0) / 60000);
  $('resultStats').textContent = `语音识别: ${audioMinutes}分钟音频 → ${task.segments.length} 条文本，约 ${charCount} 字`;

  const previewText = markdown.length > 3000 ? markdown.slice(0, 3000) + '\n\n... (预览截断，下载查看完整内容)' : markdown;
  $('preview').textContent = previewText;

  // Clear task state
  chrome.storage.local.remove('asr_task');
  sendCompletionNotification(task.videoInfo?.title || '', '语音识别');
}

async function pollAsrProgress() {
  const progress = $('progress');
  const progressFill = $('progressFill');
  const progressText = $('progressText');

  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      try {
        const task = await sendMessage({ type: 'GET_ASR_STATUS', bvid: currentBvid });

        if (task.status === 'done') {
          clearInterval(pollInterval);
          showAsrResult(task);
          resolve();
        } else if (task.status === 'error') {
          clearInterval(pollInterval);
          reject(new Error(task.error || '转录出错'));
        } else if (task.status === 'idle') {
          // Task was cancelled
          clearInterval(pollInterval);
          reject(new Error('转录已取消'));
        } else {
          // Still in progress - update UI
          const elapsed = Math.floor((Date.now() - (task.startTime || Date.now())) / 1000);
          const m = Math.floor(elapsed / 60);
          const s = elapsed % 60;
          progressText.textContent = `正在转录... ${m}分${s}秒`;
          progressFill.style.width = `${Math.min(task.progress || 5, 60)}%`;
        }
      } catch (err) {
        clearInterval(pollInterval);
        reject(err);
      }
    }, 2000);
  });
}

async function handleCancel() {
  $('cancelBtn').hidden = true;
  try {
    await sendMessage({ type: 'CANCEL_ASR' });
  } catch (e) { /* ignore */ }
  document.querySelectorAll('.actions .btn').forEach(b => b.disabled = false);
  $('progress').hidden = true;
  showError('转录已取消');
}

async function restoreAsrState() {
  try {
    const task = await sendMessage({ type: 'GET_ASR_STATUS', bvid: currentBvid });

    if (task.status === 'done' && task.segments) {
      showAsrResult(task);
    } else if (task.status !== 'idle' && task.status !== 'error') {
      const extractBtn = $('extractBtn');
      const asrBtn = $('asrBtn');
      const progress = $('progress');
      const progressFill = $('progressFill');
      const progressText = $('progressText');
      const errorMsg = $('errorMsg');

      extractBtn.disabled = true;
      asrBtn.disabled = true;
      errorMsg.hidden = true;
      $('resultPanel').hidden = true;
      progress.hidden = false;
      $('cancelBtn').hidden = false;
      progressFill.classList.remove('indeterminate');
      progressFill.style.width = '10%';
      progressText.textContent = '正在转录...（恢复上次进度）';

      await pollAsrProgress();

      extractBtn.disabled = false;
      asrBtn.disabled = false;
    } else if (task.status === 'error') {
      $('errorMsg').textContent = task.error || '转录失败';
      $('errorMsg').hidden = false;
    }
  } catch (err) {
    // Silent - no existing task to restore
  }
}

function handleDownload() {
  if (!currentResult || !currentResult.markdown) return;

  const filename = `${sanitizeFilename(currentResult.videoInfo.title || 'bilibili')}.md`;

  // Use File System Access API for save dialog with correct filename
  if ('showSaveFilePicker' in window) {
    downloadWithFilePicker(filename, currentResult.markdown);
  } else {
    downloadWithAnchor(filename, currentResult.markdown);
  }
}

async function downloadWithFilePicker(filename, content) {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Markdown',
        accept: { 'text/markdown': ['.md'] }
      }]
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError(`下载失败: ${err.message}`);
    }
  }
}

function downloadWithAnchor(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getVideoInfoFromPage(tab) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        reject(new Error('无法与页面通信，请刷新页面后重试'));
      } else {
        resolve(resp);
      }
    });
  });
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (resp.error) {
        reject(new Error(resp.error));
      } else {
        resolve(resp);
      }
    });
  });
}

function showError(msg) {
  $('errorMsg').textContent = msg;
  $('errorMsg').hidden = false;
}

async function handleStartService() {
  const startBtn = $('startServiceBtn');
  startBtn.disabled = true;
  startBtn.textContent = '⏳ 启动中...';

  try {
    // 尝试通过 Native Messaging 启动
    const resp = await sendMessage({
      type: 'START_WHISPER_SERVICE',
      serverUrl: whisperServerUrl,
    });

    if (resp.nativeStarted) {
      // Native host 成功启动，等待服务就绪
      startBtn.textContent = '⏳ 等待就绪...';
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await sendMessage({
          type: 'CHECK_WHISPER',
          serverUrl: whisperServerUrl,
        });
        if (status.available) {
          loadWhisperStatus(); // 刷新状态
          return;
        }
      }
      throw new Error('服务启动超时，请检查终端窗口');
    }
  } catch (err) {
    // Native host 未安装或失败，走剪贴板 + 提示路径
    const serverDir = 'whisper_server';
    const cmd = `python server.py`;

    try {
      await navigator.clipboard.writeText(cmd);
      showToast(`✅ 启动命令已复制: ${cmd}`);
      showToast('💡 请在终端中粘贴运行，或双击 whisper_server/start_server.bat');
    } catch (_) {
      showToast(`请在终端运行: cd whisper_server && ${cmd}`);
    }
  }

  startBtn.disabled = false;
  startBtn.textContent = '🚀 一键启动';
}

function showToast(msg) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-show'));

  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => document.body.removeChild(toast), 300);
  }, 4000);
}

function sendCompletionNotification(title, type) {
  // 窗口闪烁（任务栏抖动 + 聚焦）
  chrome.windows.getCurrent().then(win => {
    if (win.state === 'minimized') {
      chrome.windows.update(win.id, { state: 'normal' });
    } else {
      chrome.windows.update(win.id, { focused: true });
    }
  });

  document.title = `✅ 完成 - b量子阅读`;
  setTimeout(() => { document.title = 'b量子阅读'; }, 5000);

  // 系统通知
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'b量子阅读 - 完成',
    message: `「${title}」${type}已完成！`,
    priority: 2,
  });
}
