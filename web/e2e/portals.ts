// Portal falso en localhost: una pagina normal y otra con un "captcha" que
// se resuelve pulsando un boton, como haria una persona.
import { createServer, type Server } from 'node:http';

export const LISTING = '<html><body>' + '<article class="item">piso</article>'.repeat(50) + '</body></html>';
const CAPTCHA = `<html><body><iframe src="https://geo.captcha-delivery.com/c"></iframe>
<button id="solve" onclick="document.body.innerHTML = '${'<article class=item>piso</article>'.repeat(50)}'">I am human</button></body></html>`;

export function startPortals(port = 4599): Promise<Server> {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(req.url?.startsWith('/captcha') ? CAPTCHA : LISTING);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
