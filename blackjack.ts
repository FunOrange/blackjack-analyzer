import { sum } from 'ramda';
import { Pattern, match } from 'ts-pattern';

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

export const defaultRuleset = {
  hitSoft17: false,
  doubleAfterSplit: true,
  resplitAces: false,
  blackjackPayout: 1.5,
  dealerPeeks: true,
  aceAndTenCountsAsBlackjack: true,
};
type BlackjackRuleset = typeof defaultRuleset;

export const cardValue = (card: Card) =>
  match(card)
    .with({ faceValue: FaceValue.Ace }, () => 1) // can be 11 depending on hand
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
    if (card1 === FaceValue.Ace && card2 === FaceValue.Ten) return 'blackjack'; // TODO: ruleset
    if (card1 === FaceValue.Ace && card2 === FaceValue.Jack) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.Queen) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.King) return 'blackjack';
    if (card1 === FaceValue.Ace && card2 === FaceValue.Ten) return 'blackjack'; // TODO: ruleset
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

interface BlackJackState {
  shoe: Card[];
  playerHand: Card[];
  dealerHand: Card[];
  state: 'dealing' | 'player-turn' | 'dealer-turn' | 'game-over';
  bet: number;
  ruleset: BlackjackRuleset;
}

export const initState = (betDollars: number): BlackJackState => {
  const numDecks = 8;
  const shoe = Array.from({ length: numDecks }, () => UNSHUFFLED_DECK_TEMPLATE)
    .flat()
    .sort(() => Math.random() - 0.5);
  return {
    shoe,
    playerHand: [],
    dealerHand: [],
    state: 'dealing',
    bet: betDollars,
    ruleset: defaultRuleset,
  };
};

export const nextState = (state: BlackJackState, playerAction?: PlayerAction): BlackJackState =>
  match(state.state)
    .with('dealing', () => {
      if (state.playerHand.length === 0) {
        const [playerCard, ...shoe] = state.shoe;
        return {
          ...state,
          shoe,
          playerHand: [playerCard],
        };
      } else if (state.playerHand.length === 1 && state.dealerHand.length === 0) {
        const [dealerCard, ...shoe] = state.shoe;
        const dealerHand = [dealerCard];
        return {
          ...state,
          shoe,
          dealerHand,
        };
      } else if (state.playerHand.length === 1 && state.dealerHand.length === 1) {
        const [playerCard, ...shoe] = state.shoe;
        const playerHand = [state.playerHand[0], playerCard];
        if (handValue(playerHand) === 21 || handValue(playerHand) === 'blackjack') {
          return {
            ...state,
            shoe,
            playerHand,
            state: 'dealer-turn' as const, // dealer could still have 21/blackjack
          };
        }
        return {
          ...state,
          shoe,
          playerHand,
          state: 'player-turn' as const,
        };
      }
      throw new UnreachableError();
    })
    .with('player-turn', () =>
      match(playerAction)
        .with(PlayerAction.Hit, () => {
          const [playerCard, ...shoe] = state.shoe;
          const playerHand = [...state.playerHand, playerCard];
          if (handValue(playerHand) === 21 || handValue(playerHand) === 'blackjack') {
            // player 21/blackjack
            return {
              ...state,
              shoe,
              playerHand,
              state: 'dealer-turn' as const, // dealer could still have 21/blackjack
            };
          }
          if ((handValue(playerHand) as number) > 21) {
            // player busts
            return {
              ...state,
              shoe,
              playerHand,
              state: 'game-over' as const,
            };
          }
          return {
            ...state,
            shoe,
            playerHand,
          };
        })
        .with(PlayerAction.Stand, () => ({
          ...state,
          state: 'dealer-turn' as const,
        }))
        .with(PlayerAction.Double, () => state)
        .with(PlayerAction.Split, () => state)
        .exhaustive(),
    )
    .with('dealer-turn', () => {
      const dealerShouldStand = (dealerHand: Card[]) => {
        const dealerHandValue = handValue(dealerHand);
        return (
          dealerHandValue === 'blackjack' ||
          (typeof dealerHandValue === 'number' && dealerHandValue >= 17) ||
          (typeof dealerHandValue === 'object' && dealerHandValue.soft.high === 17) || // TODO: ruleset
          (typeof dealerHandValue === 'object' && dealerHandValue.soft.high === 18) ||
          (typeof dealerHandValue === 'object' && dealerHandValue.soft.high === 19) ||
          (typeof dealerHandValue === 'object' && dealerHandValue.soft.high === 20) ||
          (typeof dealerHandValue === 'object' && dealerHandValue.soft.high === 21)
        );
      };
      if (dealerShouldStand(state.dealerHand)) {
        // dealer stands
        return {
          ...state,
          state: 'game-over' as const,
        };
      } else {
        // dealer hits
        const [dealerCard, ...shoe] = state.shoe;
        const dealerHand = [...state.dealerHand, dealerCard];
        if (handValue(state.playerHand) === 'blackjack') {
          // either push or player wins, no need for dealer to keep hitting
          return {
            ...state,
            shoe,
            dealerHand,
            state: 'game-over' as const,
          };
        } else {
          return {
            ...state,
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

export const printState = (state: BlackJackState) => {
  console.clear();
  console.log('');
  console.log(
    'Dealer Hand:',
    `(${formatHandValue(handValue(state.dealerHand))})`,
    state.dealerHand.map((c) => c.faceValue),
  );
  console.log(
    'Player Hand:',
    `(${formatHandValue(handValue(state.playerHand))})`,
    state.playerHand.map((c) => c.faceValue),
  );
  // console.log('state:', state.state);
};

export const determineResult = (
  state: BlackJackState,
):
  | { result: 'player-win'; reason: 'blackjack' | 'dealer-bust' | 'higher-hand' }
  | { result: 'dealer-win'; reason: 'blackjack' | 'player-bust' | 'higher-hand' }
  | { result: 'push' } => {
  if (state.state !== 'game-over') throw new Error('Game is not over');

  const playerHandValue = handValue(state.playerHand);
  const playerHandValueHigh = typeof playerHandValue === 'object' ? playerHandValue.soft.high : playerHandValue;
  const dealerHandValue = handValue(state.dealerHand);
  const dealerHandValueHigh = typeof dealerHandValue === 'object' ? dealerHandValue.soft.high : dealerHandValue;

  return match({ playerHandValue: playerHandValueHigh, dealerHandValue: dealerHandValueHigh })
    .with({ playerHandValue: 'blackjack', dealerHandValue: 'blackjack' }, () => ({ result: 'push' }) as const)
    .with({ playerHandValue: 'blackjack' }, () => ({ result: 'player-win', reason: 'blackjack' }) as const)
    .with({ dealerHandValue: 'blackjack' }, () => ({ result: 'dealer-win', reason: 'blackjack' }) as const)
    .with(
      { playerHandValue: Pattern.number, dealerHandValue: Pattern.number },
      ({ playerHandValue, dealerHandValue }) => {
        if (playerHandValue > 21) return { result: 'dealer-win', reason: 'player-bust' } as const;
        else if (dealerHandValue > 21) return { result: 'player-win', reason: 'dealer-bust' } as const;
        else if (playerHandValue > dealerHandValue) return { result: 'player-win', reason: 'higher-hand' } as const;
        else if (playerHandValue < dealerHandValue) return { result: 'dealer-win', reason: 'higher-hand' } as const;
        else return { result: 'push' } as const;
      },
    )
    .exhaustive();
};

export const basicStrategy = (state: BlackJackState): PlayerAction => {
  if (state.state !== 'player-turn') throw new Error('Not player turn');

  const playerHandValue = handValue(state.playerHand);
  const dealerHandValue = handValue(state.dealerHand);
  if (typeof playerHandValue === 'number') {
    if (playerHandValue >= 17) return PlayerAction.Stand;
    if (playerHandValue <= 11) return PlayerAction.Hit;
    if (playerHandValue === 12) {
      if (dealerHandValue === 2 || dealerHandValue === 3 || (dealerHandValue as number) >= 7) return PlayerAction.Hit;
      return PlayerAction.Stand;
    }
    if (playerHandValue === 13 || playerHandValue === 14 || playerHandValue === 15 || playerHandValue === 16) {
      if ((dealerHandValue as number) <= 6) return PlayerAction.Stand;
      return PlayerAction.Hit;
    }
  }
  return PlayerAction.Hit;
};
