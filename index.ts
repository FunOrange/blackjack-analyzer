import { match } from 'ts-pattern';
import {
  BlackJackState,
  PlayerAction,
  basicStrategy,
  determinePlayerHandOutcomes,
  formatHandValue,
  handValue,
  initState,
  nextState,
  printState,
} from './blackjack';
import { zip } from 'ramda';
import { green, red, yellow } from './terminal';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const printGameResult = (game: BlackJackState): { earnings: number } => {
  const playerHandOutcomes = determinePlayerHandOutcomes(game);
  let earnings = 0;
  for (const outcome of playerHandOutcomes) {
    console.log(
      match(outcome)
        .with({ result: 'player-win' }, ({ reason }) =>
          green(
            (reason === 'blackjack' ? 'Blackjack! ' : reason === 'dealer-bust' ? 'Dealer busts. ' : '') +
              `Player wins!`,
          ),
        )
        .with({ result: 'player-loss' }, ({ reason }) =>
          red(
            (reason === 'blackjack' ? 'Dealer has blackjack. ' : reason === 'player-bust' ? 'Bust. ' : '') +
              'Player loses.',
          ),
        )
        .with({ result: 'push' }, () => yellow('Push.'))
        .exhaustive(),
    );
  }
  for (const [bet, outcome] of zip(game.bets, playerHandOutcomes)) {
    if (outcome.result === 'player-win' && outcome.reason !== 'blackjack') earnings += bet * 2;
    if (outcome.result === 'player-win' && outcome.reason === 'blackjack') earnings += (3 / 2) * (bet * 2);
    if (outcome.result === 'push') earnings += bet;
  }
  return { earnings };
};

const autoPlay = async () => {
  const flatBet = 100;
  let bankroll = 1000;
  while (true) {
    bankroll -= flatBet;
    let game = initState(flatBet);
    printState(game);

    while (game.state !== 'game-over') {
      let log = '';
      if (game.state === 'player-turn') {
        const playerAction = basicStrategy(game);
        const playerHand = game.playerHands[game.actionableHandIndex];
        log =
          playerAction === PlayerAction.Stand
            ? `Player stands on ${formatHandValue(handValue(playerHand))}`
            : `Player hits on ${formatHandValue(handValue(playerHand))}`;
        game = nextState(game, playerAction);
        printState(game);
      } else {
        game = nextState(game);
        printState(game);
      }
      if (log) {
        console.log(log);
        await sleep(1000);
      }
      await sleep(50);
    }
    const { earnings } = printGameResult(game);
    bankroll += earnings;
    const net = earnings - flatBet;
    console.log(`Bankroll: $${bankroll} ${net > 0 ? green(`+$${net}`) : net < 0 ? red(`-$${net}`) : ''}`);
    await sleep(2500);
  }
};

const manualPlay = async () => {
  const flatBet = 100;
  let bankroll = 1000;
  while (true) {
    const startingBalance = bankroll;
    bankroll -= flatBet;
    let game = initState(flatBet);
    printState(game);

    while (game.state !== 'game-over') {
      if (game.state === 'player-turn') {
        // get the next action from the user
        let userInput: string = '';
        while (!['1', '2', '3', '4'].includes(userInput)) {
          console.log('1: Hit');
          console.log('2: Stand');
          console.log('3: Double');
          console.log('4: Split');
          userInput = prompt('Enter your action: ');
          if (userInput === 'q') {
            process.exit(0);
          }
          if (!['1', '2', '3', '4'].includes(userInput)) {
            console.log('Invalid input.');
          }
        }
        const playerAction = match(userInput as '1' | '2' | '3' | '4')
          .with('1', () => PlayerAction.Hit)
          .with('2', () => PlayerAction.Stand)
          .with('3', () => PlayerAction.Double)
          .with('4', () => PlayerAction.Split)
          .exhaustive();
        if (playerAction === PlayerAction.Double) {
          bankroll -= game.startingBet;
        }
        game = nextState(game, playerAction);
      } else {
        game = nextState(game);
        await sleep(500);
      }
      printState(game);
    }
    const { earnings } = printGameResult(game);
    bankroll += earnings;
    const net = bankroll - startingBalance;
    console.log(`Bankroll: $${bankroll} ${net > 0 ? green(`+$${net}`) : net < 0 ? red(`-$${Math.abs(net)}`) : ''}`);
    console.log('Press Enter to play again...');
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
    let game = initState(flatBet);

    while (game.state !== 'game-over') {
      if (game.state === 'player-turn') {
        const playerAction = basicStrategy(game);
        if (playerAction === PlayerAction.Double) {
          bankroll -= game.startingBet;
        } else if (playerAction === PlayerAction.Split) {
          bankroll -= game.startingBet;
        }
        game = nextState(game, playerAction);
      } else {
        game = nextState(game);
      }
    }
    const playerHandOutcomes = determinePlayerHandOutcomes(game);
    for (const [bet, outcome] of zip(game.bets, playerHandOutcomes)) {
      const result = outcome.result;
      if (result === 'player-win') {
        bankroll += bet * 2;
        wins++;
      }
      if (result === 'player-loss') {
        losses++;
      }
      if (result === 'push') {
        bankroll += bet;
        pushes++;
      }
    }
  }

  console.log(`Wins: ${wins}, Losses: ${losses}, Pushes: ${pushes}`);
  console.log(`Bankroll: $${bankroll}`);
  const houseEdgePercent = ((initialBankroll - bankroll) / numSimulations / flatBet) * 100;
  console.log(`House edge: ${houseEdgePercent.toFixed(2)}%`);
  console.log(`${numSimulations} simulations in ${(Date.now() - startTime) / 1000} seconds`);
};

// autoPlay();
// monteCarloSimulation();
manualPlay();
