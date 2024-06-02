import { assoc, insertAll, pipe, remove, sum } from 'ramda';
import { Pattern, match } from 'ts-pattern';
import { red, yellow } from './terminal';

class UnreachableError extends Error {
  constructor(message = 'Unreachable code has been reached') {
    super(message);
    this.name = 'UnreachableError';
  }
}

enum Suit {
  Hearts = 'hearts',
  Diamonds = 'diamonds',
  Clubs = 'clubs',
  Spades = 'spades',
}
enum FaceValue {
  Ace = 'A',
  Two = '2',
  Three = '3',
  Four = '4',
  Five = '5',
  Six = '6',
  Seven = '7',
  Eight = '8',
  Nine = '9',
  Ten = '10',
  Jack = 'J',
  Queen = 'Q',
  King = 'K',
}

interface Card {
  suit: Suit;
  faceValue: FaceValue;
}

export enum PlayerAction {
  Hit = 'hit',
  Stand = 'stand',
  Double = 'double',
  Split = 'split',
}

export const rules = {
  hitSoft17: false,
  doubleAfterSplit: true, // TODO
  resplitAces: false, // TODO
  blackjackPayout: 3 / 2,
  dealerPeeks: true, // TODO
  aceAndTenCountsAsBlackjack: true,
  resplitAce: false, // TODO
  dealerStandsOnAll17: true,
};
export type BlackjackRuleset = typeof rules;

export const cardValue = (card: Card, { withAceAs11 } = { withAceAs11: false }) =>
  match(card)
    .with({ faceValue: FaceValue.Ace }, () => (withAceAs11 ? 11 : 1)) // can be 11 depending on hand
    .with({ faceValue: FaceValue.Two }, () => 2)
    .with({ faceValue: FaceValue.Three }, () => 3)
    .with({ faceValue: FaceValue.Four }, () => 4)
    .with({ faceValue: FaceValue.Five }, () => 5)
    .with({ faceValue: FaceValue.Six }, () => 6)
    .with({ faceValue: FaceValue.Seven }, () => 7)
    .with({ faceValue: FaceValue.Eight }, () => 8)
    .with({ faceValue: FaceValue.Nine }, () => 9)
    .with({ faceValue: FaceValue.Ten }, () => 10)
    .with({ faceValue: FaceValue.Jack }, () => 10)
    .with({ faceValue: FaceValue.Queen }, () => 10)
    .with({ faceValue: FaceValue.King }, () => 10)
    .otherwise(() => 0);

export const handValue = (hand: Card[]): number | 'blackjack' | { soft: { low: number; high: number } } => {
  if (hand.length === 2) {
    const [{ faceValue: card1 }, { faceValue: card2 }] = hand;
    if (rules.aceAndTenCountsAsBlackjack && card1 === FaceValue.Ace && card2 === FaceValue.Ten) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.Jack) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.Queen) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.King) return 'blackjack';
    if (rules.aceAndTenCountsAsBlackjack && card1 === FaceValue.Ten && card2 === FaceValue.Ace) return 'blackjack';
    if (card1 === FaceValue.Jack && card2 === FaceValue.Ace) return 'blackjack';
    if (card1 === FaceValue.Queen && card2 === FaceValue.Ace) return 'blackjack';
    if (card1 === FaceValue.King && card2 === FaceValue.Ace) return 'blackjack';
  }
  const values = hand.map((card) => cardValue(card));
  const low = sum(values);
  if (hand.some((card) => card.faceValue === FaceValue.Ace) && low <= 11) {
    const high = low + 10;
    if (high > 21) return low;
    if (high === 21) return 21;
    return { soft: { low, high } };
  } else {
    return low;
  }
};
const bust = (hand: Card[]) => {
  const value = handValue(hand);
  return typeof value === 'number' && value > 21;
};
export const formatHandValue = (value: ReturnType<typeof handValue>) => {
  if (typeof value === 'number') {
    return value;
  } else if (value === 'blackjack') {
    return value;
  } else if (value.soft && value.soft.low === 1) {
    return 'Ace';
  } else if (value.soft) {
    return `soft ${value.soft.high}`;
  }
};

const UNSHUFFLED_DECK_TEMPLATE = (() =>
  Object.values(Suit).flatMap((suit) =>
    Object.values(FaceValue).map((value) => ({ suit, faceValue: value }) as Card),
  ))();

export interface BlackJackState {
  shoe: Card[];
  playerHands: Card[][];
  actionableHandIndex: number;
  dealerHand: Card[];
  state: 'dealing' | 'player-turn' | 'dealer-turn' | 'game-over';
  startingBet: number;
  bets: number[]; // normally one value but can be multiple for splits
}

export const initState = (startingBet: number): BlackJackState => {
  const numDecks = 8;
  const shoe = Array.from({ length: numDecks }, () => UNSHUFFLED_DECK_TEMPLATE)
    .flat()
    .sort(() => Math.random() - 0.5);
  return {
    shoe,
    playerHands: [[]],
    actionableHandIndex: 0,
    dealerHand: [],
    state: 'dealing',
    startingBet,
    bets: [startingBet],
  };
};

const getNextActionableHandIndex = (game: BlackJackState) => {
  const index = game.playerHands.findIndex((hand, i) => i > game.actionableHandIndex && hand.length === 1);
  return index !== -1 ? index : game.actionableHandIndex;
};

export const nextState = (game: BlackJackState, playerAction?: PlayerAction): BlackJackState => {
  const playerHandFinished = (playerHand: Card[]) => {
    const playerHandValue = handValue(playerHand);
    const bust = typeof playerHandValue === 'number' && playerHandValue > 21;
    const twentyOne = typeof playerHandValue === 'number' && playerHandValue === 21;
    const softTwentyOne = typeof playerHandValue === 'object' && playerHandValue.soft.high === 21;
    const blackjack = playerHandValue === 'blackjack';
    return bust || twentyOne || softTwentyOne || blackjack;
  };
  return match(game.state)
    .with('dealing', () => {
      if (game.playerHands.length === 1) {
        if (game.playerHands[0].length === 0) {
          // deal first card
          const [playerCard, ...shoe] = game.shoe;
          return {
            ...game,
            shoe,
            playerHands: [[playerCard]],
          };
        } else if (game.playerHands[0].length === 1 && game.dealerHand.length === 0) {
          // deal second card
          const [dealerCard, ...shoe] = game.shoe;
          const dealerHand = [dealerCard];
          return {
            ...game,
            shoe,
            dealerHand,
          };
        } else if (game.playerHands[0].length === 1 && game.dealerHand.length === 1) {
          // deal third card
          const [playerCard, ...shoe] = game.shoe;
          const playerHand = [...game.playerHands[0], playerCard];
          if (handValue(playerHand) === 21 || handValue(playerHand) === 'blackjack') {
            return {
              ...game,
              shoe,
              playerHands: [playerHand],
              state: 'dealer-turn' as const, // dealer could still have 21/blackjack
            };
          }
          return {
            ...game,
            shoe,
            playerHands: [playerHand],
            state: 'player-turn' as const,
          };
        }
      } else if (game.playerHands.length > 1) {
        // player just split, deal 1 card
        // note: bust impossible
        const [playerCard, ...shoe] = game.shoe;
        const playerHand = [...game.playerHands[game.actionableHandIndex], playerCard];
        const playerHands = assoc(game.actionableHandIndex, playerHand, game.playerHands);
        const actionableHandIndex = playerHandFinished(playerHand)
          ? getNextActionableHandIndex(game)
          : game.actionableHandIndex;
        return {
          ...game,
          shoe,
          playerHands,
          actionableHandIndex,
          state: 'player-turn' as const,
        };
      }
      throw new UnreachableError();
    })
    .with('player-turn', () =>
      match(playerAction)
        .with(PlayerAction.Hit, () => {
          const [playerCard, ...shoe] = game.shoe;
          const playerHand = [...game.playerHands[game.actionableHandIndex], playerCard];
          const playerHands = assoc(game.actionableHandIndex, playerHand, game.playerHands);
          const handFinished = playerHandFinished(playerHand);
          const actionableHandIndex = handFinished ? getNextActionableHandIndex(game) : game.actionableHandIndex;
          const moreHandsToPlay = actionableHandIndex !== game.actionableHandIndex;
          const state = playerHands.every(bust)
            ? ('game-over' as const)
            : match({ handFinished, moreHandsToPlay })
                .with({ handFinished: false, moreHandsToPlay: false }, () => 'player-turn' as const)
                .with({ handFinished: false, moreHandsToPlay: true }, () => 'player-turn' as const)
                .with({ handFinished: true, moreHandsToPlay: false }, () => 'dealer-turn' as const)
                .with({ handFinished: true, moreHandsToPlay: true }, () => 'player-turn' as const)
                .exhaustive();
          return {
            ...game,
            shoe,
            playerHands,
            actionableHandIndex,
            state,
          };
        })
        .with(PlayerAction.Stand, () => {
          const actionableHandIndex = getNextActionableHandIndex(game);
          const moreHandsToPlay = actionableHandIndex !== game.actionableHandIndex;
          if (moreHandsToPlay) {
            return {
              ...game,
              actionableHandIndex,
              state: 'player-turn' as const,
            };
          } else {
            return {
              ...game,
              state: 'dealer-turn' as const,
            };
          }
        })
        .with(PlayerAction.Double, () => {
          const [playerCard, ...shoe] = game.shoe;
          const playerHand = [...game.playerHands[game.actionableHandIndex], playerCard];
          const playerHands = assoc(game.actionableHandIndex, playerHand, game.playerHands);
          const bet = game.bets[game.actionableHandIndex] + game.startingBet;
          const bets = assoc(game.actionableHandIndex, bet, game.bets);
          const handFinished = true;
          const actionableHandIndex = handFinished ? getNextActionableHandIndex(game) : game.actionableHandIndex;
          const moreHandsToPlay = actionableHandIndex !== game.actionableHandIndex;
          const state = playerHands.every(bust)
            ? ('game-over' as const)
            : moreHandsToPlay
              ? ('player-turn' as const)
              : ('dealer-turn' as const);
          return {
            ...game,
            shoe,
            playerHands,
            bets,
            actionableHandIndex,
            state,
          };
        })
        .with(PlayerAction.Split, () => {
          const [card1, card2] = game.playerHands[game.actionableHandIndex];
          const playerHands = pipe(
            remove(game.actionableHandIndex, 1) as any,
            insertAll(game.actionableHandIndex, [[card1], [card2]]),
          )(game.playerHands);
          const bets = game.bets.flatMap((bet) => [bet, bet]);
          return { ...game, playerHands, bets, state: 'dealing' as const };
        })
        .exhaustive(),
    )
    .with('dealer-turn', () => {
      const dealerShouldStand = (dealerHand: Card[]) => {
        const dealerHandValue = handValue(dealerHand);
        return (
          dealerHandValue === 'blackjack' ||
          (typeof dealerHandValue === 'number' && dealerHandValue >= 17) ||
          (rules.dealerStandsOnAll17 &&
            typeof dealerHandValue === 'object' &&
            [17, 18, 19, 20, 21].includes(dealerHandValue.soft.high))
        );
      };
      if (dealerShouldStand(game.dealerHand)) {
        // dealer stands
        return {
          ...game,
          state: 'game-over' as const,
        };
      } else {
        // dealer hits
        const [dealerCard, ...shoe] = game.shoe;
        const dealerHand = [...game.dealerHand, dealerCard];
        if (game.playerHands.every((playerHand) => handValue(playerHand) === 'blackjack')) {
          // dealer now has 2 cards and is up against all blackjacks
          // either push or player wins, no need for dealer to keep hitting
          return {
            ...game,
            shoe,
            dealerHand,
            state: 'game-over' as const,
          };
        } else {
          return {
            ...game,
            shoe,
            dealerHand,
            state: dealerShouldStand(dealerHand) ? ('game-over' as const) : ('dealer-turn' as const),
          };
        }
      }
    })
    .with('game-over', () => {
      throw new UnreachableError();
    })
    .exhaustive();
};
export const printGameState = (game: BlackJackState) => {
  console.clear();
  console.log('');
  console.log(
    'Dealer Hand:',
    `(${formatHandValue(handValue(game.dealerHand))})`,
    game.dealerHand.map((c) => c.faceValue),
    bust(game.dealerHand) ? red('BUST') : '',
  );
  game.playerHands.forEach((playerHand, i) => {
    console.log(
      'Player Hand:',
      `(${formatHandValue(handValue(playerHand))})`,
      playerHand.map((c) => c.faceValue),
      game.state === 'player-turn' && i === game.actionableHandIndex
        ? yellow('←')
        : bust(playerHand)
          ? red('BUST')
          : '',
    );
  });
};

export const determinePlayerHandOutcomes = (
  game: BlackJackState,
): (
  | { result: 'player-win'; reason: 'blackjack' | 'dealer-bust' | 'higher-hand' }
  | { result: 'player-loss'; reason: 'blackjack' | 'player-bust' | 'higher-hand' }
  | { result: 'push' }
)[] => {
  if (game.state !== 'game-over') throw new Error('Game is not over');

  return game.playerHands.map((playerHand) => {
    const playerHandValue = handValue(playerHand);
    const playerHandValueHigh = typeof playerHandValue === 'object' ? playerHandValue.soft.high : playerHandValue;
    const dealerHandValue = handValue(game.dealerHand);
    const dealerHandValueHigh = typeof dealerHandValue === 'object' ? dealerHandValue.soft.high : dealerHandValue;

    return match({ playerHandValue: playerHandValueHigh, dealerHandValue: dealerHandValueHigh })
      .with({ playerHandValue: 'blackjack', dealerHandValue: 'blackjack' }, () => ({ result: 'push' }) as const)
      .with({ playerHandValue: 'blackjack' }, () => ({ result: 'player-win', reason: 'blackjack' }) as const)
      .with({ dealerHandValue: 'blackjack' }, () => ({ result: 'player-loss', reason: 'blackjack' }) as const)
      .with(
        { playerHandValue: Pattern.number, dealerHandValue: Pattern.number },
        ({ playerHandValue, dealerHandValue }) => {
          if (playerHandValue > 21) return { result: 'player-loss', reason: 'player-bust' } as const;
          else if (dealerHandValue > 21) return { result: 'player-win', reason: 'dealer-bust' } as const;
          else if (playerHandValue > dealerHandValue) return { result: 'player-win', reason: 'higher-hand' } as const;
          else if (playerHandValue < dealerHandValue) return { result: 'player-loss', reason: 'higher-hand' } as const;
          else return { result: 'push' } as const;
        },
      )
      .exhaustive();
  });
};

const basicStrategyTable = {
  playerHardTotals: {
    //   2    3    4    5    6    7    8    9    10   A
    2: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    3: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    4: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    5: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    6: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    7: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    8: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    9: ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    10: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    11: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    12: ['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    13: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    14: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    15: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    16: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    17: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    18: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  } as Record<number, ('H' | 'S' | 'D' | 'P')[]>,
  playerSoftTotals: {
    //    2    3    4    5    6    7    8    9    10   A
    11: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    12: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    13: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    14: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    15: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    16: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    17: ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    18: ['S', 'D', 'D', 'D', 'D', 'S', 'S', 'H', 'H', 'H'], // TODO: double if allowed
    19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  } as Record<number, ('H' | 'S' | 'D' | 'P')[]>,
  playerPairs: {
    //   2    3    4    5    6    7    8    9    10   A
    2: ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    3: ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    4: ['H', 'H', 'H', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
    5: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    6: ['P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
    7: ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    8: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    9: ['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'],
    10: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    1: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  } as Record<number, ('H' | 'S' | 'D' | 'P')[]>,
};
export const basicStrategy = (game: BlackJackState): PlayerAction => {
  if (game.state !== 'player-turn') throw new Error('Not player turn');

  const playerHand = game.playerHands[game.actionableHandIndex];
  const playerHandValue = handValue(playerHand);
  const dealerUpcardValue = cardValue(game.dealerHand[0], { withAceAs11: true });
  const playerActionCode = (() => {
    if (playerHand.length === 2 && cardValue(playerHand[0]) === cardValue(playerHand[1])) {
      return basicStrategyTable.playerPairs[cardValue(playerHand[0])][dealerUpcardValue - 2];
    } else if (typeof playerHandValue === 'number') {
      return basicStrategyTable.playerHardTotals[playerHandValue][dealerUpcardValue - 2];
    } else if (typeof playerHandValue === 'object') {
      return basicStrategyTable.playerSoftTotals[playerHandValue.soft.high][dealerUpcardValue - 2];
    }
  })();
  return match(playerActionCode)
    .with('H', () => PlayerAction.Hit)
    .with('S', () => PlayerAction.Stand)
    .with('D', () => PlayerAction.Double)
    .with('P', () => PlayerAction.Split)
    .exhaustive();
};
