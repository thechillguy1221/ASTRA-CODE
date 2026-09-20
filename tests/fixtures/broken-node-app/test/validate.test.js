import assert from 'node:assert/strict';
import test from 'node:test';
import { validateInput } from '../src/validate.ts';

test('rejects an empty name', () => {
  assert.throws(() => validateInput({ name: '' }), /name is required/);
});
