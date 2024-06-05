import { match } from 'ts-pattern';
import {
  BlackJackState,
  PlayerAction,
  acesSplit,
  basicStrategy,
  determineAllowedActions,
  determinePlayerHandOutcomes,
  formatHandValue,
  handValue,
  initState,
  nextState,
  printGameState,
  rules,
} from './blackjack';
import { zip } from 'ramda';
import { green, red, yellow } from './terminal';
import { writeFile } from 'fs';

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
    if (outcome.result === 'player-win' && outcome.reason === 'blackjack')
      earnings += rules.blackjackPayout * (bet * 2);
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
    printGameState(game);

    while (game.state !== 'game-over') {
      let log = '';
      if (game.state === 'player-turn') {
        const playerAction = basicStrategy(game);
        const playerHand = game.playerHands[game.handIndex];
        const playerHandValue = formatHandValue(handValue(playerHand, acesSplit(game.playerHands)));
        log =
          playerAction === PlayerAction.Stand
            ? `Player stands on ${playerHandValue}`
            : `Player hits on ${playerHandValue}`;
        game = nextState(game, playerAction);
        printGameState(game);
      } else {
        game = nextState(game);
        printGameState(game);
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
    printGameState(game);

    while (game.state !== 'game-over') {
      if (game.state === 'player-turn') {
        // get the next action from the user
        const allowedActions = determineAllowedActions(game);
        let userInput: string = '';
        const validInputs = [
          '1',
          '2',
          ...(allowedActions.includes(PlayerAction.Double) ? ['3'] : []),
          ...(allowedActions.includes(PlayerAction.Split) ? ['4'] : []),
        ];
        while (!validInputs.includes(userInput)) {
          if (allowedActions.includes(PlayerAction.Hit)) console.log('1: Hit');
          console.log('2: Stand');
          if (allowedActions.includes(PlayerAction.Double)) console.log('3: Double');
          if (allowedActions.includes(PlayerAction.Split)) console.log('4: Split');
          userInput = prompt('Enter your action: ');
          if (!validInputs.includes(userInput)) {
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
        await sleep(150);
      }
      printGameState(game);
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
  const flatBet = 1;
  const initialBankroll = 10000;
  let bankroll = initialBankroll;
  let bankrollMovementDistribution: Record<number, number> = {};
  const startTime = Date.now();
  let savedStates: Record<number, any> = {};

  const printStats = (numRounds: number) => {
    console.log(`Starting bankroll: $${initialBankroll.toLocaleString()}`);
    const net = bankroll - initialBankroll;
    console.log(
      `Bankroll: $${bankroll.toLocaleString()}`,
      net > 0 ? green(`+$${net.toLocaleString()}`) : net < 0 ? red(`-$${Math.abs(net).toLocaleString()}`) : '',
    );
    console.log('Loss/earnings distribution:');
    for (const [movement, count] of Object.entries(bankrollMovementDistribution)
      .map(([dollars, count]) => [Number(dollars), count])
      .sort(([dollars1], [dollars2]) => dollars1 - dollars2)) {
      const percent = ((count / numRounds) * 100).toFixed(2) + '%';
      const strCount = ' (' + count.toLocaleString() + ')';
      if (movement > 0) {
        console.log(
          green(`${'+$' + Math.abs(movement).toLocaleString()}: `.padStart(10)) + percent.padEnd(6) + strCount,
        );
      } else if (movement < 0) {
        console.log(red(`${'-$' + Math.abs(movement).toLocaleString()}: `.padStart(10)) + percent.padEnd(6) + strCount);
      } else if (movement === 0) {
        console.log(`$0: `.padStart(10) + percent.padEnd(6) + strCount);
      }
    }
    const houseEdgePercent = ((initialBankroll - bankroll) / numRounds / flatBet) * 100;
    console.log(`House edge: ${houseEdgePercent.toFixed(2)}%`);
    console.log(`Simulated ${numRounds.toLocaleString()} rounds in ${(Date.now() - startTime) / 1000} seconds`);
  };

  for (let i = 0; true; i++) {
    const preroundBankroll = bankroll;
    bankroll -= flatBet;
    let game = initState(flatBet);

    while (game.state !== 'game-over') {
      if (game.state === 'player-turn') {
        const playerAction = basicStrategy(game);
        if (playerAction === PlayerAction.Double) {
          bankroll -= flatBet;
        } else if (playerAction === PlayerAction.Split) {
          bankroll -= flatBet;
        }
        game = nextState(game, playerAction);
      } else {
        game = nextState(game);
      }
    }
    const playerHandOutcomes = determinePlayerHandOutcomes(game);
    for (const [bet, outcome] of zip(game.bets, playerHandOutcomes)) {
      if (outcome.result === 'player-win') {
        if (outcome.reason !== 'blackjack') bankroll += bet + bet;
        if (outcome.reason === 'blackjack') bankroll += bet + rules.blackjackPayout * bet;
      } else if (outcome.result === 'push') bankroll += bet;
    }
    const net = bankroll - preroundBankroll;
    bankrollMovementDistribution[net] = (bankrollMovementDistribution[net] || 0) + 1;
    if (!savedStates[net]) {
      savedStates[net] = {
        ...game,
        shoe: undefined,
        dealerHand: game.dealerHand.map((card) => card.faceValue).join(', '),
        playerHands: game.playerHands.map((hand) => hand.map((card) => card.faceValue).join(', ')),
      };
      writeFile('savedStates.json', JSON.stringify(savedStates, null, 2), (err) => {});
    }
    if (i % 1000 === 0) {
      console.clear();
      printStats(i);
    }
  }
};

console.log('Welcome to Blackjack!');
console.log('Enter "auto" to run the auto-play simulation, or "monte" for Monte Carlo.');
const input = prompt('Otherwise press enter to start a normal game of Blackjack:');
if (input === 'auto') autoPlay();
else if (input === 'monte') monteCarloSimulation();
else manualPlay();
