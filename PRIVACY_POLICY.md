# SourceCheck Privacy Policy

*Last updated: March 2026*

---

## Summary

SourceCheck does not collect, store, or sell your personal data. It reads live caption text from the YouTube video you are watching, sends that text to Google's Gemini AI for claim verification using your own API key, and displays the results locally in your browser. Nothing else.

---

## What data SourceCheck processes

### Caption text (transcript)
SourceCheck reads the live caption track from the YouTube video you are watching. This text is:
- Processed locally in your browser's extension service worker
- Sent to our verification backend only when a checkable claim is detected
- **Never stored on our servers**
- **Never associated with your identity**
- Discarded from memory when you close the tab or navigate away

### Your API key
If you enter a Google AI Studio API key:
- It is stored in your browser's local extension storage (on your device only)
- It is never transmitted to our servers
- By default, it is stored only for the current browser session and cleared when the browser closes
- You can opt into persistent storage with the "Remember key" toggle in settings
- You can remove the key at any time from the settings panel

### No other data
SourceCheck does not collect:
- Your identity, name, or email
- Your browsing history or visited URLs beyond the active tab
- Video watch history
- Audio or video from your device
- Cookies or cross-site tracking data
- Crash reports or analytics

---

## How verification works

When SourceCheck detects a potentially checkable claim in a video's captions:

1. The claim text is extracted and sent to our verification backend (not to Google directly)
2. Our backend forwards the request to Google's Gemini AI using your API key
3. The response (verdict, evidence, source) is returned to your browser and displayed in the side panel
4. **Our backend does not log or store the claim text, your API key, or the response**

Our backend enforces rate limits using an anonymous session token tied to your browser session only. This token does not identify you.

---

## Third-party services

### Google Gemini AI
Claim verification uses Google's Gemini API. When claims are verified, the claim text is sent to Google's servers under your API key. Google's use of this data is governed by the [Google API Terms of Service](https://developers.google.com/terms) and [Google's Privacy Policy](https://policies.google.com/privacy).

### YouTube
SourceCheck reads caption data from YouTube pages you are already visiting. No additional data is sent to YouTube. YouTube's use of your data is governed by [Google's Privacy Policy](https://policies.google.com/privacy).

---

## Data storage

| Data | Where stored | When cleared |
|------|-------------|--------------|
| API key (no "Remember key") | Browser session storage | When browser closes |
| API key (with "Remember key") | Browser local storage | When you remove it manually |
| Verification results | Browser session storage | When browser closes |
| Transcript text | Browser memory only | When tab closes / navigated away |

No data is stored on SourceCheck's servers.

---

## Children's privacy

SourceCheck is not directed at children under 13. We do not knowingly collect any information from children.

---

## Changes to this policy

If we make material changes to this policy, we will update the "Last updated" date above and note the changes in the extension's release notes.

---

## Contact

Questions about this privacy policy? Open an issue at:
https://github.com/[your-handle]/sourcecheck/issues

Or email: [your-contact-email]
