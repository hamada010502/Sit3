import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/auth';
export async function POST(req: Request) {
  destroySession();
  return NextResponse.redirect(new URL('/', req.url), { status: 303 });
}
export const GET = POST;
