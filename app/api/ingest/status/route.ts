import { handleRequest } from '../../../../server/runtime';
export const dynamic='force-dynamic';
export function GET(request:Request){return handleRequest(request)}
