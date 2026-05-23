// Content script: injected into bilibili video pages

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_VIDEO_INFO') {
    const info = extractVideoInfo();
    sendResponse(info);
  }
  return true;
});

// Pre-fetch WBI keys from page context (has cookies) for background use
(async () => {
  try {
    const resp = await fetch('https://api.bilibili.com/x/web-interface/nav');
    const json = await resp.json();
    if (json.code === 0 && json.data?.wbi_img) {
      await chrome.storage.local.set({ _wbi_img: json.data.wbi_img });
    }
  } catch (_) { /* ignore */ }
})();

function extractVideoInfo() {
  const url = window.location.href;
  const bvidMatch = url.match(/BV[\w]+/);
  const bvid = bvidMatch ? bvidMatch[0] : null;

  // Try to get video title
  const titleEl = document.querySelector('h1.video-title, h1.VideoTitle--title, .video-info-container .video-title');
  const title = titleEl ? titleEl.textContent.trim() : document.title.replace('_哔哩哔哩_bilibili', '').trim();

  // Try to get UP主
  const upEl = document.querySelector('.up-info__name a, .username, .up-name');
  const upName = upEl ? upEl.textContent.trim() : '';

  // Try to get duration
  const durationEl = document.querySelector('.bilibili-player-video-time-total, .bpx-player-ctrl-time-duration');
  const duration = durationEl ? durationEl.textContent.trim() : '';

  // Try to extract cid from page context
  let cid = null;
  try {
    // B站页面中 window.__playinfo__ 包含视频信息
    if (window.__playinfo__ && window.__playinfo__.data) {
      cid = window.__playinfo__.data.cid || null;
    }
  } catch (e) {
    // Ignore
  }

  return { bvid, cid, title, upName, duration, url };
}
