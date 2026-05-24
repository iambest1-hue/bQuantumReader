// ASR module: call local Whisper server for speech recognition

const DEFAULT_WHISPER_URL = 'http://localhost:8787';

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

export async function transcribeAudio(audioUrl, serverUrl, language = 'zh') {
  const url = serverUrl || DEFAULT_WHISPER_URL;
  const resp = await fetch(`${url}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      language
    })
  });

  const data = await resp.json();

  if (!resp.ok) {
    throw new Error(data.error || `转录失败 (${resp.status})`);
  }

  return data;
}
