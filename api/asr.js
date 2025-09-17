import Busboy from "busboy";
import FormData from "form-data";
import fetch from "node-fetch";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const { fileBuffer, filename } = await new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });
      let chunks = [];
      let fname = "upload.wav";

      busboy.on("file", (_field, file, info) => {
        if (info && info.filename) fname = info.filename;
        file.on("data", (d) => chunks.push(d));
        file.on("end", () => {});
      });

      busboy.on("finish", () => {
        if (!chunks.length) return reject(new Error("No file uploaded"));
        resolve({ fileBuffer: Buffer.concat(chunks), filename: fname });
      });

      busboy.on("error", reject);
      req.pipe(busboy);
    });

    const task = (req.headers["x-task"] || "transcribe").toString(); // "transcribe" | "translate"
    const language = (req.headers["x-language"] || "").toString();
    const wantSrt = ((req.headers["x-want-srt"] || "false").toString() === "true");

    const form = new FormData();
    form.append("file", fileBuffer, { filename });
    form.append("model", "whisper-1");
    if (language) form.append("language", language);

    const endpoint = task === "translate" ? "translations" : "transcriptions";

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
          return `${pad(h)}:${pad(m)}:${pad(Math.floor(s2))},${String(ms).padStart(3,"0")}`;
        };
        return `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.text.trim()}\n`;
      }).join("\n");

    res.status(200).json({
      task,
      text: data.text,
      srt: wantSrt && Array.isArray(data.segments) ? toSrt(data.segments) : undefined,
      segments: data.segments
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Upload parse failed" });
  }
}

// Tell Vercel not to pre-parse the body
export const config = { api: { bodyParser: false } };
