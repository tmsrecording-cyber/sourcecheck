# SourceCheck Backend — Quick Setup

## 1. Install dependencies
```bash
cd backend
npm install
```

## 2. Set up environment
```bash
cp .env.example .env.local
# Edit .env.local with your API keys
```

To try Gemini 2.5 Pro, add this line to `.env.local` and restart the backend:

```bash
GEMINI_MODEL=gemini-2.5-pro
```

If `GEMINI_MODEL` is unset, the backend falls back to the current fast default in code.

If you deploy the backend anywhere other than `localhost`, set both
`ALLOWED_EXTENSION_IDS` and `EXTENSION_API_TOKEN` in `.env.local` or your hosting provider.
The extension must be built with matching `VITE_API_BASE` and `VITE_EXTENSION_API_TOKEN`
values so the manifest host permissions and request headers line up with the deployed API.
When `EXTENSION_API_TOKEN` is set, extension requests are also timestamp-signed per request.

## 3. Run the dev server
```bash
npm run dev
# Server starts at http://localhost:3000
```

For the extension, copy the root `.env.example` to `.env` and set `VITE_API_BASE`
before running `npm run build`.

## 4. Test the pipeline (before wiring to the extension)
```bash
npm run test:pipeline
# Sends a fake Huberman transcript through the full pipeline
# You should see claims extracted and source cards generated
```

## 5. Deploy to Vercel
```bash
npx vercel
# Follow the prompts, add your env vars in the Vercel dashboard
```

## File Overview

```
src/
├── app/api/
│   ├── analyze-chunk/route.ts   ← Claim extraction endpoint
│   ├── ask-video/route.ts       ← Video Q&A endpoint
│   └── verify-claim/route.ts    ← Source card generation endpoint
├── lib/
│   ├── gemini.ts                ← Gemini API wrapper
│   └── prompts.ts               ← ALL prompts (core IP, don't scatter)
├── proxy.ts                      ← CORS + request gating for the extension
scripts/
└── test-pipeline.ts             ← Test without the extension
shared/
└── types.ts                     ← Types shared with extension
```
