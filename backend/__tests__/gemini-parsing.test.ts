/**
 * Security / reliability tests for JSON parsing from Gemini model output.
 *
 * Fix: Gemini Flash 3 JSON Parsing Reliability
 *   - `parseJsonResponse` in `lib/gemini.ts` was made more robust. It now
 *     proactively extracts JSON from markdown code fences (` ```json ... ``` `)
 *     even if there is conversational preamble/postamble text.
 *   - If code fences are not found, it falls back to extracting the first
 *     balanced JSON object from the raw text, making it resilient to stray
 *     characters like `{` in filler text.
 */

import { describe, it, expect } from 'vitest';
import { parseJsonResponse } from '../src/lib/gemini';

describe('Fix: Gemini Flash 3 JSON Parsing Reliability', () => {
  const expected = {
    status: 'supported',
    sourceTitle: 'CDC Report 2023',
  };
  const expectedJsonString = JSON.stringify(expected, null, 2);

  it('PASS: Handles conversational preamble before a JSON code fence', () => {
    const rawOutput = `Of course! Here is the verification for the claim:\n\n\`\`\`json\n${expectedJsonString}\n\`\`\``;
    const result = parseJsonResponse(rawOutput);
    expect(result).toEqual(expected);
  });

  it('PASS: Handles conversational preamble without a code fence', () => {
    const rawOutput = `Sure, I've analyzed that. The result is:\n${expectedJsonString}`;
    const result = parseJsonResponse(rawOutput);
    expect(result).toEqual(expected);
  });

  it('PASS: Handles stray curly braces in preamble text before the main JSON object', () => {
    const rawOutput = `Analysis complete (confidence: {high}). The claim is supported.\n${expectedJsonString}`;
    const result = parseJsonResponse(rawOutput);
    expect(result).toEqual(expected);
  });

  it('PASS: Handles trailing commas in the JSON object', () => {
    const rawOutput = `\`\`\`json\n{\n  "status": "supported",\n  "sourceTitle": "CDC Report 2023",\n}\n\`\`\``;
    const result = parseJsonResponse(rawOutput);
    expect(result).toEqual(expected);
  });

  it('PASS: Handles plain code fences without the "json" language tag', () => {
    const rawOutput = `Here is the data:\n\n\`\`\`\n${expectedJsonString}\n\`\`\``;
    const result = parseJsonResponse(rawOutput);
    expect(result).toEqual(expected);
  });

  it('PASS: Handles a top-level JSON array after a conversational preamble', () => {
    const expectedArray = [{ id: 1 }, { id: 2 }];
    const rawOutput = `Here is the list of items:\n${JSON.stringify(expectedArray)}`;
    const result = parseJsonResponse<typeof expectedArray>(rawOutput);
    expect(result).toEqual(expectedArray);
  });

  it('FAIL: Throws an error if the code fence is empty', () => {
    const rawOutput = `I found no valid data to report.\n\`\`\`json\n   \n\`\`\``;
    expect(() => parseJsonResponse(rawOutput)).toThrow('No JSON object or array found in Gemini response.');
  });

  it('FAIL: Throws an error if no JSON object is found', () => {
    const rawOutput = `I could not find any verifiable claim in the provided text.`;
    expect(() => parseJsonResponse(rawOutput)).toThrow('No JSON object or array found in Gemini response.');
  });
});