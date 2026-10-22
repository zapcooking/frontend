import { redirect, type RequestHandler } from '@sveltejs/kit';

// Retired with the old explore page (no inbound links); the new /explore covers it.
export const GET: RequestHandler = ({ url }) => redirect(301, `/explore${url.search}`);
