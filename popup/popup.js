import { generateMarkdown, sanitizeFilename } from '../shared/markdown.js';
import { formatTimestamp } from '../shared/bilibili-api.js';

const $ = id => document.getElementById(id);

let currentResult = null;
let whisperServerUrl = '';
let currentBvid = null;
let currentTab = null;      // Track the active tab for button handlers
let seriesPages = null;     // Cache series pages after detection
let _asrCancelFlag = false;

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

  await initPopup(tab);

  // Bind buttons (uses currentTab — survives refresh)
  $('extractBtn').addEventListener('click', () => currentTab && handleExtract(currentTab));
  $('asrBtn').addEventListener('click', () => currentTab && handleASR(currentTab));
  $('extractCurrentBtn').addEventListener('click', () => currentTab && handleExtract(currentTab));
  $('extractSeriesBtn').addEventListener('click', () => currentTab && seriesPages && handleExtractSeries(currentTab, seriesPages));
  $('downloadBtn').addEventListener('click', handleDownload);
  $('cancelBtn').addEventListener('click', handleCancel);
  $('settingsBtn').addEventListener('click', () => { chrome.runtime.openOptionsPage(); });
  $('helpBtn').addEventListener('click', () => {
    chrome.windows.create({ url: 'help/help.html', type: 'popup', width: 720, height: 640 });
  });
  $('startServiceBtn').addEventListener('click', handleStartService);
  $('refreshBtn').addEventListener('click', handleRefresh);

  // Restore any existing ASR task state (if same video)
  restoreAsrState();
});

/** Extract bvid from a bilibili URL (path or query param) */
function extractBvid(url) {
  if (!url) return null;
  const pathMatch = url.match(/\/video\/(BV\w+)/);
  if (pathMatch) return pathMatch[1];
  const queryMatch = url.match(/[?&]bvid=(BV\w+)/);
  return queryMatch?.[1] || null;
}

/** Initialize/reset the popup UI for a given tab */
async function initPopup(tab) {
  currentTab = tab;
  currentResult = null;
  seriesPages = null;

  // Reset UI to ready state
  $('mainPanel').hidden = false;
  $('notBilibili').hidden = true;
  $('progress').hidden = true;
  $('resultPanel').hidden = true;
  $('errorMsg').hidden = true;
  $('stayOnTabWarning').hidden = true;
  $('cancelBtn').hidden = true;
  $('videoTitle').textContent = '加载中...';
  $('videoUp').textContent = '';
  $('videoDuration').textContent = '';

  // Accept any bilibili URL that contains a bvid (path or query)
  currentBvid = extractBvid(tab.url);
  if (!tab.url || !tab.url.includes('bilibili.com') || !currentBvid) {
    $('notBilibili').hidden = false;
    $('mainPanel').hidden = true;
    return;
  }

  // Get video info — try content script first, fall back to API
  chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' }, async (response) => {
    if (chrome.runtime.lastError || !response) {
      // Content script not available (e.g. watch-later page) → use API
      try {
        const meta = await sendMessage({ type: 'FETCH_VIDEO_INFO', bvid: currentBvid });
        if (!meta.error) {
          $('videoTitle').textContent = meta.title || '未知标题';
          $('videoUp').textContent = meta.upName ? `UP: ${meta.upName}` : '';
          $('videoDuration').textContent = meta.duration || '';
          return;
        }
      } catch {}
      $('videoTitle').textContent = '无法获取视频信息，请点击 🔄 刷新';
      return;
    }
    $('videoTitle').textContent = response.title || '未知标题';
    $('videoUp').textContent = response.upName ? `UP: ${response.upName}` : '';
    $('videoDuration').textContent = response.duration || '';
  });

  // Check Whisper server status
  loadWhisperStatus();

  // Detect series (multi-P videos) via background
  const seriesInfo = await detectSeries(tab.url);

  if (seriesInfo.isSeries) {
    $('extractBtn').hidden = true;
    $('seriesPanel').hidden = false;
    $('seriesTotal').textContent = seriesInfo.total;
    seriesPages = seriesInfo.pages;
  } else {
    $('seriesPanel').hidden = true;
    $('extractBtn').hidden = false;
    seriesPages = null;
  }
}

/** Refresh: find the current bilibili video tab and re-initialize */
async function handleRefresh() {
  $('refreshBtn').disabled = true;

  try {
    // 1) Find the active tab in the focused normal browser window
    //    (scans all windows since the popup window itself isn't 'normal')
    const wins = await chrome.windows.getAll({ populate: true });
    for (const win of wins) {
      if (win.type !== 'normal') continue;
      const tab = win.tabs?.find(t => t.active);
      if (tab && tab.url?.includes('bilibili.com') && extractBvid(tab.url)) {
        await chrome.storage.session.set({ activeTabId: tab.id });
        await initPopup(tab);
        $('refreshBtn').disabled = false;
        return;
      }
    }
  } catch { /* fall through */ }

  // 2) Fallback: stored activeTabId (user might have navigated same tab)
  try {
    const { activeTabId } = await chrome.storage.session.get('activeTabId');
    if (activeTabId) {
      const tab = await chrome.tabs.get(activeTabId);
      if (extractBvid(tab.url)) {
        await initPopup(tab);
        $('refreshBtn').disabled = false;
        return;
      }
    }
  } catch { /* tab gone */ }

  // 3) Last resort: any bilibili tab with a bvid
  try {
    const allTabs = await chrome.tabs.query({ url: '*://www.bilibili.com/*' });
    const tab = allTabs.find(t => extractBvid(t.url));
    if (tab) {
      await chrome.storage.session.set({ activeTabId: tab.id });
      await initPopup(tab);
      $('refreshBtn').disabled = false;
      return;
    }
  } catch { /* fall through */ }

  $('notBilibili').hidden = false;
  $('mainPanel').hidden = true;
  $('notBilibili').textContent = '未找到B站视频页面，请先打开一个视频';
  $('refreshBtn').disabled = false;
}

function loadWhisperStatus() {
  chrome.storage.sync.get(['whisperServerUrl'], async (settings) => {
    whisperServerUrl = settings.whisperServerUrl || 'http://127.0.0.1:8787';

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
      const { phase, progress, error_class, error_message, model, device, compute_type } = resp;

      // 根据 phase 显示不同状态
      if (phase === 'ready') {
        dotEl.className = 'whisper-dot online';
        textEl.textContent = `Whisper: 已连接 (${model || 'unknown'})`;
        $('asrBtn').hidden = false;
        $('asrBtn').disabled = false;
        $('startServiceBtn').hidden = true;
      } else if (phase === 'downloading_model' || phase === 'loading_model') {
        dotEl.className = 'whisper-dot loading';
        textEl.textContent = `Whisper: ${phase === 'downloading_model' ? '模型下载中' : '模型加载中'} ${progress || 0}%`;
        $('asrBtn').hidden = false;
        $('asrBtn').disabled = true;
        $('startServiceBtn').hidden = true;
      } else if (phase === 'failed') {
        dotEl.className = 'whisper-dot offline';
        textEl.textContent = `Whisper: ${error_message || '错误'}`;
        $('asrBtn').hidden = false;
        $('asrBtn').disabled = true;
        $('startServiceBtn').hidden = false;
        $('startServiceBtn').textContent = '🔄 重试启动';
      } else {
        // not_started / 其他
        dotEl.className = 'whisper-dot offline';
        textEl.textContent = 'Whisper: 启动中...';
        $('asrBtn').hidden = false;
        $('asrBtn').disabled = true;
        $('startServiceBtn').hidden = true;
      }

      const modelInfo = $('whisperModelInfo');
      modelInfo.hidden = false;
      const parts = [];
      if (model) parts.push(`模型: ${model}`);
      if (device) parts.push(`设备: ${device}`);
      if (compute_type) parts.push(`精度: ${compute_type}`);
      modelInfo.textContent = parts.join(' | ');
    } else {
      dotEl.className = 'whisper-dot offline';
      textEl.textContent = 'Whisper: 未连接';
      $('whisperModelInfo').hidden = true;
      $('asrBtn').hidden = false;
      $('asrBtn').disabled = true;
      $('startServiceBtn').hidden = false;
      $('startServiceBtn').textContent = '🚀 一键启动';
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
    let videoInfo;
    try {
      videoInfo = await getVideoInfoFromPage(tab);
    } catch {
      // Content script not available — use bvid from URL
      videoInfo = { bvid: currentBvid, cid: null };
    }
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
  $('cancelBtn').hidden = false;
  _asrCancelFlag = false;

  try {
    let videoInfo;
    try {
      videoInfo = await getVideoInfoFromPage(tab);
    } catch {
      videoInfo = { bvid: currentBvid, cid: null };
    }
    if (!videoInfo.bvid) throw new Error('无法获取视频BV号');
    currentBvid = videoInfo.bvid;

    // Step 1: Get audio URL + comments from background
    const { audioUrl, videoInfo: info, comments } = await sendMessage({
      type: 'GET_AUDIO_INFO',
      bvid: videoInfo.bvid,
      cid: videoInfo.cid
    });

    currentResult = { videoInfo: info, comments: comments || [] };
    progressFill.style.width = '5%';
    progressText.textContent = `正在启动转录「${info.title}」...`;

    // Step 2: POST /transcribe directly (bypass offscreen)
    progressText.textContent = `正在连接服务器...`;
    const transcribeResp = await fetch(`${whisperServerUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: audioUrl, language: 'zh' }),
      signal: AbortSignal.timeout(10000),
    });
    const body = await transcribeResp.json();
    if (!transcribeResp.ok) throw new Error(body.error || `转录失败 (${transcribeResp.status})`);
    if (!body.task_id) throw new Error('服务未返回 task_id');

    const taskId = body.task_id;
    // Store in session for potential restore
    await chrome.storage.session.set({ asr_task_id: taskId, asr_server_url: whisperServerUrl, asr_bvid: currentBvid });

    // Step 3: Poll /task_status/<task_id> for progress
    const overallStart = Date.now();
    const overallTimeout = 30 * 60 * 1000;

    while (true) {
      // Check overall timeout
      if (Date.now() - overallStart > overallTimeout) {
        throw new Error('转录超时 (30分钟)');
      }

      // Check cancel flag (set by handleCancel)
      if (_asrCancelFlag) {
        // Tell server to cancel
        fetch(`${whisperServerUrl}/cancel/${taskId}`, { method: 'POST' }).catch(() => {});
        throw new DOMException('Aborted', 'AbortError');
      }

      // Poll status
      const statusResp = await fetch(`${whisperServerUrl}/task_status/${taskId}`, {
        signal: AbortSignal.timeout(5000),
      });

      if (statusResp.ok) {
        const status = await statusResp.json();

        // Update progress bar
        const pct = status.progress || 0;
        progressFill.style.width = `${Math.min(pct, 60)}%`;

        // Update progress text via buildPhaseText helper
        const phaseText = buildPhaseTextForStatus(status, info.title);
        if (phaseText) progressText.textContent = phaseText;

        // Check terminal states
        if (status.status === 'done') {
          // Fetch full result
          await sleep(500);
          const full = await fetchTaskResult(whisperServerUrl, taskId);
          if (full?.segments) {
            const markdown = generateMarkdown({
              title: info.title, url: info.url, upName: info.upName,
              duration: info.duration, pubdate: info.pubdate,
              subtitles: full.segments, comments
            });
            currentResult = { ...currentResult, markdown };

            progressFill.style.width = '100%';
            progress.hidden = true;
            resultPanel.hidden = false;
            $('cancelBtn').hidden = true;

            const charCount = full.segments.reduce((sum, s) => sum + s.content.length, 0);
            const audioMinutes = Math.round((full.duration || 0) / 60000);
            $('resultStats').textContent = `语音识别: ${audioMinutes}分钟音频 → ${full.segments.length} 条文本，约 ${charCount} 字`;
            const previewText = markdown.length > 3000 ? markdown.slice(0, 3000) + '\n\n... (预览截断)' : markdown;
            $('preview').textContent = previewText;
            sendCompletionNotification(info.title, '语音识别');
          }
          // Cleanup session
          chrome.storage.session.remove(['asr_task_id', 'asr_server_url', 'asr_bvid']).catch(() => {});
          return;
        }

        if (status.status === 'cancelled') {
          throw new Error('转录已取消');
        }

        if (status.phase === 'failed' || status.error_class) {
          throw new Error(status.error_message || status.error_class || '转录失败');
        }
      }

      // Wait 2 seconds before next poll
      await sleep(2000);
    }

  } catch (err) {
    progress.hidden = true;
    $('cancelBtn').hidden = true;
    if (err.name === 'AbortError') {
      showError('转录已取消');
    } else {
      showError(`转录失败: ${err.message}`);
    }
  } finally {
    extractBtn.disabled = false;
    asrBtn.disabled = false;
    $('stayOnTabWarning').hidden = true;
  }
}

/** Build progress text from task_status JSON directly (no storage dependency). */
function buildPhaseTextForStatus(status, title) {
  const p = status.phase || status.status;
  switch (p) {
    case 'queued':
      return `排队中...`;
    case 'connecting':
      return `连接中...`;
    case 'downloading_audio':
      return `正在下载B站音频... ${status.progress || 0}%`;
    case 'transcribing': {
      const elapsed = status.processed_ms ? `${Math.round(status.processed_ms / 1000)}s` : '';
      const total = status.total_ms ? `${Math.round(status.total_ms / 1000)}s` : '';
      const segInfo = status.segments_count ? `${status.segments_count}条` : '';
      let etaText = '';
      if (status.eta_sec && status.eta_sec > 0) {
        etaText = status.eta_sec >= 120
          ? ` 预计还有 ${Math.round(status.eta_sec / 60)}分`
          : ` 预计还有 ${status.eta_sec}秒`;
      }
      return `正在转录「${title}」${elapsed}${total ? '/' + total : ''} ${segInfo}${etaText}`;
    }
    default:
      return `正在转录「${title}」... ${status.progress || 0}%`;
  }
}

async function fetchTaskResult(serverUrl, taskId) {
  try {
    const resp = await fetch(`${serverUrl}/task_result/${taskId}`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Listen to storage.onChanged for asr_task updates (real-time UI).
 * Returns a promise that resolves when task is done/error/cancelled.
 */
function listenAsrProgress(title) {
  const progressFill = $('progressFill');
  const progressText = $('progressText');

  // 实时 UI 更新 via storage.onChanged（不 resolve，仅更新进度显示）
  const uiHandler = (changes, area) => {
    if (area !== 'local' || !changes.asr_task) return;
    const task = changes.asr_task.newValue;
    if (!task) return;

    const { status, phase, progress } = task;
    const pct = progress || 0;
    progressFill.style.width = `${Math.min(pct, 100)}%`;

    const phaseText = buildPhaseText(task, title);
    if (phaseText) progressText.textContent = phaseText;
  };
  chrome.storage.onChanged.addListener(uiHandler);

  // 定期轮询获取完成/错误信号
  return pollAsrProgress(currentBvid).then((result) => {
    chrome.storage.onChanged.removeListener(uiHandler);
    return result;
  }).catch((err) => {
    chrome.storage.onChanged.removeListener(uiHandler);
    throw err;
  });
}

/** 根据 task 的 phase/status 构造友好的进度文案 */
function buildPhaseText(task, title) {
  const { status, phase, progress } = task;
  const p = phase || status;

  switch (p) {
    case 'starting':
    case 'connecting':
    case 'queued':
      return `排队中...`;
    case 'downloading_audio':
      return `正在下载B站音频... ${progress || 0}%`;
    case 'transcribing': {
      const { processed_ms, total_ms, segments_count, eta_sec } = task;
      const elapsed = processed_ms ? `${Math.round(processed_ms / 1000)}s` : '';
      const total = total_ms ? `${Math.round(total_ms / 1000)}s` : '';
      const segInfo = segments_count ? `${segments_count}条` : '';
      let etaText = '';
      if (eta_sec && eta_sec > 0) {
        if (eta_sec >= 120) {
          etaText = ` 预计还有 ${Math.round(eta_sec / 60)}分`;
        } else if (eta_sec >= 60) {
          etaText = ` 预计还有 1分${eta_sec % 60}秒`;
        } else {
          etaText = ` 预计还有 ${eta_sec}秒`;
        }
      }
      return `正在转录「${title}」${elapsed}${total ? '/' + total : ''} ${segInfo}${etaText}`;
    }
    case 'done':
    case 'cancelled':
    case 'error':
    case 'failed':
      return null; // pollAsrProgress 会处理
    default:
      return `正在转录「${title}」... ${progress || 0}%`;
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
    let stuckCount = 0;
    const pollInterval = setInterval(async () => {
      try {
        const task = await sendMessage({ type: 'GET_ASR_STATUS', bvid: currentBvid });

        if (task.status === 'done') {
          clearInterval(pollInterval);
          showAsrResult(task);
          resolve();
        } else if (task.status === 'error' || task.phase === 'failed') {
          clearInterval(pollInterval);
          reject(new Error(task.error_message || task.error || '转录出错'));
        } else if (task.status === 'cancelled') {
          clearInterval(pollInterval);
          reject(new Error('转录已取消'));
        } else if (task.status === 'idle') {
          clearInterval(pollInterval);
          reject(new Error('转录已取消'));
        } else {
          // 如果连续 15 次轮询（30 秒）都在 starting/connecting，诊断 offscreen
          if ((task.status === 'starting' || task.status === 'connecting') && task.progress === 0) {
            stuckCount++;
            if (stuckCount >= 15) {
              clearInterval(pollInterval);
              chrome.storage.local.get('_asr_diag', r => {
                const diag = r._asr_diag || 'undefined';
                reject(new Error(`后台服务未响应 (${diag})，请重新加载扩展后重试`));
              });
              return;
            }
          } else {
            stuckCount = 0; // 有进展就重置计数
          }

          const pct = task.progress || 0;
          progressFill.style.width = `${Math.min(pct, 60)}%`;

          // 使用 buildPhaseText 显示统一文案
          const videoTitle = $('videoTitle')?.textContent || '';
          const phaseText = buildPhaseText(task, videoTitle);
          if (phaseText) {
            progressText.textContent = phaseText;
          } else {
            // fallback: 显示简单计时
            const elapsed = Math.floor((Date.now() - (task.startTime || Date.now())) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            progressText.textContent = `处理中... ${m}分${s}秒`;
          }
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
  // Set flags for both ASR and series cancellation
  _asrCancelFlag = true;
  await chrome.storage.session.set({ series_cancelled: true });
  // Also tell server to cancel (in case we're in a phase where polling already stopped)
  try {
    const { asr_task_id } = await chrome.storage.session.get('asr_task_id');
    if (asr_task_id) {
      fetch(`${whisperServerUrl}/cancel/${asr_task_id}`, { method: 'POST' }).catch(() => {});
    }
  } catch {}
  showError('已取消');
}

async function restoreAsrState() {
  // Check if there's a running task from session storage
  try {
    const { asr_task_id, asr_server_url, asr_bvid } = await chrome.storage.session.get([
      'asr_task_id', 'asr_server_url', 'asr_bvid'
    ]);
    if (!asr_task_id) return; // No active task

    // Check with server if task is still active
    const url = asr_server_url || whisperServerUrl;
    const resp = await fetch(`${url}/task_status/${asr_task_id}`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) {
      // Task expired or doesn't exist — clean up
      chrome.storage.session.remove(['asr_task_id', 'asr_server_url', 'asr_bvid']).catch(() => {});
      return;
    }

    const status = await resp.json();

    if (status.status === 'done') {
      // Task completed while popup was closed — fetch result
      chrome.storage.session.remove(['asr_task_id', 'asr_server_url', 'asr_bvid']).catch(() => {});
      const full = await fetchTaskResult(url, asr_task_id);
      if (full?.segments) {
        const { videoInfo, comments } = currentResult || {};
        const title = videoInfo?.title || '';
        const markdown = generateMarkdown({
          title, url: '', upName: '', duration: '',
          pubdate: '', subtitles: full.segments, comments
        });
        $('resultPanel').hidden = false;
        $('resultStats').textContent = `语音识别: ${Math.round((full.duration || 0) / 60000)}分钟音频 → ${full.segments.length} 条文本`;
        $('preview').textContent = markdown;
        sendCompletionNotification(title, '语音识别');
      }
      return;
    }

    if (status.status === 'processing' || status.phase === 'transcribing') {
      // Task still running — show UI but don't start polling (popup will close again)
      const pct = status.progress || 0;
      $('progress').hidden = false;
      $('progressFill').style.width = `${Math.min(pct, 60)}%`;
      $('progressText').textContent = `转录进行中... ${pct}%（关闭窗口不会中断）`;
    }
  } catch {
    // Server unreachable — silently ignore
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
      // Native host 成功启动，等待服务就绪（最长 180 秒，容忍模型下载）
      startBtn.textContent = '⏳ 等待就绪...';

      // 分阶段等待：前 15 秒快速探测，之后慢速探测并展示状态
      const waitStart = Date.now();
      let lastPhase = '';

      for (let i = 0; i < 180; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const status = await sendMessage({
          type: 'CHECK_WHISPER',
          serverUrl: whisperServerUrl,
        });

        if (!status.available) {
          // 服务 HTTP 还未起来
          if (i === 3) startBtn.textContent = '⏳ 等待服务启动...';
          continue;
        }

        // 服务 HTTP 已响应，检查 phase
        const { phase, progress, error_class, error_message } = status;

        if (phase === 'ready') {
          loadWhisperStatus();
          return;
        }

        if (phase === 'failed') {
          showError(`服务启动失败: ${error_message || error_class || '未知错误'}`);
          startBtn.disabled = false;
          startBtn.textContent = '🔄 重试启动';
          return;
        }

        // 显示加载/下载进度
        if (phase !== lastPhase) {
          lastPhase = phase;
          const phaseText = {
            'loading_model': '模型加载中',
            'downloading_model': '模型下载中（首次约 500MB）',
            'not_started': '启动中',
          }[phase] || phase;
          startBtn.textContent = `⏳ ${phaseText}...`;
        }

        if (progress && progress > 0) {
          startBtn.textContent = `⏳ ${lastPhase === 'downloading_model' ? '模型下载中' : '加载中'} ${progress}%`;
        }

        // 每 30 秒更新一下状态（防止以为卡死）
        if (i > 0 && i % 30 === 0) {
          startBtn.textContent = `⏳ 等待中 (${Math.round((Date.now() - waitStart) / 1000)}秒)...`;
        }
      }

      // 超时
      showError('服务启动超时，请查看日志 whisper_server/logs/server.log');
      startBtn.disabled = false;
      startBtn.textContent = '🔄 重试启动';
      return;
    }
  } catch (err) {
    // Native host 未安装或失败，走剪贴板 + 提示路径
  }

  // Native host 失败降级：提示用户双击 start_server.bat
  const serverDir = 'whisper_server';
  const cmd = `cd ${serverDir} && start start_server.bat`;

  try {
    await navigator.clipboard.writeText(cmd);
    showToast('✅ 启动命令已复制');
    showToast('💡 请进入 whisper_server 文件夹，双击 start_server.bat');
  } catch (_) {
    showToast(`请在终端运行: ${cmd}`);
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

  document.title = `✅ 完成 - b量子速读`;
  setTimeout(() => { document.title = 'b量子速读'; }, 5000);

  // 系统通知
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon48.png'),
    title: 'b量子速读 - 完成',
    message: `「${title}」${type}已完成！`,
    priority: 2,
  });
}

// ====== Series / Multi-P episode extraction ======

/** Detect if the current video is part of a series */
async function detectSeries(url) {
  try {
    return await sendMessage({ type: 'DETECT_SERIES', url });
  } catch {
    return { isSeries: false };
  }
}

/** Extract subtitles for all episodes in a series and download as ZIP */
async function handleExtractSeries(tab, pages) {
  const seriesPanel = $('seriesPanel');
  const progress = $('progress');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const resultPanel = $('resultPanel');
  const errorMsg = $('errorMsg');
  const cancelBtn = $('cancelBtn');

  // Disable buttons
  $('extractCurrentBtn').disabled = true;
  $('extractSeriesBtn').disabled = true;
  if ($('asrBtn')) $('asrBtn').disabled = true;
  errorMsg.hidden = true;
  resultPanel.hidden = true;
  progress.hidden = false;
  progressFill.classList.add('indeterminate');
  progressText.textContent = '正在检测系列信息...';
  $('stayOnTabWarning').hidden = false;
  cancelBtn.hidden = false;

  // Clear any previous cancel flag
  await chrome.storage.session.remove('series_cancelled');

  // Listen for progress updates from background (via storage.session)
  const progressListener = (changes, area) => {
    if (area !== 'session' || !changes.series_progress) return;
    const { current, total, part } = changes.series_progress.newValue;
    progressFill.classList.remove('indeterminate');
    const pct = Math.round((current / total) * 100);
    progressFill.style.width = `${Math.min(pct, 60)}%`;
    progressText.textContent = `正在提取第 ${current} / ${total} 集${part ? `：${part}` : ''}...`;
  };
  chrome.storage.onChanged.addListener(progressListener);

  try {
    const result = await sendMessage({
      type: 'EXTRACT_SERIES',
      bvid: currentBvid,
      pages
    });
    chrome.storage.onChanged.removeListener(progressListener);

    if (!result.results || result.results.length === 0) {
      throw new Error('未能获取任何分P的字幕');
    }

    // Generate markdown files (individual + combined)
    progressText.textContent = '正在生成 Markdown 文件...';
    progressFill.style.width = '80%';

    const files = generateSeriesMarkdownFiles(result);

    // Create ZIP
    progressText.textContent = '正在打包 ZIP...';
    progressFill.style.width = '90%';

    const zip = new JSZip();
    for (const file of files) {
      zip.file(file.name, file.content);
    }
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Download ZIP via blob URL + chrome.downloads (no user gesture needed)
    const zipFilename = `${sanitizeFilename(result.videoInfo.title)}.zip`;
    const url = URL.createObjectURL(zipBlob);
    try {
      await chrome.downloads.download({ url, filename: zipFilename, saveAs: true });
    } catch {
      // chrome.downloads may not accept blob URLs in some Chrome versions — fall back to anchor
      const a = document.createElement('a');
      a.href = url;
      a.download = zipFilename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    // Show result summary
    progress.hidden = true;
    resultPanel.hidden = false;

    const charCount = result.results.reduce((sum, r) =>
      sum + (r.subtitles || []).reduce((s, sub) => s + sub.content.length, 0), 0);
    $('resultStats').textContent = `全系列 ${result.total} 集（成功 ${result.successCount}，失败 ${result.failCount}）| 约 ${charCount} 字`;

    // Preview: combined markdown
    const combinedFile = files.find(f => f.name.startsWith('全系列'));
    const previewContent = combinedFile ? combinedFile.content : '';
    const previewText = previewContent.length > 3000
      ? previewContent.slice(0, 3000) + '\n\n... (预览截断，下载查看完整内容)'
      : previewContent;
    $('preview').textContent = previewText;

    sendCompletionNotification(result.videoInfo.title, '全系列字幕提取');
  } catch (err) {
    chrome.storage.onChanged.removeListener(progressListener);
    progress.hidden = true;
    showError(err.message);
  } finally {
    $('extractCurrentBtn').disabled = false;
    $('extractSeriesBtn').disabled = false;
    if ($('asrBtn')) $('asrBtn').disabled = false;
    $('stayOnTabWarning').hidden = true;
    cancelBtn.hidden = true;
    await chrome.storage.session.remove(['series_progress', 'series_cancelled']);
  }
}

/** Generate per-episode + combined markdown file data for series results */
function generateSeriesMarkdownFiles(seriesResult) {
  const { results, videoInfo, comments } = seriesResult;
  const files = [];

  // 1. Individual episode markdown files
  for (const ep of results) {
    const epTitle = `${videoInfo.title} - P${ep.p}${ep.part ? ` ${ep.part}` : ''}`;
    const markdown = generateMarkdown({
      title: epTitle,
      url: `${videoInfo.url}?p=${ep.p}`,
      upName: videoInfo.upName,
      duration: '',
      pubdate: videoInfo.pubdate,
      subtitles: ep.hasSubtitle ? ep.subtitles : [],
      comments: []
    });

    const epPart = ep.part || videoInfo.title;
    const filename = `P${String(ep.p).padStart(2, '0')}_${sanitizeFilename(epPart)}.md`;
    files.push({ name: filename, content: markdown });
  }

  // 2. Combined markdown for the whole series
  const combinedLines = [];
  combinedLines.push(`# ${videoInfo.title}（全系列）`);
  combinedLines.push('');
  combinedLines.push(`> UP主: ${videoInfo.upName} | 共 ${results.length} 集`);
  combinedLines.push(`> 来源: ${videoInfo.url}`);
  combinedLines.push(`> 提取时间: ${new Date().toISOString().slice(0, 10)}`);
  combinedLines.push('');

  for (const ep of results) {
    combinedLines.push('---');
    combinedLines.push('');
    combinedLines.push(`## P${ep.p}${ep.part ? ` ${ep.part}` : ''}`);
    combinedLines.push('');

    if (!ep.hasSubtitle) {
      combinedLines.push(`> ${ep.message || '无字幕'}`);
      combinedLines.push('');
      continue;
    }

    for (const sub of ep.subtitles) {
      combinedLines.push(`[${formatTimestamp(sub.from)}] ${sub.content}`);
    }
    combinedLines.push('');
  }

  // Comments section (once for the whole series)
  if (comments && comments.length > 0) {
    combinedLines.push('---');
    combinedLines.push('');
    combinedLines.push('## 💬 视频评论');
    combinedLines.push('');
    for (const c of comments) {
      const date = new Date(c.time * 1000).toISOString().slice(0, 19).replace('T', ' ');
      combinedLines.push(`- **${c.user}** (${date})`);
      combinedLines.push(`  ${c.content}`);
      if (c.likes > 0) combinedLines.push(`  *👍 ${c.likes}*`);
      combinedLines.push('');
    }
  }

  const combinedName = `全系列_${sanitizeFilename(videoInfo.title)}.md`;
  files.push({ name: combinedName, content: combinedLines.join('\n') });

  return files;
}
