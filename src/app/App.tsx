import { useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { createLabController } from './labController';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import { canStartTrap, captureLessonExperience, emptyLesson, lessonReducer, loadLesson, saveLesson, type Experience, type Mission } from '../experiments/lesson';
import { loadOnboarding, onboardingReducer, reconcileOnboarding, saveOnboarding, type OnboardingContext } from '../onboarding/onboarding';
import type { EnvironmentConfig, TrainingConfig } from '../domain/types';
import { Panel, PixelButton } from '../ui/controls';
import { TrainingGround } from '../ui/TrainingGround';
import { RoutePlayer } from '../ui/RoutePlayer';
import { ResultsPanel } from '../ui/ResultsPanel';
import { ExperimentComparison } from '../ui/ExperimentComparison';
import { LearningGuide } from '../ui/LearningGuide';
import { GuideCard, OnboardingInvite, TrapHint, Welcome } from '../ui/Onboarding';
import dog from '../assets/pixel/dachshund.svg';
import home from '../assets/pixel/home.svg';
import fence from '../assets/pixel/fence.svg';
import treat from '../assets/pixel/treat.svg';

type Section = 'lab' | 'experiments' | 'guide';
const sectionNames = { lab: 'Лаборатория', experiments: 'Мои опыты', guide: 'Как это работает' };
const format = new Intl.NumberFormat('ru-RU');
const rewardText = (value: number) => `${value < 0 ? '−' : '+'}${format.format(Math.abs(value))}`;

function Conditions({ environment, config, children }: { environment: EnvironmentConfig; config: TrainingConfig; children?: React.ReactNode }) {
  const coordinate = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  return <details className="conditions-details"><summary>Подробнее об условиях</summary>
    {children}
    <p>Площадка {environment.width} × {environment.height}. Строка:столбец — старт {coordinate(environment.start)}, домик {coordinate(environment.home)}{environment.treat !== undefined ? `, лакомство ${coordinate(environment.treat)}` : ''}.</p>
    <p>Ограждения: {environment.fences.map(coordinate).join(', ')}.</p>
    <p>Награды: шаг {rewardText(environment.rewards.step)}, домик {rewardText(environment.rewards.home)}, столкновение — дополнительно {rewardText(environment.rewards.collision)}{environment.treat !== undefined ? `, лакомство ${rewardText(environment.rewards.treat)} за каждый вход` : '. Лакомства нет'}.</p>
    <p>{config.episodes} попыток, до {config.maxSteps} шагов в каждой. Проверка тоже ограничена {config.maxSteps} шагами. Seed {config.seed} задаёт начало случайной последовательности.</p>
    <p>Q-learning: вес нового опыта (alpha) — {format.format(config.alpha)}; учёт будущих наград (gamma) — {format.format(config.gamma)}. Случайные действия (epsilon): от {config.epsilonStart * 100}% до {config.epsilonEnd * 100}% за {config.episodes * config.decayFraction} попыток, затем {config.epsilonEnd * 100}%.</p>
    <p>При проверке нет случайного исследования или изменений Q. При равных оценках порядок выбора: вверх, вправо, вниз, влево.</p>
  </details>;
}

export function App() {
  const [initial] = useState(() => loadLesson());
  const [lesson, dispatch] = useReducer(lessonReducer, initial.state);
  const [onboardingInitial] = useState(() => loadOnboarding());
  const [onboarding, guideDispatch] = useReducer(onboardingReducer, onboardingInitial.state);
  const [onboardingIssue, setOnboardingIssue] = useState(onboardingInitial.issue);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const onboardingWritten = useRef(onboarding);
  const [existingLesson] = useState(() => JSON.stringify(initial.state) !== JSON.stringify(emptyLesson()));
  const [controller] = useState(() => createLabController());
  const lab = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [section, setSection] = useState<Section>('lab');
  const [storageWarning, setStorageWarning] = useState(initial.warning);
  const [storageSaved, setStorageSaved] = useState(Boolean(initial.state.home || initial.state.working.first || initial.state.savedPair) && !initial.warning);
  const writtenState = useRef(lesson);
  const training = useRef<{ id: string; mission: Mission; prediction: string } | null>(null);
  const captured = useRef<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [notice, setNotice] = useState('');
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isTrap = lesson.mission === 'trap';
  const bonus = lesson.drafts.trap.bonus;
  const draft = lesson.drafts[lesson.mission];
  const seedText = lesson.drafts.home.seedText;
  const seed = Number(seedText);
  const seedValid = isTrap || (/^\d+$/.test(seedText) && Number.isInteger(seed) && seed <= 0xffffffff);
  const busy = lab.status === 'training' || lab.status === 'evaluating';
  const activeEnvironment = isTrap ? { ...TRAP_ENVIRONMENT, rewards: { ...TRAP_ENVIRONMENT.rewards, treat: bonus } } : HOME_ENVIRONMENT;
  const config = isTrap ? TRAP_TRAINING : { ...DEFAULT_TRAINING, seed };
  const records = [lesson.current, lesson.home, lesson.working.first, lesson.working.second, lesson.savedPair?.first, lesson.savedPair?.second];
  const viewed = records.find((record) => record?.id === viewingId) ?? null;
  const current = lesson.current;
  const shown = viewed ?? current;
  // Просмотр снимка меняет только отображаемый контекст, не черновик новой тренировки.
  const displayIsTrap = (viewed?.missionId ?? lesson.mission) === 'trap';
  const result = shown?.result ?? lab.evaluation;
  const environment = shown?.model.environment ?? lab.model?.environment ?? activeEnvironment;
  const displayConfig = shown?.model.config ?? lab.model?.config ?? config;
  const visibleCursor = Math.min(cursor, result?.steps ?? 0);
  const total = config.episodes;
  const completed = lab.model?.metrics.length ?? lab.progress?.completed ?? (current ? current.model.metrics.length : 0);
  const pendingReplacement = !canStartTrap(lesson);
  const workingPair = lesson.working;
  const showSavedPair = !!lesson.savedPair && (section === 'experiments' || !workingPair.first);
  const pair = showSavedPair ? lesson.savedPair : workingPair;
  const pairScope = showSavedPair ? 'saved' : 'working';
  const secondExpected = isTrap && !!workingPair.first && current?.id !== workingPair.first.id;
  const phase = viewed ? 3 : busy || (lab.model && !lab.evaluation && !current) ? 2 : current ? isTrap && workingPair.second ? 4 : 3 : 1;
  // Подсказки читают тот же расчёт, что и лаборатория. Сохранённый просмотр
  // приостанавливает знакомство, а незавершённый Worker не даёт перейти дальше.
  const currentBelongsToRun = current && (!training.current || current.id === training.current.id);
  const guideContext: OnboardingContext = {
    mission: lesson.mission, viewingSaved: !!viewed, status: lab.status,
    hasModel: lab.status !== 'training' && Boolean(lab.model || currentBelongsToRun),
    hasResult: !busy && Boolean(currentBelongsToRun || lab.evaluation),
  };
  const guide = reconcileOnboarding(onboarding, guideContext);
  const showWelcome = section === 'lab' && (guide.status === 'new' && !existingLesson || guide.status === 'in-progress' && guide.step === 'welcome');
  const guiding = guide.status === 'in-progress' && guide.step !== 'welcome';
  const guideInLab = guiding && section === 'lab' && !isTrap && !viewed;
  const highlight = (step: string) => guideInLab && guide.step === step ? ' onboarding-target' : '';

  useEffect(() => {
    guideDispatch({ type: 'SYNC', context: guideContext });
  }, [lesson.mission, !!viewed, guideContext.hasModel, guideContext.hasResult, lab.status]);
  useEffect(() => {
    if (onboardingWritten.current === onboarding) return;
    onboardingWritten.current = onboarding;
    setOnboardingIssue(saveOnboarding(onboarding).issue);
  }, [onboarding]);

  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => { document.title = `GoWeinerDog — ${sectionNames[section]}`; }, [section]);
  // Только изменения занятия попадают в localStorage. Кадр и скорость просмотра — отдельно.
  useEffect(() => {
    if (writtenState.current === lesson) return;
    writtenState.current = lesson;
    const saved = saveLesson(lesson);
    setStorageSaved(saved.ok);
    setStorageWarning(saved.ok ? null : saved.error);
  }, [lesson]);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReducedMotion(query.matches); if (query.matches) setPlaying(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  // Новый расчёт — новый путь. Правка наблюдения не перематывает уже открытый путь.
  const resultIdentity = shown?.id ?? (lab.evaluation ? `run-${lab.runId}` : null);
  useEffect(() => { setCursor(0); setPlaying(Boolean(resultIdentity) && section === 'lab' && !reducedMotion && !viewingId); }, [resultIdentity, reducedMotion, viewingId]);
  useEffect(() => {
    if (!playing || !result) return;
    if (cursor >= result.steps) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setCursor((step) => step + 1), 450 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, cursor, result, speed]);

  function recordCompleted() {
    const state = controller.getSnapshot();
    const run = training.current;
    if (!run || captured.current === run.id || !state.model || !state.evaluation) return;
    const experience = captureLessonExperience(run.id, run.mission, state.model, state.evaluation,
      { prediction: run.prediction, observation: lesson.drafts[run.mission].observation });
    captured.current = run.id;
    dispatch({ type: 'complete', experience });
  }
  // Завершённый результат сохраняется сразу, без обязательной ручной фиксации.
  useEffect(() => { recordCompleted(); }, [lab.evaluation, lab.model]);

  function resetOperation() {
    recordCompleted();
    controller.reset(); training.current = null;
    setViewingId(null); setPlaying(false); setCursor(0);
  }
  function switchMission(mission: Mission) {
    if (mission === lesson.mission) return;
    resetOperation(); dispatch({ type: 'mission', mission });
    setNotice(records.some(Boolean) || lab.evaluation ? 'Миссия изменена. Завершённые результаты доступны в «Моих опытах».' : 'Миссия изменена. Начни с прогноза.');
  }
  function changeBonus(value: number) {
    if (value === bonus) return;
    resetOperation(); dispatch({ type: 'changeBonus', bonus: value });
    setNotice('Бонус изменён. Запиши новое ожидание и начни тренировку с нуля.');
  }
  function changeSeed(value: string) {
    resetOperation(); dispatch({ type: 'seed', seedText: value });
    setNotice('Seed изменён — текущая модель сброшена. Начни новую тренировку.');
  }
  function prepare() {
    resetOperation(); dispatch({ type: 'prepare' });
    setNotice('Запиши новое ожидание. Предыдущие завершённые результаты остаются в «Моих опытах».');
  }
  function advanceFirst() {
    prepare();
    window.requestAnimationFrame(() => document.getElementById('treat-bonus')?.focus());
  }
  function startTraining() {
    if (!seedValid || busy || (isTrap && pendingReplacement)) return;
    recordCompleted();
    setViewingId(null); setPlaying(false); setCursor(0); setNotice('');
    const prediction = draft.prediction;
    dispatch({ type: 'draft', mission: lesson.mission, patch: { observation: '' } });
    training.current = { id: crypto.randomUUID(), mission: lesson.mission, prediction };
    controller.train(activeEnvironment, config);
  }
  function stop() { controller.cancel(); setPlaying(false); }
  function checkPath() {
    setViewingId(null); setCursor(0);
    if (current || lab.evaluation) setPlaying(!reducedMotion);
    else controller.evaluate();
    if (!guideInLab) document.getElementById('ground-title')?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
  }
  function showExperience(experience: Experience) {
    setViewingId(experience.id); setPlaying(false); setCursor(0);
    window.requestAnimationFrame(() => document.getElementById('ground-title')?.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' }));
  }
  function returnToCurrent() { setViewingId(null); setPlaying(false); }
  function switchSection(next: Section) { setSection(next); setPlaying(false); }
  function focusLaboratory() {
    window.requestAnimationFrame(() => {
      const target = document.getElementById('mission-title') ?? document.querySelector<HTMLElement>('.section-nav [aria-current="page"]');
      target?.focus();
    });
  }
  function skipOnboarding() {
    guideDispatch({ type: 'SKIP' });
    focusLaboratory();
  }
  function replayOnboarding() {
    guideDispatch({ type: 'RESTART' });
    setQuizAnswer(null); setSection('lab'); setPlaying(false);
  }
  function nextGuideStep() {
    guideDispatch({ type: 'NEXT', context: guideContext, answered: quizAnswer !== null });
    if (guide.step === 'ground') window.requestAnimationFrame(() => document.getElementById('prediction')?.focus());
  }
  function finishOnboarding(toTrap: boolean) {
    guideDispatch({ type: 'FINISH' });
    if (toTrap) switchMission('trap');
    focusLaboratory();
  }
  function restart() {
    resetOperation(); dispatch({ type: 'restart' }); setSection('lab');
    setNotice('Начато новое занятие. Предыдущие результаты очищены.');
  }
  function updateObservation(experience: Experience, value: string) { dispatch({ type: 'observation', id: experience.id, value }); }
  function play() {
    if (!result) return;
    if (cursor >= result.steps) setCursor(0);
    setPlaying((value) => !value);
  }
  let status = notice || (current ? 'Завершённый опыт восстановлен. Можно посмотреть путь или дописать наблюдение.' : 'Сначала прогноз, затем тренировка.');
  if (lab.status === 'training') status = `Тренировка: ${completed} из ${total} попыток`;
  if (lab.status === 'trained') status = 'Тренировка завершена. Теперь посмотри путь.';
  if (lab.status === 'evaluating') status = 'Проверяем выученный путь без случайных действий.';
  if (lab.status === 'ready') status = lab.evaluation?.outcome === 'goal' ? 'Проверка завершена: такса добралась домой.' : 'Проверка завершена: лимит шагов, до домика не дошла.';
  if (lab.status === 'cancelled') status = lab.model ? 'Проверка остановлена. Можно проверить снова.' : 'Тренировка остановлена. Новая начнётся с нуля.';
  if (lab.status === 'error') status = lab.error ?? 'Не удалось выполнить расчёт.';
  if (viewed) status = `Сохранённый опыт: ${viewed.result.outcome === 'goal' ? 'такса добралась домой.' : 'лимит шагов, до домика не дошла.'}`;

  const predictionLabel = displayIsTrap ? !viewed && secondExpected ? 'Что изменится при новом бонусе?' : 'Как лакомство повлияет на путь таксы?' : 'Как такса найдёт дорогу домой?';
  const forecast = <div className={highlight('prediction')}><label htmlFor="prediction">{predictionLabel}</label><textarea id="prediction" rows={2} maxLength={500} value={shown?.notes.prediction ?? draft.prediction} disabled={busy || !!lab.model || !!shown} aria-describedby={guideInLab && guide.step === 'prediction' ? 'onboarding-instruction' : undefined} placeholder="Думаю, такса…" onChange={(event) => dispatch({ type: 'draft', mission: lesson.mission, patch: { prediction: event.target.value } })} /><p className="field-hint">{shown || lab.model ? 'Прогноз записан до тренировки.' : 'Твоё предположение. Можно пропустить.'}</p></div>;
  const playground = <section className={`stage-area${highlight('ground')}`} aria-labelledby="ground-title">
    <Panel className="stage-panel"><div className="panel-topline"><h2 id="ground-title">{environment.treat !== undefined ? 'Дорожка с лакомством' : 'Тренировочная площадка'}</h2><span className="small-tag">{result ? 'Проверка' : busy ? 'Тренировка' : 'Площадка'}</span></div>
      {viewed && <div className="saved-view-banner" data-testid="saved-view">Сохранённый путь · {viewed.missionId === 'trap' ? `бонус +${environment.rewards.treat}` : 'Дорога домой'}{section !== 'lab' && <button type="button" className="text-button" onClick={returnToCurrent}>К текущему опыту</button>}</div>}
      <TrainingGround environment={environment} evaluation={result} cursor={visibleCursor} compact={environment.treat !== undefined} />
      <div className="legend stage-legend" aria-label="Обозначения площадки"><span><img src={dog} alt="" />Такса</span><span><img src={home} alt="" />Домик</span>{environment.treat !== undefined ? <span><img src={treat} alt="" />Лакомство</span> : <span><img src={fence} alt="" />Ограждение</span>}</div>
      {environment.treat !== undefined && <p className="corridor-note">Показана открытая дорожка. Остальная площадка огорожена.</p>}
      <RoutePlayer result={result} cursor={visibleCursor} playing={playing} speed={speed} onSpeed={setSpeed} onPlay={play}
        onStep={() => { setPlaying(false); setCursor((step) => Math.min(step + 1, result?.steps ?? 0)); }}
        onRewind={() => { setPlaying(false); setCursor(0); }} onFinish={() => { setPlaying(false); setCursor(result?.steps ?? 0); }} />
      {viewed && section !== 'lab' && <Conditions environment={environment} config={displayConfig} />}
    </Panel>
    <ResultsPanel environment={environment} result={result} maxSteps={displayConfig.maxSteps} caption={viewed ? 'Результат этого сохранённого пути' : undefined} />
  </section>;
  const comparison = pair?.first ? <ExperimentComparison first={pair.first} second={pair.second}
    onViewFirst={() => showExperience(pair.first!)} onViewSecond={() => pair.second && showExperience(pair.second)}
    explanation={pair.explanation} onExplain={(value) => dispatch({ type: 'explanation', scope: pairScope, value })}
    onObservation={(id, value) => dispatch({ type: 'observation', id, value })}
    title={pairScope === 'saved' ? 'Сохранённая пара' : 'Сравнение опытов'} /> : null;

  const guideSteps = { welcome: 1, ground: 1, prediction: 2, training: 3, check: 4, observation: 5, question: 6, finish: 6 };
  const guideTitles = {
    welcome: 'Привет!', ground: 'Познакомься с площадкой', prediction: 'Сначала — твоя идея',
    training: 'Пора учиться на опыте', check: 'Проверим выученный путь', observation: 'Что получилось на самом деле?',
    question: 'Что изменяется во время тренировки?', finish: 'Первый опыт готов',
  };
  const coordinate = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  const guideCard = guiding && <div data-onboarding-step={guide.step}>
    {isTrap || viewed ? <GuideCard stepIndex={guideSteps[guide.step]} title="Знакомство на паузе" onExit={skipOnboarding}>
      <p>{viewed ? 'Сейчас открыт сохранённый опыт. Чтобы продолжить подсказки, нажми «К текущему опыту». Записи и настройки сохранятся.' : 'Практические подсказки относятся к «Дороге домой». Твои опыты и выбранный бонус остаются сохранёнными.'}</p>
      {!viewed && <button type="button" className="text-button" onClick={() => switchMission('home')}>Открыть «Дорогу домой»</button>}
    </GuideCard> : <GuideCard stepIndex={guideSteps[guide.step]} title={guideTitles[guide.step]} onExit={skipOnboarding}
      onContinue={['ground', 'prediction', 'observation'].includes(guide.step) || guide.step === 'question' && quizAnswer !== null ? nextGuideStep : undefined}
      continueLabel={guide.step === 'ground' ? 'К прогнозу' : guide.step === 'prediction' ? 'К тренировке' : guide.step === 'observation' ? 'К короткому вопросу' : 'Дальше'}>
      {guide.step === 'ground' && <>
        <p>Твоя задача — помочь таксе добраться домой. Алгоритм учится выбирать действия по ожидаемым наградам.</p>
        <p>Такса начинает в клетке <b>{coordinate(environment.start)}</b>, домик — <b>{coordinate(environment.home)}</b> (строка:столбец). Ограждения не дают пройти.</p>
        <p>Каждый шаг: <b>{rewardText(environment.rewards.step)}</b> очк. Столкновение: ещё <b>{rewardText(environment.rewards.collision)}</b>. Домик: <b>{rewardText(environment.rewards.home)}</b> к награде за шаг.</p>
        <p>Управлять таксой стрелками не нужно. Путь она выбирает по результатам обучения. Здесь награды уже настроены; менять бонус будем во второй миссии.</p>
      </>}
      {guide.step === 'prediction' && <>
        <p>Как ты думаешь, что произойдёт после тренировки? Запиши предположение в выделенном поле, а затем сравни его с результатом.</p>
        <p>{current || lab.model ? 'У этого опыта прогноз уже зафиксирован. Можно перечитать его и продолжить с имеющимся результатом.' : 'Можно продолжить без записи. Если прогноз не сбудется, это повод разобраться, а не ошибка.'}</p>
      </>}
      {guide.step === 'training' && <>
        <p>Во время тренировки такса много раз пробует пройти площадку. После каждого шага программа обновляет оценки действий. Так она учится на полученных наградах.</p>
        <p>{lab.status === 'training' ? `Идёт настоящий расчёт: ${completed} из ${total} попыток. Кнопка остановки доступна ниже.` : `Нажми «Начать тренировку». В этой миссии ${total} попыток — новых проб пройти площадку.`}</p>
        {(lab.status === 'cancelled' || lab.status === 'error') && <p>Расчёт не завершён. Можно снова запустить тренировку; она начнётся с нуля.</p>}
        {!seedValid && <p>Сначала исправь seed в «Подробнее об условиях»: нужно целое число от 0 до 4 294 967 295.</p>}
        <p className="field-hint">Следующая подсказка появится только после завершения обучения.</p>
      </>}
      {guide.step === 'check' && <>
        <p>Теперь проверим, чему такса научилась. Во время проверки она использует выученные оценки: случайных проб и нового обучения здесь нет.</p>
        <p>{lab.status === 'evaluating' ? 'Worker рассчитывает путь. Проверку можно остановить.' : 'Нажми «Посмотреть путь». Затем можно поставить паузу, сделать один шаг, выбрать скорость или нажать «Сразу результат».'}</p>
        {(lab.status === 'cancelled' || lab.status === 'error') && <p>Проверка не завершилась. Нажми «Посмотреть путь» ещё раз — выученная модель сохранена.</p>}
      </>}
      {guide.step === 'observation' && result && <>
        <p data-testid="onboarding-outcome"><b>{result.outcome === 'goal' ? 'Такса добралась домой.' : 'До домика не дошла: закончился лимит шагов.'}</b> Выполнено шагов: {result.steps}. Очки: {format.format(result.reward)}.</p>
        <p>Посмотри рассчитанный путь и сравни его со своим прогнозом. Что удивило? Запиши наблюдение в выделенном поле — или продолжи без записи.</p>
        <p className="field-hint">Пауза, один шаг, скорость и «Сразу результат» доступны под площадкой.</p>
      </>}
      {guide.step === 'question' && <>
        <div className="onboarding-quiz" role="group" aria-label="Варианты ответа">{['Готовый маршрут до домика', 'Оценки действий, по которым программа выбирает путь', 'Расположение ограждений'].map((answer, index) => <button key={answer} type="button" aria-pressed={quizAnswer === index} onClick={() => setQuizAnswer(index)}>{answer}</button>)}</div>
        {quizAnswer !== null && <div className="onboarding-feedback" role="status"><p>{quizAnswer === 1 ? 'Да, меняются оценки действий.' : 'Меняются оценки действий, а не готовый маршрут или площадка.'} После своего шага программа использует награду, чтобы обновить число для клетки и направления. На проверке эти числа помогают выбрать действие.</p><p>{quizAnswer !== 1 ? 'Можно выбрать другой вариант или продолжить после объяснения.' : 'Следующий эксперимент поможет исследовать, к чему приводят другие награды.'}</p></div>}
      </>}
      {guide.step === 'finish' && <>
        <p>Первый опыт готов. Дальше ты сможешь изменить награду за лакомство и исследовать, как изменится поведение таксы.</p>
        <div className="onboarding-actions"><PixelButton onClick={() => finishOnboarding(true)}>К эксперименту с лакомством</PixelButton><button type="button" className="text-button" onClick={() => finishOnboarding(false)}>Остаться в лаборатории</button></div>
      </>}
    </GuideCard>}
  </div>;

  return <div className="app-shell">
    <a href="#laboratory" className="skip-link">К лаборатории</a>
    <aside className="sidebar">
      <a className="brand" href="#laboratory" onClick={() => switchSection('lab')} aria-label="GoWeinerDog — к лаборатории"><img src={dog} alt="" /><span>GoWeinerDog<span className="brand-caption">УЧИМСЯ НА ОПЫТЕ</span></span></a>
      <nav className="section-nav" aria-label="Разделы">{(Object.keys(sectionNames) as Section[]).map((key) => <button type="button" key={key} aria-current={section === key ? 'page' : undefined} onClick={() => switchSection(key)}>{sectionNames[key]}</button>)}</nav>
      <p className="sidebar-note">Маленькая такса.<br />Настоящее обучение.</p>
    </aside>
    <div className="workspace"><header className="workspace-header"><span>Игровая лаборатория машинного обучения</span><p className="storage-status" data-testid="storage-status">{storageWarning ? 'Сохранение требует внимания' : storageSaved ? 'Занятие сохранено в этом браузере.' : 'Сохраняем только последнее занятие.'}</p></header>
      {storageWarning && <p className="storage-warning" role="alert" data-testid="storage-warning">{storageWarning}</p>}
      {onboardingIssue && <p className="storage-warning" data-testid="onboarding-storage-warning">{onboardingIssue === 'invalid' ? 'Сведения о знакомстве повреждены или имеют другую версию. Его можно пройти заново; занятие хранится отдельно.' : 'Не удалось сохранить состояние знакомства на устройстве. Подсказки работают в этой вкладке, но после перезагрузки могут появиться снова.'}</p>}
      {busy && (section !== 'lab' || viewed || showWelcome) && <div className="background-operation" role="status">{lab.status === 'training' ? 'Текущая тренировка продолжается' : 'Текущая проверка продолжается'}<button type="button" className="text-button" onClick={stop}>Остановить {lab.status === 'training' ? 'тренировку' : 'проверку'}</button></div>}
      {guiding && section !== 'lab' && <div className="onboarding-resume"><span>Подсказки знакомства ждут в лаборатории.</span><button type="button" className="text-button" onClick={() => switchSection('lab')}>Продолжить знакомство</button><button type="button" className="text-button" onClick={skipOnboarding}>Выйти из знакомства</button></div>}
      <main id="laboratory">
        {showWelcome && <Welcome onStart={() => guideDispatch({ type: 'BEGIN' })} onSkip={skipOnboarding} />}
        {section === 'lab' && !showWelcome && <>
          {guide.status === 'new' && existingLesson && <OnboardingInvite onStart={replayOnboarding} onSkip={skipOnboarding} />}
          <div className="mission-topbar"><nav className="mission-switch" aria-label="Миссии"><button type="button" aria-pressed={!displayIsTrap} disabled={!!viewed} onClick={() => switchMission('home')}>Дорога домой</button><button type="button" aria-pressed={displayIsTrap} disabled={!!viewed} onClick={() => switchMission('trap')}>Ловушка лакомства</button></nav><button type="button" className="text-button restart-button" disabled={!!viewed} onClick={restart}>Начать заново</button></div>
          <div className="mission-heading"><div><p className="eyebrow">МИССИЯ {displayIsTrap ? '02 · ЭКСПЕРИМЕНТ С НАГРАДОЙ' : '01 · ПЕРВАЯ ПРОГУЛКА'}</p><h1 id="mission-title" tabIndex={-1}>{displayIsTrap ? 'Ловушка лакомства' : 'Дорога домой'}<span className="title-dot">.</span></h1><p className="mission-description">{viewed ? 'Сохранённый опыт: посмотри путь или дополни наблюдение. Условия этого опыта неизменны.' : isTrap ? 'Добраться домой или вернуться за лакомством? Измени бонус и сравни два пути.' : 'Помоги таксе научиться добираться до домика. Сначала предположи, потом проверь.'}</p></div></div>
          {guideCard}
          {isTrap && !viewed && !guide.trapHintDismissed && <TrapHint onDismiss={() => guideDispatch({ type: 'DISMISS_TRAP_HINT' })} />}
          <ol className="lesson-steps" aria-label="Шаги занятия">{['Прогноз', 'Тренировка', 'Наблюдение', displayIsTrap ? 'Сравнение' : 'Вывод'].map((label, index) => <li key={label} aria-current={phase === index + 1 ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
          <div className="lab-layout">
            <section className="controls-area" aria-label="Действия эксперимента"><Panel className="action-panel">
              <h2>{viewed ? 'Сохранённый опыт' : current ? 'Что получилось?' : busy ? 'Такса тренируется' : secondExpected ? 'Проверим новое ожидание' : 'Начни с предположения'}</h2>
              {current || viewed || lab.model ? <details className="forecast-summary" open={guideInLab && guide.step === 'prediction' || undefined}><summary>Твой прогноз</summary>{forecast}</details> : forecast}
              {displayIsTrap && <div className="bonus-field"><label htmlFor="treat-bonus">Бонус за лакомство</label><select id="treat-bonus" value={viewed ? environment.rewards.treat : bonus} disabled={!!viewed} onChange={(event) => changeBonus(Number(event.target.value))}>{Array.from({ length: 11 }, (_, value) => <option value={value} key={value}>+{value} очк.</option>)}</select></div>}
              {shown && <div className={`observation-field${highlight('observation')}`}><label htmlFor="explanation">{shown.missionId === 'trap' ? 'Что делает такса? Опиши наблюдаемое поведение.' : 'Совпал ли путь с твоим прогнозом? Почему?'}</label><textarea id="explanation" rows={2} maxLength={1500} value={shown.notes.observation} aria-describedby={guideInLab && guide.step === 'observation' ? 'onboarding-instruction' : undefined} onChange={(event) => updateObservation(shown, event.target.value)} placeholder="Я заметил(а), что…" /><p className="field-hint">Наблюдение можно дописать позже. Условия и результат не меняются.</p></div>}
              <div className={`main-actions${highlight('training')}${highlight('check')}`}>
                {viewed ? <PixelButton onClick={returnToCurrent}>К текущему опыту</PixelButton>
                  : busy ? <PixelButton onClick={stop} secondary>Остановить {lab.status === 'training' ? 'тренировку' : 'проверку'}</PixelButton>
                    : pendingReplacement && isTrap ? <PixelButton onClick={() => dispatch({ type: 'commitPair' })}>Заменить сохранённую пару</PixelButton>
                      : current ? isTrap ? workingPair.second ? <PixelButton onClick={() => document.getElementById('comparison-explanation')?.focus()}>Объяснить результат</PixelButton> : <PixelButton onClick={advanceFirst}>Сохранить опыт и изменить бонус</PixelButton> : <PixelButton onClick={() => switchMission('trap')}>Перейти к эксперименту с лакомством</PixelButton>
                        : lab.model ? <PixelButton onClick={checkPath}>Посмотреть путь →</PixelButton> : <PixelButton onClick={startTraining} disabled={!seedValid}>Начать тренировку →</PixelButton>}
                {current && !viewed && <div className="secondary-actions"><button type="button" className="text-button" onClick={checkPath}>Посмотреть путь</button><button type="button" className="text-button" onClick={prepare}>{isTrap ? 'Новый эксперимент' : 'Обучить заново с нуля'}</button></div>}
              </div>
              {viewed && <p className="field-hint">Чтобы изменить условия следующей тренировки, нажми «К текущему опыту». Текущие настройки сохранятся.</p>}
              {busy && !viewed && <progress max={total} value={completed} aria-label="Завершённые тренировочные попытки" />}
              <p className="status-message" role="status" data-testid="run-status">{status}</p>
              {!viewed && <p className="attempt-count">Попытки: <b data-testid="episode-count">{completed} / {total}</b></p>}
              {pendingReplacement && isTrap && !viewed && <p className="next-step">Новая пара готова. Прежняя сохранена отдельно: замени её, когда будешь готов продолжить.</p>}
              <div className="reward-rules"><span>Шаг <b>{rewardText(environment.rewards.step)}</b></span><span>Домик <b>{rewardText(environment.rewards.home)}</b></span>{displayIsTrap && <span>Лакомство <b>{rewardText(environment.rewards.treat)}</b></span>}</div>
              <p className="rule-note">{displayIsTrap ? 'Бонус за каждый вход, включая первый. ' : ''}Столкновение: ещё {rewardText(environment.rewards.collision)}.</p>

            </Panel></section>
            {playground}
          </div>
          <div className="lab-details">
              <Conditions environment={viewed ? environment : activeEnvironment} config={viewed ? displayConfig : config}>{!displayIsTrap && <><div className="seed-line"><label htmlFor="seed">Seed <span>начало случайности</span></label><input id="seed" value={viewed ? displayConfig.seed : seedText} inputMode="numeric" maxLength={32} disabled={busy || !!viewed} aria-invalid={!viewed && !seedValid} onChange={(event) => changeSeed(event.target.value)} /></div><p className={`field-hint ${!viewed && !seedValid ? 'error-text' : ''}`}>{viewed ? 'Seed сохранённого опыта. Его условия не меняются.' : seedValid ? 'Одинаковый seed повторяет тренировку.' : 'Введи целое число от 0 до 4 294 967 295.'}</p></>}</Conditions>
              {displayIsTrap && !viewed && <details className="research-hint"><summary>Подсказка для исследования</summary><p>Сложи награды за два шага: уйти от лакомства и вернуться. При каком бонусе это выгодно? Домик заканчивает прогулку.</p></details>}
          </div>
          {isTrap && !viewed && lesson.savedPair && workingPair.first && lesson.savedPair.first.id !== workingPair.first.id && <p className="saved-pair-note">Предыдущая пара и её объяснение сохранены в «Моих опытах», пока ты не заменишь их новой парой.</p>}
          {displayIsTrap && comparison}
        </>}
        {section === 'experiments' && <>
          <div className="section-heading"><p className="eyebrow">ТВОИ НАБЛЮДЕНИЯ</p><h1>Мои опыты<span className="title-dot">.</span></h1><p>Последнее занятие в этом браузере. Можно вернуться к пути и дописать наблюдения.</p></div>
          {comparison}
          {lesson.home && <section className="home-record"><h2>Дорога домой</h2><p>{lesson.home.result.outcome === 'goal' ? 'Такса добралась домой.' : 'До домика не дошла.'} {lesson.home.result.reward} очк. · {lesson.home.result.steps} выполненных шагов</p><button type="button" className="text-button" onClick={() => showExperience(lesson.home!)}>Путь домой</button><details><summary>Записи и условия первой миссии</summary><p>Прогноз: {lesson.home.notes.prediction || 'Не записан.'}</p><label htmlFor="home-observation">Наблюдение первой миссии</label><textarea id="home-observation" rows={2} maxLength={1500} value={lesson.home.notes.observation} onChange={(event) => updateObservation(lesson.home!, event.target.value)} /><Conditions environment={lesson.home.model.environment} config={lesson.home.model.config} /></details></section>}
          {!pair?.first && !lesson.home && <div className="empty-state"><img src={dog} alt="Пиксельная такса" /><h2>Здесь будут твои опыты</h2><p>Заверши тренировку и посмотри путь. Результат сохранится автоматически.</p><PixelButton onClick={() => switchSection('lab')}>Открыть лабораторию</PixelButton></div>}
          {viewed && playground}
        </>}
        {section === 'guide' && <LearningGuide onRestart={replayOnboarding} />}
      </main>
      <footer className="footer-small">GoWeinerDog · Учебная модель алгоритма, не руководство по дрессировке.</footer>
    </div>
  </div>;
}
