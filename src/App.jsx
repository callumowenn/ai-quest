import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import boy from './assets/boy.avif'
import girl from './assets/girl.png'
import kim from './assets/kim.jpg'
import classBg from './assets/class.png'
import libraryBg from './assets/library.png'
import officeBg from './assets/office.png'

const API_URL = 'http://localhost:3001/turn'
const GENERATE_URL = 'http://localhost:3001/generate'
const SUMMARY_URL = 'http://localhost:3001/summary'
const MAX_ROUNDS = 8
const TYPEWRITER_MS_PER_CHAR = 30
const DEFAULT_STARTER_JIMMY = 'Jimmy has an essay due in 24 hours and is conflicted about whether to use AI... can you help him?'
const DEFAULT_STARTER_PRIYA = 'Priya has an essay due in 24 hours and is conflicted about whether to use AI... can you help her?'
const START_BUTTON_LABEL = 'press C to begin'
const CHUNK_CHARS = 150
const STEPS = 7

const LOADING_PHRASES = [
  'AI predicts patterns, it doesn\'t truly understand things.',
  'Humans tend to grasp concepts better through effort, not shortcuts!',
  'Writing by hand can deepen learning in ways typing might not.',
  'Curiosity drives real understanding — more than any algorithm.',
  'Sometimes the struggle is what makes the idea stick.',
  'Your own words reflect your thinking; AI\'s words reflect data.',
  'Shortcuts can be tempting, but effort builds the path.',
  'The best ideas often come from wrestling with the blank page.',
]

function App() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [finalLoading, setFinalLoading] = useState(false)
  const [error, setError] = useState(null)
  const [displayedLength, setDisplayedLength] = useState(0)
  const [chunkIndex, setChunkIndex] = useState(0)
  const [selectedCharacter, setSelectedCharacter] = useState(null)
  const [starterText, setStarterText] = useState(DEFAULT_STARTER_JIMMY)
  const [showingStarterIntro, setShowingStarterIntro] = useState(false)
  const [introDisplayedLength, setIntroDisplayedLength] = useState(0)
  const [loadingPhrase, setLoadingPhrase] = useState('')
  const [loadingPhraseOpacity, setLoadingPhraseOpacity] = useState(0)
  const [loadingDots, setLoadingDots] = useState(0)
  const [dialogueIndex, setDialogueIndex] = useState(0)
  const [pendingPhaseTransition, setPendingPhaseTransition] = useState(null)
  const [transitionDisplayedLength, setTransitionDisplayedLength] = useState(0)
  const transitionTextRef = useRef('')
  const latestNarrativeRef = useRef('')
  const typewriterStartedForChunkRef = useRef(false)
  const introTextRef = useRef('')
  const summaryRequestedRef = useRef(false)
  const loadingStartedRef = useRef(false)
  const phase2ShownRef = useRef(false)
  const phase3ShownRef = useRef(false)

  const lastEntry = history.length > 0 ? history[history.length - 1] : null
  const hasStructured = lastEntry && (lastEntry.narrative != null || (lastEntry.options && (lastEntry.options.A != null || lastEntry.options.B != null)))
  const latestNarrative = hasStructured ? (lastEntry.narrative ?? '') : ''
  const latestOptions = hasStructured ? (lastEntry.options ?? { A: '', B: '', C: '' }) : null
  const isPendingResponse = lastEntry && lastEntry.choice !== 'Start' && (lastEntry.narrative == null || lastEntry.narrative === '')

  const dialogueList = lastEntry?.dialogue?.length > 0 ? lastEntry.dialogue : null
  const currentDialogue = dialogueList && dialogueList[dialogueIndex] ? dialogueList[dialogueIndex] : null

  function getChunks(narrative) {
    if (!narrative || narrative.length <= CHUNK_CHARS) return [narrative].filter(Boolean)
    const chunks = []
    let start = 0
    while (start < narrative.length) {
      let end = Math.min(start + CHUNK_CHARS, narrative.length)
      if (end < narrative.length) {
        const lastSpace = narrative.lastIndexOf(' ', end)
        if (lastSpace > start) {
          end = lastSpace + 1
        } else {
          const nextSpace = narrative.indexOf(' ', end)
          end = nextSpace === -1 ? narrative.length : nextSpace + 1
        }
      }
      chunks.push(narrative.slice(start, end).trim())
      start = end
    }
    return chunks.filter(Boolean)
  }

  const chunks = getChunks(latestNarrative)
  const needsChunking = !dialogueList && chunks.length > 1
  const currentChunk = dialogueList ? '' : (chunks[chunkIndex] ?? '')
  const currentNarrativeText = dialogueList && currentDialogue ? currentDialogue.text : currentChunk
  const typewriterDoneForChunk = currentNarrativeText.length > 0 && displayedLength >= currentNarrativeText.length
  const typewriterSettledForChunk = typewriterDoneForChunk && (dialogueList ? typewriterStartedForChunkRef.current : true)
  const showingAllChunks = dialogueList
    ? dialogueIndex >= dialogueList.length || (dialogueIndex === dialogueList.length - 1 && typewriterSettledForChunk)
    : chunkIndex >= chunks.length - 1 && chunks.length > 0
  const showContinuePrompt = typewriterDoneForChunk && (dialogueList ? dialogueIndex < dialogueList.length - 1 : needsChunking && chunkIndex < chunks.length - 1)

  useEffect(() => {
    if (pendingPhaseTransition) {
      typewriterStartedForChunkRef.current = false
      setDisplayedLength(0)
      return
    }
    if (dialogueList && !currentDialogue) {
      typewriterStartedForChunkRef.current = false
      setDisplayedLength(0)
      return
    }
    if (!dialogueList && currentChunk === '') {
      typewriterStartedForChunkRef.current = false
      setDisplayedLength(0)
      return
    }
    typewriterStartedForChunkRef.current = false
    const targetText = dialogueList && currentDialogue ? currentDialogue.text : currentChunk
    latestNarrativeRef.current = targetText
    setDisplayedLength(0)
    const id = setInterval(() => {
      typewriterStartedForChunkRef.current = true
      setDisplayedLength((prev) => {
        const target = latestNarrativeRef.current?.length ?? 0
        if (prev >= target) {
          clearInterval(id)
          return target
        }
        return prev + 1
      })
    }, TYPEWRITER_MS_PER_CHAR)
    return () => clearInterval(id)
  }, [dialogueList, dialogueIndex, currentChunk, chunkIndex, currentDialogue, pendingPhaseTransition])

  useEffect(() => {
    setDialogueIndex(0)
  }, [history.length])

  useEffect(() => {
    if (!needsChunking || !latestNarrative) setChunkIndex(0)
  }, [latestNarrative, needsChunking])

  const introText = starterText || (selectedCharacter === 'Priya' ? DEFAULT_STARTER_PRIYA : DEFAULT_STARTER_JIMMY)
  const introTypewriterDone = introText.length > 0 && introDisplayedLength >= introText.length

  useEffect(() => {
    if (!showingStarterIntro || !introText) {
      setIntroDisplayedLength(0)
      return
    }
    introTextRef.current = introText
    setIntroDisplayedLength(0)
    const id = setInterval(() => {
      setIntroDisplayedLength((prev) => {
        const target = introTextRef.current?.length ?? 0
        if (prev >= target) {
          clearInterval(id)
          return target
        }
        return prev + 1
      })
    }, TYPEWRITER_MS_PER_CHAR)
    return () => clearInterval(id)
  }, [showingStarterIntro, introText])

  const transitionText = pendingPhaseTransition === 'day' ? 'the next day...' : pendingPhaseTransition === 'weeks' ? 'two weeks later...' : ''
  const transitionTypewriterDone = transitionText.length > 0 && transitionDisplayedLength >= transitionText.length
  const transitionIntervalRef = useRef(null)

  useEffect(() => {
    if (!pendingPhaseTransition) {
      setTransitionDisplayedLength(0)
      transitionIntervalRef.current = null
      return
    }
    const text = pendingPhaseTransition === 'day' ? 'the next day...' : 'two weeks later...'
    if (!text) return
    transitionTextRef.current = text
    setTransitionDisplayedLength(0)
    const timeoutId = setTimeout(() => {
      transitionIntervalRef.current = setInterval(() => {
        setTransitionDisplayedLength((prev) => {
          const target = transitionTextRef.current?.length ?? 0
          if (prev >= target) {
            if (transitionIntervalRef.current) clearInterval(transitionIntervalRef.current)
            transitionIntervalRef.current = null
            return target
          }
          return prev + 1
        })
      }, TYPEWRITER_MS_PER_CHAR)
    }, 0)
    return () => {
      clearTimeout(timeoutId)
      if (transitionIntervalRef.current) clearInterval(transitionIntervalRef.current)
      transitionIntervalRef.current = null
    }
  }, [pendingPhaseTransition])

  useEffect(() => {
    if (loading) {
      if (!loadingStartedRef.current) {
        loadingStartedRef.current = true
        const phrase = LOADING_PHRASES[Math.floor(Math.random() * LOADING_PHRASES.length)]
        setLoadingPhrase(phrase)
      }
    } else {
      loadingStartedRef.current = false
      setLoadingPhrase('')
    }
  }, [loading])

  useEffect(() => {
    if (!loading || !loadingPhrase) {
      setLoadingPhraseOpacity(0)
      return
    }
    setLoadingPhraseOpacity(0)
    const start = Date.now()
    const duration = 1500
    const id = setInterval(() => {
      const elapsed = Date.now() - start
      const opacity = Math.min(1, elapsed / duration)
      setLoadingPhraseOpacity(opacity)
      if (opacity >= 1) clearInterval(id)
    }, 50)
    return () => clearInterval(id)
  }, [loading, loadingPhrase])

  useEffect(() => {
    if (!loading) return
    const id = setInterval(() => {
      setLoadingDots((d) => (d + 1) % 4)
    }, 400)
    return () => clearInterval(id)
  }, [loading])

  const sendTurn = useCallback(async (choice, narrative, chosenOptionText) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, paragraph: narrative, narrative, chosenOptionText }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { narrative: nextNarrative, options: nextOptions, finalSummary, dialogue: nextDialogue } = data
      if (finalSummary) {
        setFinalLoading(true)
        setTimeout(() => {
          setHistory((prev) => {
            const next = [...prev]
            const entry = { narrative: nextNarrative, options: nextOptions ?? {}, finalSummary: true, dialogue: Array.isArray(nextDialogue) ? nextDialogue : [] }
            if (next.length > 0 && next[next.length - 1].choice === choice && next[next.length - 1].narrative === undefined) {
              next[next.length - 1] = { ...next[next.length - 1], ...entry }
              return next
            }
            return [...prev, { choice, ...entry }].slice(-MAX_ROUNDS)
          })
          setFinalLoading(false)
        }, 2000)
      } else {
        setHistory((prev) => {
          const next = [...prev]
          const entry = { narrative: nextNarrative, options: nextOptions ?? {}, finalSummary: false, dialogue: Array.isArray(nextDialogue) ? nextDialogue : [] }
          if (next.length > 0 && next[next.length - 1].choice === choice && next[next.length - 1].narrative === undefined) {
            next[next.length - 1] = { ...next[next.length - 1], ...entry }
            return next
          }
          return [...prev, { choice, ...entry }].slice(-MAX_ROUNDS)
        })
      }
      setChunkIndex(0)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [])

  const sendBeginQuest = useCallback(async () => {
    if (!selectedCharacter) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'start',
          name: selectedCharacter,
          starterText: starterText || (selectedCharacter === 'Jimmy' ? DEFAULT_STARTER_JIMMY : DEFAULT_STARTER_PRIYA),
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { narrative: nextNarrative, options: nextOptions, dialogue: nextDialogue } = data
      setShowingStarterIntro(false)
      setHistory((prev) => [...prev, { choice: 'Start', narrative: nextNarrative ?? '', options: nextOptions ?? {}, dialogue: Array.isArray(nextDialogue) ? nextDialogue : [] }].slice(-MAX_ROUNDS))
      setChunkIndex(0)
      summaryRequestedRef.current = false
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [selectedCharacter, starterText])

  const sendSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(SUMMARY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const { narrative: nextNarrative, finalSummary, dialogue: summaryDialogue } = data
      setHistory((prev) => [...prev, { choice: 'Summary', narrative: nextNarrative ?? '', options: {}, finalSummary: !!finalSummary, dialogue: Array.isArray(summaryDialogue) ? summaryDialogue : [] }].slice(-MAX_ROUNDS))
      setChunkIndex(0)
    } catch (err) {
      setError(err.message || 'Request failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (
      history.length !== 8 ||
      loading ||
      summaryRequestedRef.current ||
      !lastEntry?.options ||
      Object.keys(lastEntry.options).length === 0 ||
      lastEntry.finalSummary
    ) return
    summaryRequestedRef.current = true
    sendSummary()
  }, [history.length, loading, lastEntry?.options, lastEntry?.finalSummary, sendSummary])

  function handleStart() {
    if (!selectedCharacter) return
    setShowingStarterIntro(true)
  }

  const handleChoice = useCallback(
    async (choice) => {
      if (history.length === 0 || loading || history.length >= 7) return
      const last = history[history.length - 1]
      const narrative = last.narrative ?? ''
      const chosenOptionText = latestOptions && latestOptions[choice] ? latestOptions[choice] : ''
      setHistory((prev) => [...prev, { choice }].slice(-MAX_ROUNDS))
      await sendTurn(choice, narrative, chosenOptionText)
    },
    [history, loading, sendTurn, latestOptions]
  )

  const handleAnyKeyOrClick = useCallback(() => {
    if (showingAllChunks) return
    if (dialogueList) {
      typewriterStartedForChunkRef.current = false
      setDialogueIndex((i) => Math.min(i + 1, dialogueList.length))
    } else {
      if (!needsChunking) return
      setChunkIndex((i) => Math.min(i + 1, chunks.length - 1))
    }
  }, [dialogueList, needsChunking, showingAllChunks, chunks.length])

  const isEndOfStory = history.length >= MAX_ROUNDS || (history.length >= 7 && lastEntry?.finalSummary === true)
  const isFinalSummary = lastEntry?.finalSummary === true

  useLayoutEffect(() => {
    if (loading || isFinalSummary) return
    if (pendingPhaseTransition) return
    if (history.length === 3 && !phase2ShownRef.current) {
      phase2ShownRef.current = true
      setPendingPhaseTransition('day')
    } else if (history.length === 5 && !phase3ShownRef.current) {
      phase3ShownRef.current = true
      setPendingPhaseTransition('weeks')
    }
  }, [loading, history.length, isFinalSummary, pendingPhaseTransition])

  useEffect(() => {
    function onKeyDown(e) {
      if (isEndOfStory && isFinalSummary && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        handleStartAgain()
        return
      }
      if (pendingPhaseTransition && transitionTypewriterDone) {
        e.preventDefault()
        setPendingPhaseTransition(null)
        return
      }
      if (showingStarterIntro && introTypewriterDone) {
        e.preventDefault()
        setShowingStarterIntro(false)
        sendBeginQuest()
        return
      }
      if (showContinuePrompt) {
        e.preventDefault()
        handleAnyKeyOrClick()
        return
      }
      const key = e.key.toUpperCase()
      if (history.length === 0 && !showingStarterIntro) {
        if (key === 'A') {
          e.preventDefault()
          setSelectedCharacter('Jimmy')
          setStarterText(DEFAULT_STARTER_JIMMY)
        } else if (key === 'B') {
          e.preventDefault()
          setSelectedCharacter('Priya')
          setStarterText(DEFAULT_STARTER_PRIYA)
        } else if (key === 'C' && selectedCharacter) {
          e.preventDefault()
          setShowingStarterIntro(true)
        }
        return
      }
      if (loading || history.length >= 7) return
      if (key === 'A' || key === 'B' || key === 'C') {
        e.preventDefault()
        handleChoice(key)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, history.length, selectedCharacter, showingStarterIntro, introTypewriterDone, handleChoice, showContinuePrompt, handleAnyKeyOrClick, sendBeginQuest, isEndOfStory, isFinalSummary, pendingPhaseTransition, transitionTypewriterDone])

  const canChoose = history.length > 0 && history.length < 7 && !loading && !isEndOfStory && showingAllChunks && latestOptions && Object.keys(latestOptions).length > 0 && !isFinalSummary

  const choiceCounts = history.reduce((acc, entry) => {
    if (entry.choice === 'A' || entry.choice === 'B' || entry.choice === 'C') {
      acc[entry.choice] = (acc[entry.choice] || 0) + 1
    }
    return acc
  }, { A: 0, B: 0, C: 0 })
  const totalChoices = choiceCounts.A + choiceCounts.B + choiceCounts.C
  const aiUsageScore = totalChoices > 0 ? Math.round((choiceCounts.A / totalChoices) * 100) : 0
  const displayedText = currentNarrativeText ? currentNarrativeText.slice(0, displayedLength) : ''

  const currentPhase = history.length <= 2 ? 1 : history.length <= 4 ? 2 : 3
  const phaseLabel = currentPhase === 1 ? '24 hours until deadline' : currentPhase === 2 ? '2 hours until deadline' : '2 weeks later'
  const backgroundPhase =
    pendingPhaseTransition === 'day' ? 2
    : pendingPhaseTransition === 'weeks' ? 3
    : loading && history.length === 3 ? 1
    : loading && history.length === 5 ? 2
    : currentPhase
  const storyStep = Math.min(history.length, STEPS)

  function renderTextWithQuotes(text) {
    const parts = text.split('"')
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <span key={i} className="text-amber-300">"{part}"</span>
      ) : (
        part
      )
    )
  }

  function getPortraitForSpeaker(speaker) {
    if (speaker === 'Jimmy') return boy
    if (speaker === 'Priya') return girl
    if (speaker === 'Professor Kim' || speaker === 'Prof Kim') return kim
    return null
  }

  function handleStartAgain() {
    setHistory([])
    setChunkIndex(0)
    setDialogueIndex(0)
    setSelectedCharacter(null)
    setShowingStarterIntro(false)
    setStarterText(DEFAULT_STARTER_JIMMY)
    summaryRequestedRef.current = false
  }

  return (
    <main className="w-[480px] h-[320px] min-w-[480px] min-h-[320px] max-w-[480px] max-h-[320px] flex flex-row bg-slate-950 text-slate-100 overflow-hidden">
      {/* Left column: 50px, boy + 6-step slider */}
      <div className="w-[50px] h-full flex flex-col items-center flex-shrink-0 bg-slate-900/80 border-r border-slate-700/50 pt-4 pb-4">
        <div className="flex-1 relative w-full min-h-0" style={{ minHeight: 0 }}>
          <div className="absolute inset-0 flex flex-col justify-between py-1">
            {Array.from({ length: STEPS }, (_, i) => {
              const choiceForStep = i + 1 < history.length && ['A', 'B', 'C'].includes(history[i + 1]?.choice) ? history[i + 1].choice : null
              const isCurrentStep = i === storyStep - 1
              const choiceBg = choiceForStep === 'A' ? '#ffafe4' : choiceForStep === 'B' ? '#7de2f4' : choiceForStep === 'C' ? '#4bf296' : null
              return (
                <div key={i} className="flex flex-col items-center justify-center shrink-0 min-h-[2.25rem]">
                  {isCurrentStep ? (
                    <img
                      src={selectedCharacter === 'Priya' ? girl : boy}
                      alt="Story position"
                      className="w-9 h-9 object-cover rounded-full border-2 border-amber-400/60 pointer-events-none animate-sidebar-pulse"
                    />
                  ) : choiceForStep && choiceBg ? (
                    <div
                      className="w-6 h-6 rounded-sm opacity-70 flex items-center justify-center flex-shrink-0"
                      style={{ fontFamily: '"Press Start 2P", cursive', color: choiceBg, backgroundColor: '#000' }}
                    >
                      <span className="text-[8px] font-bold">{choiceForStep}</span>
                    </div>
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-600 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Right column: phase, narrative, chunk prompt, options */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden px-2 py-1 relative">
        {((history.length > 0 && !lastEntry?.finalSummary) || (history.length === 0 && (showingStarterIntro || loading))) && (
          <div
            className="absolute inset-0 z-0 bg-cover bg-center opacity-90"
            style={{
              backgroundImage: `url(${history.length === 0 ? classBg : backgroundPhase === 1 ? classBg : backgroundPhase === 2 ? libraryBg : officeBg})`,
            }}
            aria-hidden
          />
        )}
        {history.length === 0 && !showingStarterIntro && !loading && !finalLoading && (
          <div
            className="absolute inset-0 z-0 bg-cover bg-center opacity-60 blur-sm"
            style={{ backgroundImage: `url(${classBg})` }}
            aria-hidden
          />
        )}
        <div className="relative z-10 flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {history.length === 0 && !showingStarterIntro && !loading && (
          <div className="flex-1 flex flex-col w-full min-h-0 py-2 relative">
            <h1 className="arcade-title absolute top-8 left-0 right-0 text-center pt-1 z-10" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              AI QUEST
            </h1>
            <div className="flex-1 flex flex-col mt-8 items-center justify-center gap-2 min-h-0">
              <p className="text-amber-400/90 text-[8px] uppercase shrink-0" style={{ fontFamily: '"Press Start 2P", cursive' }}>Choose your character</p>
              <div className="flex items-center justify-center gap-4 shrink-0">
                <div
                  onClick={() => { setSelectedCharacter('Jimmy'); setStarterText(DEFAULT_STARTER_JIMMY) }}
                  className="flex flex-col items-center gap-1 p-1 rounded border-2 border-transparent focus:outline-none focus:border-amber-400/60"
                  aria-pressed={selectedCharacter === 'Jimmy'}
                >
                  <img
                    src={boy}
                    alt="Jimmy"
                    className={`w-20 h-20 object-cover rounded-full border-2 transition-all scale-100 ${selectedCharacter === 'Jimmy' ? 'border-amber-400 ring-2 ring-amber-400/50 scale-110' : 'border-slate-600'}`}
                  />
                  <span className={`${selectedCharacter === 'Jimmy' ? 'text-amber-400 text-[16px]' : 'text-slate-300 text-[12px]'}`} style={{ fontFamily: '"Press Start 2P", cursive' }}>A</span>
                </div>
                <div
                  onClick={() => { setSelectedCharacter('Priya'); setStarterText(DEFAULT_STARTER_PRIYA) }}
                  className="flex flex-col items-center gap-1 p-1 rounded border-2 border-transparent focus:outline-none focus:border-amber-400/60"
                  aria-pressed={selectedCharacter === 'Priya'}
                >
                  <img
                    src={girl}
                    alt="Priya"
                    className={`w-20 h-20 object-cover rounded-full border-2 transition-all scale-100 ${selectedCharacter === 'Priya' ? 'border-amber-400 ring-2 ring-amber-400/50 scale-110' : 'border-slate-600 '}`}
                  />
                  <span className={`${selectedCharacter === 'Priya' ? 'text-amber-400 text-[16px]' : 'text-slate-300 text-[12px]'}`} style={{ fontFamily: '"Press Start 2P", cursive' }}>B</span>
                </div>
              </div>
            </div>
            {selectedCharacter && (
              <div className="absolute left-0 right-0 bottom-2 flex justify-center">
                <button
                  type="button"
                  onClick={handleStart}
                  disabled={loading}
                  className="text-[10px] font-bold py-2 px-3 text-slate-900 border-2 border-slate-700 hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                  style={{ fontFamily: '"Press Start 2P", cursive', backgroundColor: '#4bf296' }}
                >
                  {loading ? '...' : START_BUTTON_LABEL}
                </button>
              </div>
            )}
          </div>
        )}

        {history.length === 0 && showingStarterIntro && !finalLoading && (
          <div className=" self-center rounded-md border-2 border-amber-400/60 justify-self-center mt-32 backdrop-blur-md bg-slate-950/30 h-min flex flex-col items-center justify-center gap-2 min-h-0 py-2">
            <p className="text-amber-100 text-xs leading-tight whitespace-pre-wrap break-words m-0 text-center max-w-80 px-2" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              {renderTextWithQuotes(introText.slice(0, introDisplayedLength))}
            </p>
            {introTypewriterDone && (
              <span
                role="button"
                tabIndex={0}
                onClick={() => { setShowingStarterIntro(false); sendBeginQuest() }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setShowingStarterIntro(false); sendBeginQuest() } }}
                className="shrink-0 text-amber-200/80 text-[10px] lowercase border-0 p-0 cursor-pointer hover:text-amber-400 mb-0.5 w-full text-center"
                style={{ fontFamily: '"Press Start 2P", cursive' }}
              >
                [press any key to continue]
              </span>
            )}
          </div>
        )}

        {finalLoading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 py-2">
            <p className="text-amber-200/95 text-xs bg-slate-900/50 px-1 py-0.5 rounded-md leading-tight whitespace-pre-wrap break-words m-0 text-center max-w-80 px-2" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              Professor Kim is thinking about your choices...
            </p>
            <p className="text-amber-400/90 text-[10px] lowercase flex-none bg-slate-900/50 px-1 py-0.5 rounded-md" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              loading summary...
            </p>
          </div>
        )}

        {loading && !finalLoading && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 py-2">
            <div className="speech-bubble flex-none px-3 py-2 max-w-80" style={{ opacity: loadingPhraseOpacity }}>
              <p className="text-amber-200/95 text-[9px] leading-tight whitespace-pre-wrap break-words m-0" style={{ fontFamily: '"Press Start 2P", cursive' }}>
                {loadingPhrase}
              </p>
            </div>
            <img
              src={selectedCharacter === 'Priya' ? girl : boy}
              alt={selectedCharacter === 'Priya' ? 'Priya' : 'Jimmy'}
              className="w-14 h-14 object-cover rounded-full border-2 border-amber-400/60 flex-shrink-0"
            />
            <p className="text-amber-200/90 bg-slate-900/50 px-1 py-0.5 rounded-md text-[10px] lowercase flex-none" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              generating story{'.'.repeat(loadingDots)}
            </p>
          </div>
        )}

        {!loading && !finalLoading && pendingPhaseTransition && (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 min-h-0 py-2">
            <p className="text-amber-200/95 text-xs bg-slate-900/60 px-1 py-0.5 rounded-md leading-tight whitespace-pre-wrap break-words m-0 text-center" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              {transitionText.slice(0, transitionDisplayedLength)}
            </p>
            {transitionTypewriterDone && (
              <span
                className="shrink-0 text-amber-300/80 bg-slate-900/70 text-nowrap w-min px-1 py-0.5 rounded-md text-[10px] lowercase border-0 p-0 cursor-pointer hover:text-amber-400 mb-0.5 w-full text-center"
                style={{ fontFamily: '"Press Start 2P", cursive' }}
              >
                [press any key to continue]
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="text-red-400 text-[10px] text-center font-mono py-0.5">{error}</p>
        )}

        {!pendingPhaseTransition && !isFinalSummary && !finalLoading && ((latestNarrative !== '' && !error && !loading) || (isPendingResponse && !loading)) && (
          <>
            {/* Options above: flex-1 so bar stays at bottom */}
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {canChoose && latestOptions && (
                <div className="shrink-0 flex flex-col gap-0.5 py-1">
                  <div className="flex flex-wrap gap-1 ml-0 mt-4">
                  <span
              className="shrink-0 text-amber-400/80 text-[10px] lowercase border-0 p-0 cursor-pointer hover:text-amber-400 mb-0.5 w-full text-end"
              style={{ fontFamily: '"Press Start 2P", cursive' }}
            >
              you decide!
            </span>
                    {['A', 'B', 'C'].map((key) => {
                      const bgColor = key === 'A' ? '#ffafe4' : key === 'B' ? '#7de2f4' : '#4bf296'
                      return (
                      <div key={key} onClick={() => handleChoice(key)} className='flex gap-1 w-[420px]'>
                        <div className='w-full text-[10px] rounded-md px-2 py-2 border border-black backdrop-blur-lg' style={{ fontFamily: '"Press Start 2P", cursive', color: '#000000', backgroundColor: `${bgColor}` }}>
                          {latestOptions[key] ?? ''}
                        </div>
                        <div className='text-[16px] rounded-md w-14 h-12 flex items-center justify-center' style={{ fontFamily: '"Press Start 2P", cursive', color: bgColor, backgroundColor: '#000' }}>
                          {key}
                        </div>
                      </div>
                      
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            {/* Dialogue bar fixed at bottom: phase label, portrait, name, text box, continue */}
            <div className="flex-none flex flex-col shrink-0 w-full min-w-0 items-end">
              <div className="bg-slate-900/50 px-1 py-0.5 mb-0.5 rounded-md w-min">
                <p className="text-slate-100/70 text-nowrap text-[8px] uppercase tracking-wider phase-label-step shrink-0" style={{ fontFamily: '"Press Start 2P", cursive' }}>
                  {phaseLabel}
                </p>
              </div>
              {isPendingResponse ? (
                <div className="flex-none px-2 py-1 bg-slate-800/95 border-2 border-amber-400/90 rounded opacity-60 flex items-center justify-center min-h-[3rem]">
                  <p className="text-amber-200/95 text-xs">...</p>
                </div>
              ) : (
                <>
                  <div className="flex-none flex flex-row gap-1 items-stretch w-full min-w-0">
                    {currentDialogue && (
                      <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                        {getPortraitForSpeaker(currentDialogue.speaker) ? (
                          <img
                            src={getPortraitForSpeaker(currentDialogue.speaker)}
                            alt={currentDialogue.speaker}
                            className="w-18 h-18 object-cover rounded border-2 border-amber-400/70"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded border-2 border-slate-500 bg-slate-700 flex items-center justify-center text-slate-400 text-lg" style={{ fontFamily: '"Press Start 2P", cursive' }}>?</div>
                        )}
                      </div>
                    )}
                    <div
                      className="flex-1 min-w-0 px-2 py-1 bg-slate-800/95 border-2 border-amber-400/90 rounded flex flex-col"
                      style={{ fontFamily: '"Press Start 2P", cursive' }}
                    >
                      <span className="text-amber-300/95 text-[8px] bg-slate-700 absolute -translate-x-2 -translate-y-6 px-1 py-0.5 border-2 border-amber-400/90 rounded" style={{ fontFamily: '"Press Start 2P", cursive' }}>{currentDialogue.speaker}</span>
                      <p className="text-amber-200/95 text-xs leading-tight whitespace-pre-wrap break-words">
                        {renderTextWithQuotes(displayedText)}
                        {typewriterDoneForChunk && (dialogueList ? dialogueIndex < dialogueList.length - 1 : needsChunking && chunkIndex < chunks.length - 1) ? (
                          <>
                            <span className="animate-blink inline-block ml-0.5 align-middle text-[10px]" aria-hidden>▼</span>
                          </>
                        ) : ''}
                      </p>
                    </div>
                  </div>
                  {showContinuePrompt && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={handleAnyKeyOrClick}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleAnyKeyOrClick() } }}
                      className="shrink-0 text-amber-400/80 text-[10px] lowercase border-0 p-0 cursor-pointer hover:text-amber-400 mb-0.5 w-full text-center"
                      style={{ fontFamily: '"Press Start 2P", cursive' }}
                    >
                      {/* [press any key to continue] */}
                    </span>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {isEndOfStory && isFinalSummary && history.length > 0 && !finalLoading && (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden py-2 gap-2">
            <h2 className="text-amber-300 text-sm font-bold shrink-0 text-center tracking-wide" style={{ fontFamily: '"Press Start 2P", cursive', textShadow: '0 0 8px rgba(253, 224, 71, 0.6)' }}>
              Quest Complete
            </h2>
            <p className="text-amber-400/90 text-[8px] uppercase shrink-0 text-center" style={{ fontFamily: '"Press Start 2P", cursive' }}>
              AI usage score
            </p>
            <p className="text-amber-200 text-2xl font-bold shrink-0 text-center" style={{ fontFamily: '"Press Start 2P", cursive', color: '#fef08a', textShadow: '0 0 12px rgba(254, 240, 138, 0.8)' }}>
              {aiUsageScore}%
            </p>
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
              {(lastEntry?.dialogue?.length ?? 0) > 0 ? (
                lastEntry.dialogue.map((line, i) => (
                  <div key={i} className="flex flex-row gap-2 items-stretch w-full min-w-0 shrink-0">
                    <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                      {getPortraitForSpeaker(line.speaker) ? (
                        <img
                          src={getPortraitForSpeaker(line.speaker)}
                          alt={line.speaker}
                          className="w-16 h-16 object-cover rounded border-2 border-amber-400/70"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded border-2 border-slate-500 bg-slate-700 flex items-center justify-center text-slate-400 text-sm" style={{ fontFamily: '"Press Start 2P", cursive' }}>?</div>
                      )}
                      <span className="text-amber-400/90 text-[7px]" style={{ fontFamily: '"Press Start 2P", cursive' }}>{line.speaker}</span>
                    </div>
                    <div className="flex-1 min-w-0 px-2 py-1 bg-slate-800/95 border-2 border-amber-400/90 rounded flex flex-col justify-center">
                      <p className="text-amber-200/95 text-[10px] leading-tight whitespace-pre-wrap break-words m-0" style={{ fontFamily: '"Press Start 2P", cursive' }}>
                        {renderTextWithQuotes(line.text)}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex-none px-2 py-1 bg-slate-800/95 border-2 border-amber-400/90 rounded w-full min-w-0">
                  <p className="text-amber-200/95 text-xs leading-tight whitespace-pre-wrap break-words m-0" style={{ fontFamily: '"Press Start 2P", cursive' }}>
                    {lastEntry?.narrative ?? ''}
                  </p>
                </div>
              )}
            </div>
            <span
              role="button"
              tabIndex={0}
              onClick={handleStartAgain}
              onKeyDown={(e) => { if (e.key === 'c' || e.key === 'C') { e.preventDefault(); handleStartAgain() } }}
              className="shrink-0 text-amber-400/80 text-[10px] lowercase border-0 p-0 cursor-pointer hover:text-amber-400 text-center"
              style={{ fontFamily: '"Press Start 2P", cursive' }}
            >
              Press C to play again.
            </span>
          </div>
        )}
        {isEndOfStory && !canChoose && history.length > 0 && !isFinalSummary && (
          <div className="shrink-0 flex flex-col items-center gap-1 mt-1">
            <p className="text-amber-400/60 text-[8px]" style={{ fontFamily: '"Press Start 2P", cursive' }}>End of story</p>
          </div>
        )}

        {/* Compact step dots */}
        {history.length > 0 && !isFinalSummary && (
          <div className="shrink-0 flex justify-center gap-0.5 py-1">
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i < history.length ? 'bg-amber-400/90' : 'bg-slate-600'}`}
                aria-hidden
              />
            ))}
          </div>
        )}
        </div>
      </div>
    </main>
  )
}

export default App
