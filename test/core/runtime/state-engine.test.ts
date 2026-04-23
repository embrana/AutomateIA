import { describe, expect, it } from 'vitest';
import { StateEngine } from '../../../src/core/runtime/state/StateEngine.js';

describe('StateEngine', () => {
  it('allows escalating from spec-ready to human escalation required', () => {
    const stateEngine = new StateEngine();

    expect(() => {
      stateEngine.assertTicketTransition('SPEC_READY', 'HUMAN_ESCALATION_REQUIRED');
    }).not.toThrow();
  });

  it('allows returning from human escalation required to under review', () => {
    const stateEngine = new StateEngine();

    expect(() => {
      stateEngine.assertTicketTransition('HUMAN_ESCALATION_REQUIRED', 'UNDER_REVIEW');
    }).not.toThrow();
  });

  it('allows returning from under review to in execution after implementation approval', () => {
    const stateEngine = new StateEngine();

    expect(() => {
      stateEngine.assertTicketTransition('UNDER_REVIEW', 'IN_EXECUTION');
    }).not.toThrow();
  });
});
