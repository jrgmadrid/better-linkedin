// Copy to config.local.js (gitignored) and fill in your key. Loaded by the
// slop-judge service worker via importScripts('config.local.js'); without it
// the judge tier stays off and the heuristic scorer runs alone.
const DEEPSEEK_API_KEY = 'sk-REPLACE_ME';
const DEEPSEEK_MODEL = 'deepseek-v4-flash';
// Any OpenAI-compatible /chat/completions endpoint works here.
const API_BASE = 'https://api.deepseek.com';
