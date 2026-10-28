function getApiBase() {
  if (typeof globalThis.DRISHTIPAY_API_BASE_URL === "string") {
    return globalThis.DRISHTIPAY_API_BASE_URL.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.location?.protocol?.startsWith("http")) {
    // Relative path routes through server.mjs proxy, avoiding CORS and mobile port issues
    return "";
  }
  const host = (typeof window !== "undefined" && window.location?.hostname) ? window.location.hostname : "localhost";
  return `http://${host}:8000`;
}

const baseUrl = getApiBase();

/** Calls the optional FastAPI reader. It intentionally exposes no fabricated fallback. */
export async function readProductLabel(image) {
  const body = new FormData();
  body.append("image", image);
  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1/vision/read-price`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(60000)
    });
  } catch (err) {
    if (err.name === "TimeoutError") {
      throw new Error("Label reading timed out. Please try again or enter amount manually.");
    }
    throw new Error(`The product-reading service is unavailable (${err.message}). Check that the backend is running.`);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || `The product-reading service returned ${response.status}.`);
  }
  return response.json();
}

/** Sends recorded audio blob to backend for reliable transcription */
export async function transcribeVoiceAudio(audioBlob) {
  const body = new FormData();
  body.append("audio", audioBlob, "voice.webm");
  let response;
  try {
    response = await fetch(`${baseUrl}/api/v1/voice/transcribe`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(20000)
    });
  } catch (err) {
    throw new Error("Voice service unavailable.");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail || `Voice service returned ${response.status}.`);
  }
  return response.json();
}
