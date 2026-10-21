import { handleRequest } from '../../../../server/runtime';
export const dynamic='force-dynamic';
export function POST(request:Request){return handleRequest(request)}
