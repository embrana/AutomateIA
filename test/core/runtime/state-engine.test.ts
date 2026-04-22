import { describe, expect, it } from 'vitest';
import { StateEngine } from '../../../src/core/runtime/state/StateEngine.js';

describe('StateEngine', () => {
  it('allows escalating from spec-ready to human escalation required', () => {
    const stateEngine = new StateEngine();

    expect(() => {
      stateEngine.assertTicketTransition('SPEC_READY', 'HUMAN_ESCALATION_REQUIRED');
    }).not.toThrow();
  });
});
