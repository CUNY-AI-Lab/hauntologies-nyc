import html from '../../web/guide.html?raw';

export function GET() {
  return new Response(html, { headers: {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'same-origin',
  } });
}
