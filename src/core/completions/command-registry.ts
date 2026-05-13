import { CommandDefinition, FlagDefinition } from './types.js';

/**
 * Common flags used across multiple commands
 */
const COMMON_FLAGS = {
  json: {
    name: 'json',
    description: 'Output as JSON',
  } as FlagDefinition,
  jsonValidation: {
    name: 'json',
    description: 'Output validation results as JSON',
  } as FlagDefinition,
  strict: {
    name: 'strict',
    description: 'Enable strict validation mode',
  } as FlagDefinition,
  noInteractive: {
    name: 'no-interactive',
    description: 'Disable interactive prompts',
  } as FlagDefinition,
  type: {
    name: 'type',
    description: 'Specify item type when ambiguous',
    takesValue: true,
    values: ['change', 'spec'],
  } as FlagDefinition,
} as const;

/**
 * Registry of all OpenSpec CLI commands with their flags and metadata.
 * This registry is used to generate shell completion scripts.
 */
export const COMMAND_REGISTRY: CommandDefinition[] = [
  {
    name: 'init',
    description: 'Initialize OpenSpec in your project',
    acceptsPositional: true,
    positionalType: 'path',
    flags: [
      {
        name: 'tools',
        description: 'Configure AI tools non-interactively (e.g., "all", "none", or comma-separated tool IDs)',
        takesValue: true,
      },
    ],
  },
  {
    name: 'update',
    description: 'Update OpenSpec instruction files',
    acceptsPositional: true,
    positionalType: 'path',
    flags: [],
  },
  {
    name: 'list',
    description: 'List items (changes by default, or specs with --specs)',
    flags: [
      {
        name: 'specs',
        description: 'List specs instead of changes',
      },
      {
        name: 'changes',
        description: 'List changes explicitly (default)',
      },
    ],
  },
  {
    name: 'view',
    description: 'Display an interactive dashboard of specs and changes',
    flags: [],
  },
  {
    name: 'validate',
    description: 'Validate changes and specs',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    flags: [
      {
        name: 'all',
        description: 'Validate all changes and specs',
      },
      {
        name: 'changes',
        description: 'Validate all changes',
      },
      {
        name: 'specs',
        description: 'Validate all specs',
      },
      COMMON_FLAGS.type,
      COMMON_FLAGS.strict,
      COMMON_FLAGS.jsonValidation,
      {
        name: 'concurrency',
        description: 'Max concurrent validations (defaults to env OPENSPEC_CONCURRENCY or 6)',
        takesValue: true,
      },
      COMMON_FLAGS.noInteractive,
    ],
  },
  {
    name: 'show',
    description: 'Show a change or spec',
    acceptsPositional: true,
    positionalType: 'change-or-spec-id',
    flags: [
      COMMON_FLAGS.json,
      COMMON_FLAGS.type,
      COMMON_FLAGS.noInteractive,
      {
        name: 'deltas-only',
        description: 'Show only deltas (JSON only, change-specific)',
      },
      {
        name: 'requirements-only',
        description: 'Alias for --deltas-only (deprecated, change-specific)',
      },
      {
        name: 'requirements',
        description: 'Show only requirements, exclude scenarios (JSON only, spec-specific)',
      },
      {
        name: 'no-scenarios',
        description: 'Exclude scenario content (JSON only, spec-specific)',
      },
      {
        name: 'requirement',
        short: 'r',
        description: 'Show specific requirement by ID (JSON only, spec-specific)',
        takesValue: true,
      },
    ],
  },
  {
    name: 'archive',
    description: 'Archive a completed change and sync an active Jira worklog session',
    acceptsPositional: true,
    positionalType: 'change-id',
    flags: [
      {
        name: 'yes',
        short: 'y',
        description: 'Skip confirmation prompts',
      },
      {
        name: 'skip-specs',
        description: 'Skip spec update operations',
      },
      {
        name: 'no-validate',
        description: 'Skip validation (not recommended)',
      },
      {
        name: 'comment',
        description: 'Comment for the Jira worklog',
        takesValue: true,
      },
      {
        name: 'retry',
        description: 'Retry a pending Jira worklog sync',
      },
    ],
  },
  {
    name: 'purpose',
    description: 'Start an OpenSpec work session for a Jira issue',
    flags: [
      {
        name: 'jira',
        description: 'Jira issue key to track work against',
        takesValue: true,
      },
      {
        name: 'import-ticket',
        description: 'Import Jira ticket summary, status, assignee, description, and URL into the timer session',
      },
      {
        name: 'create-change',
        description: 'Create an OpenSpec change from the imported Jira ticket description',
      },
    ],
  },
  {
    name: 'ticket',
    description: 'Inspect Jira ticket context imported into the active timer session',
    flags: [],
    subcommands: [
      {
        name: 'show',
        description: 'Show the Jira ticket context imported into the active timer session',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
    ],
  },
  {
    name: 'timer',
    description: 'Manage the OpenSpec work timer',
    flags: [],
    subcommands: [
      {
        name: 'status',
        description: 'Show the active OpenSpec work timer',
        flags: [],
      },
      {
        name: 'cancel',
        description: 'Cancel the active OpenSpec work timer without creating a Jira worklog',
        flags: [],
      },
    ],
  },
  {
    name: 'runtime',
    description: 'Inspect agentic runtime state',
    flags: [],
    subcommands: [
      {
        name: 'status',
        description: 'Show the current or latest OpenSpec runtime state',
        flags: [
          {
            name: 'json',
            description: 'Output runtime state as JSON',
          },
        ],
      },
    ],
  },
  {
    name: 'agent',
    description: 'Run runtime agents',
    flags: [],
    subcommands: [
      {
        name: 'run',
        description: 'Run a runtime agent: context, spec, planning, implementation, critic, validation, delivery',
        acceptsPositional: true,
        flags: [],
      },
    ],
  },
  {
    name: 'orchestrate',
    description: 'Run agentic orchestration steps',
    flags: [
      {
        name: 'from-session',
        description: 'Run orchestration using the active runtime session',
      },
      {
        name: 'until',
        description: 'Run until stage: context, spec, planning, implementation, critic, validation, delivery',
        takesValue: true,
      },
    ],
  },
  {
    name: 'approval',
    description: 'Inspect and resolve runtime approvals',
    flags: [],
    subcommands: [
      {
        name: 'show',
        description: 'Show approvals for the current or latest runtime ticket',
        flags: [
          {
            name: 'json',
            description: 'Output approvals as JSON',
          },
        ],
      },
      {
        name: 'accept',
        description: 'Approve a pending runtime approval',
        acceptsPositional: true,
        flags: [
          {
            name: 'reason',
            description: 'Optional approval note',
            takesValue: true,
          },
        ],
      },
      {
        name: 'reject',
        description: 'Reject a pending runtime approval',
        acceptsPositional: true,
        flags: [
          {
            name: 'reason',
            description: 'Reason for rejecting the approval',
            takesValue: true,
          },
        ],
      },
    ],
  },
  {
    name: 'feedback',
    description: 'Submit feedback about OpenSpec',
    acceptsPositional: true,
    flags: [
      {
        name: 'body',
        description: 'Detailed description for the feedback',
        takesValue: true,
      },
    ],
  },
  {
    name: 'new',
    description: 'Create new items',
    flags: [],
    subcommands: [
      {
        name: 'change',
        description: 'Create a new change directory',
        acceptsPositional: true,
        positionalType: 'change-id',
        flags: [
          {
            name: 'description',
            description: 'Description to add to README.md',
            takesValue: true,
          },
          {
            name: 'schema',
            description: 'Workflow schema to use',
            takesValue: true,
          },
          {
            name: 'from-ticket',
            description: 'Create a change from a Jira ticket',
            takesValue: true,
          },
        ],
      },
    ],
  },
  {
    name: 'change',
    description: 'Manage OpenSpec change proposals (deprecated)',
    flags: [],
    subcommands: [
      {
        name: 'show',
        description: 'Show a change proposal',
        acceptsPositional: true,
        positionalType: 'change-id',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'deltas-only',
            description: 'Show only deltas (JSON only)',
          },
          {
            name: 'requirements-only',
            description: 'Alias for --deltas-only (deprecated)',
          },
          COMMON_FLAGS.noInteractive,
        ],
      },
      {
        name: 'list',
        description: 'List all active changes (deprecated)',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'long',
            description: 'Show id and title with counts',
          },
        ],
      },
      {
        name: 'validate',
        description: 'Validate a change proposal',
        acceptsPositional: true,
        positionalType: 'change-id',
        flags: [
          COMMON_FLAGS.strict,
          COMMON_FLAGS.jsonValidation,
          COMMON_FLAGS.noInteractive,
        ],
      },
    ],
  },
  {
    name: 'spec',
    description: 'Manage OpenSpec specifications',
    flags: [],
    subcommands: [
      {
        name: 'show',
        description: 'Show a specification',
        acceptsPositional: true,
        positionalType: 'spec-id',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'requirements',
            description: 'Show only requirements, exclude scenarios (JSON only)',
          },
          {
            name: 'no-scenarios',
            description: 'Exclude scenario content (JSON only)',
          },
          {
            name: 'requirement',
            short: 'r',
            description: 'Show specific requirement by ID (JSON only)',
            takesValue: true,
          },
          COMMON_FLAGS.noInteractive,
        ],
      },
      {
        name: 'list',
        description: 'List all specifications',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'long',
            description: 'Show id and title with counts',
          },
        ],
      },
      {
        name: 'validate',
        description: 'Validate a specification',
        acceptsPositional: true,
        positionalType: 'spec-id',
        flags: [
          COMMON_FLAGS.strict,
          COMMON_FLAGS.jsonValidation,
          COMMON_FLAGS.noInteractive,
        ],
      },
    ],
  },
  {
    name: 'completion',
    description: 'Manage shell completions for OpenSpec CLI',
    flags: [],
    subcommands: [
      {
        name: 'generate',
        description: 'Generate completion script for a shell (outputs to stdout)',
        acceptsPositional: true,
        positionalType: 'shell',
        flags: [],
      },
      {
        name: 'install',
        description: 'Install completion script for a shell',
        acceptsPositional: true,
        positionalType: 'shell',
        flags: [
          {
            name: 'verbose',
            description: 'Show detailed installation output',
          },
        ],
      },
      {
        name: 'uninstall',
        description: 'Uninstall completion script for a shell',
        acceptsPositional: true,
        positionalType: 'shell',
        flags: [
          {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation prompts',
          },
        ],
      },
    ],
  },
  {
    name: 'config',
    description: 'View and modify global OpenSpec configuration',
    flags: [
      {
        name: 'scope',
        description: 'Config scope (only "global" supported currently)',
        takesValue: true,
        values: ['global'],
      },
    ],
    subcommands: [
      {
        name: 'path',
        description: 'Show config file location',
        flags: [],
      },
      {
        name: 'list',
        description: 'Show all current settings',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'show',
        description: 'Show all current settings',
        flags: [
          COMMON_FLAGS.json,
        ],
      },
      {
        name: 'get',
        description: 'Get a specific value (raw, scriptable)',
        acceptsPositional: true,
        flags: [],
      },
      {
        name: 'set',
        description: 'Set a value (auto-coerce types)',
        acceptsPositional: true,
        flags: [
          {
            name: 'string',
            description: 'Force value to be stored as string',
          },
          {
            name: 'allow-unknown',
            description: 'Allow setting unknown keys',
          },
        ],
      },
      {
        name: 'unset',
        description: 'Remove a key (revert to default)',
        acceptsPositional: true,
        flags: [],
      },
      {
        name: 'reset',
        description: 'Reset configuration to defaults',
        flags: [
          {
            name: 'all',
            description: 'Reset all configuration (required)',
          },
          {
            name: 'yes',
            short: 'y',
            description: 'Skip confirmation prompts',
          },
        ],
      },
      {
        name: 'edit',
        description: 'Open config in $EDITOR',
        flags: [],
      },
      {
        name: 'profile',
        description: 'Configure workflow profile (interactive picker or preset shortcut)',
        flags: [],
      },
    ],
  },
  {
    name: 'schema',
    description: 'Manage workflow schemas',
    flags: [],
    subcommands: [
      {
        name: 'which',
        description: 'Show where a schema resolves from',
        acceptsPositional: true,
        positionalType: 'schema-name',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'all',
            description: 'List all schemas with their resolution sources',
          },
        ],
      },
      {
        name: 'validate',
        description: 'Validate a schema structure and templates',
        acceptsPositional: true,
        positionalType: 'schema-name',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'verbose',
            description: 'Show detailed validation steps',
          },
        ],
      },
      {
        name: 'fork',
        description: 'Copy an existing schema to project for customization',
        acceptsPositional: true,
        positionalType: 'schema-name',
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'force',
            description: 'Overwrite existing destination',
          },
        ],
      },
      {
        name: 'init',
        description: 'Create a new project-local schema',
        acceptsPositional: true,
        flags: [
          COMMON_FLAGS.json,
          {
            name: 'description',
            description: 'Schema description',
            takesValue: true,
          },
          {
            name: 'artifacts',
            description: 'Comma-separated artifact IDs',
            takesValue: true,
          },
          {
            name: 'default',
            description: 'Set as project default schema',
          },
          {
            name: 'no-default',
            description: 'Do not prompt to set as default',
          },
          {
            name: 'force',
            description: 'Overwrite existing schema',
          },
        ],
      },
    ],
  },
];
