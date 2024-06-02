import { aperture, assoc, insertAll, pipe, remove, sum } from 'ramda';
import { Pattern, match } from 'ts-pattern';
import { red, yellow } from './terminal';
import { writeFile } from 'fs/promises';

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
  faceDown?: boolean;
}

export enum PlayerAction {
  Hit = 'hit',
  Stand = 'stand',
  Double = 'double',
  Split = 'split',
}

interface BlackjackRuleset {
  // dealer
  dealerStandsOnAll17: boolean;
  dealerPeeks: boolean;

  // splitting
  splitAces: 0 | 1 | 2 | 3;
  hitOnSplitAce: boolean;
  maxHandsAfterSplit: 1 | 2 | 3 | 4;

  // doubling
  doubleOn: 'any' | 'hard-9-11' | 'hard-10-11';
  doubleAfterSplit: boolean;
  doubleOnSplitAce: boolean;

  // blackjack
  blackjackPayout: number;
  aceAndTenCountsAsBlackjack: boolean;
  splitAceCanBeBlackjack: boolean;
}
export const rules: BlackjackRuleset = {
  dealerStandsOnAll17: true,
  dealerPeeks: true,

  splitAces: 3,
  hitOnSplitAce: false,
  maxHandsAfterSplit: 4,

  doubleOn: 'any',
  doubleAfterSplit: true,
  doubleOnSplitAce: false,

  aceAndTenCountsAsBlackjack: true,
  blackjackPayout: 3 / 2,
  splitAceCanBeBlackjack: false,
};

export const cardValue = (card: Card, { withAceAs11 } = { withAceAs11: false }) =>
  card.faceDown
    ? 0
    : match(card)
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

export const handValue = (
  _hand: Card[],
  acesSplit: boolean,
): number | 'blackjack' | { soft: { low: number; high: number } } => {
  const hand = _hand.filter((card) => !card.faceDown);
  if (hand.length === 2) {
    const [{ faceValue: card1 }, { faceValue: card2 }] = hand;
    const handValue =
      (rules.aceAndTenCountsAsBlackjack && card1 === FaceValue.Ace && card2 === FaceValue.Ten) ||
      (card1 === FaceValue.Ace && card2 === FaceValue.Jack) ||
      (card1 === FaceValue.Ace && card2 === FaceValue.Queen) ||
      (card1 === FaceValue.Ace && card2 === FaceValue.King) ||
      (rules.aceAndTenCountsAsBlackjack && card1 === FaceValue.Ten && card2 === FaceValue.Ace) ||
      (card1 === FaceValue.Jack && card2 === FaceValue.Ace) ||
      (card1 === FaceValue.Queen && card2 === FaceValue.Ace) ||
      (card1 === FaceValue.King && card2 === FaceValue.Ace)
        ? 'blackjack'
        : undefined;
    if (handValue === 'blackjack') {
      return acesSplit && !rules.splitAceCanBeBlackjack ? 21 : 'blackjack';
    }
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
  const value = handValue(hand, undefined);
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
  const debugShoes = {
    split: [shoe[0], shoe[1], shoe[0], shoe[2], ...shoe.slice(3)],
    acePair: [
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      shoe[0],
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      ...shoe.slice(1),
    ],
    resplitAces: [
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      shoe[0],
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      shoe[1],
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      { suit: Suit.Hearts, faceValue: FaceValue.Ace },
      ...shoe.slice(2),
    ],
  };
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

const switchToSplitHand = (game: BlackJackState) => {
  const index = game.playerHands.findIndex((hand, i) => i > game.actionableHandIndex && hand.length === 1);
  return index !== -1 ? index : game.actionableHandIndex;
};

export const acesSplit = (playerHands: Card[][]) =>
  playerHands.length > 1 && playerHands.every((hand) => hand[0].faceValue === FaceValue.Ace);

const playerHandFinished = (playerHands: Card[][], index: number) => {
  const playerHand = playerHands[index];
  const playerHandValue = handValue(playerHand, acesSplit(playerHands));
  const isAcePair = playerHand.length === 2 && playerHand.every((card) => card.faceValue === FaceValue.Ace); // when player can resplit ace, offer player PlayerAction.Split or PlayerAction.Stand
  const cannotResplitAce = match(rules.splitAces)
    .with(0, () => true) // cannot split ace
    .with(1, () => true) // cannot resplit ace
    .with(2, () => playerHands.length >= 3) // can split ace twice to form max 3 hands
    .with(3, () => playerHands.length >= 4) // can split ace thrice to form max 4 hands
    .exhaustive();
  const splitAceFinished = (() => {
    if (!acesSplit(playerHands)) return false;
    if (rules.hitOnSplitAce) return false; // player's turn (can hit on split ace)
    if (isAcePair) {
      if (cannotResplitAce) {
        return true; // this hand is done; player can't resplit ace
      } else {
        return false; // give player option to resplit
      }
    } else {
      return true; // this hand is done (eg. A, 5)
    }
  })();
  const bust = typeof playerHandValue === 'number' && playerHandValue > 21;
  const twentyOne = typeof playerHandValue === 'number' && playerHandValue === 21;
  const softTwentyOne = typeof playerHandValue === 'object' && playerHandValue.soft.high === 21;
  const blackjack = playerHandValue === 'blackjack';
  return splitAceFinished || bust || twentyOne || softTwentyOne || blackjack;
};

export const nextState = (game: BlackJackState, playerAction?: PlayerAction): BlackJackState => {
  return match(game.state)
    .with('dealing', () => {
      if (game.playerHands.length === 1) {
        if (game.playerHands[0].length === 0) {
          // deal first card to player
          const [playerCard, ...shoe] = game.shoe;
          return {
            ...game,
            shoe,
            playerHands: [[playerCard]],
          };
        } else if (game.playerHands[0].length === 1 && game.dealerHand.length === 0) {
          // deal second card to dealer
          const [dealerCard, ...shoe] = game.shoe;
          const dealerHand = [dealerCard];
          return {
            ...game,
            shoe,
            dealerHand,
          };
        } else if (game.playerHands[0].length === 1 && game.dealerHand.length === 1) {
          // deal third card to player
          const [playerCard, ...shoe] = game.shoe;
          const playerHand = [...game.playerHands[0], playerCard];
          return {
            ...game,
            shoe,
            playerHands: [playerHand],
          };
        } else if (game.playerHands[0].length === 2 && game.dealerHand.length === 1) {
          // deal fourth card to dealer
          const [dealerCard, ...shoe] = game.shoe;
          const dealerHand = [...game.dealerHand, { ...dealerCard, faceDown: true }];

          // dealer peeks
          if (rules.dealerPeeks) {
            if (handValue(dealerHand.map(assoc('faceDown', false)), false) === 'blackjack') {
              return {
                ...game,
                shoe,
                dealerHand: dealerHand.map(assoc('faceDown', false)),
                state: 'game-over' as const,
              };
            }
          }

          const playerHandValue = handValue(game.playerHands[0], acesSplit(game.playerHands));
          if (playerHandValue === 21 || playerHandValue === 'blackjack') {
            return {
              ...game,
              shoe,
              dealerHand,
              state: 'dealer-turn' as const, // dealer could still have 21/blackjack
            };
          }
          return {
            ...game,
            shoe,
            dealerHand,
            state: 'player-turn' as const,
          };
        }
      } else if (game.playerHands.length > 1) {
        // player just split, deal 1 card
        // note: bust impossible
        const [playerCard, ...shoe] = game.shoe;
        const playerHand = [...game.playerHands[game.actionableHandIndex], playerCard];
        const playerHands = assoc(game.actionableHandIndex, playerHand, game.playerHands);
        const _playerHandFinished = playerHandFinished(playerHands, game.actionableHandIndex);
        const actionableHandIndex = _playerHandFinished ? switchToSplitHand(game) : game.actionableHandIndex;
        const switchingToSplitHand = actionableHandIndex !== game.actionableHandIndex;
        const state = switchingToSplitHand
          ? ('dealing' as const)
          : _playerHandFinished && !switchingToSplitHand
            ? ('dealer-turn' as const)
            : ('player-turn' as const);
        return {
          ...game,
          shoe,
          playerHands,
          actionableHandIndex,
          state,
        };
      }
      throw new UnreachableError();
    })
    .with('player-turn', () => {
      const allowedActions = determineAllowedActions(game);
      if (!allowedActions.includes(playerAction)) {
        writeFile('errorState.txt', formatGameState(game));
        throw new Error(`Illegal action: ${playerAction}. Allowed actions: ${allowedActions.join(', ')}`);
      }
      return match(playerAction)
        .with(PlayerAction.Hit, () => {
          const [playerCard, ...shoe] = game.shoe;
          const playerHand = [...game.playerHands[game.actionableHandIndex], playerCard];
          const playerHands = assoc(game.actionableHandIndex, playerHand, game.playerHands);
          const handFinished = playerHandFinished(playerHands, game.actionableHandIndex);
          const actionableHandIndex = handFinished ? switchToSplitHand(game) : game.actionableHandIndex;
          const switchingToSplitHand = actionableHandIndex !== game.actionableHandIndex;
          const state = playerHands.every(bust)
            ? ('game-over' as const)
            : match({ handFinished, switchingToSplitHand })
                .with({ handFinished: false, switchingToSplitHand: false }, () => 'player-turn' as const)
                .with({ handFinished: false, switchingToSplitHand: true }, () => 'dealing' as const) // deal card to next split hand
                .with({ handFinished: true, switchingToSplitHand: false }, () => 'dealer-turn' as const)
                .with({ handFinished: true, switchingToSplitHand: true }, () => 'dealing' as const) // deal card to next split hand
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
          const actionableHandIndex = switchToSplitHand(game);
          const switchingToSplitHand = actionableHandIndex !== game.actionableHandIndex;
          if (switchingToSplitHand) {
            return {
              ...game,
              actionableHandIndex,
              state: 'dealing' as const,
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
          const actionableHandIndex = handFinished ? switchToSplitHand(game) : game.actionableHandIndex;
          const switchingToSplitHand = actionableHandIndex !== game.actionableHandIndex;
          const state = playerHands.every(bust)
            ? ('game-over' as const)
            : switchingToSplitHand
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
          const bets = [...game.bets, game.startingBet];
          return { ...game, playerHands, bets, state: 'dealing' as const };
        })
        .exhaustive();
    })
    .with('dealer-turn', () => {
      const dealerShouldStand = (dealerHand: Card[]) => {
        const dealerHandValue = handValue(dealerHand, false);
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
        const { dealerHand, shoe } = (() => {
          if (game.dealerHand[1].faceDown) {
            const dealerHand = [game.dealerHand[0], { ...game.dealerHand[1], faceDown: false }];
            return { dealerHand, shoe: game.shoe };
          } else {
            const [dealerCard, ...shoe] = game.shoe;
            const dealerHand = [...game.dealerHand, dealerCard];
            return { dealerHand, shoe };
          }
        })();
        const acesWereSplit = acesSplit(game.playerHands);
        if (game.playerHands.every((playerHand) => handValue(playerHand, acesWereSplit) === 'blackjack')) {
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

export const determineAllowedActions = (game: BlackJackState): PlayerAction[] => {
  if (game.state !== 'player-turn') throw new Error('Not player turn');

  const playerHand = game.playerHands[game.actionableHandIndex];
  const playerHandValue = handValue(playerHand, acesSplit(game.playerHands));
  if (playerHandFinished(game.playerHands, game.actionableHandIndex)) {
    printGameState(game);
    throw new Error('Player hand is finished; no allowed actions on this hand.');
  }

  const canHit = rules.hitOnSplitAce ? true : !acesSplit(game.playerHands);

  const canSplit = (() => {
    const isPair = playerHand.length === 2 && cardValue(playerHand[0]) === cardValue(playerHand[1]);
    const canSplitAces = (() => {
      const numAcesSplit = acesSplit(game.playerHands) ? game.playerHands.length - 1 : 0;
      return match(rules.splitAces)
        .with(0, () => false)
        .with(1, () => numAcesSplit === 0)
        .with(2, () => numAcesSplit <= 1)
        .with(3, () => numAcesSplit <= 2)
        .exhaustive();
    })();
    const maxSplitCondition = game.playerHands.length < rules.maxHandsAfterSplit;
    return isPair && maxSplitCondition && (playerHand[0].faceValue === FaceValue.Ace ? canSplitAces : true);
  })();

  const canDouble = (() => {
    const canDoubleOnCurrentHand = match(rules.doubleOn)
      .with('any', () => true)
      .with('hard-9-11', () => [9, 10, 11].includes(playerHandValue as number))
      .with('hard-10-11', () => [10, 11].includes(playerHandValue as number))
      .exhaustive();
    return (
      playerHand.length === 2 &&
      canDoubleOnCurrentHand &&
      (rules.doubleAfterSplit ? true : game.actionableHandIndex === 0) &&
      (rules.doubleOnSplitAce ? true : !acesSplit(game.playerHands))
    );
  })();

  return [
    canHit && PlayerAction.Hit,
    PlayerAction.Stand,
    canDouble && PlayerAction.Double,
    canSplit && PlayerAction.Split,
  ].filter(Boolean);
};

export const formatGameState = (game: BlackJackState): string => {
  const lines: string[] = [];
  lines.push(
    [
      'Dealer Hand:',
      `(${formatHandValue(handValue(game.dealerHand, false))})`,
      game.dealerHand.map((c) => (c.faceDown ? '?' : c.faceValue)),
      bust(game.dealerHand) ? 'BUST' : '',
    ].join(' '),
  );
  game.playerHands.forEach((playerHand, i) => {
    lines.push(
      [
        'Player Hand:',
        `(${formatHandValue(handValue(playerHand, acesSplit(game.playerHands)))})`,
        playerHand.map((c) => c.faceValue),
        game.state === 'player-turn' && i === game.actionableHandIndex && '←',
        bust(playerHand) && 'BUST',
        game.bets[i] > game.startingBet && 'D',
      ]
        .filter(Boolean)
        .join(' '),
    );
  });
  return lines.join('\n');
};
export const printGameState = (game: BlackJackState) => {
  console.clear();
  console.log('');
  console.log(
    'Dealer Hand:',
    `(${formatHandValue(handValue(game.dealerHand, false))})`,
    game.dealerHand.map((c) => (c.faceDown ? '?' : c.faceValue)),
    bust(game.dealerHand) ? red('BUST') : '',
  );
  game.playerHands.forEach((playerHand, i) => {
    const args = [
      'Player Hand:',
      `(${formatHandValue(handValue(playerHand, acesSplit(game.playerHands)))})`,
      playerHand.map((c) => c.faceValue),
      game.state === 'player-turn' && i === game.actionableHandIndex && yellow('←'),
      bust(playerHand) && red('BUST'),
      game.bets[i] > game.startingBet && yellow('D'),
    ].filter(Boolean);
    console.log(...args);
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
    const playerHandValue = handValue(playerHand, acesSplit(game.playerHands));
    const playerHandValueHigh = typeof playerHandValue === 'object' ? playerHandValue.soft.high : playerHandValue;
    const dealerHandValue = handValue(game.dealerHand, false);
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
    11: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D'],
    12: ['H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    13: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    14: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    15: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    16: ['S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'],
    17: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    18: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  } as Record<number, ('H' | 'S' | 'D')[]>,
  playerSoftTotals: {
    //    2    3    4    5    6    7    8    9    10   A
    12: ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    13: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    14: ['H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    15: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    16: ['H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    17: ['H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'],
    18: ['S', 'D/S', 'D/S', 'D/S', 'D/S', 'S', 'S', 'H', 'H', 'H'],
    19: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    20: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
  } as Record<number, ('H' | 'S' | 'D' | 'D/S')[]>,
  playerPairs: {
    //   2    3    4    5    6    7    8    9    10   A
    2: ['P/H', 'P/H', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    3: ['P/H', 'P/H', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    4: ['H', 'H', 'H', 'P/H', 'P/H', 'H', 'H', 'H', 'H', 'H'],
    5: ['D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'],
    6: ['P/H', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'],
    7: ['P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'],
    8: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
    9: ['P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'],
    10: ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    1: ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  } as Record<number, ('H' | 'S' | 'D' | 'P' | 'P/H')[]>,
};
export const basicStrategy = (game: BlackJackState): PlayerAction => {
  if (game.state !== 'player-turn') throw new Error('Not player turn');

  const playerHand = game.playerHands[game.actionableHandIndex];
  const playerHandValue = handValue(playerHand, acesSplit(game.playerHands));
  const dealerUpcardValue = cardValue(game.dealerHand[0], { withAceAs11: true });
  const playerHasPair = playerHand.length === 2 && cardValue(playerHand[0]) === cardValue(playerHand[1]);

  const allowedActions = determineAllowedActions(game);
  const playerActionCode = (() => {
    if (playerHasPair && allowedActions.includes(PlayerAction.Split)) {
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
    .with('D', () => (allowedActions.includes(PlayerAction.Double) ? PlayerAction.Double : PlayerAction.Hit))
    .with('D/S', () => (allowedActions.includes(PlayerAction.Double) ? PlayerAction.Double : PlayerAction.Stand))
    .with('P', () => PlayerAction.Split)
    .with('P/H', () => (rules.doubleAfterSplit ? PlayerAction.Split : PlayerAction.Hit))
    .exhaustive();
};
