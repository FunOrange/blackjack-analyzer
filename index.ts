import { match } from 'ts-pattern';
import {
  PlayerAction,
  basicStrategy,
  determineResult,
  formatHandValue,
  handValue,
  initState,
  nextState,
  printState,
} from './blackjack';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const green = (str: string) => `\x1b[32m${str}\x1b[0m`;
const red = (str: string) => `\x1b[31m${str}\x1b[0m`;
const yellow = (str: string) => `\x1b[33m${str}\x1b[0m`;

await (async () => {
  const flatBet = 100;
  let bankroll = 1000;
  while (true) {
    bankroll -= flatBet;
    let state = initState(flatBet);
    printState(state);

    while (state.state !== 'game-over') {
      let log = '';
      if (state.state === 'player-turn') {
        const playerAction = basicStrategy(state);
        log =
          playerAction === PlayerAction.Stand
            ? `Player stands on ${formatHandValue(handValue(state.playerHand))}`
            : `Player hits on ${formatHandValue(handValue(state.playerHand))}`;
        state = nextState(state, playerAction);
        printState(state);
      } else {
        state = nextState(state);
        printState(state);
      }
      if (log) {
        console.log(log);
        await sleep(1000);
      }
      await sleep(50);
    }
    const gameResult = determineResult(state);
    const result = gameResult.result;
    console.log(
      match(gameResult)
        .with({ result: 'player-win' }, ({ reason }) =>
          green(
            (reason === 'blackjack' ? 'Blackjack! ' : reason === 'dealer-bust' ? 'Dealer busts. ' : '') +
              `Player wins!`,
          ),
        )
        .with({ result: 'dealer-win' }, ({ reason }) =>
          red(
            (reason === 'blackjack' ? 'Dealer has blackjack. ' : reason === 'player-bust' ? 'Bust. ' : '') +
              'Player loses.',
          ),
        )
        .with({ result: 'push' }, () => yellow('Push.'))
        .exhaustive(),
    );
    if (result === 'player-win') bankroll += state.bet * 2;
    if (result === 'push') bankroll += state.bet;
    console.log(
      `Bankroll: $${bankroll} ${
        result === 'player-win' ? green(`+$${state.bet}`) : result === 'dealer-win' ? red(`-$${state.bet}`) : ''
      }`,
    );
    await sleep(2500);
  }
})();
