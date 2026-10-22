import html from '../../web/dashboard.html?raw';

export function GET() {
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}
