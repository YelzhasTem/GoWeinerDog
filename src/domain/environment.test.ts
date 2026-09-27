import { describe, expect, it } from 'vitest';
import { step } from './environment';
import type { EnvironmentConfig } from './types';

const playground: EnvironmentConfig = {
  width: 3, height: 2, start: 0, home: 5, fences: [4], treat: 1,
  rewards: { step: -1, collision: -2, home: 20, treat: 5 },
};

describe('Правила площадки', () => {
  it('делает один шаг и явно складывает награды', () => {
    expect(step(playground, 0, 1)).toEqual({
      from: 0, to: 1, action: 1, reward: 4, collision: false, moved: true,
      enteredTreat: true, terminated: false,
      rewardParts: { step: -1, collision: 0, home: 0, treat: 5 },
    });
  });

  it.each([0, 3] as const)('граница сохраняет позицию и учитывает штраф: действие %s', (action) => {
    const transition = step(playground, 0, action);
    expect(transition).toMatchObject({ to: 0, moved: false, collision: true, reward: -3, enteredTreat: false });
  });

  it('не переносит движение вправо с конца строки на следующую строку', () => {
    expect(step(playground, 2, 1)).toMatchObject({ to: 2, collision: true });
  });

  it('повторный вход даёт лакомство, а столкновение на нём — нет', () => {
    const first = step(playground, 0, 1);
    const fence = step(playground, first.to, 2);
    const boundary = step(playground, first.to, 0);
    const exit = step(playground, first.to, 1);
    const second = step(playground, exit.to, 3);
    expect([first.rewardParts.treat, fence.rewardParts.treat, boundary.rewardParts.treat, exit.rewardParts.treat, second.rewardParts.treat]).toEqual([5, 0, 0, 0, 5]);
    expect(fence.to).toBe(1);
    expect(fence.enteredTreat).toBe(false);
  });

  it('домик завершает прогулку; награда дома добавляется к цене шага', () => {
    expect(step(playground, 2, 2)).toMatchObject({ to: 5, terminated: true, reward: 19 });
    expect(() => step(playground, 5, 0)).toThrow('Прогулка завершена');
  });

  it('не изменяет настройки площадки', () => {
    const original = structuredClone(playground);
    step(playground, 0, 1);
    expect(playground).toEqual(original);
  });
});
