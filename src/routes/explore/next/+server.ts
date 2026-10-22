import { redirect, type RequestHandler } from '@sveltejs/kit';

// The magazine page was previewed here before the cutover; it is /explore now.
export const GET: RequestHandler = ({ url }) => redirect(301, `/explore${url.search}`);
