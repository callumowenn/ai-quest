/**
 * Local API: 7-turn story engine. Turn 1 = opening (Phase 1); turns 2–6 = choice responses (phase 1,2,2,3,3); turn 7 = final summary.
 * - /generate (prompt: start) -> init state, build turn 1 prompt, call Ollama, return { narrative, options }
 * - /turn -> update state, build turn N prompt (N=2..6), call Ollama, return { narrative, options [, finalSummary ] }
 *
 * Run: node server/index.js   or   npm run server
 * Default port: 3001
 */

import http from 'http'
const OLLAMA_URL = 'http://Cals-Macbook-Pro.local:11434/api/generate'
const DEFAULT_OLLAMA_MODEL = 'llam3dot-8b-storyengine'
const PORT = 3001
const TOTAL_TURNS = 6
const MAX_NARRATIVE_WORDS = 80
const MAX_OPTION_WORDS = 8
const MAX_DIALOGUE_LINES = 5
const LAST_EXCHANGE_MAX_WORDS = 50

const DEFAULT_STARTER_TEXT = 'Jimmy has an essay due in 24 hours and is conflicted about whether to use AI.'

const DIALOGUE_REMINDER = `IMPORTANT: The story must be ENTIRELY DIALOGUE—no narration or description. Use very simple words, short sentences, for children with lower literacy, but keep it light and engaging. Every line must be from exactly one speaker: Jimmy, Priya, or Prof Kim. Format each line as: SPEAKER: what they say (e.g. JIMMY: Hi! or PRIYA: Let's use AI.). Maximum ${MAX_DIALOGUE_LINES} lines of dialogue before (ESSENTIAL) finishing with A, B, C options.`

// ========== Prompt outline – edit these to control each turn ==========
const PROMPT_OUTLINES = {
  /** Character traits – included so the LLM keeps voices consistent. */
  characterContext: {
    friend: 'The friend is pro-AI and tempts the protagonist to use it.',
    profKim: 'Professor Kim encourages thinking critically and values independent work.',
  },
  // turn1 = opening (Phase 1). turn2 = 1st choice response (Phase 1). turn3 = 2nd choice (Phase 2). turn4 = 3rd choice (Phase 2). turn5 = 4th choice (Phase 3). turn6 = 5th choice (Phase 3).
  turn1: {
    scene: `Turn 1, Phase 1. Daytime, 24 hours before the essay deadline. Protagonist and friend only.`,
    task: (name, friendName) => `Opening dialogue. ${friendName} tempts ${name} to use AI for the essay, even though it is not recommended. ${name} is considering it. They have a brief conversation (3 or 4 dialogue lines, must end with a question or statement from ${friendName}). Then you must return three concise dialogue choices A, B, or C for ${name} to say in coversation next.`,
    outputFormat: `Write ONLY dialogue. Maximum ${MAX_DIALOGUE_LINES} lines. JIMMY: ... or PRIYA: ... only. One line per speech. Then blank line, then (THIS IS ESSENTIAL) the three options A: ... B: ... C: ... for next dialogue.`,
  },
  turn2: {
    scene: 'Turn 2, Phase 1. 24h to deadline. Protagonist must decide whether to use AI for the essay from one of the three options (A, B, C).',
    task: ({ name, friendName }) =>
      `continuing the conversation, ${friendName} replies to ${name}, and they have a brief conversation (3 or 4 dialogue lines). Then it MUST offer a critical decision (action, not dialogue) for ${name} to make: A: Generate the essay with AI, B: Write the essay without AI, C: Do something silly and unrelated to the essay.`,
    outputFormat: `Use format JIMMY: ... or PRIYA: ... only. One line per speech. Then blank line, then, essentially, A: ... B: ... C: ... Keep each option to a few words (max ${MAX_OPTION_WORDS}).`,
  },
  turn3: {
    scene: 'Turn 3, Phase 2. New scene. Deadline day, more urgent, now only 2 hours until deadline. Protagonist and friend are discussing whether the protagonist should use AI for one final check of the essay.',
    task: ({ name, friendName, decisions }) =>
      `Hectic conversation (3 or 4 dialogue lines) between ${name} and ${friendName} as deadline approaches. ${decisions.phase1UsedAI ? `${name} used AI for the essay, and is feeling smug and well-rested.` : `${name} did not not use AI for the essay, so is feeling tired but proud.`} Then offer three thoughtful dialogue choices:  A (AI-positive), B (AI-negative), or C (silly, unrelated) for ${name} to say in coversation.`,
    outputFormat: `Use format JIMMY: ... or PRIYA: ... only. One line per speech. Then blank line, then A: ... B: ... C: ... Keep each option to a few words (max ${MAX_OPTION_WORDS}).`,
  },
  turn4: {
    scene: 'Turn 4, Phase 2. Deadline day, urgent, now only 2 hours to deadline. Protagonist and friend are discussing whether the protagonist should use AI for one final check of the essay.',
    task: ({ name, friendName }) =>
      `${friendName} replies to ${name}, continuing the hectic conversation about whether to use AI for a last-minute check of the essay (at most 5 dialogue lines). Then offer a critical decision (action, not dialogue) for ${name} to make: A: Use AI to check the essay, B: Check the essay without AI, C: Do something silly and unrelated to the essay.`,
    outputFormat: `Use format JIMMY: ... or PRIYA: ... only. One line per speech. Then blank line, then A: ... B: ... C: ... Keep each option to a few words (max ${MAX_OPTION_WORDS}).`,
  },
  turn5: {
    scene: 'Turn 5, Phase 3. Two weeks after deadline, essay graded, getting feedback from Professor Kim. Roughly 5 dialogue lines.',
    task: ({ name, decisions }) =>
      `${decisions.phase1UsedAI ? `${decisions.phase2UsedAICheck ? `${name} has used AI to write and check the essay - Professor Kim is very angry in conversation, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defends themself, B: doubts themself and apologises, C: laughs and jokes about it` : `${name} used AI to write the essay, but checked it manually - Professor Kim is suspicious and questions ${name}, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defends themself, B: doubts themself, apologises, C: laughs and jokes about it`}` : `${decisions.phase2UsedAICheck ? `${name} wrote the essay themself but checked the essay with AI - Professor Kim notices some strange content and questions ${name}, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defend themself, B: doubts themself, apologises, C: laughs and jokes about it` : `${name} wrote the essay themself and checked it manually - Professor Kim is proud and congratulates ${name}!, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: ponder whether AI might have helped, B: show pride, C: laughs and jokes about it`}`}`,
    outputFormat: `Use format JIMMY: ... or PROF KIM: ... only. One line per speech. Then blank line, then A: ... B: ... C: ... Keep each option to a few words (max ${MAX_OPTION_WORDS}).`,
  },
  turn6: {
    scene: 'Turn 6, Phase 3. Two weeks after deadline, essay graded, getting feedback from Professor Kim. At most 5 dialogue lines.',
    task: ({ name, decisions }) =>
      `${decisions.phase1UsedAI ? `${decisions.phase2UsedAICheck ? `${name} has used AI to write and check the essay - Professor Kim is very angry in conversation, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defends themself, B: doubts themself and apologises, C: laughs and jokes about it` : `${name} used AI to write the essay, but checked it manually - Professor Kim is suspicious and questions ${name}, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defends themself, B: doubts themself, apologises, C: laughs and jokes about it`}` : `${decisions.phase2UsedAICheck ? `${name} wrote the essay themself but checked the essay with AI - Professor Kim notices some strange content and questions ${name}, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: defend themself, B: doubts themself, apologises, C: laughs and jokes about it` : `${name} wrote the essay themself and checked it manually - Professor Kim is proud and congratulates ${name}!, around 5 dialogue lines. Then offer three dialogue choices for ${name}: A: ponder whether AI might have helped, B: show pride, C: laughs and jokes about it`}`}. Close the conversation between ${name} and Professor Kim with at most 5 dialogue lines. Then offer three reflective dialogue choices for ${name} to say in coversation: A: reflect on how good AI can be, B: reflect on how good it is to use your own brain, C: laughs and jokes about something random`,
    outputFormat: `Use format JIMMY: ... or PROF KIM: ... only. One line per speech. Then blank line, then A: ... B: ... C: ... Keep each option to a few words (max ${MAX_OPTION_WORDS}).`,
  },
  finalSummary: {
    role: (name) => `You are Professor Kim giving brief feedback to ${name} after their essay quest.`,
    rules: `Output exactly ONE line in this format:\nPROF KIM: "your feedback here"\nRules: Write in second person ("you"). One short sentence only (max 15 words). Simple words for children. Congratulate or gently reflect. No story recap, no A/B/C options.`,
  },
}

// ========== Lean context – bounded context for each turn (no full story) ==========
/** Returns a one-line hint so the LLM can reflect protagonist personality from choices so far. */
function getProtagonistTendency(state) {
  const a = state.choiceCounts.A || 0
  const b = state.choiceCounts.B || 0
  const c = state.choiceCounts.C || 0
  const total = a + b + c
  if (total === 0) return 'Protagonist is neutral (no choices yet).'
  const max = Math.max(a, b, c)
  const leaders = [a === max && 'A', b === max && 'B', c === max && 'C'].filter(Boolean)
  if (leaders.length > 1) return "Protagonist's choices are mixed so far; keep their tone balanced."
  if (a === max) return 'Protagonist has chosen mostly pro-AI (A) so far; their dialogue should sound a bit more pro-AI.'
  if (b === max) return 'Protagonist has chosen mostly anti-AI (B) so far; their dialogue should sound a bit more anti-AI.'
  return 'Protagonist has chosen mostly funny/silly (C) so far; their dialogue should sound a bit more playful or silly.'
}

function getLeanContext(state, turn) {
  const phase = getPhaseFromTurn(turn)
  const a = state.choiceCounts.A || 0
  const b = state.choiceCounts.B || 0
  const c = state.choiceCounts.C || 0
  let recap = `Phase ${phase}. A=${a} B=${b} C=${c}.`
  if (phase >= 2 && state.decisions.phase1UsedAI != null) {
    recap += state.decisions.phase1UsedAI ? ' Used AI in phase 1.' : ' Did not use AI in phase 1.'
  }
  if (phase === 3) {
    recap += state.decisions.phase3ProfessorProud !== false ? ' Kim proud.' : ' Kim scolding.'
  }
  const friendName = state.name === 'Jimmy' ? 'Priya' : 'Jimmy'
  if (phase <= 2) recap += ` ${state.name} with ${friendName}.`
  else recap += ` ${state.name} with Professor Kim.`
  const lastChosen = state.lastChosenOption && state.lastChosenOption.text
    ? `${state.lastChosenOption.key}: ${state.lastChosenOption.text}`
    : '(no previous choice text available)'
  return { lastChosenOption: lastChosen, recap }
}

// ========== Build prompts from outline (no full storySummary in turn prompts) ==========
/** Turn 1 = opening scene (Phase 1). Uses PROMPT_OUTLINES.turn1. */
function buildTurn1Prompt(name, starterText) {
  const friendName = name === 'Jimmy' ? 'Priya' : 'Jimmy'
  const o = PROMPT_OUTLINES.turn1
  const chars = PROMPT_OUTLINES.characterContext
  const taskStr = typeof o.task === 'function' ? o.task(name, friendName, starterText) : o.task
  return `Interactive story for children. Use simple words and short sentences. Produce dialogue and then three options A, B, C for optional dialogue for ${name} to say in coversation.
${DIALOGUE_REMINDER}

${o.scene}
${taskStr}

${o.outputFormat}`
}

function buildTurnPrompt(turn, leanContext, choice, state) {
  // Turn 2 = 1st choice response, turn 3 = 2nd choice, ... turn 6 = 5th choice. Use outline turnN for server turn N.
  const key = `turn${turn}` in PROMPT_OUTLINES ? `turn${turn}` : 'turn2'
  const o = PROMPT_OUTLINES[key]
  const name = state.name || 'Jimmy'
  const friendName = name === 'Jimmy' ? 'Priya' : 'Jimmy'
  const phase = getPhaseFromTurn(turn)
  const ctx = {
    name,
    friendName,
    turn,
    phase,
    decisions: state.decisions,
    choiceCounts: state.choiceCounts,
    leanContext,
  }
  const sceneStr = typeof o.scene === 'function' ? o.scene(ctx) : o.scene
  const taskStr = typeof o.task === 'function' ? o.task(ctx) : o.task
  const choiceLabel = choice === 'A' ? 'pro-AI' : choice === 'B' ? 'anti-AI' : 'funny/silly'
  const chars = PROMPT_OUTLINES.characterContext
  const allowedSpeakers = phase <= 2
    ? `ONLY JIMMY and PRIYA in this scene. Do NOT use PROF KIM — she is not present yet.`
    : `ONLY PROF KIM AND ${name} in this scene.`
  const characterTraits = phase <= 2 ? `Character: ${chars.friend}` : `Character: ${chars.profKim}`
  const protagonistTendency = getProtagonistTendency(state)
  return `${sceneStr}
  ${name} just chose: ${leanContext.lastChosenOption} (${choiceLabel}).

${taskStr}

${allowedSpeakers}
${characterTraits}
Protagonist tendency: ${protagonistTendency}

${DIALOGUE_REMINDER}

${o.outputFormat}`
}

function buildFinalSummaryPromptTemplate(state) {
  const a = state.choiceCounts.A || 0
  const b = state.choiceCounts.B || 0
  const c = state.choiceCounts.C || 0
  const kimMood = state.decisions.phase3ProfessorProud ? 'proud' : 'scolding'
  const name = state.name || 'the player'
  const o = PROMPT_OUTLINES.finalSummary
  const chars = PROMPT_OUTLINES.characterContext
  return `${o.role(name)}

Character: ${chars.profKim}
Choice counts: Pro-AI (A)=${a}, Anti-AI (B)=${b}, Silly (C)=${c}. Professor Kim is ${kimMood}.

${o.rules}`
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
    lastChosenOption: null,
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
  // No truncation – keep full text as returned by the model.
  if (!text || typeof text !== 'string') return ''
  return String(text)
}

/** Parse "SPEAKER: text" lines into dialogue array. Normalizes speaker to Jimmy | Priya | Prof Kim. Accepts "Prof Kim" or "Professor Kim". */
function parseDialogueFromText(rawText) {
  const dialogue = []
  if (!rawText || typeof rawText !== 'string') return dialogue
  const lines = rawText.split(/\n/).map((l) => l.trim())
  const speakerRegex = /^(JIMMY|PRIYA|PROF KIM|PROFESSOR KIM|Jimmy|Priya|Prof Kim|Professor Kim):\s*(.*)$/i
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
      options[key] = match[2].trim() || fallbackOptions[key]
    } else if (!foundBlank) {
      if (line) narrativeParts.push(line)
    }
  }
  const narrative = narrativeParts.join(' ')
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

  const fullPrompt = buildTurn1Prompt(name, starterText)

  console.log('[handleGenerate] --- PROMPT TO MODEL (turn 1) ---')
  console.log(fullPrompt)
  console.log('[handleGenerate] --- END PROMPT (chars=', fullPrompt.length, ') ---')
  try {
    const { text } = await callOllama(fullPrompt)
    console.log('[handleGenerate] --- RESPONSE FROM MODEL ---')
    console.log(text ?? '')
    console.log('[handleGenerate] --- END RESPONSE (chars=', text?.length ?? 0, ') ---')
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
  const chosenOptionText = body.chosenOptionText != null ? String(body.chosenOptionText) : ''

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
  state.lastChosenOption = { key: choice, text: chosenOptionText }
  state.turn += 1
  const turn = state.turn
  const phase = getPhaseFromTurn(turn)

  if (paragraph) {
    state.storySummary = state.storySummary ? state.storySummary + '\n\n' + paragraph : paragraph
  }

  // Phase decisions:
  // - Phase 1 (write essay): did the player choose A on turn 2?
  // - Phase 2 (check essay): did the player choose B on turn 4?
  if (turn === 2) {
    state.decisions.phase1UsedAI = choice === 'A'
  }
  if (turn === 4) {
    state.decisions.phase2UsedAICheck = choice === 'B'
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
    if (aiUsageScore <= 25) phrase = 'Well done, strong independent human! You used your own brain and didn\'t rely on AI. That is the best way to learn! You should be proud of yourself.'
    else if (aiUsageScore <= 50) phrase = 'Good job, you showed a good balance between independence and using AI! Can you try relying on your own intelligence even more next time?'
    else if (aiUsageScore <= 75) phrase = 'Nice try, you used your own brain somewhat, but relied heavily on AI! Can you try relying on your own intelligence more next time?'
    else phrase = "Are you sure you're not an AI? You relied very heavily on AI throughout the quest! Be careful not to become too dependent on it as it may negatively affect your learning over time."
    sendJson(res, 200, {
      narrative: '',
      options: {},
      finalSummary: true,
      dialogue: [{ speaker: 'Prof Kim', text: phrase }],
      aiUsageScore,
      phaseResults: {
        usedAIToWrite: state.decisions.phase1UsedAI,
        usedAIToCheck: state.decisions.phase2UsedAICheck,
        professorProud: state.decisions.phase3ProfessorProud !== false,
      },
    })
    return
  }

  const leanContext = getLeanContext(state, turn)
  const turnPrompt = buildTurnPrompt(turn, leanContext, choice, state)

  console.log('[handleTurn] --- PROMPT TO MODEL (turn', turn, ') ---')
  console.log(turnPrompt)
  console.log('[handleTurn] --- END PROMPT (chars=', turnPrompt.length, ') ---')
  try {
    const { text } = await callOllama(turnPrompt)
    console.log('[handleTurn] --- RESPONSE FROM MODEL ---')
    console.log(text ?? '')
    console.log('[handleTurn] --- END RESPONSE (chars=', text?.length ?? 0, ') ---')
    state.storySummary = state.storySummary ? state.storySummary + '\n\n' + text : text
    const structured = parseStructuredResponse(text)
    console.log('[handleTurn] parsed:', JSON.stringify({ dialogue: structured.dialogue?.length, options: structured.options }, null, 2))
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
  console.log('[handleSummary] --- PROMPT TO MODEL (final summary) ---')
  console.log(promptText)
  console.log('[handleSummary] --- END PROMPT (chars=', promptText.length, ') ---')
  try {
    const { text } = await callOllama(promptText)
    console.log('[handleSummary] --- RESPONSE FROM MODEL ---')
    console.log(text ?? '')
    console.log('[handleSummary] --- END RESPONSE (chars=', text?.length ?? 0, ') ---')
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
