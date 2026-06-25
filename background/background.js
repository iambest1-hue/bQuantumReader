// Background service worker

import { getVideoInfo, getSubtitleList, getSubtitleContent, getAudioUrl, getComments, formatDuration, parseBilibiliUrl, getVideoPages } from '../shared/bilibili-api.js';
import { generateMarkdown, sanitizeFilename } from '../shared/markdown.js';
import { checkWhisperStatus } from '../shared/asr.js';
import { getNativeClient, resetNativeClient } from '../shared/native_messaging.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_SUBTITLE') {
    handleExtract(request.bvid, request.cid)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'DETECT_SERIES') {
    handleDetectSeries(request.url)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'EXTRACT_SERIES') {
    handleExtractSeries(request.bvid, request.pages)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'FETCH_VIDEO_INFO') {
    fetchVideoInfoMeta(request.bvid)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'DOWNLOAD_MARKDOWN') {
    handleDownload(request.markdown, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'CHECK_WHISPER') {
    checkWhisperStatus(request.serverUrl)
      .then(sendResponse)
      .catch(err => sendResponse({ available: false, error: err.message }));
    return true;
  }

  if (request.type === 'GET_AUDIO_INFO') {
    handleGetAudioInfo(request.bvid, request.cid)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'START_ASR') {
    handleStartASR(request)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'GET_ASR_STATUS') {
    chrome.storage.local.get('asr_task')
      .then(r => {
        const task = r.asr_task;
        // Only return task if bvid matches (or neither has bvid)
        if (request.bvid) {
          if (task && task.bvid === request.bvid) {
            sendResponse(task);
          } else {
            sendResponse({ status: 'idle' });
          }
        } else {
          sendResponse(task || { status: 'idle' });
        }
      })
      .catch(err => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (request.type === 'CANCEL_ASR') {
    handleCancelASR()
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (request.type === 'TRANSCRIBE_DONE') {
    handleTranscribeDone()
      .then(() => sendResponse({ success: true }))
      .catch(err => console.warn('TRANSCRIBE_DONE error:', err));
    return true;
  }

  if (request.type === 'START_WHISPER_SERVICE') {
    handleStartWhisperService()
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message, nativeStarted: false }));
    return true;
  }

  if (request.type === 'NATIVE_COMMAND') {
    handleNativeCommand(request.command)
      .then(sendResponse)
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});

/** Extract subtitle data for a single episode (used by both single and series extraction) */
async function extractSingleEpisode(bvid, cid, pageInfo = {}) {
  const subtitleList = await getSubtitleList(bvid, cid);
  let subtitles = [];
  let hasSubtitle = false;
  let message = '';

  if (subtitleList.length > 0) {
    const zhSub = subtitleList.find(s => s.lan === 'zh-CN' || s.lan === 'ai-ZH') || subtitleList[0];
    subtitles = await getSubtitleContent(zhSub.subtitle_url);
    hasSubtitle = true;
  } else {
    message = '该视频没有CC字幕，可尝试使用语音识别（需本地Whisper服务）';
  }

  return {
    hasSubtitle,
    subtitles,
    part: pageInfo.part || '',
    subtitleLangs: subtitleList.map(s => s.lan),
    message
  };
}

async function handleExtract(bvid, cid) {
  // Step 1: Get video info (for cid if missing, and metadata)
  const videoInfo = await getVideoInfo(bvid);

  // Use provided cid or fall back to videoInfo.cid (first page)
  const effectiveCid = cid || videoInfo.cid;

  // Step 2: Try to get CC subtitles for this episode
  const episodeResult = await extractSingleEpisode(bvid, effectiveCid);

  let result;
  if (!episodeResult.hasSubtitle) {
    result = {
      hasSubtitle: false,
      videoInfo: extractVideoMeta(videoInfo),
      subtitles: [],
      message: episodeResult.message
    };
  } else {
    result = {
      hasSubtitle: true,
      videoInfo: extractVideoMeta(videoInfo),
      subtitles: episodeResult.subtitles,
      subtitleLangs: episodeResult.subtitleLangs
    };
  }

  // Step 3: Fetch comments
  try {
    const comments = await getComments(videoInfo.aid);
    result.comments = comments;
  } catch (e) {
    console.warn('获取评论失败:', e.message);
    result.comments = [];
  }

  return result;
}

function extractVideoMeta(data) {
  return {
    title: data.title || '',
    bvid: data.bvid || '',
    aid: data.aid || 0,
    upName: data.owner?.name || '',
    duration: formatDuration(data.duration || 0),
    pubdate: data.pubdate ? new Date(data.pubdate * 1000).toISOString().slice(0, 10) : '',
    url: `https://www.bilibili.com/video/${data.bvid}`,
    desc: data.desc || ''
  };
}

/** Fetch only video metadata (title, upName, duration) via API — used when content script is unavailable */
async function fetchVideoInfoMeta(bvid) {
  const videoInfo = await getVideoInfo(bvid);
  const meta = extractVideoMeta(videoInfo);
  return { title: meta.title, upName: meta.upName, duration: meta.duration };
}

/** Detect if the current video is part of a series/multi-P video */
async function handleDetectSeries(url) {
  const { bvid, p } = parseBilibiliUrl(url);
  if (!bvid) return { isSeries: false };

  const pages = await getVideoPages(bvid);
  if (pages.length <= 1) {
    return { isSeries: false, currentBvid: bvid };
  }

  return {
    isSeries: true,
    total: pages.length,
    currentP: p,
    pages,
    currentBvid: bvid
  };
}

/** Extract subtitles for all episodes in a series */
async function handleExtractSeries(bvid, pages) {
  const videoInfo = await getVideoInfo(bvid);
  const meta = extractVideoMeta(videoInfo);

  // Fetch comments once (comments are per-video, not per-page)
  let comments = [];
  try {
    comments = await getComments(videoInfo.aid);
  } catch (e) {
    console.warn('获取评论失败:', e.message);
  }

  const results = [];

  for (const page of pages) {
    // Check cancel flag
    const { series_cancelled } = await chrome.storage.session.get('series_cancelled');
    if (series_cancelled) break;

    // Update progress via session storage (popup will listen)
    await chrome.storage.session.set({
      series_progress: { current: results.length + 1, total: pages.length, part: page.part || '' }
    });

    try {
      const episodeResult = await extractSingleEpisode(bvid, page.cid, page);
      results.push({
        p: page.page,
        part: page.part || '',
        hasSubtitle: episodeResult.hasSubtitle,
        subtitles: episodeResult.subtitles,
        subtitleLangs: episodeResult.subtitleLangs,
        message: episodeResult.message
      });
    } catch (err) {
      results.push({
        p: page.page,
        part: page.part || '',
        hasSubtitle: false,
        subtitles: [],
        message: `提取失败: ${err.message}`
      });
    }
  }

  // Clear progress
  await chrome.storage.session.remove('series_progress');

  return {
    results,
    total: pages.length,
    successCount: results.filter(r => r.hasSubtitle).length,
    failCount: results.filter(r => !r.hasSubtitle).length,
    videoInfo: meta,
    comments
  };
}

async function handleDownload(markdown, filename) {
  const encoded = encodeURIComponent(markdown);
  const dataUrl = `data:text/markdown;charset=utf-8,${encoded}`;

  await chrome.downloads.download({
    url: dataUrl,
    filename: `${sanitizeFilename(filename)}.md`,
    saveAs: true
  });
}

async function handleStartASR({ audioUrl, serverUrl, language, videoInfo, comments }) {
  // Store full task state in storage FIRST
  const task = {
    status: 'starting',
    progress: 0,
    startTime: Date.now(),
    bvid: videoInfo.bvid,
    videoInfo,
    comments: comments || [],
    audioUrl,
    serverUrl,
    language: language || 'zh'
  };
  await chrome.storage.local.set({ asr_task: task });

  // Check if offscreen already exists (avoid close+create race)
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  }).catch(() => []);

  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Long-running Whisper ASR transcription that persists when popup closes'
    });
    // Give the document a moment to initialize before sending message
    await new Promise(r => setTimeout(r, 500));
  }

  // Actively notify offscreen (primary start mechanism)
  chrome.runtime.sendMessage({ type: 'START_TRANSCRIBE_IN_OFFSCREEN', task }).catch(() => {
    // Offscreen might not have loaded its listener yet — storage-driven
    // fallback (offscreen.js IIFE) will pick up the task
  });
}

async function handleTranscribeDone() {
  // Close the offscreen document
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // May already be closed
  }
}

async function handleStartWhisperService() {
  // 通过 Native Messaging 长连接启动 Whisper 服务
  try {
    const client = getNativeClient();
    await client.connect();
    const resp = await client.send({ command: 'start' }, 10000);
    return { nativeStarted: true, pid: resp.pid, msg: resp.msg };
  } catch (err) {
    return { nativeStarted: false, error: err.message };
  }
}

async function handleCancelASR() {
  // 获取当前任务信息用于服务端取消
  try {
    const { asr_task } = await chrome.storage.local.get('asr_task');
    const taskId = asr_task?.task_id;
    const serverUrl = asr_task?.serverUrl || 'http://127.0.0.1:8787';

    // 通知服务端取消
    if (taskId) {
      fetch(`${serverUrl}/cancel/${taskId}`, { method: 'POST' }).catch(() => {});
    }

    // 通知 offscreen 文档取消（让它 abort fetch + 写 cancelled 状态）
    // offscreen 收到 CANCEL_ASR 后会自行清理并发送 TRANSCRIBE_DONE
    chrome.runtime.sendMessage({ type: 'CANCEL_ASR' }).catch(() => {});

    // 移除存储中的任务（防止恢复）
    await chrome.storage.local.remove('asr_task');
  } catch (e) {
    // 兜底
    await chrome.storage.local.remove('asr_task');
  }

  // 关闭 offscreen document
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // 可能已关闭
  }
}

async function handleNativeCommand(command) {
  try {
    const client = getNativeClient();
    await client.connect();
    return await client.send({ command }, 5000);
  } catch (err) {
    return { status: 'error', msg: err.message };
  }
}

// ====== Window Mode: 点击图标打开独立窗口 ======
chrome.action.onClicked.addListener(async (tab) => {
  // 1) 检查 session 存储中是否已有窗口 ID
  const { ext_window_id } = await chrome.storage.session.get('ext_window_id');
  if (ext_window_id) {
    try {
      await chrome.windows.update(ext_window_id, { focused: true });
      // 更新当前标签 ID（用户可能已切换到其他 B站 页面）
      await chrome.storage.session.set({ activeTabId: tab.id });
      return;
    } catch (_) { /* 窗口已关闭，继续创建新窗口 */ }
  }

  // 2) 扫描所有窗口，避免重复创建（保守路径）
  const extUrl = chrome.runtime.getURL('popup/popup.html');
  const allWindows = await chrome.windows.getAll({ populate: true });
  for (const win of allWindows) {
    if (win.tabs?.some(t => t.url === extUrl)) {
      await chrome.windows.update(win.id, { focused: true });
      await chrome.storage.session.set({ ext_window_id: win.id, activeTabId: tab.id });
      return;
    }
  }

  // 3) 创建新窗口
  await chrome.storage.session.set({ activeTabId: tab.id });
  const win = await chrome.windows.create({
    url: 'popup/popup.html',
    type: 'popup',
    width: 520,
    height: 680,
  });
  await chrome.storage.session.set({ ext_window_id: win.id });
});

// 窗口关闭时清理 session（但保留 offscreen / asr_task，让后台转录继续运行）
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { ext_window_id } = await chrome.storage.session.get('ext_window_id');
  if (windowId === ext_window_id) {
    await chrome.storage.session.remove(['ext_window_id', 'activeTabId']);
  }
});

async function handleGetAudioInfo(bvid, cid) {
  const videoInfo = await getVideoInfo(bvid);
  const effectiveCid = cid || videoInfo.cid;

  const audioUrl = await getAudioUrl(bvid, effectiveCid);
  if (!audioUrl) {
    throw new Error('无法获取音频流地址');
  }

  // Fetch comments in parallel
  let comments = [];
  try {
    comments = await getComments(videoInfo.aid);
  } catch (e) {
    console.warn('获取评论失败:', e.message);
  }

  return {
    audioUrl,
    videoInfo: extractVideoMeta(videoInfo),
    comments
  };
}
