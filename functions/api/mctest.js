export async function onRequestGet() {
  try {
    const r = await fetch('https://www.moneycontrol.com/rss/buzzingstocks.xml', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(9000),
    });
    const text = await r.text();
    return new Response(JSON.stringify({status:r.status, len:text.length, preview:text.slice(0,300)}), {headers:{'Content-Type':'application/json'}});
  } catch(e) {
    return new Response(JSON.stringify({error:e.message}), {status:500,headers:{'Content-Type':'application/json'}});
  }
}
