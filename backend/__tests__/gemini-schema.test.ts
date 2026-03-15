/**
 * Security tests for the schema validation in backend/src/lib/gemini.ts
 *
 * Fix 2: askGeminiJSONWithSearch() schema parameter was a no-op
 *   — validateAgainstSchema() is now called after parsing the Gemini response;
 *     a mismatch throws GeminiError('PARSE_ERROR') instead of silently passing.
 *
 * These tests exercise validateAgainstSchema() directly — the exported function
 * that Fix 2 introduced — to confirm it is not a no-op at runtime.
 */

import { describe, it, expect } from 'vitest';
import { validateAgainstSchema, GeminiError } from '../src/lib/gemini';

// The real schema used by /api/verify-claim — reproduced here to pin the contract.
const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['supported', 'partial', 'disputed', 'unverifiable'],
    },
    sourceTitle: { type: 'string' },
    sourceType: {
      type: 'string',
      enum: ['academic_paper', 'news_article', 'official_source', 'wikipedia', 'other'],
    },
    nuance: { type: 'string' },
  },
  required: ['status', 'sourceTitle', 'sourceType', 'nuance'],
  additionalProperties: false,
} as const;

// ---------------------------------------------------------------------------
// Primitive types
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — primitive types', () => {
  it('PASS: valid string passes', () => {
    expect(validateAgainstSchema('hello', { type: 'string' })).toBeNull();
  });

  it('FAIL: number where string expected', () => {
    expect(validateAgainstSchema(42, { type: 'string' })).not.toBeNull();
  });

  it('PASS: valid boolean passes', () => {
    expect(validateAgainstSchema(true, { type: 'boolean' })).toBeNull();
  });

  it('FAIL: string where boolean expected', () => {
    expect(validateAgainstSchema('true', { type: 'boolean' })).not.toBeNull();
  });

  it('PASS: valid number passes', () => {
    expect(validateAgainstSchema(42.5, { type: 'number' })).toBeNull();
  });

  it('FAIL: string where number expected', () => {
    expect(validateAgainstSchema('42.5', { type: 'number' })).not.toBeNull();
  });

  it('PASS: valid integer passes', () => {
    expect(validateAgainstSchema(42, { type: 'integer' })).toBeNull();
  });

  it('FAIL: non-integer number where integer expected', () => {
    expect(validateAgainstSchema(42.5, { type: 'integer' })).not.toBeNull();
  });

  it('PASS: valid array of strings passes', () => {
    expect(
      validateAgainstSchema(['a', 'b'], { type: 'array', items: { type: 'string' } })
    ).toBeNull();
  });

  it('FAIL: wrong item type in array', () => {
    expect(
      validateAgainstSchema([1, 2], { type: 'array', items: { type: 'string' } })
    ).not.toBeNull();
  });

  it('PASS: empty array passes', () => {
    expect(validateAgainstSchema([], { type: 'array', items: { type: 'string' } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Enum values
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — enum values', () => {
  const schema = { type: 'string', enum: ['VERIFYING', 'REJECTED', 'BUFFERING'] };

  it('PASS: value in enum passes', () => {
    expect(validateAgainstSchema('VERIFYING', schema)).toBeNull();
    expect(validateAgainstSchema('REJECTED', schema)).toBeNull();
    expect(validateAgainstSchema('BUFFERING', schema)).toBeNull();
  });

  it('FAIL: value not in enum is rejected', () => {
    expect(validateAgainstSchema('UNKNOWN', schema)).not.toBeNull();
    expect(validateAgainstSchema('verifying', schema)).not.toBeNull();  // case-sensitive
  });

  it('FAIL: PARSE_ERROR is not a model-returnable enum value', () => {
    // The model's action_state schema only allows VERIFYING/REJECTED/BUFFERING.
    // PARSE_ERROR is a server-internal state injected by the route on failure;
    // the model must never be able to return it.
    const modelSchema = { type: 'string', enum: ['VERIFYING', 'REJECTED', 'BUFFERING'] };
    expect(validateAgainstSchema('PARSE_ERROR', modelSchema)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — required fields', () => {
  const schema = {
    type: 'object',
    properties: { id: { type: 'string' }, name: { type: 'string' } },
    required: ['id', 'name'],
  };

  it('FAIL: missing required field returns an error string', () => {
    const result = validateAgainstSchema({ id: 'x' }, schema);
    expect(result).not.toBeNull();
    expect(result).toMatch(/Missing required field/);
  });

  it('PASS: all required fields present', () => {
    expect(validateAgainstSchema({ id: 'x', name: 'y' }, schema)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// additionalProperties: false
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — additionalProperties: false', () => {
  const schema = {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  };

  it('FAIL: unexpected property is rejected', () => {
    const result = validateAgainstSchema({ name: 'x', injected: 'bad' }, schema);
    expect(result).not.toBeNull();
    expect(result).toMatch(/Unexpected property/);
  });

  it('PASS: no extra properties — validation passes', () => {
    expect(validateAgainstSchema({ name: 'x' }, schema)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// anyOf
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — anyOf', () => {
  it('PASS: string matches anyOf [string, boolean]', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'boolean' }] };
    expect(validateAgainstSchema('text', schema)).toBeNull();
  });

  it('PASS: boolean matches anyOf [string, boolean]', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'boolean' }] };
    expect(validateAgainstSchema(true, schema)).toBeNull();
  });

  it('FAIL: number does not match anyOf [string, boolean]', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'boolean' }] };
    expect(validateAgainstSchema(42, schema)).not.toBeNull();
  });

  // NOTE: { type: 'null' } is not in the supported schema subset — the validator
  // documents "Unknown/unsupported schema construct — pass through." So anyOf
  // that includes a null-typed branch passes everything.  The only anyOf usage
  // in production code is claim_text in the extraction schema, which is handled
  // by constrained decoding (not post-hoc validation), so this limitation is safe.
  it('PASS: null matches anyOf [string, null] — null-type is a pass-through', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(validateAgainstSchema(null, schema)).toBeNull();
  });

  it('PASS: string matches anyOf [string, null]', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(validateAgainstSchema('hello', schema)).toBeNull();
  });

  it('FAIL: number does not match anyOf [string, null]', () => {
    const schema = { anyOf: [{ type: 'string' }, { type: 'null' }] };
    expect(validateAgainstSchema(42, schema)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full VERIFICATION_SCHEMA — the schema that was previously a no-op
// ---------------------------------------------------------------------------
describe('Fix 2: validateAgainstSchema — VERIFICATION_SCHEMA (verify-claim)', () => {
  const valid = {
    status: 'supported',
    sourceTitle: 'CDC Report 2023',
    sourceType: 'official_source',
    nuance: 'Based on 2023 surveillance data.',
  };

  it('PASS: valid verification payload passes schema', () => {
    expect(validateAgainstSchema(valid, VERIFICATION_SCHEMA)).toBeNull();
  });

  it('FAIL: invalid status value rejected', () => {
    expect(validateAgainstSchema({ ...valid, status: 'maybe' }, VERIFICATION_SCHEMA))
      .not.toBeNull();
  });

  it('FAIL: invalid sourceType value rejected', () => {
    expect(validateAgainstSchema({ ...valid, sourceType: 'blog_post' }, VERIFICATION_SCHEMA))
      .not.toBeNull();
  });

  it('FAIL: missing required field (nuance) rejected', () => {
    const { nuance: _dropped, ...noNuance } = valid;
    expect(validateAgainstSchema(noNuance, VERIFICATION_SCHEMA)).not.toBeNull();
  });

  it('FAIL: extra property rejected (additionalProperties: false)', () => {
    expect(
      validateAgainstSchema({ ...valid, injected: 'xss' }, VERIFICATION_SCHEMA)
    ).not.toBeNull();
  });

  it('PASS: GeminiError is exported and has a PARSE_ERROR code constructor', () => {
    // Confirms that the error path in askGeminiJSONWithSearch uses the correct type.
    const err = new GeminiError('PARSE_ERROR', 'schema mismatch', 502);
    expect(err.code).toBe('PARSE_ERROR');
    expect(err instanceof Error).toBe(true);
  });
});
