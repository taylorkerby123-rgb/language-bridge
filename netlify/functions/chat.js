// Netlify function: proxies Language Bridge conversation practice to the Anthropic API.
// The API key lives only in the Netlify environment variable "Samson".
// Prompts are built here on the server, so the endpoint can only be used as a language tutor.

const MODEL = 'claude-haiku-4-5-20251001'; // change to 'claude-sonnet-5' for a more capable tutor

const TOPIC_LABELS = {
  es: { general:'General', cafe:'Café', viajes:'Viajes', salud:'Consulta médica', trabajo:'Trabajo', compras:'De compras' },
  zh: { general:'General', cafe:'Café', viajes:'Travel', salud:"Doctor's visit", trabajo:'Work', compras:'Shopping' }
};

const LEVEL_GUIDANCE = {
  es:{
    A2:"Level A2 (CEFR): common everyday vocabulary, simple sentences and a few short compound ones, basic tenses (present, preterite, imperfect). Avoid the subjunctive and complex structures. Keep sentences short and clear.",
    B1:"Level B1 (CEFR): a wider range of tenses (future, conditional, basic subjunctive in frequent expressions), more varied connectors (aunque, mientras, ya que, sin embargo), and somewhat more complex sentences, but keep vocabulary accessible and avoid very idiomatic or literary language.",
    B2:"Level B2 (CEFR): confident use of most tenses including subjunctive across clause types (deseos, dudas, hipótesis), passive and impersonal constructions, more idiomatic connectors and nuanced vocabulary. Sentences can be longer and more complex, but avoid highly literary or heavily regional slang."
  },
  zh:{
    HSK2:"HSK 2 level: a roughly 300-word vocabulary, very short and simple sentences, only the most basic grammar (的, 了, simple time expressions, basic yes/no and question-word questions). Keep it extremely simple, slow-paced, and forgiving.",
    HSK3:"HSK 3 level: use the ~600 HSK 1-3 vocabulary set, simple and compound sentences, common grammar patterns (了, 过, 要, 会, 因为...所以..., comparison with 比). Avoid advanced grammar patterns.",
    HSK4:"HSK 4 level: HSK 4 vocabulary is fine, including patterns like 按照, 值得+verb, 尽管...还是..., 既...又..., 只有...才..., 不但...而且..., 连...都.... The student is bridging from HSK 3 to HSK 4, still shaky on conjunction patterns, subtle vocabulary distinctions (说/告诉/讲, 戴/带/穿, 遇到/见面), and careful detail reading. Naturally work opportunities to use these patterns into the conversation.",
    HSK5:"HSK 5 level: a roughly 2500-word vocabulary, more abstract topics, some idiomatic expressions (成语, used sparingly), and more complex sentence structures (被动句, 把字句, combined clauses). Keep a natural, near-native pace while staying supportive of a learner."
  }
};

function buildChatRules(track, level, topicId){
  const topicLabel = (TOPIC_LABELS[track] && TOPIC_LABELS[track][topicId]) || 'General';
  const langName = track==='zh' ? 'Mandarin Chinese' : 'Spanish';
  const guidance = (LEVEL_GUIDANCE[track] && LEVEL_GUIDANCE[track][level]) || '';
  const correctionSpec = track==='zh'
    ? 'Write the correction as: the corrected Chinese, its pinyin in parentheses, then a one-line English explanation. Example: "连你都不知道吗？(lián nǐ dōu bù zhīdào ma?) — 连...都... needs 都 after the noun, not before."'
    : 'Write the correction in simple Spanish, or brief Spanish plus a short English aside, citing the phrase with the error, the correct form, and a one-line reason.';
  return `You are a conversation partner for a student studying ${langName}, currently at level ${level}. Your only job is to hold a natural conversation in ${langName} and, when needed, correct gently.

${guidance}

Conversation topic: ${topicLabel}. Stay within this topic, but naturally — ask genuine follow-up questions.

Rules:
- Always reply in ${langName}, never in English, in the "reply" field.
- Be warm, curious, and natural, like a real person chatting, not a teacher giving a lesson.
- Keep your turns short: two or three sentences at most, plus a follow-up question when it makes sense.
- Review the student's last message. If it has grammar, conjugation, agreement, or spelling errors worth flagging for their level, write a short, kind correction in the "correction" field. ${correctionSpec} If there's nothing worth flagging, or this is the first message of the conversation, set "correction" to null.
- Don't nitpick trivial accent-mark slips if the rest of the message is clearly understood; focus on errors an examiner would actually flag.

Reply with ONLY a valid JSON object, no text outside the JSON, no code fences, in exactly this shape:
{"reply": "your reply in the target language", "correction": "short correction or null"}`;
}

function buildDefineRules(track, word, sentence){
  if(track==='zh'){
    return `You are a compact Mandarin Chinese dictionary. Given a character or word and the sentence it appeared in, return ONLY a valid JSON object, no text outside it, no code fences, in exactly this shape:
{"translation": "short English meaning", "reading": "pinyin with tone marks", "note": "one short line on nuance or usage in this sentence, in English"}

Character/word: ${word}
Sentence: ${sentence}`;
  }
  return `You are a compact Spanish dictionary. Given a word and the sentence it appeared in, return ONLY a valid JSON object, no text outside it, no code fences, in exactly this shape:
{"translation": "short English meaning", "reading": null, "note": "one short line on nuance or usage in this sentence, in English (e.g. verb tense, false-friend warning, regional note)"}

Word: ${word}
Sentence: ${sentence}`;
}


const HEADERS = { 'Content-Type': 'application/json' };
const reply = (status, obj) => ({ statusCode: status, headers: HEADERS, body: JSON.stringify(obj) });

function parseModelJson(text){
  const clean = String(text || '').replace(/```json|```/g, '').trim();
  const start = clean.indexOf('{'), end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no_json');
  return JSON.parse(clean.slice(start, end + 1));
}

async function callClaude(system, messages, maxTokens){
  const key = process.env.Samson;
  if (!key) { const e = new Error('missing_key'); e.status = 500; throw e; }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('Anthropic API error', res.status, detail.slice(0, 500));
    const e = new Error('api_error'); e.status = res.status; throw e;
  }
  const data = await res.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'method_not_allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'bad_json' }); }
  const track = body.track === 'zh' ? 'zh' : 'es';
  try {
    if (body.kind === 'define') {
      const word = String(body.word || '').slice(0, 40);
      const sentence = String(body.sentence || '').slice(0, 600);
      if (!word) return reply(400, { error: 'missing_word' });
      const text = await callClaude('Return only valid JSON.', [{ role: 'user', content: buildDefineRules(track, word, sentence) }], 300);
      return reply(200, parseModelJson(text));
    }
    const level = String(body.level || '');
    const topic = String(body.topic || 'general');
    const raw = Array.isArray(body.messages) ? body.messages.slice(-30) : [];
    const convo = raw
      .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
      .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 1500) }))
      .filter(m => m.content);
    if (!convo.length || convo[convo.length - 1].role !== 'user') return reply(400, { error: 'bad_messages' });
    const messages = convo[0].role === 'assistant' ? [{ role: 'user', content: '(conversation starts)' }, ...convo] : convo;
    const text = await callClaude(buildChatRules(track, level, topic), messages, 600);
    return reply(200, parseModelJson(text));
  } catch (err) {
    if (err.status === 429) return reply(429, { error: 'rate_limited' });
    if (err.message === 'missing_key') return reply(500, { error: 'missing_key' });
    return reply(502, { error: 'upstream_error' });
  }
};
