// Bilibili API wrapper for fetching video info and subtitles
// Includes WBI signing for /x/player/wbi/v2 endpoint

const BILIBILI_API_BASE = 'https://api.bilibili.com';

// WBI signing constants
const MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 37, 12, 52, 56, 7,
  0, 16, 38, 11, 6, 34, 55, 39, 57, 22, 1, 26, 44, 24, 51, 13,
  36, 20, 40, 4, 17, 48, 21, 30, 25, 41, 54, 59
];

let cachedMixinKey = null;
let keyFetchPromise = null;

async function getMixinKey() {
  if (cachedMixinKey) return cachedMixinKey;
  if (keyFetchPromise) return keyFetchPromise;

  keyFetchPromise = (async () => {
    try {
      const resp = await fetch(`${BILIBILI_API_BASE}/x/web-interface/nav`, {
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Referer': 'https://www.bilibili.com/',
        }
      });
      const json = await resp.json();
      if (json.code !== 0) {
        throw new Error(`获取 WBI 密钥失败 (code=${json.code}, msg=${json.message})`);
      }
      if (!json.data?.wbi_img) {
        // Fallback: if not logged in, try reading from page context via storage
        const { _wbi_img } = await chrome.storage.local.get('_wbi_img');
        if (_wbi_img) {
          const extractKey = (url) => url.split('/').pop().split('.')[0];
          const rawKey = extractKey(_wbi_img.img_url) + extractKey(_wbi_img.sub_url);
          let mixin = '';
          for (const i of MIXIN_KEY_TABLE) {
            if (i < rawKey.length) mixin += rawKey[i];
          }
          cachedMixinKey = mixin.slice(0, 32);
          return cachedMixinKey;
        }
        throw new Error('获取 WBI 密钥失败：nav API 未返回 wbi_img，请先登录B站');
      }

      const { img_url, sub_url } = json.data.wbi_img;
      const extractKey = (url) => url.split('/').pop().split('.')[0];
      const rawKey = extractKey(img_url) + extractKey(sub_url);

      let mixin = '';
      for (const i of MIXIN_KEY_TABLE) {
        if (i < rawKey.length) mixin += rawKey[i];
      }
      cachedMixinKey = mixin.slice(0, 32);
      return cachedMixinKey;
    } finally {
      keyFetchPromise = null;
    }
  })();

  return keyFetchPromise;
}

async function signParams(params) {
  const mixinKey = await getMixinKey();
  const wts = Math.floor(Date.now() / 1000);

  const allParams = { ...params, wts };

  const keys = Object.keys(allParams).sort();
  const query = keys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
    .join('&');

  const signStr = query + mixinKey;
  const wRid = md5(signStr);

  return { w_rid: wRid, wts };
}

// Pure JS MD5 implementation
function md5(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const bytes = [];
  for (let i = 0; i < utf8.length; i++) {
    bytes.push(utf8.charCodeAt(i));
  }

  // Append padding
  const origLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length * 8) % 512 !== 448) {
    bytes.push(0);
  }
  // Append original length as 64-bit little-endian
  for (let i = 0; i < 8; i++) {
    bytes.push((origLen >>> (i * 8)) & 0xff);
  }

  // Process 512-bit chunks
  const words = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)
    );
  }

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    const w = words.slice(i, i + 16);
    let a = a0, b = b0, c = c0, d = d0;

    // Helper functions
    const F = (x, y, z) => (x & y) | (~x & z);
    const G = (x, y, z) => (x & z) | (y & ~z);
    const H = (x, y, z) => x ^ y ^ z;
    const I = (x, y, z) => y ^ (x | ~z);

    const rot = (x, n) => (x << n) | (x >>> (32 - n));

    const FF = (a, b, c, d, k, s, ac) => {
      a += F(b, c, d) + w[k] + ac;
      return rot(a, s) + b;
    };
    const GG = (a, b, c, d, k, s, ac) => {
      a += G(b, c, d) + w[k] + ac;
      return rot(a, s) + b;
    };
    const HH = (a, b, c, d, k, s, ac) => {
      a += H(b, c, d) + w[k] + ac;
      return rot(a, s) + b;
    };
    const II = (a, b, c, d, k, s, ac) => {
      a += I(b, c, d) + w[k] + ac;
      return rot(a, s) + b;
    };

    // Round 1
    a = FF(a, b, c, d, 0, 7, 0xd76aa478); d = FF(d, a, b, c, 1, 12, 0xe8c7b756);
    c = FF(c, d, a, b, 2, 17, 0x242070db); b = FF(b, c, d, a, 3, 22, 0xc1bdceee);
    a = FF(a, b, c, d, 4, 7, 0xf57c0faf); d = FF(d, a, b, c, 5, 12, 0x4787c62a);
    c = FF(c, d, a, b, 6, 17, 0xa8304613); b = FF(b, c, d, a, 7, 22, 0xfd469501);
    a = FF(a, b, c, d, 8, 7, 0x698098d8); d = FF(d, a, b, c, 9, 12, 0x8b44f7af);
    c = FF(c, d, a, b, 10, 17, 0xffff5bb1); b = FF(b, c, d, a, 11, 22, 0x895cd7be);
    a = FF(a, b, c, d, 12, 7, 0x6b901122); d = FF(d, a, b, c, 13, 12, 0xfd987193);
    c = FF(c, d, a, b, 14, 17, 0xa679438e); b = FF(b, c, d, a, 15, 22, 0x49b40821);

    // Round 2
    a = GG(a, b, c, d, 1, 5, 0xf61e2562); d = GG(d, a, b, c, 6, 9, 0xc040b340);
    c = GG(c, d, a, b, 11, 14, 0x265e5a51); b = GG(b, c, d, a, 0, 20, 0xe9b6c7aa);
    a = GG(a, b, c, d, 5, 5, 0xd62f105d); d = GG(d, a, b, c, 10, 9, 0x02441453);
    c = GG(c, d, a, b, 15, 14, 0xd8a1e681); b = GG(b, c, d, a, 4, 20, 0xe7d3fbc8);
    a = GG(a, b, c, d, 9, 5, 0x21e1cde6); d = GG(d, a, b, c, 14, 9, 0xc33707d6);
    c = GG(c, d, a, b, 3, 14, 0xf4d50d87); b = GG(b, c, d, a, 8, 20, 0x455a14ed);
    a = GG(a, b, c, d, 13, 5, 0xa9e3e905); d = GG(d, a, b, c, 2, 9, 0xfcefa3f8);
    c = GG(c, d, a, b, 7, 14, 0x676f02d9); b = GG(b, c, d, a, 12, 20, 0x8d2a4c8a);

    // Round 3
    a = HH(a, b, c, d, 5, 4, 0xfffa3942); d = HH(d, a, b, c, 8, 11, 0x8771f681);
    c = HH(c, d, a, b, 11, 16, 0x6d9d6122); b = HH(b, c, d, a, 14, 23, 0xfde5380c);
    a = HH(a, b, c, d, 1, 4, 0xa4beea44); d = HH(d, a, b, c, 4, 11, 0x4bdecfa9);
    c = HH(c, d, a, b, 7, 16, 0xf6bb4b60); b = HH(b, c, d, a, 10, 23, 0xbebfbc70);
    a = HH(a, b, c, d, 13, 4, 0x289b7ec6); d = HH(d, a, b, c, 0, 11, 0xeaa127fa);
    c = HH(c, d, a, b, 3, 16, 0xd4ef3085); b = HH(b, c, d, a, 6, 23, 0x04881d05);
    a = HH(a, b, c, d, 9, 4, 0xd9d4d039); d = HH(d, a, b, c, 12, 11, 0xe6db99e5);
    c = HH(c, d, a, b, 15, 16, 0x1fa27cf8); b = HH(b, c, d, a, 2, 23, 0xc4ac5665);

    // Round 4
    a = II(a, b, c, d, 0, 6, 0xf4292244); d = II(d, a, b, c, 7, 10, 0x432aff97);
    c = II(c, d, a, b, 14, 15, 0xab9423a7); b = II(b, c, d, a, 5, 21, 0xfc93a039);
    a = II(a, b, c, d, 12, 6, 0x655b59c3); d = II(d, a, b, c, 3, 10, 0x8f0ccc92);
    c = II(c, d, a, b, 10, 15, 0xffeff47d); b = II(b, c, d, a, 1, 21, 0x85845dd1);
    a = II(a, b, c, d, 8, 6, 0x6fa87e4f); d = II(d, a, b, c, 15, 10, 0xfe2ce6e0);
    c = II(c, d, a, b, 6, 15, 0xa3014314); b = II(b, c, d, a, 13, 21, 0x4e0811a1);
    a = II(a, b, c, d, 4, 6, 0xf7537e82); d = II(d, a, b, c, 11, 10, 0xbd3af235);
    c = II(c, d, a, b, 2, 15, 0x2ad7d2bb); b = II(b, c, d, a, 9, 21, 0xeb86d391);

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  // Convert to hex
  const toHex = (n) => {
    let hex = '';
    for (let i = 0; i < 4; i++) {
      hex += ('0' + ((n >>> (i * 8)) & 0xff).toString(16)).slice(-2);
    }
    return hex;
  };

  return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

export async function getVideoInfo(bvid) {
  const resp = await fetch(`${BILIBILI_API_BASE}/x/web-interface/view?bvid=${bvid}`);
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`获取视频信息失败: ${json.message}`);
  }
  return json.data;
}

export async function getSubtitleList(bvid, cid) {
  const params = { bvid, cid };
  const { w_rid, wts } = await signParams(params);

  const resp = await fetch(
    `${BILIBILI_API_BASE}/x/player/wbi/v2?bvid=${bvid}&cid=${cid}&w_rid=${w_rid}&wts=${wts}`
  );
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`获取字幕列表失败: ${json.message}`);
  }
  return json.data.subtitle?.subtitles || [];
}

export async function getSubtitleContent(subtitleUrl) {
  const url = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl;
  const resp = await fetch(url);
  const json = await resp.json();
  const body = json.body || [];
  // B站字幕时间戳是秒，统一转为毫秒（与 Whisper 输出一致）
  return body.map(entry => ({
    from: Math.round(entry.from * 1000),
    to: Math.round(entry.to * 1000),
    content: entry.content,
  }));
}

export async function getAudioUrl(bvid, cid) {
  const resp = await fetch(
    `${BILIBILI_API_BASE}/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=0&fnval=16`
  );
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`获取音频流失败: ${json.message}`);
  }
  const dash = json.data.dash;
  if (dash && dash.audio && dash.audio.length > 0) {
    return dash.audio[0].baseUrl;
  }
  return null;
}

export async function getComments(aid, page = 1, pageSize = 20) {
  const resp = await fetch(
    `${BILIBILI_API_BASE}/x/v2/reply/main?type=1&oid=${aid}&mode=3&ps=${pageSize}` +
    (page > 1 ? `&pn=${page}` : '')
  );
  const json = await resp.json();
  if (json.code !== 0) {
    throw new Error(`获取评论失败: ${json.message}`);
  }
  const replies = json.data?.replies || [];
  return replies.map(r => ({
    id: r.rpid,
    user: r.member?.uname || '匿名用户',
    avatar: r.member?.avatar || '',
    time: r.ctime,
    content: r.content?.message || '',
    likes: r.like || 0,
    replyCount: r.rcount || 0,
  }));
}

export function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTimestamp(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
