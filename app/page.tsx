"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, ArrowUpRight, AudioLines, Clock3, Headphones, Mic, Pause, Play, RefreshCw, Settings2, Square, Volume2, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";

const TOPICS = [
  { id: "ai", name: "Intelligenza artificiale", short: "AI" },
  { id: "engineering", name: "Ingegneria ed elettronica", short: "Ingegneria" },
  { id: "software", name: "Software e cybersecurity", short: "Software" },
  { id: "semiconductors", name: "Semiconduttori", short: "Chip" },
  { id: "energy", name: "Energia e fotovoltaico", short: "Energia" },
  { id: "funding", name: "Bandi e innovazione", short: "Bandi" },
  { id: "economy", name: "Economia", short: "Economia" },
  { id: "politics", name: "Politica", short: "Politica" },
  { id: "iot", name: "IoT e automazione", short: "IoT" },
  { id: "travel", name: "Turismo", short: "Turismo" },
] as const;
type TopicId = (typeof TOPICS)[number]["id"];
type Article = { id: string; title: string; source: string; link: string; published: string; topic: TopicId | "custom"; description: string };
type Preferences = { topics: TopicId[]; keywords: string; rate: number; voice: string; autoNext: boolean };
type Recognition = { lang: string; interimResults: boolean; onstart: (() => void) | null; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; length: number; isFinal: boolean }> }) => void) | null; onerror: ((event: { error?: string }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void };
type Phase = "idle" | "acknowledging" | "listening" | "recognized" | "finding" | "reading" | "summarizing" | "speaking" | "done" | "error";
type Insight = { article: Article; points?: string[]; message?: string; sourceUrl?: string; coverage?: string };
const DEFAULTS: Preferences = { topics: ["ai", "engineering", "software", "semiconductors", "energy", "funding"], keywords: "", rate: 1, voice: "", autoNext: true };
const STORE = "jarvis-news-preferences-v1";

function relativeTime(value: string) {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3600000));
  if (!Number.isFinite(hours)) return "Data non disponibile";
  if (hours < 1) return "Meno di 1 ora fa";
  if (hours < 24) return `${hours} ${hours === 1 ? "ora" : "ore"} fa`;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
const PHASE_LABELS: Record<Phase, string> = { idle: "PRONTO", acknowledging: "ATTIVO IL MICROFONO", listening: "TI ASCOLTO", recognized: "COMANDO RICEVUTO", finding: "CERCO LA FONTE", reading: "LEGGO LA FONTE", summarizing: "PREPARO LA SINTESI", speaking: "JARVIS PARLA", done: "COMPLETATO", error: "ATTENZIONE" };
function VoiceScope({ phase, micStream }: { phase: Phase; micStream: MediaStream | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let frame = 0;
    let audio: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let samples: Uint8Array<ArrayBuffer> | null = null;
    if (phase === "listening" && micStream && typeof AudioContext !== "undefined") {
      audio = new AudioContext();
      const source = audio.createMediaStreamSource(micStream);
      analyser = audio.createAnalyser(); analyser.fftSize = 512; source.connect(analyser);
      samples = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    }
    const draw = (time: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const color = phase === "listening" ? "#8affce" : phase === "error" ? "#fa9c82" : "#64e9ec";
      const live = phase === "listening" && analyser && samples;
      if (live) analyser!.getByteTimeDomainData(samples!);
      ctx.beginPath();
      for (let x = 0; x <= width; x += 2) {
        const index = Math.min(511, Math.floor(x / Math.max(width, 1) * 512));
        const signal = live ? (samples![index] - 128) / 128 :
          phase === "speaking" || phase === "acknowledging" ? Math.sin(x * .095 - time * .012) * Math.sin(x * .026 + time * .004) * .56 :
          ["finding", "reading", "summarizing"].includes(phase) ? Math.sin(x * .09 - time * .008) * .16 : Math.sin(x * .05 - time * .001) * .025;
        const y = height / 2 + signal * height * .37;
        if (!x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.shadowColor = color; ctx.shadowBlur = 16; ctx.stroke();
      ctx.shadowBlur = 0;
      if (phase === "listening" || phase === "speaking" || phase === "acknowledging") frame = requestAnimationFrame(draw);
      else frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); if (audio) void audio.close(); };
  }, [phase, micStream]);
  return <div className={`voice-scope scope-${phase}`} role="img" aria-label={`Indicatore vocale: ${PHASE_LABELS[phase]}`}>
    <div className="scope-grid"/><div className="scope-center"/>
    <canvas ref={canvasRef} className="scope-canvas" aria-hidden="true"/>
    <span className="scope-caption">{phase === "listening" ? micStream ? "INGRESSO MICROFONO · SEGNALE REALE" : "INGRESSO VOCALE" : phase === "speaking" ? "USCITA VOCALE · INDICATORE" : "JARVIS / SIGNAL"}</span>
  </div>;
}

export default function Home() {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [ready, setReady] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [active, setActive] = useState<TopicId | "custom" | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [phaseDetail, setPhaseDetail] = useState("Scegli una notizia o avvia il briefing.");
  const [insight, setInsight] = useState<Insight | null>(null);
  const [transcript, setTranscript] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);
  const currentArticle = useRef<Article | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const commandArticle = useRef<Article | null>(null);
  const requestToken = useRef(0);
  const captureToken = useRef(0);
  const playToken = useRef(0);
  const nextRef = useRef<() => void>(() => {});
  const releaseMic = () => { micStreamRef.current?.getTracks().forEach(track => track.stop()); micStreamRef.current = null; setMicStream(null); };

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORE) || "null");
      if (stored && typeof stored === "object") setPrefs({ ...DEFAULTS, ...stored, topics: Array.isArray(stored.topics) ? stored.topics.filter((x: string) => TOPICS.some(t => t.id === x)) : DEFAULTS.topics });
    } catch { /* Use defaults. */ }
    setReady(true);
    if ("speechSynthesis" in window) {
      const load = () => setVoices(window.speechSynthesis.getVoices());
      load();
      window.speechSynthesis.addEventListener("voiceschanged", load);
      return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
    }
  }, []);
  useEffect(() => { if (ready) localStorage.setItem(STORE, JSON.stringify(prefs)); }, [prefs, ready]);
  useEffect(() => {
    const context = (document as Document & { modelContext?: { registerTool: (tool: unknown, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "configure_news_topics",
      title: "Configura i temi delle notizie",
      description: "Imposta i temi seguiti da Jarvis News sul dispositivo corrente.",
      inputSchema: { type: "object", properties: { topics: { type: "array", items: { type: "string", enum: TOPICS.map(t => t.id) }, uniqueItems: true } }, required: ["topics"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        const value = input as { topics?: unknown };
        if (!Array.isArray(value?.topics) || !value.topics.every(x => typeof x === "string" && TOPICS.some(t => t.id === x)) || new Set(value.topics).size !== value.topics.length) throw new Error("Elenco temi non valido.");
        setPrefs(p => ({ ...p, topics: value.topics as TopicId[] }));
        return { topics: value.topics };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  const loadNews = useCallback(async (signal?: AbortSignal) => {
    if (!prefs.topics.length && !prefs.keywords.trim()) { setArticles([]); setError("Scegli almeno un argomento nelle impostazioni."); return; }
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ topics: prefs.topics.join(","), keywords: prefs.keywords.trim().slice(0, 100) });
      const response = await fetch(`/api/news?${query}`, { signal, cache: "no-store" });
      const data = await response.json() as { articles?: Article[]; failed?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Impossibile caricare le notizie.");
      setArticles(data.articles || []);
      setUpdated(new Date());
      if (data.failed?.length) setError(`Alcune fonti non sono disponibili: ${data.failed.map((id: string) => TOPICS.find(t => t.id === id)?.short || id).join(", ")}.`);
      else if (!data.articles?.length) setError("Nessuna notizia recente trovata. Prova altri argomenti o aggiorna.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message === "Le fonti esterne non rispondono al server." ? "Le fonti delle notizie non rispondono. Jarvis riproverà automaticamente; puoi anche premere Aggiorna." : "Non riesco a raggiungere le fonti in questo momento. Riprova tra poco.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [prefs.topics, prefs.keywords]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    loadNews(controller.signal);
    const timer = window.setInterval(() => loadNews(controller.signal), 10 * 60 * 1000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [ready, loadNews]);

  const visible = active === "all" ? articles : articles.filter(a => a.topic === active);
  const stopSpeech = () => { playToken.current++; window.speechSynthesis?.cancel(); setSpeaking(false); setPaused(false); setPlayingIndex(null); };
  const stop = () => { stopSpeech(); setPhase("idle"); setPhaseDetail("Riproduzione fermata."); };
  const speakText = (words: string) => {
    if (!("speechSynthesis" in window)) { setPhase("done"); setPhaseDetail("Sintesi pronta da leggere sullo schermo."); return; }
    const token = ++playToken.current;
    const utterance = new SpeechSynthesisUtterance(words);
    utterance.lang = "it-IT"; utterance.rate = prefs.rate;
    utterance.voice = voices.find(v => v.voiceURI === prefs.voice) || voices.find(v => v.lang.toLowerCase().startsWith("it")) || null;
    utterance.onstart = () => { if (token === playToken.current) { setPhase("speaking"); setPhaseDetail("Jarvis legge la sintesi della fonte."); setSpeaking(true); } };
    utterance.onend = () => { if (token === playToken.current) { setPhase("done"); setPhaseDetail("Sintesi completata. Puoi verificare la fonte dal link."); setSpeaking(false); } };
    utterance.onerror = () => { if (token === playToken.current) { setPhase("done"); setPhaseDetail("Sintesi visibile; la voce non è disponibile."); setSpeaking(false); } };
    window.speechSynthesis.speak(utterance);
  };
  const deepen = async (article: Article | null) => {
    if (!article) { setPhase("error"); setPhaseDetail("Scegli una notizia prima di chiedere l'approfondimento."); return; }
    const token = ++requestToken.current;
    stopSpeech(); currentArticle.current = article; setSelectedArticle(article); setInsight(null);
    setPhase("finding"); setPhaseDetail("Cerco l'articolo originale…");
    try {
      const response = await fetch("/api/deepen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ link: article.link, title: article.title, source: article.source }) });
      if (!response.ok || !response.body) throw new Error("Il servizio di approfondimento non risponde.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      const receive = (line: string) => {
        if (!line.trim() || token !== requestToken.current) return;
        const event = JSON.parse(line) as { phase: Phase; detail: string; error?: string; result?: { points: string[]; sourceUrl: string; coverage: string } };
        setPhase(event.phase); setPhaseDetail(event.error || event.detail);
        if (event.error) setInsight({ article, message: event.error });
        if (event.result) {
          setInsight({ article, points: event.result.points, sourceUrl: event.result.sourceUrl, coverage: event.result.coverage });
          speakText(`Ecco i punti principali della notizia. ${event.result.points.join(" ")} Per verificare, trovi il link alla fonte originale sullo schermo.`);
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = pending.split("\n"); pending = lines.pop() || "";
        lines.forEach(receive);
        if (done) { receive(pending); break; }
      }
    } catch (error) {
      if (token !== requestToken.current) return;
      const message = error instanceof Error ? error.message : "Fonte non disponibile.";
      setPhase("error"); setPhaseDetail(message); setInsight({ article, message });
    }
  };
  const listen = () => {
    if (phase === "listening" || phase === "acknowledging") {
      captureToken.current++;
      recognition.current?.stop(); releaseMic(); stopSpeech();
      setPhase("idle"); setPhaseDetail("Ascolto interrotto."); return;
    }
    const browser = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Constructor = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    commandArticle.current = currentArticle.current || selectedArticle || visible[0] || null;
    stopSpeech(); setTranscript(""); setPhase("acknowledging");
    setPhaseDetail("Jarvis attiva il microfono e ti darà conferma prima di ascoltare.");
    if (!Constructor) {
      setPhase("error"); setPhaseDetail("Il riconoscimento vocale non è disponibile in questo browser. Usa Approfondisci qui sotto.");
      return;
    }
    const token = ++captureToken.current;
    // Request permission within the click gesture; start recognition after the spoken cue so it cannot transcribe Jarvis.
    const streamPromise = navigator.mediaDevices?.getUserMedia?.({ audio: { echoCancellation: true, noiseSuppression: true } });
    const startCapture = async () => {
      if (streamPromise) {
        try {
          const stream = await streamPromise;
          if (token !== captureToken.current) { stream.getTracks().forEach(track => track.stop()); return; }
          micStreamRef.current = stream; setMicStream(stream);
        } catch {
          setPhase("error"); setPhaseDetail("Il microfono è bloccato. Consenti l'accesso dal browser oppure usa Approfondisci."); return;
        }
      }
      if (token !== captureToken.current) return;
      const mic = new Constructor(); recognition.current = mic; mic.lang = "it-IT"; mic.interimResults = true;
      let recognized = false;
      mic.onstart = () => { setPhase("listening"); setPhaseDetail("TI ASCOLTO: pronuncia «approfondisci questa notizia»."); };
      mic.onresult = event => {
        const result = event.results[event.results.length - 1];
        const command = result?.[0]?.transcript.trim() || "";
        setTranscript(command);
        if (!result?.isFinal || recognized) return;
        recognized = true;
        setPhase("recognized"); setPhaseDetail(`Ho capito: «${command}».`);
        mic.stop();
        if (/approfond|dimmi di pi[uù]|spiega|riassum/.test(command.toLocaleLowerCase("it"))) void deepen(commandArticle.current);
        else { setPhase("error"); setPhaseDetail(`Comando «${command}» non riconosciuto. Riprova o usa Approfondisci.`); }
      };
      mic.onerror = event => { if (!recognized && token === captureToken.current) { setPhase("error"); setPhaseDetail(event.error === "not-allowed" ? "Permesso microfono negato nelle impostazioni del browser." : `Ascolto non riuscito (${event.error || "errore"}). Usa Approfondisci o riprova.`); } releaseMic(); };
      mic.onend = () => { recognition.current = null; releaseMic(); if (!recognized && token === captureToken.current) setPhase(previous => { if (previous === "listening") { setPhaseDetail("Non ho sentito un comando. Tocca il microfono e riprova."); return "error"; } return previous; }); };
      try { mic.start(); } catch { releaseMic(); setPhase("error"); setPhaseDetail("Impossibile avviare il riconoscimento vocale. Usa Approfondisci."); }
    };
    if (!("speechSynthesis" in window)) { void startCapture(); return; }
    let finished = false;
    const readyToListen = () => { if (finished) return; finished = true; void startCapture(); };
    const cue = new SpeechSynthesisUtterance("Ti ascolto. Dimmi quale notizia vuoi approfondire.");
    cue.lang = "it-IT"; cue.rate = prefs.rate;
    cue.voice = voices.find(v => v.voiceURI === prefs.voice) || voices.find(v => v.lang.toLowerCase().startsWith("it")) || null;
    cue.onstart = () => setPhaseDetail("Jarvis dice: «Ti ascolto». Tra poco si attiva il microfono.");
    cue.onend = readyToListen; cue.onerror = readyToListen;
    window.speechSynthesis.speak(cue);
    window.setTimeout(readyToListen, 3800);
  };
  const speak = (index: number, items = visible) => {
    if (!("speechSynthesis" in window) || !items[index]) return;
    window.speechSynthesis.cancel();
    const token = ++playToken.current;
    const item = items[index];
    currentArticle.current = item; setSelectedArticle(item); setInsight(null);
    const description = item.description.trim();
    const duplicate = description.toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]/gu, "").startsWith(item.title.toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]/gu, ""));
    const utterance = new SpeechSynthesisUtterance(`${item.title}. Fonte: ${item.source}.${description && !duplicate ? ` ${description}` : ""}`);
    utterance.lang = "it-IT"; utterance.rate = prefs.rate;
    const selected = voices.find(v => v.voiceURI === prefs.voice) || voices.find(v => v.lang.toLowerCase().startsWith("it"));
    if (selected) utterance.voice = selected;
    utterance.onstart = () => { if (token === playToken.current) { setSpeaking(true); setPaused(false); setPlayingIndex(index); setPhase("speaking"); setPhaseDetail(`Notizia ${index + 1} di ${items.length}. Tocca il microfono per interrompermi.`); } };
    utterance.onend = () => { if (token !== playToken.current) return; if (prefs.autoNext && index + 1 < items.length) nextRef.current(); else { setSpeaking(false); setPlayingIndex(null); setPhase("done"); setPhaseDetail("Briefing completato."); } };
    utterance.onerror = () => { if (token === playToken.current) { setSpeaking(false); setPlayingIndex(null); setPhase("error"); setPhaseDetail("Riproduzione vocale non riuscita."); } };
    nextRef.current = () => speak(index + 1, items);
    window.speechSynthesis.speak(utterance);
  };
  const togglePlayback = () => {
    if (speaking && paused) { window.speechSynthesis.resume(); setPaused(false); setPhase("speaking"); }
    else if (speaking) { window.speechSynthesis.pause(); setPaused(true); setPhase("idle"); setPhaseDetail("Briefing in pausa."); }
    else speak(0);
  };
  const toggleTopic = (id: TopicId) => setPrefs(p => ({ ...p, topics: p.topics.includes(id) ? p.topics.filter(x => x !== id) : [...p.topics, id] }));
  const first = visible[0];
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><AudioLines size={22}/></div><span>JARVIS<span className="brand-accent"> / NEWS</span></span></div>
      <div className="top-status"><span className="live-pulse"/> AGGIORNAMENTO AUTOMATICO <span className="status-divider">/</span> OGNI 10 MIN</div>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogTrigger asChild><button className="icon-button settings-button" aria-label="Apri impostazioni"><Settings2 size={19}/><span>CONFIGURA</span></button></DialogTrigger>
        <DialogContent className="settings-dialog"><DialogHeader><DialogTitle>Configura Jarvis News</DialogTitle></DialogHeader>
          <p className="settings-intro">Scegli cosa seguire e come ascoltarlo. Le preferenze vengono salvate su questo dispositivo.</p>
          <h3>ARGOMENTI</h3><div className="settings-topics">{TOPICS.map(t => <label key={t.id} className="setting-row"><span>{t.name}</span><Switch checked={prefs.topics.includes(t.id)} onCheckedChange={() => toggleTopic(t.id)} aria-label={t.name}/></label>)}</div>
          <label className="field-label" htmlFor="keywords">PAROLE CHIAVE PERSONALI <span>(facoltative)</span></label><input id="keywords" className="text-field" value={prefs.keywords} maxLength={100} onChange={e => setPrefs(p => ({ ...p, keywords: e.target.value }))} placeholder="Es. Wi-Fi sensing, bandi Sicilia"/><p className="field-help">Inserisci una ricerca specifica; viene aggiunta alle notizie selezionate.</p>
          <h3>VOCE</h3><label className="field-label" htmlFor="voice">VOCE DISPONIBILE SUL DISPOSITIVO</label><select id="voice" className="text-field" value={prefs.voice} onChange={e => setPrefs(p => ({ ...p, voice: e.target.value }))}><option value="">Automatica (preferisci italiano)</option>{voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}</option>)}</select>
          <label className="field-label" htmlFor="rate">VELOCITÀ · {prefs.rate.toFixed(1)}×</label><input id="rate" type="range" min="0.7" max="1.5" step="0.1" value={prefs.rate} onChange={e => setPrefs(p => ({ ...p, rate: Number(e.target.value) }))}/>
          <label className="setting-row auto-next"><span>Continua con la notizia successiva</span><Switch checked={prefs.autoNext} onCheckedChange={value => setPrefs(p => ({ ...p, autoNext: value }))}/></label>
          <button className="primary-button settings-done" onClick={() => setSettingsOpen(false)}>Fatto</button>
        </DialogContent></Dialog>
    </header>
    <main className="workspace">
      <section className="intro"><div><div className="eyebrow"><Zap size={14}/> INTELLIGENCE FEED <span>—</span> PERSONAL EDITION</div><h1>Il tuo mondo, <em>in tempo reale.</em></h1><p>Le notizie che contano per te. Scegli un tema, ascolta il briefing, apri le fonti.</p></div><div className="date-block"><span>OGGI</span><strong>{new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "long" }).format(new Date())}</strong><small>{new Intl.DateTimeFormat("it-IT", { weekday: "long", year: "numeric" }).format(new Date())}</small></div></section>
      <div className="main-grid"><aside className="sidebar"><div className="section-heading">CANALI <span>{prefs.topics.length + (prefs.keywords ? 1 : 0)}</span></div><button className={`channel ${active === "all" ? "selected" : ""}`} onClick={() => { stop(); setActive("all"); }}><Activity size={17}/> Tutte le notizie <span>{articles.length}</span></button>{TOPICS.filter(t => prefs.topics.includes(t.id)).map(t => <button key={t.id} className={`channel ${active === t.id ? "selected" : ""}`} onClick={() => { stop(); setActive(t.id); }}><span className="channel-dot"/>{t.name}<span>{articles.filter(a => a.topic === t.id).length}</span></button>)}{prefs.keywords.trim() && <button className={`channel ${active === "custom" ? "selected" : ""}`} onClick={() => { stop(); setActive("custom"); }}><span className="channel-dot"/>Le tue parole chiave<span>{articles.filter(a => a.topic === "custom").length}</span></button>}<button className="add-channel" onClick={() => setSettingsOpen(true)}>+ Personalizza canali</button><div className="sidebar-foot"><div className="signal-line"/><span>FONTI PUBBLICHE · LINK ORIGINALI</span><span>ORA LOCALE · EUROPA/ROMA</span></div></aside>
      <section className="feed"><div className="feed-header"><div><div className="eyebrow">IL TUO RADAR</div><h2>{active === "all" ? "Ultime notizie" : active === "custom" ? "Parole chiave" : TOPICS.find(t => t.id === active)?.name}</h2><div className="feed-meta">{loading ? "Ricerca in corso…" : `${visible.length} notizie`} <span>·</span> {updated ? `Verificato alle ${updated.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" })}` : "In attesa delle fonti"}</div></div><button className="refresh-button" disabled={loading} onClick={() => loadNews()} aria-label="Aggiorna notizie"><RefreshCw size={17} className={loading ? "spin" : ""}/><span>Aggiorna</span></button></div>
        {error && <div className="notice" role="status">{error}</div>}
        {loading && !articles.length ? <div className="loading-card"><span className="spin-circle"/>Cerco notizie dalle fonti…</div> : null}
        {!loading && !visible.length ? <div className="empty-card"><Activity size={28}/><strong>Nessuna notizia da mostrare</strong><p>Modifica i canali o riprova l’aggiornamento.</p></div> : null}
        <div className="article-list">{visible.map((a, index) => <article className={`article ${playingIndex === index && speaking ? "article-playing" : ""}`} key={a.id}><div className="article-meta"><span className="topic-label">{a.topic === "custom" ? "PERSONALE" : TOPICS.find(t => t.id === a.topic)?.short.toUpperCase()}</span><span className="meta-separator"/> {a.source} <span className="meta-separator"/><Clock3 size={13}/>{relativeTime(a.published)}</div><a className="article-title" href={a.link} target="_blank" rel="noopener noreferrer">{a.title}<ArrowUpRight size={17}/></a>{a.description && !a.description.toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]/gu, "").startsWith(a.title.toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]/gu, "")) && <p>{a.description}</p>}<div className="article-actions"><button onClick={() => speak(index)}><Volume2 size={15}/> Ascolta</button><button onClick={() => void deepen(a)}>Approfondisci</button><a href={a.link} target="_blank" rel="noopener noreferrer">Apri la fonte <ArrowUpRight size={14}/></a></div></article>)}</div>

      </section>
      <aside className="briefing-panel" aria-live="polite">
        <div className="panel-top"><div className="eyebrow">JARVIS AUDIO</div><span className={`audio-status status-${phase}`}><span className="live-pulse"/> {PHASE_LABELS[phase]}</span></div>
        <VoiceScope phase={phase} micStream={micStream}/>
        <div className="activity-status" role="status"><strong>{PHASE_LABELS[phase]}</strong><p>{phaseDetail}</p>{transcript && <small>Hai detto: «{transcript}»</small>}</div>
        <h2>Ascolta. <em>Chiedi.</em><br/>Approfondisci.</h2>
        <p className="panel-copy">{selectedArticle ? `Notizia selezionata: ${selectedArticle.title}` : first ? `Pronto a leggere ${visible.length} notizie. Premi Ascolta o seleziona un articolo.` : "Seleziona un canale con notizie disponibili."}</p>
        <div className="player-controls"><button className="play-button" disabled={!first || !(typeof window !== "undefined" && "speechSynthesis" in window)} onClick={togglePlayback}>{speaking && !paused ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}<span>{speaking && !paused ? "Metti in pausa" : paused ? "Riprendi" : "Ascolta il briefing"}</span></button><button className="stop-button" disabled={!speaking} aria-label="Ferma ascolto" onClick={stop}><Square size={16}/></button></div>
        <button className={`voice-command ${phase === "listening" ? "is-listening" : ""}`} onClick={listen} disabled={!first}><Mic size={17}/>{phase === "listening" || phase === "acknowledging" ? "Ferma ascolto" : "Parla a Jarvis"}</button>
        <button className="detail-command" onClick={() => void deepen(currentArticle.current || selectedArticle || first || null)} disabled={!first || ["finding","reading","summarizing"].includes(phase)}>Approfondisci la notizia selezionata</button>
        <p className="voice-hint">Tocca il microfono, attendi «TI ASCOLTO» e di': «approfondisci questa notizia».</p>
        {insight && <div className="insight-card" role="status"><strong>{insight.article.title}</strong>{insight.points ? <><small>{insight.coverage}</small>{insight.points.map((point, i) => <p key={i}>{point}</p>)}</> : <p>{insight.message}</p>}<a href={insight.sourceUrl || insight.article.link} target="_blank" rel="noopener noreferrer">Verifica sulla fonte originale <ArrowUpRight size={14}/></a></div>}
        <div className="player-note"><Headphones size={16}/> Voce e microfono dipendono dal browser · autorizza il microfono quando richiesto</div>
        <div className="panel-bottom"><span>PROSSIMA NOTIZIA</span><strong>{speaking && playingIndex !== null ? visible[playingIndex + 1]?.title || "Fine del briefing" : first?.title || "In attesa di notizie"}</strong></div>
      </aside></div>
    </main><footer className="footer"><span>JARVIS / NEWS</span><span>Le notizie provengono da fonti esterne. Apri la fonte per leggere l’articolo completo.</span></footer>
  </div>;
}
