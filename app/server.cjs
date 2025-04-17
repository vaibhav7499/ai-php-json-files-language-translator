const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { runTranslation } = require('./translate.cjs');

const app = express();
const PORT = 3000;

let currentStatus = {
  running: false,
  log: [],
  done: false
};
let cancelTranslation = false;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../public')));

app.post('/translate', async (req, res) => {
  const lang = req.body.lang || 'uk';
  const fileType = req.body.fileType || 'php';
  const params = req.body.params || {};

  if (currentStatus.running) {
    return res.json({ message: 'Translation already in progress' });
  }

  currentStatus = { running: true, log: [], done: false };
  cancelTranslation = false;

  runTranslation(lang, fileType, params, (logLine) => {
    if (cancelTranslation) return;
    console.log(logLine);
    currentStatus.log.push(logLine);
  }).then(() => {
    if (!cancelTranslation) {
      currentStatus.running = false;
      currentStatus.done = true;
    }
  }).catch((err) => {
    console.error('Translation error:', err);
    currentStatus.running = false;
    currentStatus.done = true;
    currentStatus.log.push(`❌ Translation failed: ${err.message}`);
  });

  res.json({ message: `Started translation to ${lang} for ${fileType}` });
});

app.post('/stop', (req, res) => {
  if (currentStatus.running) {
    cancelTranslation = true;
    currentStatus.running = false;
    currentStatus.done = true;
    currentStatus.log.push('🛑 Translation stopped by user');
    res.json({ message: 'Translation stopped' });
  } else {
    res.json({ message: 'No active translation to stop' });
  }
});

app.get('/status', (req, res) => {
  res.json(currentStatus);
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
});