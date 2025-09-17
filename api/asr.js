import Busboy from "busboy";
import FormData from "form-data";
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const state = { chunks: [], filename: "upload.wav", task: "transcribe", language: "", wantSrt: false };

    await new Promise((resolve, reject) => {
      const bb = Busboy({ headers: req.headers });

      bb.on("file", (fieldname, file, info) => {
        if (info?.filename) state.filename = info.filename;
        file.on("data", d => state.chunks.push(d));
        file.on("end", () => {});
      });

      bb.on("field", (name, value) => {
        if (name === "task" && (value === "transcribe" || value === "translate")) state.task = value;
        if (name === "language") state.language = String(value || "");
        if (name === "wantSrt") state.wantSrt = String(value).toLowerCase() === "true";
      });

      bb.on("finish", () => {
        if (!state.chunks.length) return reject(new Error("No file uploaded"));
        resolve();
      });

      bb.on("error", reject);
      req.pipe(bb);
    });

    const fileBuffer = Buffer.concat(state.chunks);

    const form = new FormData();
    form.append("file", fileBuffer, { filename: state.filename });
    form.append("model", "whisper-1");
    if (state.language) form.append("language", state.language);

    const endpoint = state.task === "translate" ? "translations" : "transcriptions";
    const r = await fetch(`https://api.openai.com/v1/audio/${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await r.json();

    const toSrt = (segments = []) =>
      segments.map((s, i) => {
        const fmt = (t) => {
          const h = Math.floor(t / 3600);
          const m = Math.floor((t % 3600) / 60);
          const s2 = t % 60;
          const ms = Math.round((s2 - Math.floor(s2)) * 1000);
          const pad = (n, z = 2) => String(n).padStart(z, "0");
          return `${pad(h)}:${pad(m)}:${pad(Math.floor(s2))},${String(ms).padStart(3, "0")}`;
        };
        return `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${(s.text || "").trim()}\n`;
      }).join("\n");

    res.status(200).json({
      task: state.task,
      text: data.text,
      srt: state.wantSrt && Array.isArray(data.segments) ? toSrt(data.segments) : undefined,
      segments: data.segments
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload parse failed" });
  }
}

// Important for multipart parsing on Vercel
export const config = { api: { bodyParser: false } };
