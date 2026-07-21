import crypto from "node:crypto";
import http from "node:http";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export const FIREFOX_FIXTURE_HOSTS = Object.freeze([
  "00px.net",
  "abema.tv",
  "bam.nr-data.net",
  "eng-tips.com",
  "engineering.com",
  "example.test",
  "firecrux.com",
  "first.test",
  "fixture.test",
  "functional.sentry.io",
  "neowin.net",
  "news.yahoo.com",
  "other-frame.test",
  "publisher.test",
  "s.yimg.com",
  "screen13.com",
  "search.brave.com",
  "www.google-analytics.com",
]);

export async function startFirefoxFixtureServer() {
  const requests = [];
  const sockets = new Set();
  let fixturePort;
  const server = http.createServer((request, response) => {
    const host = getHostname(request.headers.host);
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    requests.push({
      host,
      method: request.method,
      path: url.pathname,
      refererPresent: typeof request.headers.referer === "string",
    });
    routeRequest({ fixturePort, host, request, response, url });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    const host = getHostname(request.headers.host);
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    requests.push({ host, method: "UPGRADE", path: url.pathname });
    if (
      (host !== "neowin.net" && host !== "127.0.0.1") ||
      url.pathname !== "/control"
    ) {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    const accept = crypto
      .createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    setTimeout(() => socket.end(), 100);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The Firefox fixture did not bind a TCP port.");
  }
  fixturePort = address.port;

  return {
    port: address.port,
    requests,
    url(host, pathname = "/") {
      return `http://${host}${pathname}`;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function routeRequest({ fixturePort, host, request, response, url }) {
  if (request.method !== "GET") {
    return send(response, 405, "text/plain; charset=utf-8", "GET only");
  }
  if (url.pathname.startsWith("/probe/")) {
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      createProbePage(host, url.pathname, fixturePort),
    );
  }
  if (host === "00px.net" && url.pathname === "/main-frame") {
    return send(
      response,
      200,
      "text/html; charset=utf-8",
      "<!doctype html><title>Main-frame control</title><main id=main-frame>loaded</main>",
    );
  }
  if (host === "first.test" && url.pathname === "/redirect-to-screen13") {
    response.writeHead(302, {
      location: "http://screen13.com/conversion/pixel?resource=image",
    });
    return response.end();
  }
  if (host === "screen13.com") {
    if (url.searchParams.get("resource") === "script") {
      return send(
        response,
        200,
        "text/javascript; charset=utf-8",
        "window.__epFixtureMark('screen13-script', 'loaded');",
      );
    }
    return send(response, 200, "image/png", PIXEL);
  }
  if (host === "firecrux.com" && url.pathname === "/track/event") {
    if (url.searchParams.get("resource") === "script") {
      return send(
        response,
        200,
        "text/javascript; charset=utf-8",
        "window.__epFixtureMark('firecrux-script', 'loaded');",
      );
    }
    return sendCorsJson(response, { received: true });
  }
  if (host === "bam.nr-data.net" && url.pathname === "/1/events") {
    return sendCorsJson(response, { exception: true });
  }
  if (host === "s.yimg.com" && url.pathname === "/aaq/vzm/tracker.js") {
    return send(
      response,
      200,
      "text/javascript; charset=utf-8",
      "window.__epFixtureMark('yahoo-source-script', 'loaded');",
    );
  }
  if (host === "engineering.com" && url.pathname === "/scripts/track.js") {
    return send(
      response,
      200,
      "text/javascript; charset=utf-8",
      "window.__epFixtureScriptLoaded = true;",
    );
  }
  if (host === "fixture.test" && url.pathname === "/allowed.js") {
    return send(
      response,
      200,
      "text/javascript; charset=utf-8",
      "window.__epFixtureMark('ordinary-allowed-script', 'loaded');",
    );
  }
  if (host === "search.brave.com" && url.pathname === "/api/feedback") {
    return sendCorsJson(response, { feedback: true });
  }
  if (host === "search.brave.com" && url.pathname === "/api/search") {
    return sendCorsJson(response, { search: true });
  }
  if (host === "functional.sentry.io" && url.pathname === "/functional") {
    return sendCorsJson(response, {
      refererPresent: typeof request.headers.referer === "string",
    });
  }
  if (host === "www.google-analytics.com" && url.pathname === "/g/collect") {
    return send(response, 200, "image/png", PIXEL);
  }
  return send(response, 404, "text/plain; charset=utf-8", "not found");
}

function createProbePage(host, pathname, fixturePort) {
  const probe = pathname.slice("/probe/".length);
  if (probe === "publisher" && host === "publisher.test") {
    return harness(`
      finish([
        image("screen13-image", "http://screen13.com/collect/pixel?resource=image"),
        script("screen13-script", "http://screen13.com/script/pixel?resource=script"),
        request("firecrux-xhr", "http://firecrux.com/track/event"),
        script("firecrux-script", "http://firecrux.com/track/event?resource=script"),
        image("redirect-image", "http://first.test/redirect-to-screen13"),
        image("privacy-image", "http://screen13.com/users/person%40example.test/550e8400-e29b-41d4-a716-446655440000/pixel.png?token=private-value"),
        script("ordinary-allowed-script", "http://fixture.test/allowed.js"),
        websocket("websocket-block", "ws://neowin.net/ws/socket"),
        websocket("websocket-control", "ws://127.0.0.1:${fixturePort}/control")
      ]);
    `);
  }
  if (probe === "control" && (host === "publisher.test" || host === "example.test")) {
    return harness(
      `finish([image("screen13-image", "http://screen13.com/pixel?resource=image")]);`,
    );
  }
  if (probe === "degraded" && host === "publisher.test") {
    return harness(`
      finish([
        image("catalog-google-analytics", "http://www.google-analytics.com/g/collect"),
        image("easyprivacy-only-screen13", "http://screen13.com/pixel?resource=image"),
        requestJson("sentry-referer", "http://functional.sentry.io/functional", value => value.refererPresent ? "present" : "absent")
      ]);
    `);
  }
  if (probe === "exception" && host === "abema.tv") {
    return harness(
      `finish([request("newrelic-exception", "http://bam.nr-data.net/1/events")]);`,
    );
  }
  if (probe === "source" && (host === "news.yahoo.com" || host === "example.test")) {
    return harness(
      `finish([script("yahoo-source-script", "http://s.yimg.com/aaq/vzm/tracker.js")]);`,
    );
  }
  if (probe === "first-party" && host === "search.brave.com") {
    return harness(`
      finish([
        request("first-party-feedback", "/api/feedback"),
        request("first-party-control", "/api/search")
      ]);
    `);
  }
  if (probe === "frame" && host === "publisher.test") {
    return harness(`
      finish([
        frame("framed-positive", "http://eng-tips.com/probe/frame-child"),
        frame("framed-negative", "http://other-frame.test/probe/frame-child")
      ]);
    `);
  }
  if (probe === "frame-child" && (host === "eng-tips.com" || host === "other-frame.test")) {
    return `<!doctype html><script>
      window.__epFixtureScriptLoaded = false;
      const element = document.createElement("script");
      element.src = "http://engineering.com/scripts/track.js";
      element.onload = () => parent.postMessage({ fixture: "frame-result", outcome: window.__epFixtureScriptLoaded ? "loaded" : "error" }, "*");
      element.onerror = () => parent.postMessage({ fixture: "frame-result", outcome: "blocked" }, "*");
      document.head.append(element);
    </script>`;
  }
  return "<!doctype html><main>unknown fixture</main>";
}

function harness(body) {
  return `<!doctype html><meta charset='utf-8'><link rel='icon' href='data:,'><pre id='results'>pending</pre><script>
    const results = Object.create(null);
    window.__epFixtureMark = (name, outcome) => { results[name] = outcome; };
    function image(name, url) { return new Promise(resolve => { const e = new Image(); e.onload = () => { results[name] = "loaded"; resolve(); }; e.onerror = () => { results[name] = "blocked"; resolve(); }; e.src = url; }); }
    function script(name, url) { return new Promise(resolve => { const e = document.createElement("script"); e.onload = () => { results[name] ??= "loaded"; resolve(); }; e.onerror = () => { results[name] = "blocked"; resolve(); }; e.src = url; document.head.append(e); }); }
    function request(name, url) { return fetch(url).then(() => { results[name] = "loaded"; }, () => { results[name] = "blocked"; }); }
    function requestJson(name, url, map) { return fetch(url).then(r => r.json()).then(value => { results[name] = map(value); }, () => { results[name] = "blocked"; }); }
    function websocket(name, url) { return new Promise(resolve => { const ws = new WebSocket(url); const done = outcome => { results[name] = outcome; try { ws.close(); } catch {} resolve(); }; ws.onopen = () => done("loaded"); ws.onerror = () => done("blocked"); setTimeout(() => { if (!(name in results)) done("timeout"); }, 2000); }); }
    function frame(name, url) { return new Promise(resolve => { const e = document.createElement("iframe"); const listener = event => { if (event.source === e.contentWindow && event.data?.fixture === "frame-result") { window.removeEventListener("message", listener); results[name] = event.data.outcome; resolve(); } }; window.addEventListener("message", listener); e.src = url; document.body.append(e); }); }
    function finish(tasks) { Promise.all(tasks).then(() => { document.querySelector("#results").textContent = JSON.stringify(results); document.documentElement.dataset.fixtureComplete = "true"; }); }
    ${body}
  </script>`;
}

function sendCorsJson(response, value) {
  response.setHeader("access-control-allow-origin", "*");
  return send(response, 200, "application/json", JSON.stringify(value));
}

function send(response, status, contentType, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": contentType,
  });
  response.end(body);
}

function getHostname(hostHeader) {
  try {
    return new URL(`http://${hostHeader}`).hostname;
  } catch {
    return "";
  }
}
