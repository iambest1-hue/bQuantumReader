// Background service worker

import { getVideoInfo, getSubtitleList, getSubtitleContent, getAudioUrl, getComments, formatDuration } from '../shared/bilibili-api.js';
import { generateMarkdown, sanitizeFilename } from '../shared/markdown.js';
import { checkWhisperStatus } from '../shared/asr.js';

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_SUBTITLE') {
    handleExtract(request.bvid, request.cid)
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
});

async function handleExtract(bvid, cid) {
  // Step 1: Get video info (for cid if missing, and metadata)
  const videoInfo = await getVideoInfo(bvid);

  // Use provided cid or fall back to videoInfo.cid (first page)
  const effectiveCid = cid || videoInfo.cid;

  // Step 2: Try to get CC subtitles
  const subtitleList = await getSubtitleList(bvid, effectiveCid);

  let result;
  if (subtitleList.length === 0) {
    result = {
      hasSubtitle: false,
      videoInfo: extractVideoMeta(videoInfo),
      subtitles: [],
      message: '该视频没有CC字幕，可尝试使用语音识别（需本地Whisper服务）'
    };
  } else {
    // Prefer Chinese subtitles, then any available
    const zhSub = subtitleList.find(s => s.lan === 'zh-CN' || s.lan === 'ai-ZH') || subtitleList[0];

    // Step 3: Download subtitle content
    const subtitles = await getSubtitleContent(zhSub.subtitle_url);

    result = {
      hasSubtitle: true,
      videoInfo: extractVideoMeta(videoInfo),
      subtitles,
      subtitleLangs: subtitleList.map(s => s.lan)
    };
  }

  // Step 4: Fetch comments
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
  // Store full task state in storage FIRST, before creating offscreen doc
  // Offscreen doc will read this automatically on load, avoiding race conditions
  await chrome.storage.local.set({
    asr_task: {
      status: 'starting',
      progress: 0,
      startTime: Date.now(),
      bvid: videoInfo.bvid,
      videoInfo,
      comments: comments || [],
      audioUrl,
      serverUrl,
      language: language || 'zh'
    }
  });

  // Close any existing offscreen doc first (stale/hung task), then create a fresh one
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) { /* none exists */ }

  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['WORKERS'],
    justification: 'Long-running Whisper ASR transcription that must persist when popup closes'
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
  // 尝试通过 Native Messaging 启动 Whisper 服务
  try {
    const nativePort = chrome.runtime.connectNative('com.bquantum.whisper');
    return await new Promise((resolve, reject) => {
      nativePort.onMessage.addListener((msg) => {
        nativePort.disconnect();
        if (msg.status === 'ok') {
          resolve({ nativeStarted: true, pid: msg.pid, msg: msg.msg });
        } else {
          reject(new Error(msg.msg || 'Native host 返回错误'));
        }
      });
      nativePort.onDisconnect.addListener(() => {
        reject(new Error('Native host 未安装或连接断开'));
      });
      nativePort.postMessage({ command: 'start' });
    });
  } catch (err) {
    // Native host 未安装，返回失败让 popup 走剪贴板方案
    return { nativeStarted: false, error: err.message };
  }
}

async function handleCancelASR() {
  await chrome.storage.local.remove('asr_task');
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // ignore
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

// 窗口关闭时清理存储
chrome.windows.onRemoved.addListener(async (windowId) => {
  const { ext_window_id } = await chrome.storage.session.get('ext_window_id');
  if (windowId === ext_window_id) {
    // 如果 ASR 正在运行，清理 offscreen document
    try {
      const { asr_task } = await chrome.storage.local.get('asr_task');
      if (asr_task && (asr_task.status === 'starting' || asr_task.status === 'connecting' || asr_task.status === 'processing')) {
        await chrome.offscreen.closeDocument();
        await chrome.storage.local.remove('asr_task');
      }
    } catch (_) { /* 忽略清理错误 */ }
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
