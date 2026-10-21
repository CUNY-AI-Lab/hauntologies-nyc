import { env } from 'cloudflare:workers';
import { handleRegistration } from '../../../server/registration.mjs';
export const dynamic = 'force-dynamic';
export function POST(request: Request) { return handleRegistration(request, env); }
