import { proxy } from './src/proxy';

export const middleware = proxy;

export const config = {
  matcher: '/api/:path*',
};
