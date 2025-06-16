const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs').promises;
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT ||3000;

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
      filename TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );`
  );
}

function addHistory(prompt, filename) {
  runSql(
    `INSERT INTO history (prompt, filename) VALUES (${escapeSql(prompt)}, ${escapeSql(filename)});`
  );
}

function fetchHistory() {
  const out = runSql('SELECT prompt, filename, created_at FROM history ORDER BY id DESC;', true);
  return out ? JSON.parse(out) : [];
}

initDb();

const imagesDir = path.join(__dirname, '../public/images');
fs.mkdir(imagesDir, { recursive: true }).catch(() => {});

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

app.post('/generate', async (req, res) => {
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
    addHistory(prompt, filename);

    res.json({ imageUrl: '/images/' + filename' });
  } catch (error) {
    console.error('Error generating image:', error);
    res.status(500).send('Failed to generate image');
  }
});

app.get('/history', (req, res) => {
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
