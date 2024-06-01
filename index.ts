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

const autoPlay = async () => {
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
};

const manualPlay = async () => {
  const flatBet = 100;
  let bankroll = 1000;
  while (true) {
    bankroll -= flatBet;
    let state = initState(flatBet);
    printState(state);

    while (state.state !== 'game-over') {
      if (state.state === 'player-turn') {
        // get the next action from the user
        let userInput: string;
        while (!['s', 'h', 'd'].includes(userInput)) {
          userInput = prompt('Enter your action (h for hit, s for stand, d for double): ');
          if (!['s', 'h', 'd'].includes(userInput)) {
            console.log('Invalid input. Please enter h, s, or d.');
          }
        }
        const playerAction = match(userInput as 's' | 'h' | 'd')
          .with('s', () => PlayerAction.Stand)
          .with('h', () => PlayerAction.Hit)
          .with('d', () => PlayerAction.Double)
          .exhaustive();
        if (playerAction === PlayerAction.Double) {
          bankroll -= state.bet;
        }
        state = nextState(state, playerAction);
      } else {
        state = nextState(state);
      }
      printState(state);
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
    // press any key to play again
    console.log('Press any key to play again...');
    await new Promise<void>((resolve) => {
      const listener = () => {
        process.stdin.off('data', listener);
        resolve();
      };
      process.stdin.on('data', listener);
    });
    console.clear();
  }
};

const monteCarloSimulation = () => {
  const numSimulations = 100000;
  const flatBet = 1;
  const initialBankroll = 100;
  let bankroll = initialBankroll;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  console.log('running...');
  const startTime = Date.now();
  for (let i = 0; i < numSimulations; i++) {
    bankroll -= flatBet;
    let state = initState(flatBet);

    while (state.state !== 'game-over') {
      if (state.state === 'player-turn') {
        const playerAction = basicStrategy(state);
        state = nextState(state, playerAction);
      } else {
        state = nextState(state);
      }
    }
    const gameResult = determineResult(state);
    const result = gameResult.result;
    if (result === 'player-win') {
      bankroll += state.bet * 2;
      wins++;
    }
    if (result === 'dealer-win') {
      losses++;
    }
    if (result === 'push') {
      bankroll += state.bet;
      pushes++;
    }
  }

  console.log(`Wins: ${wins}, Losses: ${losses}, Pushes: ${pushes}`);
  console.log(`Bankroll: $${bankroll}`);
  const houseEdgePercent = ((initialBankroll - bankroll) / numSimulations / flatBet) * 100;
  console.log(`House edge: ${houseEdgePercent.toFixed(2)}%`);
  console.log(`${numSimulations} simulations in ${(Date.now() - startTime) / 1000} seconds`);
};

manualPlay();
