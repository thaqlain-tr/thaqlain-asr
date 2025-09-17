// api/asr.js
// Vercel Serverless Function: transcribe (same language) or translate (to English) using Whisper

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") {
      res.status(405).send("Use POST with raw audio/video bytes");
      return;
    }

    // Collect raw bytes from the request
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);

    // Options via headers (keeps the body just the file)
    const task = (req.headers["x-task"] || "transcribe").toString(); // "transcribe" | "translate"
    const language = (req.headers["x-language"] || "").toString();   // e.g., "ar"
    const wantSrt = ((req.headers["x-want-srt"] || "false").toString() === "true");

    // Build multipart form for OpenAI
    const form = new FormData();
    form.append("file", new Blob([raw]), "audio");
    form.append("model", "whisper-1");
    if (language) form.append("language", language);

    const endpoint = task === "translate" ? "translations" : "transcriptions";

    const r = await fetch(`https://api.openai.com/v1/audio/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await r.json();

    // Build very simple SRT from segments (if present)
    const toSrt = (segments = []) =>
      segments.map((s, i) => {
        const fmt = (t) => {
          const h = Math.floor(t / 3600);
          const m = Math.floor((t % 3600) / 60);
          const s2 = t % 60;
          const ms = Math.round((s2 - Math.floor(s2)) * 1000);
          const pad = (n, z = 2) => String(n).padStart(z, "0");
          return `${pad(h)}:${pad(m)}:${pad(Math.floor(s2))},${String(ms).padStart(3,"0")}`;
        };
        return `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${(s.text || "").trim()}\n`;
      }).join("\n");

    res.status(200).json({
      task,
      text: data.text,
      srt: wantSrt && Array.isArray(data.segments) ? toSrt(data.segments) : undefined,
      segments: data.segments
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || "Unknown error" });
  }
};
