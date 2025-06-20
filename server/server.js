const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const port = 3000;
const API_KEY = process.env.API_KEY;

const dbPath = path.join(__dirname, 'history.db');

function runSql(args, json = false) {
  const cmdArgs = [];
  if (json) cmdArgs.push('-json');
  cmdArgs.push(dbPath, args);
  return execFileSync('sqlite3', cmdArgs, { encoding: 'utf8' });
}

function escapeSql(str) {
  return `'${str.replace(/'/g, "''")}'`;
}

function initDb() {
  runSql(
    `CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT,
      story TEXT,
      filename TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`
  );
  try {
    const info = JSON.parse(runSql('PRAGMA table_info(history);', true));
    const cols = info.map(c => c.name);
    if (!cols.includes('story')) {
      runSql('ALTER TABLE history ADD COLUMN story TEXT;');
    }
  } catch (err) {
    console.error('Error ensuring story column:', err);
  }
}

function addHistory(prompt, story, filename) {
  runSql(
    `INSERT INTO history (prompt, story, filename) VALUES (${escapeSql(prompt)}, ${escapeSql(story)}, ${escapeSql(filename)});`
  );
}

function fetchHistory() {
  const out = runSql('SELECT prompt, story, filename, created_at FROM history ORDER BY id DESC;', true);
  return out ? JSON.parse(out) : [];
}

initDb();

const imagesDir = path.join(__dirname, '../public/images');
fs.mkdir(imagesDir, { recursive: true }).catch(() => {});

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const requests = new Map();

function authenticate(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (key === API_KEY) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function rateLimit(req, res, next) {
  const id = (req.headers['x-api-key'] || req.ip) || 'anon';
  const now = Date.now();
  const info = requests.get(id) || { start: now, count: 0 };
  if (now - info.start > RATE_LIMIT_WINDOW_MS) {
    info.start = now;
    info.count = 0;
  }
  info.count += 1;
  requests.set(id, info);
  if (info.count > MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  next();
}

const IMAGE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function cleanOldImages() {
  try {
    const files = await fs.readdir(imagesDir);
    const now = Date.now();
    for (const file of files) {
      if (file === '.gitkeep') continue;
      const filePath = path.join(imagesDir, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > IMAGE_TTL_MS) {
        await fs.unlink(filePath).catch(() => {});
        runSql(`DELETE FROM history WHERE filename=${escapeSql(file)};`);
      }
    }
  } catch (err) {
    console.error('Error cleaning images:', err);
  }
}

cleanOldImages();
setInterval(cleanOldImages, 60 * 60 * 1000);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

const API_URL = 'https://ai-image-api.xeven.workers.dev/img';

async function generateStory(prompt) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return `這是一段關於「${prompt}」的短篇故事。`;
  }
}
try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
      {
        contents: [
          {
            parts: [
              {
                text: `請根據以下主題生成一段約 50 字的中文短篇故事。\n\n主題：「${prompt}」`
              }
            ]
          }
        ]
      },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    const candidates = resp.data?.candidates;
    const story = candidates?.[0]?.content?.parts?.[0]?.text || '';
    return story.trim();
  } catch (err) {
    console.error('Error calling Gemini API:', err?.response?.data || err);
    return '';
  }

app.post('/generate', authenticate, rateLimit, async (req, res) => {
  const { prompt } = req.body;

  try {
    const response = await axios.get(API_URL, {
      params: { prompt },
      responseType: 'arraybuffer',
    });

    const imageBuffer = Buffer.from(response.data, 'binary');
    const filename = `${crypto.randomUUID()}.png`;
    const imagePath = path.join(imagesDir, filename);
    await fs.writeFile(imagePath, imageBuffer);
    const story = await generateStory(prompt);
    addHistory(prompt, story, filename);

    res.json({ imageUrl: '/images/' + filename, story });
  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).send('Failed to generate image');
  }
});

app.get('/history', authenticate, rateLimit, (req, res) => {
  try {
    const history = fetchHistory();
    res.json(history);
  } catch (error) {
    console.error('Error fetching history:', error);
    res.status(500).send('Failed to load history');
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
