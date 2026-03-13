/**
 * Local API: 7-turn story engine (1 opening + 6 choice turns; turn 7 = final summary).
 * - /generate (prompt: start) -> init state, build opening prompt, call Ollama, return { narrative, options }
 * - /turn -> update state, build turn prompt, call Ollama, return { narrative, options [, finalSummary ] }
 *
 * Run: node server/index.js   or   npm run server
 * Default port: 3001
 */

import http from 'http'
const OLLAMA_URL = 'http://Cals-Macbook-Pro.local:11434/api/generate'
const DEFAULT_OLLAMA_MODEL = 'llam3dot-8b-storyengine'
const PORT = 3001
const TOTAL_TURNS = 7
const MAX_NARRATIVE_WORDS = 80
const MAX_OPTION_WORDS = 15

const DEFAULT_STARTER_TEXT = 'Jimmy has an essay due in 24 hours and is conflicted about whether to use AI.'

const DIALOGUE_REMINDER = `IMPORTANT: The story must be ENTIRELY DIALOGUE—no narration or description. Use very simple words, short sentences, for children with lower literacy. Every line must be from exactly one speaker: Jimmy, Priya, or Prof Kim. Format each line as: SPEAKER: what they say (e.g. JIMMY: Hi! or PRIYA: Let's use AI.).`

// Editable prompt templates – tweak these to change LLM behaviour without touching logic.
function buildOpeningPrompt(name, starterText) {
  const friendName = name === 'Jimmy' ? 'Priya' : 'Jimmy'
  return `You are writing the opening scene (turn 1 of ${TOTAL_TURNS}) of an interactive story for children. Use simple words and short sentences.

${DIALOGUE_REMINDER}

SETUP: ${name} is the protagonist. ${friendName} is their friend. Phase 1: 24 hours before the essay deadline. ${friendName} is tempting ${name} to use AI. Story context: "${starterText}"

Write ONLY dialogue. Each line must be: JIMMY: ... or PRIYA: ... (no other speakers in this scene). One line per speech. Then a blank line, then the three choices the protagonist could say next:
A: [one short line of dialogue, pro-AI]
B: [one short line of dialogue, anti-AI]
C: [one short line of dialogue, funny or silly, different from A and B]
Maximum ${MAX_OPTION_WORDS} words per option. Output format: dialogue lines, then blank line, then A: ... B: ... C: ...`
}

function buildTurnPromptTemplate(turn, phase, choice, state, phaseContext, d) {
  const friendName = state.name === 'Jimmy' ? 'Priya' : 'Jimmy'
  let sceneNote = ''
  if (phase === 3) {
    sceneNote = `This is the final scene: only ${state.name} and Professor Kim. No ${friendName}.`
  } else {
    sceneNote = `In this scene the characters are ${state.name} (protagonist) and ${friendName} (friend).`
  }
  return `Story so far:
${state.storySummary}

---
Turn ${turn} of ${TOTAL_TURNS}. Phase ${phase}. ${sceneNote}
Context: ${phaseContext}

Player just chose ${choice} (${choice === 'A' ? 'pro-AI' : choice === 'B' ? 'anti-AI' : 'funny/silly'}).
Choice counts: A=${state.choiceCounts.A}, B=${state.choiceCounts.B}, C=${state.choiceCounts.C}.

${DIALOGUE_REMINDER}

Write ONLY dialogue in reply to that choice. Use format: JIMMY: ... or PRIYA: ... or PROF KIM: ... (only these three names). One line per speech. Then a blank line, then the next three options (lines the protagonist could say):
A: [short dialogue line, pro-AI]
B: [short dialogue line, anti-AI]
C: [short dialogue line, funny/silly]
Max ${MAX_OPTION_WORDS} words per option.`
}

function buildFinalSummaryPromptTemplate(state) {
  const a = state.choiceCounts.A || 0
  const b = state.choiceCounts.B || 0
  const c = state.choiceCounts.C || 0
  const kimMood = state.decisions.phase3ProfessorProud ? 'proud' : 'scolding'
  const name = state.name || 'the player'
  return `You are Professor Kim giving brief feedback to ${name} after their essay quest.

Choice counts: Pro-AI (A)=${a}, Anti-AI (B)=${b}, Silly (C)=${c}. Professor Kim is ${kimMood}.

Output exactly ONE line in this format:
PROF KIM: "your feedback here"

Rules:
- Write in second person ("you"). Address the player directly.
- One short sentence only (max 15 words). Simple words for children.
- Congratulate or gently reflect on what they did. No story recap, no A/B/C options.`
}

// Single-session game state
let gameState = null

function resetState(body = {}) {
  const name = body.name || 'Jimmy'
  const starterText = body.starterText || DEFAULT_STARTER_TEXT
  gameState = {
    turn: 0,
    phase: 1,
    choiceCounts: { A: 0, B: 0, C: 0 },
    storySummary: '',
    decisions: {
      phase1UsedAI: null,
      phase2UsedAICheck: null,
      phase3ProfessorProud: null,
    },
    name,
    starterText,
  }
  return gameState
}

function getPhaseFromTurn(turn) {
  if (turn <= 2) return 1
  if (turn <= 4) return 2
  if (turn <= 6) return 3
  return 3 // turn 7 = finale (phase 3)
}

function getPhaseContext(turn, phase, decisions) {
  if (phase === 1) return '24 hours before the essay deadline. Protagonist is with a friend, discussing whether to use AI; the friend tempts them. Options: A = pro-AI, B = anti-AI, C = funny/silly.'
  if (phase === 2) {
    const usedAI = decisions.phase1UsedAI
    const mood = usedAI ? "well-rested, smug, 'work smart not hard'" : 'exhausted but proud of their own work'
    return `Next day, less than 2 hours to deadline. Protagonist is ${mood}. Conflict: whether to use AI to check over the essay or not. Options: A = pro-AI check, B = anti-AI, C = funny/silly.`
  }
  const proud = decisions.phase3ProfessorProud !== false
  return `Two weeks later. Essay graded. Conversation with Professor Kim. ${proud ? 'Kim is proud of not using AI.' : 'Kim scolds for using AI, being lazy, learning nothing.'} Options: A, B, C as before.`
}

function truncateToWords(text, maxWords) {
  if (!text || typeof text !== 'string') return ''
  const words = text.trim().split(/\s+/).filter(Boolean)
  return words.slice(0, maxWords).join(' ')
}

/** Parse "SPEAKER: text" lines into dialogue array. Normalizes speaker to Jimmy | Priya | Professor Kim. */
function parseDialogueFromText(rawText) {
  const dialogue = []
  if (!rawText || typeof rawText !== 'string') return dialogue
  const lines = rawText.split(/\n/).map((l) => l.trim())
  const speakerRegex = /^(JIMMY|PRIYA|PROF KIM|Jimmy|Priya|Prof Kim):\s*(.*)$/i
  for (const line of lines) {
    const m = line.match(speakerRegex)
    if (m) {
      const name = m[1].toLowerCase()
      const normalized = name.startsWith('jimmy') ? 'Jimmy' : name.startsWith('priya') ? 'Priya' : 'Prof Kim'
      const text = m[2].trim()
      if (text) dialogue.push({ speaker: normalized, text: truncateToWords(text, MAX_NARRATIVE_WORDS) || text })
    }
  }
  return dialogue
}

/** Parse LLM raw text into { narrative, options, dialogue }. Options are protagonist dialogue lines. */
function parseStructuredResponse(rawText) {
  const fallbackOptions = { A: 'Use AI', B: 'Do it yourself', C: 'Something silly' }
  if (!rawText || typeof rawText !== 'string') {
    return { narrative: '', options: fallbackOptions, dialogue: [] }
  }
  const lines = rawText.split(/\n/).map((l) => l.trim())
  const optionRegex = /^([ABC]):\s*(.*)$/i
  let narrativeParts = []
  const options = { A: '', B: '', C: '' }
  let foundBlank = false
  for (const line of lines) {
    const match = line.match(optionRegex)
    if (match) {
      foundBlank = true
      const key = match[1].toUpperCase()
      options[key] = truncateToWords(match[2].trim(), MAX_OPTION_WORDS) || fallbackOptions[key]
    } else if (!foundBlank) {
      if (line) narrativeParts.push(line)
    }
  }
  const narrative = truncateToWords(narrativeParts.join(' '), MAX_NARRATIVE_WORDS)
  const dialogue = parseDialogueFromText(rawText)
  return {
    narrative,
    options: {
      A: options.A || fallbackOptions.A,
      B: options.B || fallbackOptions.B,
      C: options.C || fallbackOptions.C,
    },
    dialogue: dialogue.length > 0 ? dialogue : [{ speaker: 'Jimmy', text: narrative || '...' }],
  }
}

async function callOllama(promptText) {
  console.log('[callOllama] Sending request to', OLLAMA_URL)
  const res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_OLLAMA_MODEL,
      stream: false,
      prompt: promptText,
    }),
  })
  if (res.status >= 400) {
    console.warn('[callOllama] Cals-Macbook returned', res.status, OLLAMA_URL)
  }
  const data = await res.json()
  const text = (data && data.response) ? String(data.response) : ''
  console.log('[callOllama] Response from Cals-Macbook: response length=', text.length, 'done=', data?.done ?? '')
  return { data, text }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (ch) => { data += ch })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

async function handleGenerate(req, res) {
  console.log('[handleGenerate] POST /generate received')
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  let body
  try {
    body = await readJson(req)
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }
  console.log('[handleGenerate] body:', JSON.stringify(body, null, 2))

  if (body.prompt !== 'start') {
    sendJson(res, 400, { error: 'Expected prompt: "start" with name and starterText' })
    return
  }

  resetState(body)
  const { name, starterText } = gameState
  console.log('[handleGenerate] state reset: name=', name, 'starterText=', starterText)

  const fullPrompt = buildOpeningPrompt(name, starterText)

  console.log('[handleGenerate] calling Ollama with opening prompt (length=', fullPrompt.length, ')')
  try {
    const { text } = await callOllama(fullPrompt)
    console.log('[handleGenerate] Ollama response text length:', text?.length ?? 0)
    gameState.storySummary = text
    gameState.turn = 1
    const structured = parseStructuredResponse(text)
    sendJson(res, 200, structured)
  } catch (err) {
    console.error('[handleGenerate]', err.message)
    sendJson(res, 502, { error: 'Proxy error', message: err.message })
  }
}

async function handleTurn(req, res) {
  console.log('[handleTurn] POST /turn received')
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  let body
  try {
    body = await readJson(req)
  } catch (e) {
    sendJson(res, 400, { error: 'Invalid JSON body' })
    return
  }
  console.log('[handleTurn] body:', JSON.stringify({ ...body, paragraph: body.paragraph != null ? `(${String(body.paragraph).length} chars)` : undefined }, null, 2))

  const choice = body.choice && ['A', 'B', 'C'].includes(String(body.choice).toUpperCase()) ? String(body.choice).toUpperCase() : null
  const paragraph = body.paragraph != null ? String(body.paragraph) : (body.narrative != null ? String(body.narrative) : '')

  if (!choice) {
    sendJson(res, 400, { error: 'Missing or invalid choice (A, B, or C)' })
    return
  }

  if (!gameState) {
    sendJson(res, 400, { error: 'No game in progress. Call /generate with prompt: start first.' })
    return
  }

  if (gameState.turn >= 7) {
    sendJson(res, 400, { error: 'Six choice turns completed. Call POST /summary for the final summary.' })
    return
  }

  const state = gameState
  state.choiceCounts[choice] = (state.choiceCounts[choice] || 0) + 1
  state.turn += 1
  const turn = state.turn
  const phase = getPhaseFromTurn(turn)

  if (paragraph) {
    state.storySummary = state.storySummary ? state.storySummary + '\n\n' + paragraph : paragraph
  }

  if (turn === 2) {
    state.decisions.phase1UsedAI = state.choiceCounts.A > state.choiceCounts.B
  }
  if (turn === 4) {
    state.decisions.phase2UsedAICheck = state.choiceCounts.A > state.choiceCounts.B
  }
  if (turn === 6) {
    state.decisions.phase3ProfessorProud = !state.decisions.phase1UsedAI && !state.decisions.phase2UsedAICheck
  }
  console.log('[handleTurn] turn=', turn, 'phase=', phase, 'choiceCounts=', state.choiceCounts, 'decisions=', state.decisions)

  if (turn === 7) {
    const a = state.choiceCounts.A || 0
    const b = state.choiceCounts.B || 0
    const c = state.choiceCounts.C || 0
    const total = a + b + c
    const aiUsageScore = total > 0 ? Math.round((a / total) * 100) : 0
    let phrase
    if (aiUsageScore <= 25) phrase = 'Well done, strong independent human!'
    else if (aiUsageScore <= 50) phrase = 'Good job, you showed a good balance between independence and using AI!'
    else if (aiUsageScore <= 75) phrase = 'Nice try, you used some of your brain, but relied heavily on AI!'
    else phrase = "Are you sure you're not an AI?"
    sendJson(res, 200, {
      narrative: '',
      options: {},
      finalSummary: true,
      dialogue: [{ speaker: 'Prof Kim', text: phrase }],
      aiUsageScore
    })
    return
  }

  const phaseContext = getPhaseContext(turn, phase, state.decisions)
  const d = state.decisions

  const turnPrompt = buildTurnPromptTemplate(turn, phase, choice, state, phaseContext, d)

  console.log('[handleTurn] calling Ollama for turn', turn, '(prompt length=', turnPrompt.length, ')')
  try {
    const { text } = await callOllama(turnPrompt)
    console.log('[handleTurn] Ollama response text length:', text?.length ?? 0)
    state.storySummary = state.storySummary ? state.storySummary + '\n\n' + text : text
    const structured = parseStructuredResponse(text)
    sendJson(res, 200, structured)
  } catch (err) {
    console.error('[handleTurn]', err.message)
    sendJson(res, 502, { error: 'Proxy error', message: err.message })
  }
}


async function handleSummary(req, res) {
  console.log('[handleSummary] POST /summary received')
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method not allowed' })
    return
  }
  if (!gameState) {
    sendJson(res, 400, { error: 'No game in progress. Call /generate with prompt: start first.' })
    return
  }
  if (gameState.turn !== 7) {
    sendJson(res, 400, {
      error: `Final summary only after 6 choice turns. Current turn: ${gameState.turn}. Make 6 choices via POST /turn first.`,
    })
    return
  }
  const state = gameState
  const promptText = buildFinalSummaryPromptTemplate(state)
  console.log('[handleSummary] calling Ollama for final summary (prompt length=', promptText.length, ')')
  try {
    const { text } = await callOllama(promptText)
    state.storySummary = state.storySummary ? state.storySummary + '\n\n' + text : text
    state.turn = 7
    const structured = parseStructuredResponse(text)
    structured.finalSummary = true
    structured.options = {}
    if (!structured.dialogue || !Array.isArray(structured.dialogue)) structured.dialogue = []
    structured.narrative = ''
    sendJson(res, 200, structured)
  } catch (err) {
    console.error('[handleSummary]', err.message)
    sendJson(res, 502, { error: 'Proxy error', message: err.message })
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }

  const path = (req.url?.split('?')[0] || '/').replace(/\/$/, '') || '/'
  if (path === '/turn') {
    await handleTurn(req, res)
    return
  }
  if (path === '/summary') {
    await handleSummary(req, res)
    return
  }
  if (path === '/api/generate' || path === '/generate') {
    await handleGenerate(req, res)
    return
  }

  console.warn('[404] No route for', req.method, req.url)
  sendJson(res, 404, { error: 'Not found', path })
})

server.listen(PORT, () => {
  console.log(`Story engine listening on http://localhost:${PORT}`)
  console.log(`  POST /generate -> start game, then Ollama`)
  console.log(`  POST /turn     -> choice A/B/C, then Ollama`)
})
