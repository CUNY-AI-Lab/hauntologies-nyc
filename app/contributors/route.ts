// Keep old bookmarks useful after retiring the standalone directory.
export function GET() {
  return new Response(null, { status: 302, headers: {
    location: '/#contributors',
    'cache-control': 'no-store',
  } });
}
