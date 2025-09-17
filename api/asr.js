// api/asr.js
import Busboy from "busboy";
import FormData from "form-data";
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    // Parse multipart/form-data to get the uploaded file buffer
    const { fileBuffer, filename } = await new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });
      let chunks = [];
      let gotFile = false;
      let fname = "audio";

      busboy.on("file", (_name, file, info) => {
        gotFile = true;
        if (info && info.filename) fname = info.filename;
        file.on("data", (d) => chunks.push(d));
        file.on("end", () => {});
      });

      busboy.on("finish", () => {
        if (!gotFile) return reject(new Error("No file field in form-data"));
        resolve({ fileBuffer: Buffer.concat(chunks), filename: fname });
      });

      busboy.on("error", reject);
      req.pipe(busboy);
    });

    // Read control headers (sent by the Action)
    const task = (req.headers["x-task"] || "transcribe").toString(); // transcribe | translate
    const language = (req.headers["x-language"] || "").toString();
    const wantSrt = ((req.headers["x-want-srt"] || "false").toString() === "true");

    // Build OpenAI request
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

    // Optional SRT from segments
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
}

// Vercel (Node) should not auto-parse the body for this route
export const config = { api: { bodyParser: false } };
