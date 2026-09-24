import type { NextRequest } from "next/server";

export const runtime = "nodejs";

type Event = { phase: string; detail: string; result?: { points: string[]; sourceUrl: string; sourceName: string; coverage: string }; error?: string };
const encoder = new TextEncoder();
const decode = (value: string) => value.replace(/<[^>]+>/g, " ")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10)))
  .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, x => ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" })[x.toLowerCase()] || x)
  .replace(/\s+/g, " ").trim();
const normalize = (value: string) => value.toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]/gu, "");

function publicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password || !host.includes(".") ||
      /^(localhost|\d+\.\d+\.\d+\.\d+|\[|.*\.(?:local|internal|localhost))$/.test(host)) throw new Error("Indirizzo della fonte non valido.");
  return url;
}
async function fetchPage(start: URL) {
  let target = start;
  for (let i = 0; i < 5; i++) {
    const response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(6500), cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisNews/1.4)", Accept: "text/html,application/xhtml+xml" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect incompleto.");
      target = publicUrl(new URL(location, target).toString());
      continue;
    }
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) throw new Error("Articolo non raggiungibile.");
    return { html: (await response.text()).slice(0, 1_200_000), url: target };
  }
  throw new Error("Troppi redirect.");
}
async function findPublisher(title: string) {
  const rss = new URL("https://www.bing.com/news/search");
  rss.searchParams.set("q", `"${title.slice(0, 115)}"`);
  rss.searchParams.set("format", "rss");
  rss.searchParams.set("setlang", "it");
  const response = await fetch(rss, { signal: AbortSignal.timeout(6500), cache: "no-store" });
  if (!response.ok) throw new Error("Ricerca della fonte non disponibile.");
  const xml = await response.text();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const heading = decode(match[1].match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
    const needle = normalize(title).slice(0, 45);
    if (needle.length < 15 || !normalize(heading).includes(needle)) continue;
    const rawLink = decode(match[1].match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    try { return publicUrl(rawLink); } catch { /* Try the next match. */ }
  }
  throw new Error("Non ho trovato una corrispondenza verificabile per questa notizia.");
}
function extract(html: string) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || html;
  const clean = article.replace(/<(script|style|nav|footer|header|aside|form|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const paragraphs = [...clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(m => decode(m[1])).filter(p => p.length > 75 && p.length < 1800 && !/cookie|privacy policy|iscriviti|newsletter|abbonati/i.test(p));
  const unique = [...new Set(paragraphs)];
  if (unique.join(" ").length < 320) throw new Error("La testata non rende accessibile abbastanza testo per una sintesi affidabile.");
  return unique;
}
function summarize(paragraphs: string[]) {
  // Short extractive points: no claims beyond the article text and no fabricated context.
  const points: string[] = [];
  for (const paragraph of paragraphs) {
    const sentence = paragraph.match(/^.{75,230}?[.!?](?=\s|$)/u)?.[0] || paragraph.slice(0, 205).replace(/\s+\S*$/, "") + "…";
    if (points.some(p => normalize(p).slice(0, 50) === normalize(sentence).slice(0, 50))) continue;
    points.push(sentence);
    if (points.length === 3) break;
  }
  return points;
}
export async function POST(request: NextRequest) {
  let link: URL, title: string, source: string;
  try {
    const body = await request.json() as { link?: unknown; title?: unknown; source?: unknown };
    link = publicUrl(String(body.link || ""));
    if (!/^(news\.google\.com|www\.bing\.com)$/.test(link.hostname)) throw new Error();
    title = String(body.title || "").trim().slice(0, 200);
    source = String(body.source || "").trim().slice(0, 100);
    if (title.length < 12) throw new Error();
  } catch { return Response.json({ error: "Dati della notizia non validi." }, { status: 400 }); }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Event) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ phase: "finding", detail: "Cerco l'articolo originale…" });
        let page = await fetchPage(link).catch(() => null);
        if (!page || /^(news\.google\.com|www\.bing\.com)$/.test(page.url.hostname)) {
          const publisher = await findPublisher(title);
          page = await fetchPage(publisher);
        }
        if (/^(news\.google\.com|www\.bing\.com)$/.test(page.url.hostname)) throw new Error("Il link non conduce al testo della testata.");
        send({ phase: "reading", detail: `Leggo il testo accessibile su ${page.url.hostname}…` });
        const paragraphs = extract(page.html);
        send({ phase: "summarizing", detail: "Seleziono i punti principali…" });
        const points = summarize(paragraphs);
        send({ phase: "ready", detail: "Sintesi pronta. La leggo adesso.", result: { points, sourceUrl: page.url.toString(), sourceName: source || page.url.hostname, coverage: `Sintesi estrattiva basata su ${paragraphs.length} paragrafi accessibili della fonte.` } });
      } catch (error) {
        send({ phase: "error", detail: "Impossibile approfondire questa fonte.", error: error instanceof Error ? error.message : "Fonte non accessibile." });
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
