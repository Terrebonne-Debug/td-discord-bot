import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandDispatcher } from '../../../src/bot/commands/command-dispatcher.ts';
import type { Command } from '../../../src/bot/commands/command.ts';
import { createFakeInteraction, createFakeModalSubmit, createLogger } from '../../helpers/fakes.ts';

interface FakeCommand extends Command {
  handled: string[];
  submitted: string[];
}

/** Une commande factice ; handleSubmit n'existe que si on le fournit. */
function fakeCommand(
  names: readonly string[],
  behaviors: Partial<Omit<FakeCommand, 'names' | 'handled' | 'submitted'>> = {},
): FakeCommand {
  const handled: string[] = [];
  const submitted: string[] = [];
  return {
    names,
    handled,
    submitted,
    async handle(interaction) {
      handled.push(interaction.commandName);
    },
    ...behaviors,
  };
}

function dispatcher(commands: Command[]) {
  const logger = createLogger();
  return { dispatcher: new CommandDispatcher({ commands, logger }), logger };
}

test('CommandDispatcher routes chat inputs to the command by name, aliases included', async () => {
  const version = fakeCommand(['version']);
  const help = fakeCommand(['aide', 'help']);
  const { dispatcher: d } = dispatcher([version, help]);

  await d.dispatch(createFakeInteraction({ commandName: 'version' }));
  await d.dispatch(createFakeInteraction({ commandName: 'help' }));

  assert.deepEqual(version.handled, ['version']);
  assert.deepEqual(help.handled, ['help']);
});

test('CommandDispatcher ignores unknown commands and non-chat-input interactions', async () => {
  const q = fakeCommand(['q']);
  const { dispatcher: d } = dispatcher([q]);

  await d.dispatch(createFakeInteraction({ commandName: 'inconnue' }));
  await d.dispatch(createFakeInteraction({ chatInput: false }));

  assert.deepEqual(q.handled, []);
});

test('CommandDispatcher routes modal submissions and stops at the first taker', async () => {
  const withoutSubmit = fakeCommand(['a']);
  const second = fakeCommand(['b'], {
    async handleSubmit(modal) {
      second.submitted.push(modal.customId);
      return true;
    },
  });
  const { dispatcher: d } = dispatcher([withoutSubmit, second]);

  await d.dispatch(createFakeModalSubmit({ customId: 'feature-request' }));

  assert.deepEqual(withoutSubmit.submitted, []);
  assert.deepEqual(second.submitted, ['feature-request']);
});

test('CommandDispatcher ignores modals no command accepts', async () => {
  const first = fakeCommand(['a'], {
    async handleSubmit(modal) {
      first.submitted.push(modal.customId);
      return false;
    },
  });
  const { dispatcher: d, logger } = dispatcher([first]);

  await d.dispatch(createFakeModalSubmit({ customId: 'autre-modal' }));

  assert.deepEqual(first.submitted, ['autre-modal']);
  assert.deepEqual(logger.messages('error'), []);
});

test('CommandDispatcher logs handler failures without crashing', async () => {
  const broken = fakeCommand(['version'], {
    // Un rejet non-Error couvre aussi la branche String(error) du journal.
    async handle() {
      throw 'reply failed';
    },
  });
  const { dispatcher: d, logger } = dispatcher([broken]);

  await assert.doesNotReject(d.dispatch(createFakeInteraction({ commandName: 'version' })));

  assert.match(logger.messages('error')[0], /Failed to handle \/version: reply failed/);
});

test('CommandDispatcher logs submit failures without crashing', async () => {
  const broken = fakeCommand(['a'], {
    async handleSubmit() {
      throw new Error('field failed');
    },
  });
  const { dispatcher: d, logger } = dispatcher([broken]);

  await assert.doesNotReject(d.dispatch(createFakeModalSubmit({ customId: 'feature-request' })));

  assert.match(
    logger.messages('error')[0],
    /Failed to handle feature-request submit: field failed/,
  );
});
