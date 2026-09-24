import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function decode(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10)))
    .replace(/&(?:nbsp|amp|quot|apos|lt|gt);/gi, x => ({ "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" })[x.toLowerCase()] || x)
    .replace(/\s+/g, " ").trim();
}

function safeUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Indirizzo non valido");
  if (!/^(news\.google\.com|www\.bing\.com)$/.test(url.hostname)) throw new Error("Fonte non supportata");
  return url;
}
function publicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port || url.username || url.password || !host.includes(".") ||
      /^(localhost|\d+\.\d+\.\d+\.\d+|\[|.*\.(?:local|internal|localhost))$/.test(host)) throw new Error("Redirect non sicuro");
  return url;
}

export async function POST(request: NextRequest) {
  let link: URL;
  try {
    const body = await request.json() as { link: string };
    link = safeUrl(body.link);
  } catch { return NextResponse.json({ error: "Link della notizia non valido." }, { status: 400 }); }

  try {
    let target = link;
    let response: Response | undefined;
    for (let i = 0; i < 4; i++) {
      response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(8000), cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisNews/1.3)" } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect incompleto");
      target = publicUrl(new URL(location, target).toString());
    }
    if (!response) throw new Error("Fonte non accessibile");
    const type = response.headers.get("content-type") || "";
    if (!response.ok || !type.includes("text/html")) throw new Error("Fonte non accessibile");
    const html = (await response.text()).slice(0, 1_000_000);
    const finalHost = target.hostname;
    if (finalHost === "news.google.com" || finalHost.endsWith("bing.com")) throw new Error("La fonte non ha fornito il testo dell'articolo.");
    const withoutNoise = html.replace(/<(script|style|nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
    const paragraphs = [...withoutNoise.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
      .map(match => decode(match[1])).filter(p => p.length > 85 && p.length < 1800 && !/cookie|privacy policy|iscriviti|newsletter/i.test(p));
    if (paragraphs.join(" ").length < 450) throw new Error("Il testo completo non è accessibile automaticamente.");
    // An extractive overview is labeled as such; never imply an AI-generated full-article summary.
    const overview = paragraphs.slice(0, 3).map(p => p.slice(0, 220).replace(/\s+\S*$/, "") + (p.length > 220 ? "…" : ""));
    return NextResponse.json({ overview, url: response.url, fullTextAvailable: true });
  } catch {
    return NextResponse.json({ error: "Non riesco a leggere il testo completo dalla fonte. Apri l'articolo originale per approfondire." }, { status: 422 });
  }
}
