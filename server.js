const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function splitIntoChunks(text, maxChars = 3000) {
  const paragraphs = text.split(/\n+/);
  const chunks = [];
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n' + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function convertChunk(chunk, options, apiKey) {
  const prompt = `Sen, edebi eserleri ve metinleri disleksi ile disgrafi yaşayan okuyucular için daha erişilebilir hale getiren uzman bir Türkçe dil asistanısın.

Görevin:
1. Metni yeniden yaz; yazarın sesini, üslubunu ve anlam bütünlüğünü koru.
2. Edebi kaliteyi ve duygusal derinliği asla düşürme.
3. Şu disleksi dostu teknikleri uygula:
${options || '- Kısa ve net cümleler kullan.\n- Paragrafları kısa tut (3-4 cümle).\n- Edilgen yapıları etken yapıya çevir.'}
4. Türkçe dil bilgisi kurallarına tam uy.
5. Sadece dönüştürülmüş metni yaz. Açıklama ekleme, giriş cümlesi kurma.

Dönüştürülecek metin:
${chunk}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.4 },
      }),
    }
  );

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error?.message || `API hatası: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function processText(text, options, apiKey) {
  const chunks = splitIntoChunks(text, 3000);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    const result = await convertChunk(chunks[i], options, apiKey);
    results.push(result);
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
  return results.join('\n\n');
}

function cleanText(text) {
  return text
    .replace(/[^\x20-\x7E\u00C0-\u024F\u0100-\u017E\u011E\u011F\u0130\u0131\u015E\u015F\u00D6\u00F6\u00DC\u00FC\u00C7\u00E7\u0040-\u007A\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

app.post('/api/convert', async (req, res) => {
  const { text, options } = req.body || {};
  if (!text || text.trim().length === 0)
    return res.status(400).json({ error: 'Metin boş olamaz.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API anahtarı yapılandırılmamış.' });

  try {
    const result = await processText(text, options, apiKey);
    return res.status(200).json({ result });
  } catch (err) {
    return res.status(500).json({ error: 'Sunucu hatası: ' + err.message });
  }
});

app.post('/api/convert-file', upload.single('file'), async (req, res) => {
  if (!req.file)
    return res.status(400).json({ error: 'Dosya yüklenmedi.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey)
    return res.status(500).json({ error: 'API anahtarı yapılandırılmamış.' });

  const options = req.body.options || '';

  try {
    let text = '';
    const mime = req.file.mimetype;

    if (mime === 'application/pdf') {
      const parsed = await pdfParse(req.file.buffer);
      text = parsed.text || '';
      text = cleanText(text);
    } else {
      text = req.file.buffer.toString('utf-8');
    }

    if (!text || text.trim().length === 0)
      return res.status(400).json({ error: 'Dosyadan metin okunamadı.' });

    const result = await processText(text, options, apiKey);
    return res.status(200).json({ result });
  } catch (err) {
    return res.status(500).json({ error: 'Dosya işleme hatası: ' + err.message });
  }
});

app.get('/', (req, res) => res.json({ status: 'LexiDost API çalışıyor ✓' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LexiDost backend port ${PORT}'de çalışıyor`));
