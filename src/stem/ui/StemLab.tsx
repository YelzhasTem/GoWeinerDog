import { useEffect, useReducer, useRef, useState } from 'react';
import dog from '../../assets/pixel/dachshund.svg';
import { createTrainer, insights, predict, type TrainedModel } from '../model';
import { runTest, type TestItem, type TestResult } from '../evaluate';
import { CHALLENGE_TARGET, LEVELS, type LevelId } from '../levels';
import { initialStemState, levelComplete, loadStem, modelIsFresh, phaseOf, saveStem, stemReducer, teachSituation, type Stage, type StemState, type TestRecord } from '../lab';
import { ALL_SITUATIONS, MOVE_LABELS, correctMoves, describeSituation, judge, situationKey, type HomeSide, type Move, type Situation } from '../situations';
import { AccuracyChart, Dataset, MoveButtons, Progress, ProbabilityBars, percent, plural } from './Parts';
import { SituationScene } from './Scene';
import '../../styles/stem.css';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, reducedMotion() ? 0 : ms));

export function StemLab({ onOpenQLab }: { onOpenQLab: () => void }) {
  const [state, dispatch] = useReducer(stemReducer, undefined, loadStem);
  useEffect(() => { saveStem(state); }, [state]);
  useEffect(() => { window.scrollTo?.({ top: 0 }); }, [state.screen, state.level]);

  if (state.screen === 'start') return <StartScreen state={state} onStart={() => dispatch({ type: 'open', screen: 'intro' })}
    onContinue={() => dispatch({ type: 'begin' })} onRestart={() => dispatch({ type: 'restart' })} />;
  if (state.screen === 'intro') return <IntroScreen onTry={() => dispatch({ type: 'begin' })} />;
  if (state.screen === 'final') return <FinalScreen state={state} onRestart={() => dispatch({ type: 'restart' })} onExplore={() => dispatch({ type: 'open', screen: 'sandbox' })} />;
  if (state.screen === 'sandbox') return <Sandbox state={state} onBack={() => dispatch({ type: 'open', screen: levelComplete(state, 3) ? 'final' : 'level' })} onOpenQLab={onOpenQLab} />;
  return <LevelScreen state={state} dispatch={dispatch} />;
}

function StartScreen({ state, onStart, onContinue, onRestart }: { state: StemState; onStart: () => void; onContinue: () => void; onRestart: () => void }) {
  const started = JSON.stringify(state.levels) !== JSON.stringify(initialStemState().levels);
  return <section className="stem-start" aria-labelledby="stem-title">
    <div className="start-badges" aria-hidden="true"><span>🎮 игра</span><span>🧪 STEM-лаборатория</span><span>🧠 AI-эксперимент</span></div>
    <img className="start-dog" src={dog} alt="" />
    <h1 id="stem-title" className="start-title">GO WEINER DOG</h1>
    <p className="start-lead">Научи своего бота самостоятельно находить дорогу домой</p>
    <div className="start-actions">
      <button type="button" className="ml-primary big" onClick={onStart}>▶ НАЧАТЬ ЭКСПЕРИМЕНТ</button>
      {started && <button type="button" className="ml-secondary" onClick={onContinue}>Продолжить с уровня {state.level}</button>}
      {started && <button type="button" className="text-button" onClick={onRestart}>Начать заново</button>}
    </div>
    <p className="start-note">Ты не управляешь собакой. Ты обучаешь её принимать решения.</p>
    <p className="start-theme">STEM без сложного оборудования · Не школьник управляет AI — школьник обучает AI</p>
  </section>;
}

const CYCLE = ['ПРИМЕРЫ', 'ОБУЧЕНИЕ', 'ТЕСТ', 'ОШИБКА', 'УЛУЧШЕНИЕ'];

function IntroScreen({ onTry }: { onTry: () => void }) {
  const example: Situation = { rockLeft: false, rockAhead: true, rockRight: false, home: 'right' };
  return <section className="stem-intro" aria-labelledby="intro-title">
    <h1 id="intro-title" className="sr-only">Как работает эксперимент</h1>
    <div className="dog-speech"><img src={dog} alt="" /><p>🐶 «Я хочу попасть домой, но пока не знаю, как обходить препятствия. Научишь меня?»</p></div>
    <ol className="cycle-chips" aria-label="Цикл машинного обучения">{CYCLE.map((item, index) => <li key={item}>{item}{index < CYCLE.length - 1 && <span aria-hidden="true"> →</span>}</li>)}</ol>
    <div className="intro-grid">
      <div className="ml-card">
        <h2>Как учится бот</h2>
        <p>Ты показываешь боту <b>примеры</b>: ситуацию и правильное решение. Бот ищет в них <b>закономерности</b> и применяет их к <b>новым ситуациям</b>, которых раньше не видел.</p>
        <p className="intro-small">Внутри — настоящая маленькая модель (логистическая регрессия). Она учится только на твоих примерах: другие примеры — другое поведение.</p>
      </div>
      <div className="ml-card intro-world">
        <SituationScene situation={example} size="small" />
        <div>
          <h2>Правила прогулки</h2>
          <ul>
            <li>🪨 Не врезаться в камень.</li>
            <li>🏠 Если путь к домику свободен — идти к домику.</li>
            <li>↑ Иначе идти прямо, а если и там камень — обойти сбоку.</li>
          </ul>
        </div>
      </div>
    </div>
    <button type="button" className="ml-primary big" onClick={onTry}>ПОПРОБОВАТЬ</button>
  </section>;
}

type Dispatch = (action: Parameters<typeof stemReducer>[1]) => void;

function LevelScreen({ state, dispatch }: { state: StemState; dispatch: Dispatch }) {
  const level = state.levels[state.level];
  const meta = LEVELS[state.level];
  const fresh = modelIsFresh(level);
  const enoughData = level.examples.length >= meta.minExamples;
  const [teachMode, setTeachMode] = useState<'guided' | 'custom'>('guided');
  const phase = phaseOf(state);
  const lastTest = level.tests[level.tests.length - 1];
  const goStage = (stage: Stage) => dispatch({ type: 'stage', stage });
  const addCustom = () => { setTeachMode('custom'); goStage('data'); requestAnimationFrame(() => document.getElementById('teach-title')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })); };
  const unlocked = (id: LevelId) => id === 1 || levelComplete(state, (id - 1) as LevelId);

  return <section className="stem-level" data-level={state.level} data-stage={level.stage}>
    <div className="level-head">
      <nav className="level-tabs" aria-label="Уровни">{([1, 2, 3] as LevelId[]).map((id) => <button key={id} type="button" aria-current={id === state.level ? 'page' : undefined} disabled={!unlocked(id)}
        onClick={() => dispatch({ type: 'level', level: id })}>{levelComplete(state, id) ? '✓ ' : ''}Уровень {id}</button>)}</nav>
      <p className="eyebrow">УРОВЕНЬ {state.level} · {LEVELS[state.level].title.toUpperCase()}</p>
      <h1 className="level-title">{state.level === 3 ? '🎯 ДОСТИГНИ 80% УСПЕШНЫХ РЕШЕНИЙ' : meta.title}</h1>
      <p className="level-goal">{meta.goal}</p>
    </div>
    <Progress stage={level.stage} onStage={goStage} enabled={{ data: true, train: enoughData, test: fresh, result: !!lastTest }} />
    <div className="stem-layout">
      <div className="stem-main">
        {level.stage === 'data' && <TeachCard state={state} dispatch={dispatch} mode={phase === 'similar' ? 'guided' : teachMode} setMode={setTeachMode} />}
        {level.stage === 'train' && <TrainCard state={state} dispatch={dispatch} />}
        {level.stage === 'test' && <TestCard state={state} dispatch={dispatch} />}
        {level.stage === 'result' && lastTest && <ResultCard state={state} dispatch={dispatch} result={lastTest} />}
      </div>
      <aside className="stem-side">
        <Dataset examples={level.examples} stale={!!level.model && !fresh} onRemove={(id) => dispatch({ type: 'remove', id })} onAdd={addCustom} canAdd={phase !== 'similar'} />
        {level.tests.length > 0 && <div className="ml-card"><AccuracyChart tests={level.tests} target={state.level === 3 ? CHALLENGE_TARGET : undefined} /></div>}
      </aside>
    </div>
  </section>;
}

function TeachCard({ state, dispatch, mode, setMode }: { state: StemState; dispatch: Dispatch; mode: 'guided' | 'custom'; setMode: (mode: 'guided' | 'custom') => void }) {
  const level = state.levels[state.level];
  const meta = LEVELS[state.level];
  const phase = phaseOf(state);
  const [custom, setCustom] = useState<Situation>({ rockLeft: false, rockAhead: true, rockRight: false, home: 'ahead' });
  const [shown, setShown] = useState<{ situation: Situation; move: Move; id: number } | null>(null);
  const [warning, setWarning] = useState('');
  const [added, setAdded] = useState(0);
  const counter = useRef(0);
  const guided = teachSituation(state);
  const situation = shown?.situation ?? (mode === 'custom' ? custom : guided);
  const similarCount = level.examples.filter((example) => situationKey(example.situation) === '010-right').length;

  async function choose(move: Move) {
    if (shown) return;
    const id = ++counter.current;
    setShown({ situation, move, id });
    setAdded(level.examples.length + 1);
    dispatch({ type: 'add', situation, move, fromTeach: mode === 'guided' });
    await wait(900);
    setShown((current) => (current?.id === id ? null : current));
  }
  function toggleRock(side: Move) {
    const next = { ...custom, [side === 'left' ? 'rockLeft' : side === 'right' ? 'rockRight' : 'rockAhead']: !(side === 'left' ? custom.rockLeft : side === 'right' ? custom.rockRight : custom.rockAhead) };
    if (next.rockLeft && next.rockAhead && next.rockRight) { setWarning('Все три стороны закрыты — из такой ситуации нет хода. Оставь хотя бы один проход.'); return; }
    setWarning(''); setCustom(next);
  }
  const enough = level.examples.length >= meta.minExamples;

  return <section className="ml-card teach-card" aria-labelledby="teach-title">
    <h2 id="teach-title">🐶 УЧИ БОТА: КУДА ИДТИ?</h2>
    {phase === 'similar' && <p className="level-hint" data-testid="phase-hint">Эксперимент 1: добавь <b>6 похожих примеров</b> — одну и ту же ситуацию. Посмотрим, хватит ли боту много одинаковых данных. Сейчас: {similarCount} из 6.</p>}
    {phase === 'diverse' && <p className="level-hint" data-testid="phase-hint">Эксперимент 2: добавь <b>разнообразные</b> примеры — препятствие слева, справа, впереди, несколько сразу, свободный путь. Потом переобучи бота и сравни результат.</p>}
    {state.level === 3 && <p className="level-hint">Сам решай, какие ситуации показать боту. Экзамен — все 21 возможная ситуация. Нужно 80%.</p>}
    {phase !== 'similar' && <div className="teach-modes" role="group" aria-label="Откуда взять ситуацию">
      <button type="button" aria-pressed={mode === 'guided'} onClick={() => setMode('guided')}>Подготовленная ситуация</button>
      <button type="button" aria-pressed={mode === 'custom'} onClick={() => setMode('custom')}>Своя ситуация</button>
    </div>}
    <div className="teach-body">
      <SituationScene situation={situation} move={shown?.move} verdict={shown ? judge(shown.situation, shown.move) === 'crash' ? 'crash' : null : null}
        animationKey={shown?.id} editable={mode === 'custom' && !shown} onToggleRock={toggleRock} onHome={(home: HomeSide) => setCustom({ ...custom, home })} />
      <div className="teach-side">
        <p className="teach-situation" data-testid="teach-situation">{describeSituation(situation)}</p>
        {mode === 'custom' && <p className="teach-help">Нажимай на клетки поля: ставь и убирай камни, выбирай, где домик.</p>}
        {warning && <p className="stale-note" role="alert">{warning}</p>}
        <p className="teach-question">Какое решение правильное?</p>
        <MoveButtons onChoose={choose} disabled={!!shown} chosen={shown?.move} />
        <p className="added-toast" role="status" data-testid="added-toast">{added ? `✓ Обучающий пример добавлен · всего ${added}` : ' '}</p>
        {mode === 'guided' && <button type="button" className="text-button" disabled={!!shown || phase === 'similar'} onClick={() => dispatch({ type: 'skip' })}>Другая ситуация ↻</button>}
      </div>
    </div>
    <div className="teach-footer">
      <p>{enough ? `Примеров достаточно для обучения: ${level.examples.length}.` : `Добавь ещё ${meta.minExamples - level.examples.length} ${plural(meta.minExamples - level.examples.length, 'пример', 'примера', 'примеров')}, чтобы обучить бота.`}</p>
      <button type="button" className="ml-primary" disabled={!enough || (phase === 'similar' && similarCount < 6)} onClick={() => dispatch({ type: 'stage', stage: 'train' })}>Дальше: обучение →</button>
    </div>
  </section>;
}

const TRAIN_STAGES = ['Анализируем примеры', 'Ищем закономерности', 'Обучение', 'Готово!'];

function TrainCard({ state, dispatch }: { state: StemState; dispatch: Dispatch }) {
  const level = state.levels[state.level];
  const fresh = modelIsFresh(level);
  const [progress, setProgress] = useState<{ epoch: number; loss: number; startLoss: number } | null>(null);
  const [running, setRunning] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  async function trainBot() {
    if (running) return;
    setRunning(true);
    const trainer = createTrainer(level.examples);
    let step = trainer.run(0);
    const startLoss = step.loss;
    setProgress({ epoch: 0, loss: step.loss, startLoss });
    while (!step.done) {
      await wait(45);
      if (!alive.current) return;
      step = trainer.run(12);
      setProgress({ epoch: step.epoch, loss: step.loss, startLoss });
    }
    await wait(300);
    if (!alive.current) return;
    setRunning(false);
    dispatch({ type: 'trained', model: trainer.result() });
  }
  const model = fresh ? level.model : null;
  const share = progress ? progress.epoch / 300 : model ? 1 : 0;
  const stageIndex = !running && model ? 3 : share < 0.15 ? 0 : share < 0.55 ? 1 : share < 1 ? 2 : 3;

  return <section className="ml-card train-card" aria-labelledby="train-title">
    <h2 id="train-title">🧠 ОБУЧЕНИЕ БОТА</h2>
    <p>Теперь попробуем научить бота находить закономерности.</p>
    <p className="train-count">Обучающих примеров: <b>{level.examples.length}</b></p>
    {!running && !model && <button type="button" className="ml-primary big" onClick={trainBot}>🚀 ОБУЧИТЬ БОТА</button>}
    {(running || model) && <div className="train-progress" data-testid="train-progress">
      <ol className="train-stages">{TRAIN_STAGES.map((name, index) => <li key={name} className={index < stageIndex ? 'done' : index === stageIndex ? 'active' : ''}>{index < stageIndex || (index === 3 && stageIndex === 3) ? '✓ ' : ''}{name}</li>)}</ol>
      <div className="train-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}><span style={{ width: `${share * 100}%` }} /></div>
      {progress && <p className="train-loss">Эпоха {progress.epoch} из 300 · ошибка модели на примерах: {progress.startLoss.toFixed(2)} → <b>{progress.loss.toFixed(2)}</b></p>}
    </div>}
    {model && !running && <TrainedSummary model={model} onTest={() => dispatch({ type: 'stage', stage: 'test' })} />}
  </section>;
}

function TrainedSummary({ model, onTest }: { model: TrainedModel; onTest: () => void }) {
  const found = insights(model);
  return <div className="trained-summary" data-testid="trained-summary">
    <p className="trained-done" role="status">Готово! Бот совпадает с твоими примерами в {percent(model.trainAccuracy)} случаев.</p>
    {found.length > 0 && <><h3>Какие закономерности заметил бот</h3>
      <ul className="insights">{found.map((item) => <li key={`${item.feature}-${item.move}`}>{item.feature} → скорее <b>{MOVE_LABELS[item.move]}</b></li>)}</ul></>}
    <p className="intro-small">Но совпадать с примерами — ещё не значит справляться с новыми ситуациями. Это покажет тест.</p>
    <button type="button" className="ml-primary" onClick={onTest}>Дальше: тест →</button>
  </div>;
}

function TestCard({ state, dispatch }: { state: StemState; dispatch: Dispatch }) {
  const level = state.levels[state.level];
  const tests = LEVELS[state.level].tests;
  const [run, setRun] = useState<{ result: TestResult; index: number } | null>(null);
  const skip = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const model = modelIsFresh(level) ? level.model : null;

  async function start() {
    if (!model || run) return;
    // Решения принимает только модель. Ученик в этот момент ничего не выбирает.
    const result = runTest(model, level.examples, tests);
    skip.current = reducedMotion();
    for (let index = 0; index < result.items.length; index += 1) {
      if (!alive.current) return;
      setRun({ result, index });
      if (!skip.current) await wait(result.items.length > 10 ? 650 : 1000);
    }
    if (!alive.current) return;
    dispatch({ type: 'tested', result });
  }
  if (!model) return <section className="ml-card"><p>Сначала обучи бота на текущих данных.</p>
    <button type="button" className="ml-primary" onClick={() => dispatch({ type: 'stage', stage: 'train' })}>К обучению</button></section>;
  const item = run?.result.items[run.index];
  return <section className="ml-card test-card" aria-labelledby="test-title">
    <h2 id="test-title">🧪 ТЕСТ НА НОВЫХ СИТУАЦИЯХ</h2>
    <p className="test-lead">Теперь не помогай боту. Посмотрим, чему он научился.</p>
    <p className="intro-small">В тесте {tests.length} {plural(tests.length, 'ситуация', 'ситуации', 'ситуаций')}. Бот сам принимает решение в каждой — кнопок управления нет.</p>
    {!run && <button type="button" className="ml-primary big" onClick={start}>▶ ЗАПУСТИТЬ БОТА</button>}
    {run && item && <div className="test-run" data-testid="test-run">
      <SituationScene situation={item.situation} move={item.move} verdict={item.verdict} animationKey={run.index} />
      <div>
        <p className="test-counter">Ситуация {run.index + 1} из {run.result.items.length}{item.seen ? '' : ' · новая'}</p>
        <p className={`test-verdict ${item.verdict}`}>Бот решил: {MOVE_LABELS[item.move]} — {verdictText(item)}</p>
        <ol className="tally" aria-label="Решения бота">{run.result.items.map((entry, index) => <li key={index} className={index > run.index ? 'pending' : entry.verdict === 'ok' ? 'ok' : 'bad'}>{index > run.index ? '·' : entry.verdict === 'ok' ? '✓' : '✗'}</li>)}</ol>
        <button type="button" className="text-button" onClick={() => { skip.current = true; }}>Показать результат сразу</button>
      </div>
    </div>}
  </section>;
}

function verdictText(item: TestItem) {
  if (item.verdict === 'ok') return 'правильно';
  if (item.verdict === 'crash') return 'врезался в камень';
  return `можно лучше: ${MOVE_LABELS[correctMoves(item.situation)[0]]}`;
}

function causeText(item: TestItem) {
  if (item.cause === 'new-situation') return 'Эта ситуация отличается от тех, на которых он обучался.';
  if (item.cause === 'taught-this') return 'В твоих примерах для этой ситуации было такое же решение — бот его выучил. Проверь, правильные ли примеры.';
  return 'Такой пример в данных есть, но других, непохожих примеров намного больше — они «перевесили».';
}

function ResultCard({ state, dispatch, result }: { state: StemState; dispatch: Dispatch; result: TestRecord }) {
  const level = state.levels[state.level];
  const previous = level.tests[level.tests.length - 2];
  const errors = result.items.filter((item) => item.verdict !== 'ok');
  const firstError = errors[0];
  const done = levelComplete(state);
  const improve = () => dispatch({ type: 'stage', stage: 'data' });
  const similar = level.tests.find((test) => test.phase === 'similar');
  return <section className="ml-card result-card" aria-labelledby="result-title" data-testid="result">
    <h2 id="result-title">📊 РЕЗУЛЬТАТ ЭКСПЕРИМЕНТА</h2>
    <div className="result-stats">
      <div><span>Успешность модели</span><b data-testid="accuracy">{percent(result.accuracy)}</b></div>
      <div><span>Правильных решений</span><b data-testid="correct">{result.correct}/{result.total}</b></div>
      <div><span>Обучающих примеров</span><b>{result.examples}</b></div>
    </div>
    {previous && <p className="result-compare" data-testid="result-compare">Прошлый тест: {percent(previous.accuracy)} на {previous.examples} {plural(previous.examples, 'примере', 'примерах', 'примерах')} → сейчас {percent(result.accuracy)} на {result.examples}. {result.accuracy > previous.accuracy ? 'Новые данные помогли! 📈' : result.accuracy < previous.accuracy ? 'Стало хуже — данные изменили поведение бота. 📉' : 'Результат не изменился.'}</p>}
    {firstError && <div className="error-box" role="alert" data-testid="error-box">
      <h3>❌ БОТ ОШИБСЯ</h3>
      <div className="error-body">
        <SituationScene situation={firstError.situation} move={firstError.move} verdict={firstError.verdict} size="small" />
        <div>
          <p><b>{describeSituation(firstError.situation)}</b>: бот выбрал {MOVE_LABELS[firstError.move]} — {verdictText(firstError)}.</p>
          <p>{causeText(firstError)}</p>
          <p className="error-tip">💡 Попробуй добавить больше разнообразных примеров.</p>
        </div>
      </div>
      {errors.length > 1 && <p className="intro-small">Ещё ошибок: {errors.length - 1}. Все решения — ниже.</p>}
    </div>}
    {!firstError && <p className="success-box" role="status">✓ Бот справился со всеми ситуациями теста!</p>}
    {state.level === 2 && result.phase === 'similar' && <p className="level-hint">Много одинаковых примеров, а результат — {percent(result.accuracy)}. Бот выучил одну ситуацию и повторяет её везде. Теперь добавь разнообразные примеры.</p>}
    {state.level === 2 && done && similar && <div className="lesson-box" data-testid="lesson-box">
      <h3>Вывод: важно не только количество данных, но и их разнообразие</h3>
      <p>Похожие примеры: {similar.examples} шт., {similar.diversity} {plural(similar.diversity, 'тип', 'типа', 'типов')} ситуаций → {percent(similar.accuracy)}. Разнообразные: {result.examples} шт., {result.diversity} {plural(result.diversity, 'тип', 'типа', 'типов')} → {percent(result.accuracy)}.</p>
    </div>}
    {state.level === 3 && !done && <p className="level-hint">До цели: {percent(CHALLENGE_TARGET)}. Посмотри, где бот ошибается, и дай ему примеры для таких ситуаций.</p>}
    <div className="result-actions">
      {(!done || firstError) && <button type="button" className={done ? 'ml-secondary' : 'ml-primary big'} onClick={improve}>🔬 УЛУЧШИТЬ МОДЕЛЬ</button>}
      {done && state.level < 3 && <button type="button" className="ml-primary big" onClick={() => dispatch({ type: 'level', level: (state.level + 1) as LevelId })}>Уровень {state.level + 1} →</button>}
      {done && state.level === 3 && <button type="button" className="ml-primary big" onClick={() => dispatch({ type: 'open', screen: 'final' })}>🎯 Цель достигнута — к финалу</button>}
    </div>
    {done && state.level === 1 && <p className="success-box">Уровень 1 пройден: ты провёл полный цикл «данные → обучение → тест → улучшение».</p>}
    <details className="decisions" open={result.items.length <= 8}>
      <summary>Все решения бота ({result.correct} из {result.total} верно)</summary>
      <ul className="decision-grid">{result.items.map((item) => <li key={situationKey(item.situation)} className={item.verdict === 'ok' ? 'ok' : 'bad'}>
        <SituationScene situation={item.situation} move={item.move} verdict={item.verdict} size="tiny" />
        <span>{item.verdict === 'ok' ? '✓' : '✗'} {MOVE_LABELS[item.move]}{item.seen ? '' : ' · новая'}</span>
      </li>)}</ul>
    </details>
  </section>;
}

const CHECKLIST: [keyof StemState['flags'], string][] = [
  ['createdData', 'Создал обучающие данные'], ['trained', 'Обучил модель'], ['tested', 'Проверил её на новых данных'],
  ['foundError', 'Нашёл ошибку'], ['changedData', 'Изменил данные'], ['retrained', 'Переобучил модель'], ['compared', 'Сравнил результаты'],
];

function FinalScreen({ state, onRestart, onExplore }: { state: StemState; onRestart: () => void; onExplore: () => void }) {
  const all = ([1, 2, 3] as LevelId[]).flatMap((id) => state.levels[id].tests);
  const best = Math.max(0, ...state.levels[3].tests.map((test) => test.accuracy));
  return <section className="stem-final" aria-labelledby="final-title">
    <img className="start-dog" src={dog} alt="" />
    <h1 id="final-title">🧠 ТЫ ПРОШЁЛ ЭКСПЕРИМЕНТ</h1>
    <p className="final-score">Лучший результат в челлендже: <b>{percent(best)}</b></p>
    <ul className="final-checklist">{CHECKLIST.map(([flag, text]) => <li key={flag} className={state.flags[flag] ? 'done' : ''}>{state.flags[flag] ? '✓' : '○'} {text}</li>)}</ul>
    <div className="ml-card"><AccuracyChart tests={all} target={CHALLENGE_TARGET} title="Все твои тесты" /></div>
    <p className="final-phrase">«Ты только что провёл эксперимент с машинным обучением — без лаборатории и специального оборудования».</p>
    <div className="start-actions">
      <button type="button" className="ml-primary big" onClick={onRestart}>🚀 ПОПРОБОВАТЬ СНОВА</button>
      <button type="button" className="ml-secondary big" onClick={onExplore}>🔬 ИССЛЕДОВАТЬ НОВУЮ СИТУАЦИЮ</button>
    </div>
  </section>;
}

function Sandbox({ state, onBack, onOpenQLab }: { state: StemState; onBack: () => void; onOpenQLab: () => void }) {
  const model = ([3, 2, 1] as LevelId[]).map((id) => state.levels[id].model).find(Boolean) ?? null;
  const [situation, setSituation] = useState<Situation>(ALL_SITUATIONS[10]);
  const [warning, setWarning] = useState('');
  const prediction = model ? predict(model, situation) : null;
  const verdict = prediction ? judge(situation, prediction.move) : null;
  function toggleRock(side: Move) {
    const field = side === 'left' ? 'rockLeft' : side === 'right' ? 'rockRight' : 'rockAhead';
    const next = { ...situation, [field]: !situation[field] };
    if (next.rockLeft && next.rockAhead && next.rockRight) { setWarning('Оставь хотя бы один проход.'); return; }
    setWarning(''); setSituation(next);
  }
  return <section className="stem-sandbox" aria-labelledby="sandbox-title">
    <h1 id="sandbox-title">🔬 Исследуй новую ситуацию</h1>
    <p className="level-goal">Собери любую ситуацию — обученный бот сразу скажет, что он сделает и насколько уверен.</p>
    {!model ? <p className="level-hint">Сначала обучи бота хотя бы на одном уровне.</p> : <div className="ml-card sandbox-body">
      <SituationScene situation={situation} move={prediction?.move} verdict={verdict} animationKey={situationKey(situation)} editable onToggleRock={toggleRock} onHome={(home) => setSituation({ ...situation, home })} />
      <div>
        <p className="teach-situation">{describeSituation(situation)}</p>
        {warning && <p className="stale-note" role="alert">{warning}</p>}
        <p className={`test-verdict ${verdict}`} data-testid="sandbox-verdict">Бот выбирает {MOVE_LABELS[prediction!.move]} — {verdict === 'ok' ? 'правильно' : verdict === 'crash' ? 'врезается в камень' : `можно лучше: ${MOVE_LABELS[correctMoves(situation)[0]]}`}</p>
        <h3>Уверенность модели</h3>
        <ProbabilityBars probabilities={prediction!.probabilities} />
        <p className="intro-small">Нажимай на клетки поля: ставь и убирай камни, переставляй домик.</p>
      </div>
    </div>}
    <div className="start-actions">
      <button type="button" className="ml-secondary" onClick={onBack}>← Назад</button>
      <button type="button" className="ml-secondary" onClick={onOpenQLab}>Открыть Q-лабораторию (обучение наградами)</button>
    </div>
  </section>;
}
