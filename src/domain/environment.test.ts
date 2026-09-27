import { describe, expect, it } from 'vitest';
import { step } from './environment';
import { initialState } from './state';
import type { EnvironmentConfig } from './types';

const playground: EnvironmentConfig = {
  width: 3, height: 2, start: 0, home: 5, fences: [4], treat: 1,
  rewards: { step: -1, collision: -2, home: 20, treat: 5 },
};

const at = (cell: number, treatCollected = false) => ({ cell, treatCollected });

describe('Правила площадки', () => {
  it('первый вход собирает лакомство, меняет состояние и явно складывает награды', () => {
    expect(step(playground, initialState(playground), 1)).toEqual({
      from: 0, to: 1, fromState: 0, toState: 7,
      before: at(0), after: at(1, true),
      action: 1, reward: 4, collision: false, moved: true,
      enteredTreat: true, collectedTreat: true, terminated: false,
      rewardParts: { step: -1, collision: 0, home: 0, treat: 5 },
    });
  });

  it.each([0, 3] as const)('граница сохраняет позицию и учитывает штраф: действие %s', (action) => {
    const transition = step(playground, at(0), action);
    expect(transition).toMatchObject({ to: 0, after: at(0), moved: false, collision: true, reward: -3, enteredTreat: false, collectedTreat: false });
  });

  it('не переносит движение вправо с конца строки на следующую строку', () => {
    expect(step(playground, at(2), 1)).toMatchObject({ to: 2, collision: true });
  });

  it('повторный вход и столкновения не выдают уже собранное лакомство', () => {
    const first = step(playground, initialState(playground), 1);
    const fence = step(playground, first.after, 2);
    const boundary = step(playground, fence.after, 0);
    const exit = step(playground, boundary.after, 1);
    const second = step(playground, exit.after, 3);
    expect([first, fence, boundary, exit, second].map((transition) => transition.rewardParts.treat)).toEqual([5, 0, 0, 0, 0]);
    expect(fence).toMatchObject({ to: 1, enteredTreat: false, collectedTreat: false });
    expect(second).toMatchObject({ to: 1, enteredTreat: true, collectedTreat: false, reward: -1 });
  });

  it('столкновение само по себе не собирает даже доступное лакомство', () => {
    const collision = step(playground, at(1), 2);
    expect(collision).toMatchObject({ collision: true, collectedTreat: false, enteredTreat: false, after: at(1), rewardParts: { treat: 0 } });
  });

  it('собирает лакомство с бонусом 0 и не выдаёт его после изменения бонуса в той же попытке', () => {
    const zero = { ...playground, rewards: { ...playground.rewards, treat: 0 } };
    const collected = step(zero, initialState(zero), 1);
    const exit = step(zero, collected.after, 1);
    expect(collected).toMatchObject({ collectedTreat: true, rewardParts: { treat: 0 }, after: at(1, true) });
    expect(step(playground, exit.after, 3)).toMatchObject({ enteredTreat: true, collectedTreat: false, rewardParts: { treat: 0 } });
  });

  it('новая попытка снова начинает с доступным лакомством', () => {
    const first = step(playground, initialState(playground), 1);
    const nextEpisode = step(playground, initialState(playground), 1);
    expect(first.collectedTreat).toBe(true);
    expect(nextEpisode).toEqual(first);
  });

  it('домик завершает прогулку; награда дома добавляется к цене шага', () => {
    expect(step(playground, at(2, true), 2)).toMatchObject({ to: 5, terminated: true, reward: 19 });
    expect(() => step(playground, at(5, true), 0)).toThrow('Прогулка завершена');
  });

  it('не изменяет настройки площадки и переданное состояние', () => {
    const original = structuredClone(playground);
    const state = Object.freeze(initialState(playground));
    step(playground, state, 1);
    expect(playground).toEqual(original);
    expect(state).toEqual(at(0));
  });

  it('отклоняет ограждение вместо позиции и неверный признак сбора', () => {
    expect(() => step(playground, at(4), 1)).toThrow('доступной клетке');
    expect(() => step(playground, { cell: 0, treatCollected: 1 } as never, 1)).toThrow('признак сбора');
  });
});
