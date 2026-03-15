# SourceCheck Privacy Policy

*Last updated: 2026-03-15*

## What SourceCheck does

SourceCheck is a browser extension that reads the transcript of a YouTube video you are watching, extracts factual claims from it, verifies those claims against web sources, and lets you ask questions about the video content.

## Data processed and where it goes

| Data | When it is sent | Destination |
|------|----------------|-------------|
| YouTube video ID, title, and channel name | When a watch page loads | SourceCheck backend |
| Video transcript text (verbatim, up to ~16 000 characters per chunk) | During claim extraction | SourceCheck backend → Google Gemini API |
| Extracted claim text (up to 700 characters) | During claim verification | SourceCheck backend → Google Gemini API + Google Search (grounding) |
| Your typed question (up to 500 characters) and surrounding transcript context | When you submit a question | SourceCheck backend → Google Gemini API |

**Google Gemini** is used for claim extraction, verification reasoning, and answering questions.
**Google Search grounding** is used during claim verification only; Gemini queries Google Search in real time to find supporting or contradicting sources, and the resulting URLs are shown to you in the extension.

The SourceCheck backend acts as an intermediary. It does not store your questions or transcript text beyond what is required to fulfil the immediate request.

## What is stored locally on your device

| Storage | Contents | Cleared when |
|---------|----------|--------------|
| `chrome.storage.local` | Full transcript for the current video | You navigate to a different video or the extension reloads |
| `chrome.storage.session` | Runtime state: current video metadata, verified source cards, pending claims, debug log | Browser tab is closed |
| In-memory React state | Your Q&A history for the current session | Browser tab is closed or page is refreshed |

Q&A history is **not** persisted between browser sessions.

## What is not collected

- No account, login, or identity information is collected or transmitted.
- No browsing history outside of the active YouTube watch page is accessed.
- No data is sold or shared with third parties for advertising purposes.

## Third-party services

- **Google Gemini API** — subject to [Google's privacy policy](https://policies.google.com/privacy) and the [Gemini API additional terms](https://ai.google.dev/gemini-api/terms).
- **Google Search (grounding)** — accessed through Gemini's grounding feature; subject to [Google's privacy policy](https://policies.google.com/privacy).

## Contact

To report a privacy concern, open an issue in the SourceCheck repository.
