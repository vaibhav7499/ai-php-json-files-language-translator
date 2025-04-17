require('dotenv').config();

let currentKeyIndex = 0;
function getNextKey(keys) {
  const key = keys[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  return key;
}

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const parser = require('php-parser');
const chalk = require('chalk');

const phpParser = new parser.Engine({ parser: { extractDoc: true } });

const inputDir = path.join(__dirname, '../input');
const outputDir = path.join(__dirname, '../output');

let errorCount = 0;
let cancelTranslation = false;

const languageNames = {
  "ar": "Arabic",
  "am": "Amharic",
  "bg": "Bulgarian",
  "bn": "Bengali",
  "ca": "Catalan",
  "cs": "Czech",
  "da": "Danish",
  "de": "German",
  "el": "Greek",
  "en": "English",
  "en_AU": "English (Australia)",
  "en_GB": "English (Great Britain)",
  "en_US": "English (USA)",
  "es": "Spanish",
  "es_419": "Spanish (Latin America and Caribbean)",
  "et": "Estonian",
  "fa": "Persian",
  "fi": "Finnish",
  "fil": "Filipino",
  "fr": "French",
  "gu": "Gujarati",
  "he": "Hebrew",
  "hi": "Hindi",
  "hr": "Croatian",
  "hu": "Hungarian",
  "id": "Indonesian",
  "it": "Italian",
  "ja": "Japanese",
  "kn": "Kannada",
  "ko": "Korean",
  "lt": "Lithuanian",
  "lv": "Latvian",
  "ml": "Malayalam",
  "mr": "Marathi",
  "ms": "Malay",
  "nl": "Dutch",
  "no": "Norwegian",
  "pl": "Polish",
  "pt_BR": "Portuguese (Brazil)",
  "pt_PT": "Portuguese (Portugal)",
  "ro": "Romanian",
  "ru": "Russian",
  "sk": "Slovak",
  "sl": "Slovenian",
  "sr": "Serbian",
  "sv": "Swedish",
  "sw": "Swahili",
  "ta": "Tamil",
  "te": "Telugu",
  "th": "Thai",
  "tr": "Turkish",
  "uk": "Ukrainian",
  "vi": "Vietnamese",
  "zh_CN": "Chinese (China)",
  "zh_TW": "Chinese (Taiwan)"
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeAndEscape(str) {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function sanitizeInput(text) {
  return text
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"')
    .replace(/\\/g, '\\\\')
    .replace(/[\u0000-\u001F\u007F]/g, '');
}

function loadPhpFile(filePath) {
  try {
    const code = fs.readFileSync(filePath, 'utf-8');
    if (!code.trim().startsWith('<?php')) {
      console.error(`❌ File ${filePath} does not appear to be a valid PHP file (missing <?php)`);
      return null;
    }
    const ast = phpParser.parseCode(code);
    const expr = ast.children.find(node => node.kind === 'return');
    if (!expr) {
      console.error(`❌ File ${filePath} does not contain a valid PHP return statement`);
      return null;
    }
    const entries = {};
    expr.expr.items.forEach(item => {
      const key = item.key.value;
      const value = item.value.value;
      entries[key] = value;
    });
    return entries;
  } catch (err) {
    console.error(`❌ Error parsing PHP file: ${filePath} - ${err.message}`);
    return null;
  }
}

function saveToPhpFile(filePath, dataObj) {
  let content = "<?php\n\nreturn [\n";
  for (const [key, value] of Object.entries(dataObj)) {
    content += `    '${normalizeAndEscape(key)}' => '${normalizeAndEscape(value)}',\n`;
  }
  content += "];\n";
  fs.writeFileSync(filePath, content, 'utf-8');
}

function loadJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim().startsWith('{') && !content.trim().startsWith('[')) {
      console.error(`❌ File ${filePath} does not appear to be valid JSON`);
      return null;
    }
    return JSON.parse(content);
  } catch (err) {
    console.error(`❌ Error parsing JSON file: ${filePath} - ${err.message}`);
    return null;
  }
}

async function translateText(text, languageName, params) {
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for translateText');
  }
  const { RETRY_DELAY, KEYS, activeModel } = params;
  if (
    !Number.isInteger(RETRY_DELAY) ||
    !(Array.isArray(KEYS) || typeof KEYS === 'string') ||
    typeof activeModel !== 'string'
  ) {
    throw new Error('Invalid params: RETRY_DELAY, KEYS, and activeModel are required');
  }

  const keysArray = Array.isArray(KEYS) ? KEYS : KEYS.split(',').map(k => k.trim());
  const cleanText = sanitizeInput(text);
  const prompt = `Respond ONLY with valid JSON in this format: {"translated": "..."}.\nEnsure all double quotes in the translated text are properly escaped (e.g., use \\"). Do not include Markdown, backticks, explanation, or extra text.\nThis is important.\n\nYou are translating UI text and descriptions for a Chrome extension called "Cursor Style", which allows users to change their mouse cursors. The content includes cursor names and descriptions from games, cartoons, anime, and pop culture.\n\nTranslate the following text to ${languageName}.\nDo NOT translate brand names or the name "Cursor Style".\n\nText: "${cleanText}"`;

  try {
    if (cancelTranslation) throw new Error('Translation cancelled');
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getNextKey(keysArray)}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://lambda.openrouter.local",
        "X-Title": "LambdaTranslator"
      },
      body: JSON.stringify({
        model: activeModel,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data = await response.json();
    console.log('Raw API response:', JSON.stringify(data, null, 2).slice(0, 200) + (JSON.stringify(data).length > 200 ? '...' : ''));

    if (data.error) {
      throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
    }

    let raw = data?.choices?.[0]?.message?.content?.trim?.() || '';
    raw = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '');

    let translated = '';
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.translated === 'string') {
        translated = parsed.translated;
      } else {
        throw new Error('Response does not contain a valid "translated" field');
      }
    } catch (err) {
      console.error('❌ JSON parse error:', err.message);
      const match = raw.match(/"translated"\s*:\s*"(.*?)"(?=\s*}$)/s);
      if (match && match[1]) {
        translated = match[1]
          .replace(/\\"/g, '"')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r');
        console.log('⚠️ Recovered translated text using fallback, length:', translated.length);
      } else {
        console.error('❌ Fallback failed, no valid translated string found in:', raw);
        throw new Error('Failed to parse or extract translation response');
      }
    }

    translated = translated
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');

    console.log('Extracted translated content length:', translated.length, 'Preview:', translated.slice(0, 100) + (translated.length > 100 ? '...' : ''));

    return translated;
  } catch (err) {
    console.error('❌ Translate error:', err.message);
    await sleep(RETRY_DELAY);
    return await translateText(text, languageName, params);
  }
}

function extractJsonFromContent(rawResponseBatch) {
  try {
    if (!rawResponseBatch || typeof rawResponseBatch !== 'object') {
      console.error('❌ Invalid API response: Response is null or not an object');
      return {};
    }
    if (!rawResponseBatch.choices || !Array.isArray(rawResponseBatch.choices) || rawResponseBatch.choices.length === 0) {
      console.error('❌ Invalid API response: No choices array or empty choices');
      return {};
    }
    let content = rawResponseBatch.choices[0]?.message?.content?.trim() || '';
    if (!content) {
      console.error('❌ Empty API response content');
      return {};
    }
    console.log('Raw batch response length:', content.length, 'Content:', content.slice(0, 200) + (content.length > 200 ? '...' : ''));
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    }
    return JSON.parse(content);
  } catch (error) {
    console.error('❌ JSON parse error:', error.message);
    return {};
  }
}

async function translateBatch(batchObj, languageName, params) {
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for translateBatch');
  }
  const { MAX_ERRORS, RETRY_DELAY, KEYS, activeModel } = params;
  if (
    !Number.isInteger(MAX_ERRORS) ||
    !Number.isInteger(RETRY_DELAY) ||
    !(Array.isArray(KEYS) || typeof KEYS === 'string') ||
    typeof activeModel !== 'string'
  ) {
    throw new Error('Invalid params: MAX_ERRORS, RETRY_DELAY, KEYS, and activeModel are required');
  }

  const keysArray = Array.isArray(KEYS) ? KEYS : KEYS.split(',').map(k => k.trim());
  const prompt = `You are translating UI text and descriptions for a Chrome extension called "Cursor Style", which allows users to change their mouse cursors. The content includes cursor names and descriptions from games, cartoons, anime, and pop culture.

  Translate each value in the following JSON object to ${languageName}.
  Do NOT translate brand names or the name "Cursor Style" and DO NOT CUT THE TEXT, I need a full translation!
  
  Respond ONLY with valid JSON in the SAME structure. Example format:
  {
    "key1": "value",
    "key2": "value"
  }
  
  Input:
  ${JSON.stringify(batchObj, null, 2)}
  `;

  let retryCount = 0;
  const maxRetries = 3;
  let keyIndex = currentKeyIndex;

  while (retryCount < maxRetries) {
    try {
      if (cancelTranslation) throw new Error('Translation cancelled');
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${keysArray[keyIndex]}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://lambda.openrouter.local",
          "X-Title": "LambdaTranslator"
        },
        body: JSON.stringify({
          model: activeModel,
          messages: [{ role: "user", content: prompt }]
        })
      });

      const data = await response.json();
      console.log('Raw API response:', JSON.stringify(data, null, 2).slice(0, 200) + (JSON.stringify(data).length > 200 ? '...' : ''));

      if (data.error) {
        throw new Error(`API error: ${data.error.message || JSON.stringify(data.error)}`);
      }

      const parsed = extractJsonFromContent(data);
      if (Object.keys(parsed).length === 0 && Object.keys(batchObj).length > 0) {
        throw new Error('Empty or invalid response from API');
      }
      errorCount = 0;
      currentKeyIndex = (keyIndex + 1) % keysArray.length;
      return parsed;
    } catch (err) {
      console.error('❌ Batch translate error:', err.message);
      errorCount++;
      if (errorCount >= MAX_ERRORS || retryCount >= maxRetries - 1) {
        throw new Error('Too many errors or retries exhausted');
      }
      keyIndex = (keyIndex + 1) % keysArray.length;
      await sleep(RETRY_DELAY);
      retryCount++;
    }
  }
}

function batchStrings(data, params) {
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for batchStrings');
  }
  const { MAX_BATCH_CHAR_LIMIT } = params;
  if (!Number.isInteger(MAX_BATCH_CHAR_LIMIT)) {
    throw new Error('Invalid params: MAX_BATCH_CHAR_LIMIT is required');
  }

  const batches = [];
  let currentBatch = {};
  let currentBatchSize = 0;

  for (const [key, value] of Object.entries(data)) {
    const valueLen = value.length;

    if (valueLen > MAX_BATCH_CHAR_LIMIT) {
      if (Object.keys(currentBatch).length > 0) {
        batches.push(currentBatch);
      }
      batches.push({ [key]: value });
      currentBatch = {};
      currentBatchSize = 0;
    } else {
      if (currentBatchSize + valueLen > MAX_BATCH_CHAR_LIMIT) {
        if (Object.keys(currentBatch).length > 0) {
          batches.push(currentBatch);
        }
        currentBatch = { [key]: value };
        currentBatchSize = valueLen;
      } else {
        currentBatch[key] = value;
        currentBatchSize += valueLen;
      }
    }
  }

  if (Object.keys(currentBatch).length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function processFileAsPhp(filename, onLog, langCode, languageName, params) {
  if (typeof onLog !== 'function') {
    console.error(`❌ onLog is not a function in processFileAsPhp`);
    return;
  }
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for processFileAsPhp');
  }
  const { MAX_CONCURRENCY } = params;
  if (!Number.isInteger(MAX_CONCURRENCY)) {
    throw new Error('Invalid params: MAX_CONCURRENCY is required');
  }

  const fullPath = path.join(inputDir, filename);
  const langOutputDir = path.join(outputDir, langCode);
  const outPath = path.join(langOutputDir, filename);

  try {
    if (cancelTranslation) throw new Error('Translation cancelled');
    const data = loadPhpFile(fullPath);
    if (data === null) {
      onLog(`❌ Failed to load PHP file: ${filename}`);
      return;
    }
    onLog(`✅ Successfully read ${filename}`);

    const translated = {};
    const missing = {};
    const queue = [];

    let existingTranslations = {};
    if (fs.existsSync(outPath)) {
      existingTranslations = loadPhpFile(outPath) || {};
    }

    const toTranslate = {};
    for (const [key, value] of Object.entries(data)) {
      if (!existingTranslations[key]) {
        onLog(chalk.green(`🌍 Translating new string: ${key}`));
        toTranslate[key] = value;
      } else {
        const originalLen = value.length;
        const translatedLen = existingTranslations[key].length;
        const ratio = (translatedLen / originalLen) * 100;
        if (ratio < 40) {
          onLog(chalk.green(`🌍 Retranslating string: ${key} (length ratio: ${ratio.toFixed(2)}%)`));
          toTranslate[key] = value;
        } else {
          onLog(chalk.yellow(`ℹ️ Skipping string: ${key} (length ratio: ${ratio.toFixed(2)}%)`));
          translated[key] = existingTranslations[key];
        }
      }
    }

    const batches = batchStrings(toTranslate, params);
    for (const batchObj of batches) {
      queue.push(async () => {
        onLog(chalk.green(`🔤 Translating batch: ${Object.keys(batchObj).join(', ')} for language: ${langCode}`));
        const result = await translateBatch(batchObj, languageName, params);
        return { batchObj, result };
      });
    }

    const runners = new Set();
    while (queue.length > 0 || runners.size > 0) {
      if (cancelTranslation) throw new Error('Translation cancelled');
      while (runners.size < MAX_CONCURRENCY && queue.length > 0) {
        const job = queue.shift();
        const runner = job()
          .then(({ batchObj, result }) => {
            const translations = result.translations || result;
            for (const [key, original] of Object.entries(batchObj)) {
              if (!(key in translations) || !translations[key]) {
                onLog(chalk.red(`⚠️ Missing translation for: ${key} in language: ${langCode}`));
                missing[key] = original;
              } else {
                translated[key] = translations[key];
              }
            }
          })
          .catch(err => {
            onLog(chalk.red(`❌ Error processing batch for ${filename}: ${err.message}`));
          })
          .finally(() => {
            runners.delete(runner);
          });
        runners.add(runner);
      }
      if (runners.size > 0) {
        await Promise.race(runners);
      }
    }

    const outputDirName = path.dirname(outPath);
    if (!fs.existsSync(outputDirName)) {
      fs.mkdirSync(outputDirName, { recursive: true });
    }
    saveToPhpFile(outPath, translated);
    onLog(chalk.blue(`✅ Done: ${filename} for language: ${langCode}`));
  } catch (err) {
    onLog(chalk.red(`❌ Failed to process PHP file: ${filename} - ${err.message}`));
  }
}

function collectTranslatableStrings(obj, prefix = '') {
  const strings = {};
  for (const [key, value] of Object.entries(obj)) {
    const currentKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      strings[currentKey] = value;
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(strings, collectTranslatableStrings(value, currentKey));
    }
  }
  return strings;
}

async function processFileAsJson(filename, onLog, langCode, languageName, params) {
  if (typeof onLog !== 'function') {
    console.error(`❌ onLog is not a function in processFileAsJson`);
    return;
  }
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for processFileAsJson');
  }
  const { MAX_BATCH_CHAR_LIMIT } = params;
  if (!Number.isInteger(MAX_BATCH_CHAR_LIMIT)) {
    throw new Error('Invalid params: MAX_BATCH_CHAR_LIMIT is required');
  }

  const fullPath = path.join(inputDir, filename);
  const langOutputDir = path.join(outputDir, langCode);
  const outPath = path.join(langOutputDir, filename);

  try {
    if (cancelTranslation) throw new Error('Translation cancelled');
    const content = fs.readFileSync(fullPath, 'utf-8');
    const data = JSON.parse(content);
    onLog(chalk.green(`✅ Successfully read ${filename}`));

    let existingTranslations = {};
    if (fs.existsSync(outPath)) {
      try {
        existingTranslations = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
        onLog(chalk.blue(`ℹ️ Loaded existing translations for ${filename}`));
      } catch (err) {
        onLog(chalk.yellow(`⚠️ Failed to load existing translations for ${filename}: ${err.message}`));
      }
    }
    const existingStrings = collectTranslatableStrings(existingTranslations);

    const translated = JSON.parse(JSON.stringify(data));
    const missing = {};
    const toTranslate = {};

    const stringsToTranslate = collectTranslatableStrings(data);
    for (const [key, value] of Object.entries(stringsToTranslate)) {
      if (!existingStrings[key]) {
        onLog(chalk.green(`🌍 Translating new string: ${key}`));
        toTranslate[key] = value;
      } else {
        const originalLen = value.length;
        const translatedLen = existingStrings[key].length;
        const ratio = (translatedLen / originalLen) * 100;
        if (ratio < 40) {
          onLog(chalk.green(`🌍 Retranslating string: ${key} (length ratio: ${ratio.toFixed(2)}%)`));
          toTranslate[key] = value;
        } else {
          onLog(chalk.yellow(`ℹ️ Skipping string: ${key} (length ratio: ${ratio.toFixed(2)}%)`));
        }
      }
    }

    const batches = batchStrings(toTranslate, params);
    for (const batchObj of batches) {
      if (cancelTranslation) throw new Error('Translation cancelled');
      onLog(chalk.green(`🔤 Translating batch: ${Object.keys(batchObj).join(', ')} for language: ${langCode}`));
      const result = await translateBatch(batchObj, languageName, params);
      for (const [key, original] of Object.entries(batchObj)) {
        if (!(key in result) || !result[key]) {
          onLog(chalk.red(`⚠️ Missing translation for: ${key} in language: ${langCode}`));
          missing[key] = original;
        } else {
          setNestedValue(translated, key, result[key]);
        }
      }
    }

    const outputDirName = path.dirname(outPath);
    if (!fs.existsSync(outputDirName)) {
      fs.mkdirSync(outputDirName, { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(translated, null, 2), 'utf-8');
    onLog(chalk.blue(`✅ Done: ${filename} for language: ${langCode}`));
  } catch (err) {
    onLog(chalk.red(`❌ Failed to process JSON file: ${filename} - ${err.message}`));
  }
}

function setNestedValue(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]] = current[keys[i]] || {};
  }
  current[keys[keys.length - 1]] = value;
}

function getAllFiles(dir, relativePath = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, relative));
    } else if (entry.isFile()) {
      results.push(relative);
    }
  }

  return results;
}

async function processFileAsText(filename, onLog, langCode, languageName, params) {
  if (typeof onLog !== 'function') {
    console.error(`❌ onLog is not a function in processFileAsText`);
    return;
  }
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for processFileAsText');
  }
  const { RETRY_DELAY, KEYS, activeModel } = params;
  if (
    !Number.isInteger(RETRY_DELAY) ||
    !(Array.isArray(KEYS) || typeof KEYS === 'string') ||
    typeof activeModel !== 'string'
  ) {
    throw new Error('Invalid params: RETRY_DELAY, KEYS, and activeModel are required');
  }

  const fullInputPath = path.join(inputDir, filename);
  const langOutputDir = path.join(outputDir, langCode);
  const fullOutputPath = path.join(langOutputDir, filename);

  try {
    if (cancelTranslation) throw new Error('Translation cancelled');
    const content = fs.readFileSync(fullInputPath, 'utf-8');
    onLog(`🌍 Translating text file: ${filename} to ${languageName}`);
    const translatedContent = await translateText(content, languageName, params);

    onLog(`📝 Translated content preview: ${translatedContent.slice(0, 100)}${translatedContent.length > 100 ? '...' : ''}`);

    const outputDirName = path.dirname(fullOutputPath);
    if (!fs.existsSync(outputDirName)) {
      fs.mkdirSync(outputDirName, { recursive: true });
    }
    fs.writeFileSync(fullOutputPath, translatedContent, 'utf-8');
    onLog(`✅ Done: ${filename} for language: ${langCode}`);
  } catch (err) {
    onLog(`❌ Failed to process text file: ${filename} - ${err.message}`);
  }
}

function getLanguageName(langCode) {
  return languageNames[langCode] || langCode;
}

async function runTranslation(lang, fileType, params, onLog) {
  if (typeof onLog !== 'function') {
    console.error(`❌ onLog is not a function in runTranslation`);
    return;
  }
  if (!params || typeof params !== 'object') {
    throw new Error('Params object is required for runTranslation');
  }
  const { MAX_CONCURRENCY, MAX_BATCH_CHAR_LIMIT, RETRY_DELAY, MAX_ERRORS, KEYS, activeModel } = params;
  if (
    !Number.isInteger(MAX_CONCURRENCY) ||
    !Number.isInteger(MAX_BATCH_CHAR_LIMIT) ||
    !Number.isInteger(RETRY_DELAY) ||
    !Number.isInteger(MAX_ERRORS) ||
    !(Array.isArray(KEYS) || typeof KEYS === 'string') ||
    typeof activeModel !== 'string'
  ) {
    throw new Error('Invalid params: MAX_CONCURRENCY, MAX_BATCH_CHAR_LIMIT, RETRY_DELAY, MAX_ERRORS, KEYS, and activeModel are required');
  }

  console.log('runTranslation called with:', { lang, fileType, params, onLog: typeof onLog });
  cancelTranslation = false;
  const languages = lang.split(',').map(code => code.trim().toLowerCase());
  const files = getAllFiles(inputDir);

  for (const langCode of languages) {
    if (cancelTranslation) {
      onLog('🛑 Translation cancelled');
      break;
    }
    const languageName = getLanguageName(langCode);
    onLog(`🌐 Starting translation for language: ${langCode} (${languageName})`);
    for (const file of files) {
      if (cancelTranslation) {
        onLog('🛑 Translation cancelled');
        break;
      }
      onLog(`📄 Processing file: ${file} as ${fileType} for language: ${langCode}`);
      if (fileType === 'php') {
        await processFileAsPhp(file, onLog, langCode, languageName, params);
      } else if (fileType === 'json') {
        await processFileAsJson(file, onLog, langCode, languageName, params);
      } else if (fileType === 'files') {
        await processFileAsText(file, onLog, langCode, languageName, params);
      } else {
        onLog('Invalid fileType');
        return;
      }
    }
    if (!cancelTranslation) {
      onLog(`🌐 Finished translation for language: ${langCode}`);
    }
  }
}

module.exports = {
  runTranslation
};