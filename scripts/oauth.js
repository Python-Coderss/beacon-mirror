// Completes a wrangler Cloudflare OAuth login over the device flow.
//
//   node scripts/oauth.js <userCode>
//
// Wrangler prints a device code and waits five minutes for approval. This
// enters the code in a Chrome instance that already has a Cloudflare session
// and clicks the approve button, over the DevTools protocol. No credentials
// are handled here.
//
// The device flow is used rather than the localhost callback because the
// callback has a short timeout that a slow approval can miss.

const CODE = process.argv[2];
const CDP = "http://127.0.0.1:9222";

if (!CODE) {
  console.error("usage: node scripts/oauth.js <userCode>");
  process.exit(1);
}

async function cdpPage() {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    const created = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
    page = await created.json();
  }
  return page;
}

const page = await cdpPage();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");

const readPage = async () => {
  const r = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      url: location.href,
      title: document.title,
      text: (document.body ? document.body.innerText : '').slice(0, 1500),
      inputs: Array.from(document.querySelectorAll('input')).map((i) => ({
        name: i.name, id: i.id, type: i.type, placeholder: i.placeholder
      })),
      buttons: Array.from(document.querySelectorAll('button,input[type=submit],a[role=button]'))
        .map((b) => (b.innerText || b.value || '').trim()).filter(Boolean)
    })`,
    returnByValue: true,
  });
  return JSON.parse(r.result.value);
};

console.log("opening the device verify page");
await send("Page.navigate", { url: `https://dash.cloudflare.com/oauth2/device/verify` });
await new Promise((r) => setTimeout(r, 5000));

let info = await readPage();
console.log(`  at ${info.url}`);
console.log(`  title: ${info.title}`);

if (/log in|sign in|email address/i.test(info.text) && !/code|verify|authorize/i.test(info.text)) {
  console.log("  the page asks for a sign-in; the Cloudflare session did not carry over");
  console.log(`  text: ${info.text.slice(0, 500)}`);
  process.exit(1);
}

// Enter the code.
const filled = await send("Runtime.evaluate", {
  expression: `(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    const target = inputs.find((i) => /code|user/i.test((i.name||'') + ' ' + (i.id||'') + ' ' + (i.placeholder||'')))
      || inputs.find((i) => i.type === 'text' || i.type === 'tel' || !i.type);
    if (!target) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(target, ${JSON.stringify(CODE)});
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return target.name || target.id || 'input';
  })()`,
  returnByValue: true,
});
console.log(`  entered code into: ${filled.result.value ?? "(no field found)"}`);

await new Promise((r) => setTimeout(r, 2500));

// Submit / approve.
for (let attempt = 0; attempt < 10; attempt++) {
  const clicked = await send("Runtime.evaluate", {
    expression: `(() => {
      const wanted = ['continue','verify','submit','next','authorize','allow','approve','confirm','go'];
      const els = Array.from(document.querySelectorAll('button,input[type=submit],a[role=button]'));
      for (const el of els) {
        const label = (el.innerText || el.value || '').trim().toLowerCase();
        if (wanted.some((w) => label === w || label.startsWith(w + ' ') || label.startsWith(w))) {
          el.click();
          return label;
        }
      }
      return null;
    })()`,
    returnByValue: true,
  });

  info = await readPage();
  if (clicked.result.value) {
    console.log(`  clicked "${clicked.result.value}" -> ${info.url}`);
    await new Promise((r) => setTimeout(r, 3500));
    info = await readPage();
    if (/success|authorized|approved|granted|device/i.test(info.text) && !/verify/i.test(info.text)) {
      console.log(`  page says: ${info.text.slice(0, 200).replace(/\n+/g, " ")}`);
      ws.close();
      process.exit(0);
    }
  } else {
    console.log(`  waiting... buttons: ${info.buttons.join(", ") || "(none)"}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

console.log("  could not confirm approval");
console.log(`  text: ${info.text.slice(0, 700)}`);
ws.close();
process.exit(1);
