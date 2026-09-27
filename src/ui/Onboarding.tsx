import { useEffect, useId, useRef, type ReactNode } from 'react';
import dog from '../assets/pixel/dachshund.svg';
import home from '../assets/pixel/home.svg';
import paw from '../assets/pixel/paw.svg';
import { Panel, PixelButton } from './controls';
import '../styles/onboarding.css';

interface StartActions {
  onStart: () => void;
  onSkip: () => void;
}

/** Знакомство использует ту же таксу, что и настоящая площадка. */
export function Welcome({ onStart, onSkip }: StartActions) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  return <section className="onboarding-welcome" aria-labelledby="welcome-title" data-testid="onboarding-welcome">
    <Panel className="welcome-panel">
      <div className="welcome-copy">
        <p className="eyebrow">Твой первый эксперимент · 2–4 минуты</p>
        <h1 id="welcome-title" ref={heading} tabIndex={-1}>Привет! Поможешь мне научиться находить дорогу домой?</h1>
        <p className="welcome-role">Здесь ты исследователь. Ты запускаешь обучение, наблюдаешь за результатом и меняешь награды, чтобы проверить свои идеи.</p>
        <p className="welcome-model">Такса — персонаж программы. Её действия выбирает алгоритм, который учится на опыте.</p>
      </div>
      <div className="welcome-scene">
        <img className="welcome-home" src={home} alt="" />
        <div className="welcome-path" aria-hidden="true"><img src={paw} alt="" /><img src={paw} alt="" /><img src={paw} alt="" /></div>
        <img className="welcome-dog" src={dog} alt="Пиксельная такса GoWeinerDog" />
        <span className="welcome-scene-caption">Один шаг. Новый опыт.</span>
      </div>
      <ol className="welcome-cycle" aria-label="Как проходит эксперимент">
        {['Предположи', 'Обучи', 'Проверь', 'Объясни'].map((label, index) => <li key={label}>
          <span className="welcome-cycle-number" aria-hidden="true">0{index + 1}</span>{label}
        </li>)}
      </ol>
      <div className="welcome-actions">
        <PixelButton onClick={onStart}>Начать знакомство <span aria-hidden="true">→</span></PixelButton>
        <button className="text-button" onClick={onSkip}>Сразу в лабораторию</button>
        <p>Можно выйти в любой момент и вернуться через «Как это работает».</p>
      </div>
    </Panel>
  </section>;
}

interface GuideCardProps {
  /** Номер видимого шага, начиная с 1. */
  stepIndex: number;
  totalSteps?: number;
  title: string;
  children: ReactNode;
  onExit: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  actions?: ReactNode;
  /** Меняется при новом шаге, но не при каждом обновлении прогресса Worker. */
  focusKey?: string;
}

export function GuideCard({ stepIndex, totalSteps = 6, title, children, onExit,
  onContinue, continueLabel = 'Продолжить', actions, focusKey }: GuideCardProps) {
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [stepIndex, title, focusKey]);

  return <section className="onboarding-card" aria-labelledby={titleId} data-testid="onboarding-card">
    <div className="onboarding-card-topline">
      <p className="onboarding-progress">Знакомство <span aria-hidden="true">·</span> шаг {stepIndex} из {totalSteps}</p>
      <button className="text-button onboarding-exit" onClick={onExit}>Выйти из знакомства</button>
    </div>
    <div className="onboarding-card-content">
      <div className="onboarding-dog-badge" aria-hidden="true"><img src={dog} alt="" /></div>
      <div className="onboarding-card-copy">
        <h2 id={titleId} ref={heading} tabIndex={-1}>{title}</h2>
        <div className="onboarding-instruction" id="onboarding-instruction">{children}</div>
        {(onContinue || actions) && <div className="onboarding-card-actions">
          {onContinue && <PixelButton onClick={onContinue}>{continueLabel}</PixelButton>}
          {actions}
        </div>}
      </div>
    </div>
    <div className="onboarding-step-marks" aria-hidden="true">
      {Array.from({ length: totalSteps }, (_, index) => <span key={index} className={index < stepIndex ? 'is-reached' : ''} />)}
    </div>
  </section>;
}

/** Для сохранённого занятия: обычная карточка без перехвата фокуса. */
export function OnboardingInvite({ onStart, onSkip }: StartActions) {
  return <aside className="onboarding-invite" aria-label="Знакомство с лабораторией">
    <img src={dog} alt="" />
    <div><strong>Первый эксперимент с подсказками</strong><p>За 2–4 минуты познакомься с лабораторией. Твоё занятие сохранится.</p></div>
    <div className="onboarding-invite-actions">
      <button className="text-button" onClick={onStart}>Начать знакомство</button>
      <button className="text-button" onClick={onSkip}>Не сейчас</button>
    </div>
  </aside>;
}

export function TrapHint({ onDismiss }: { onDismiss: () => void }) {
  return <aside className="onboarding-trap-hint" aria-labelledby="trap-hint-title">
    <div><strong id="trap-hint-title">Теперь — твоя идея</strong>
      <p>Измени только бонус за лакомство → запиши новый прогноз → обучи заново → проверь путь → сравни два опыта.</p>
      <p>Так проще заметить, как одна награда влияет на поведение.</p>
    </div>
    <button className="text-button" onClick={onDismiss} aria-label="Скрыть подсказку об эксперименте">Понятно</button>
  </aside>;
}
