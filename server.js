// Portföy Pusulası — canlı veri sunucusu (kendi sunucunuzda)
// Gereksinim: Node.js 18+ (yerleşik fetch).
// Kurulum:  npm init -y && npm install express
// Çalıştır: node server.js   →   http://localhost:3000
// Uygulamanın HTML'ini  public/index.html  olarak bu klasöre koyun.
//
// Uygulamadaki ⟳ düğmesi şu uçları çağırır (aynı sunucudan, kısıtlamasız):
//   /api/fx                         → USD/TL kuru
//   /api/quote?symbol=AAPL&market=us   veya  &market=bist
//   /api/fund?code=AFT              → TEFAS fon fiyatı
//
// NOT: BIST ve TEFAS verileri kamuya açık/gayriresmi kaynaklardan (Yahoo Finance,
// TEFAS) gecikmeli alınır; kişisel kullanım içindir, zaman zaman değişebilir.
// Kesintisiz/garantili veri için ücretli bir sağlayıcıya geçilebilir.

const express = require("express");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, "public")));

const UA = "Mozilla/5.0 (compatible; PortfoyPusulasi/1.0)";
const cache = {};                 // basit 60 sn önbellek
function cached(key, fn) {
  return async () => {
    const now = Date.now();
    if (cache[key] && now - cache[key].t < 60000) return cache[key].v;
    const v = await fn();
    cache[key] = { v, t: now };
    return v;
  };
}

/* ---- USD/TL ---- */
async function usdTry() {
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=TRY");
    const j = await r.json();
    if (j && j.rates && j.rates.TRY) return j.rates.TRY;
  } catch (e) {}
  try {
    const r = await fetch("https://api.exchangerate.host/latest?base=USD&symbols=TRY");
    const j = await r.json();
    if (j && j.rates && j.rates.TRY) return j.rates.TRY;
  } catch (e) {}
  return null;
}
app.get("/api/fx", async (_req, res) => {
  const v = await cached("fx", usdTry)();
  if (v == null) return res.status(502).json({ error: "Kur alınamadı" });
  res.json({ usdtry: Number(v.toFixed(4)) });
});

/* ---- Hisse (ABD + BIST) : Yahoo Finance (gayriresmi, gecikmeli) ---- */
async function yahoo(symbol) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
    encodeURIComponent(symbol) + "?interval=1d&range=1d";
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  const j = await r.json();
  const m = j && j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  return (m && (m.regularMarketPrice || m.previousClose)) || null;
}
app.get("/api/quote", async (req, res) => {
  const sym = (req.query.symbol || "").toUpperCase();
  const market = (req.query.market || "us").toLowerCase();
  if (!sym) return res.status(400).json({ error: "symbol gerekli" });
  const ysym = market === "bist" ? sym + ".IS" : sym;      // Borsa İstanbul: THYAO.IS
  try {
    const p = await cached("q:" + ysym, () => yahoo(ysym))();
    if (p == null) throw 0;
    res.json({ symbol: sym, market, price: p });
  } catch (e) {
    res.status(502).json({ error: "Fiyat alınamadı", symbol: sym });
  }
});

/* ---- TEFAS fonları (kamuya açık veri) ---- */
async function tefas(code) {
  const two = n => String(n).padStart(2, "0");
  const fmt = d => two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear();
  const today = new Date(), start = new Date(today);
  start.setDate(start.getDate() - 12);
  const body = new URLSearchParams({
    fontip: "YAT", fonkod: code, bastarih: fmt(start), bittarih: fmt(today),
  }).toString();
  const r = await fetch("https://www.tefas.gov.tr/api/DB/BindHistoryInfo", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
      "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  const j = await r.json();
  const data = (j && j.data) || [];
  if (!data.length) return null;
  data.sort((a, b) => Number(b.TARIH) - Number(a.TARIH));  // en yeni tarih
  return Number(data[0].FIYAT) || null;
}
app.get("/api/fund", async (req, res) => {
  const code = (req.query.code || "").toUpperCase();
  if (!code) return res.status(400).json({ error: "code gerekli" });
  try {
    const p = await cached("f:" + code, () => tefas(code))();
    if (p == null) throw 0;
    res.json({ code, price: p });
  } catch (e) {
    res.status(502).json({ error: "Fon fiyatı alınamadı", code });
  }
});

app.listen(PORT, () => console.log(`Portföy Pusulası →  http://localhost:${PORT}`));
