// Offscreen document for long-running Whisper transcription
// Loads pending tasks from storage on startup (no message race condition)

// On load, check for pending task and auto-start
(async () => {
  const { asr_task } = await chrome.storage.local.get('asr_task');
  if (asr_task && (asr_task.status === 'starting' || asr_task.status === 'connecting')) {
    handleTranscribe(asr_task);
  }
})();

async function handleTranscribe({ audioUrl, serverUrl, language }) {
  await updateTask({ status: 'connecting', progress: 5 });

  const resp = await fetch(`${serverUrl}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio_url: audioUrl, language: language || 'zh' }),
    signal: AbortSignal.timeout(600000)
  });

  await updateTask({ status: 'processing', progress: 70 });

  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `转录失败 (${resp.status})`);
  }

  await updateTask({
    status: 'done',
    progress: 100,
    segments: data.segments,
    duration: data.duration,
    language: data.language,
    completedAt: Date.now()
  });

  // Notify background to close this document
  chrome.runtime.sendMessage({ type: 'TRANSCRIBE_DONE' });
}

async function updateTask(partial) {
  const existing = await chrome.storage.local.get('asr_task');
  const task = existing.asr_task || {};
  await chrome.storage.local.set({ asr_task: { ...task, ...partial } });
}
