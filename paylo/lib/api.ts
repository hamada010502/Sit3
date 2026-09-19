import { NextResponse } from 'next/server';
import { sellerForToken } from './apitokens';
import type { Seller } from './types';

/** Bearer-token gate for the public REST API. Returns the seller or a 401 response. */
export function authenticate(req: Request): { seller: Seller } | { response: NextResponse } {
  const seller = sellerForToken(req.headers.get('authorization'));
  if (!seller) {
    return { response: NextResponse.json({ error: { type: 'unauthorized', message: 'Provide a valid Bearer token.' } }, { status: 401 }) };
  }
  return { seller };
}

export const apiError = (type: string, message: string, status: number) =>
  NextResponse.json({ error: { type, message } }, { status });

export function pagination(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10) || 0);
  return { limit, offset, params: url.searchParams };
}
