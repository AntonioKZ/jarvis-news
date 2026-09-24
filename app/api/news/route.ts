import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const QUERIES: Record<string, string> = {
  ai: '"intelligenza artificiale" OR "AI generativa" tecnologia when:7d',
  engineering: 'ingegneria elettronica OR automazione industriale when:7d',
  software: 'software cybersecurity informatica when:7d',
  semiconductors: 'semiconduttori OR chip OR elettronica di potenza when:7d',
  energy: 'energia fotovoltaico batterie rete elettrica when:7d',
  funding: 'bandi ricerca sviluppo innovazione imprese Sicilia when:7d',
  economy: 'economia imprese Italia Europa when:7d',
  politics: 'politica Italia Europa when:7d',
  iot: 'IoT sensori automazione industriale when:7d',
  travel: 'turismo agenzie viaggi mercato Italia when:7d',
};
function decode(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => String.fromCodePoint(n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : parseInt(n, 10)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, e => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[e] || e)
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}
function field(xml: string, name: string) {
  return decode(xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "");
}
export async function getFeed(topic: string, query: string) {
  const urls = [
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=it&gl=IT&ceid=IT:it`,
    `https://www.bing.com/news/search?q=${encodeURIComponent(query.replace(" when:7d", ""))}&format=rss&setlang=it`,
  ];
  let xml = "";
  const reasons: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { headers: { "Accept": "application/rss+xml,application/xml,text/xml", "User-Agent": "Mozilla/5.0 (compatible; JarvisNews/1.1)" }, signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (response.ok) {
        const body = await response.text();
        if (body.includes("<rss") && /<item(?:\s[^>]*)?>/i.test(body)) { xml = body; break; }
      }
      reasons.push(`${new URL(url).hostname}: HTTP ${response.status}`);
    } catch (error) { reasons.push(`${new URL(url).hostname}: ${error instanceof Error ? error.name : "errore"}`); }
  }
  if (!xml) throw new Error(reasons.join("; "));
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0, 10).map(m => {
    const item = m[1], rawTitle = field(item, "title"), source = field(item, "source") || "Google News";
    const title = source !== "Google News" && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -source.length - 3) : rawTitle;
    const link = field(item, "link");
    const published = field(item, "pubDate");
    const rawDescription = field(item, "description");
    const cleaned = rawDescription.replace(/\u00a0|&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    const normalized = (value: string) => value.toLocaleLowerCase("it").replace(/[^\p{L}\p{N}]/gu, "");
    const description = normalized(cleaned).startsWith(normalized(rawTitle)) || normalized(cleaned) === normalized(source)
      ? "" : cleaned.slice(0, 260);
    const date = new Date(published);
    return { id: `${topic}-${link}`, topic, title, source, link, published: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(), description };
  }).filter(a => a.title && a.link && /^https:\/\//.test(a.link));
}
export async function GET(request: NextRequest) {
  const selected = [...new Set((request.nextUrl.searchParams.get("topics") || "").split(",").filter(id => id in QUERIES))].slice(0, 10);
  const keywords = (request.nextUrl.searchParams.get("keywords") || "").trim().slice(0, 100).replace(/[<>]/g, "");
  const tasks = selected.map(id => ({ id, query: QUERIES[id] }));
  if (keywords) tasks.push({ id: "custom", query: `${keywords} when:7d` });
  if (!tasks.length) return NextResponse.json({ articles: [], failed: [] });
  const results = await Promise.allSettled(tasks.map(t => getFeed(t.id, t.query)));
  const failed = tasks.filter((_, i) => results[i].status === "rejected").map(t => t.id);
  const errors = tasks.flatMap((task, i) => results[i].status === "rejected" ? [{ topic: task.id, reason: String((results[i] as PromiseRejectedResult).reason?.message || "Fonte non raggiungibile") }] : []);
  const seen = new Set<string>();
  const articles = results.flatMap(r => r.status === "fulfilled" ? r.value : [])
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published))
    .filter(a => { const key = a.title.toLowerCase().replace(/\W/g, ""); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 50);
  return NextResponse.json({ articles, failed, errors, error: failed.length === tasks.length ? "Le fonti esterne non rispondono al server." : undefined, fetchedAt: new Date().toISOString() }, { status: failed.length === tasks.length ? 503 : 200, headers: { "Cache-Control": "private, no-store" } });
}
