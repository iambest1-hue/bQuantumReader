/**
 * ASR module: communicate with local Whisper server (v2)
 *
 * checkWhisperStatus  ─ GET /status  (returns new state machine fields)
 * transcribeAudio     ─ POST /transcribe (returns task_id)
 * subscribeProgress   ─ SSE GET /progress/<task_id>
 * cancelTranscribe    ─ POST /cancel/<task_id>
 */

const DEFAULT_WHISPER_URL = 'http://127.0.0.1:8787';

/**
 * Check Whisper server health and state.
 * @param {string} [serverUrl]
 * @returns {Promise<{available:boolean, phase:string, progress:number, error_class?:string, error_message?:string, model?:string, device?:string, compute_type?:string, port?:number}>}
 */
export async function checkWhisperStatus(serverUrl) {
  const url = serverUrl || DEFAULT_WHISPER_URL;
  try {
    const resp = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) });
    const data = await resp.json();
    return { available: true, ...data };
  } catch {
    return { available: false };
  }
}

/**
 * Start async transcription. Returns task_id immediately.
 * @param {string} audioUrl - B站 audio stream URL
 * @param {object} [opts]
 * @param {string} [opts.serverUrl]
 * @param {string} [opts.language='zh']
 * @returns {Promise<{task_id:string}>}
 */
export async function transcribeAudio(audioUrl, opts = {}) {
  const url = opts.serverUrl || DEFAULT_WHISPER_URL;
  const resp = await fetch(`${url}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      language: opts.language || 'zh',
    }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `转录失败 (${resp.status})`);
  return data; // { task_id }
}

/**
 * Subscribe to SSE progress stream.
 * @param {string} taskId
 * @param {object} callbacks
 * @param {function} [callbacks.onProgress]  - {phase, percent, processed_ms, total_ms, ...}
 * @param {function} [callbacks.onPhaseChange] - {phase}
 * @param {function} [callbacks.onDone]      - {segments, duration, language}
 * @param {function} [callbacks.onError]     - {error_class, error_message}
 * @param {object} [opts]
 * @param {string} [opts.serverUrl]
 * @returns {EventSource} - caller can close() to unsubscribe
 */
export function subscribeProgress(taskId, callbacks, opts = {}) {
  const url = opts.serverUrl || DEFAULT_WHISPER_URL;
  const es = new EventSource(`${url}/progress/${taskId}`);

  es.addEventListener('progress', (e) => {
    try { callbacks.onProgress?.(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('phase-change', (e) => {
    try { callbacks.onPhaseChange?.(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('done', (e) => {
    try { callbacks.onDone?.(JSON.parse(e.data)); } catch {}
    es.close();
  });
  es.addEventListener('error', (e) => {
    try { callbacks.onError?.(JSON.parse(e.data)); } catch {}
    es.close();
  });

  // Fallback: if EventSource fires 'error' without a named event, close
  es.onerror = () => {
    callbacks.onError?.({ error_class: 'connection_lost', error_message: '进度连接中断' });
    es.close();
  };

  return es;
}

/**
 * Cancel a running transcription.
 * @param {string} taskId
 * @param {object} [opts]
 * @param {string} [opts.serverUrl]
 * @returns {Promise<{status:string}>}
 */
export async function cancelTranscribe(taskId, opts = {}) {
  const url = opts.serverUrl || DEFAULT_WHISPER_URL;
  const resp = await fetch(`${url}/cancel/${taskId}`, { method: 'POST' });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error || `取消失败 (${resp.status})`);
  return data;
}
