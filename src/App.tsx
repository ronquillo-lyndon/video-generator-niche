import {useEffect, useMemo, useRef, useState} from 'react';
import {buildScenes, recalculateSceneTimings, duration, themes, type Project, type QuizQuestion, type RenderJob, type SceneType} from './types';
import {demoProject} from './seed';

const API = '/api';
const nav = ['Dashboard', 'Create quiz', 'Editor', 'Templates', 'My videos', 'Publishing', 'Settings'];
const sceneTitle: Record<SceneType, string> = {hook:'HOOK', question:'QUESTION', reveal:'REVEAL', explanation:'DID YOU KNOW?', score:'YOUR SCORE', cta:'CALL TO ACTION'};
const initialJob: RenderJob = {jobId:'', status:'idle', progress:0, currentStep:''};
const letters = ['A','B','C','D'];

function fmt(seconds: number) { return `00:${String(Math.floor(seconds)).padStart(2, '0')}`; }
function fit(text: string, base: number) { return text.length > 82 ? base * .67 : text.length > 54 ? base * .8 : base; }

export default function App() {
  const [project, setProject] = useState<Project>(() => { try { return JSON.parse(localStorage.getItem('quizframe-project') || '') } catch { return demoProject } });
  const [page, setPage] = useState('Editor');
  const [selectedSceneId, setSelectedSceneId] = useState<string>(() => project.scenes[1]?.id || project.scenes[0]?.id || 'hook');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(() => project.scenes[1]?.startTime || 0);
  const [sound, setSound] = useState(true);
  const [showGuides, setShowGuides] = useState(false);
  const [job, setJob] = useState<RenderJob>(initialJob);
  const [notice, setNotice] = useState('');
  const timer = useRef<number>();
  const total = duration(project);

  const activeScene = useMemo(() => {
    if (selectedSceneId) {
      const found = project.scenes.find(s => s.id === selectedSceneId);
      if (found) return found;
    }
    return project.scenes.find(s => time >= s.startTime && time < s.startTime + s.duration)
      ?? project.scenes[project.scenes.length - 1];
  }, [project.scenes, time, selectedSceneId]);

  const activeQuestion = useMemo(() => {
    return project.questions.find(q => q.id === activeScene?.questionId) || project.questions[0];
  }, [project.questions, activeScene]);

  useEffect(() => { localStorage.setItem('quizframe-project', JSON.stringify(project)); }, [project]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setTime(t => {
        if (t >= total) {
          setPlaying(false);
          return 0;
        }
        const next = +(t + 0.1).toFixed(2);
        const curScene = project.scenes.find(s => next >= s.startTime && next < s.startTime + s.duration) ?? project.scenes[project.scenes.length - 1];
        if (curScene && curScene.id !== selectedSceneId) {
          setSelectedSceneId(curScene.id);
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer.current);
  }, [playing, total, project.scenes, selectedSceneId]);

  useEffect(() => {
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'idle') return;
    const id = window.setInterval(async () => {
      const response = await fetch(`${API}/render/${job.jobId}`);
      if (response.ok) setJob(await response.json());
    }, 900);
    return () => clearInterval(id);
  }, [job.jobId, job.status]);

  function update(mutator: (old: Project) => Project) { setProject(old => mutator(old)); }

  function selectScene(sceneId: string) {
    const s = project.scenes.find(x => x.id === sceneId);
    if (!s) return;
    setSelectedSceneId(s.id);
    setTime(s.startTime);
    setPlaying(false);
  }

  function selectQuestion(questionId: string) {
    const qScene = project.scenes.find(s => s.type === 'question' && s.questionId === questionId);
    if (qScene) {
      selectScene(qScene.id);
    } else {
      const anyScene = project.scenes.find(s => s.questionId === questionId);
      if (anyScene) selectScene(anyScene.id);
    }
  }

  async function generate(input: {topic:string; category:string; count:number; timer:number}) {
    setNotice('Generating quiz in demo mode…');
    try {
      const res = await fetch(`${API}/quiz/generate`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(input)});
      const result = await res.json() as {questions: QuizQuestion[]; mode: string};
      const qs = result.questions;
      const newScenes = buildScenes(qs, input.timer);
      update(old => ({...old, title: input.topic || old.title, category:input.category, timer:input.timer, questions:qs, scenes:newScenes, updatedAt:new Date().toISOString()}));
      setPage('Editor');
      const firstQScene = newScenes.find(s => s.type === 'question') || newScenes[0];
      setSelectedSceneId(firstQScene.id);
      setTime(firstQScene.startTime);
      setNotice(`${qs.length} questions ready · ${result.mode}`);
    } catch {
      setNotice('Could not reach the local API. Start npm run dev and try again.');
    }
  }

  async function render() {
    setNotice('');
    try {
      const res = await fetch(`${API}/projects/${project.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(project)});
      if (!res.ok) throw Error();
      const start = await fetch(`${API}/render`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id})});
      if (!start.ok) throw Error();
      setJob(await start.json());
    } catch {
      setNotice('The local renderer is unavailable. Start npm run dev to enable the rendering queue.');
    }
  }

  function editQuestion(questionId: string, key: keyof QuizQuestion, value: any) {
    const questions = project.questions.map(q => q.id === questionId ? {...q, [key]:value} : q);
    update(old => ({...old, questions, scenes:buildScenes(questions, old.timer)}));
  }

  function addQuestion() {
    const newId = Math.random().toString(36).slice(2, 9);
    const newQ: QuizQuestion = {
      id: newId,
      question: 'New quiz question',
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correctAnswerIndex: 0,
      explanation: 'Explanation for this question.',
      category: project.category || 'General Knowledge',
      difficulty: 'easy'
    };
    const questions = [...project.questions, newQ];
    const scenes = buildScenes(questions, project.timer);
    update(p => ({...p, questions, scenes}));
    const targetScene = scenes.find(s => s.type === 'question' && s.questionId === newId);
    if (targetScene) {
      setSelectedSceneId(targetScene.id);
      setTime(targetScene.startTime);
    }
    setNotice('Added new question.');
  }

  function deleteQuestion(id: string) {
    if (project.questions.length <= 2) {
      setNotice('A quiz requires at least 2 questions.');
      return;
    }
    const questions = project.questions.filter(q => q.id !== id);
    const scenes = buildScenes(questions, project.timer);
    update(p => ({...p, questions, scenes}));
    setSelectedSceneId(scenes[1]?.id || scenes[0].id);
    setTime(scenes[1]?.startTime || 0);
    setNotice('Question removed.');
  }

  function updateSceneDuration(sceneId: string, dur: number) {
    const rawScenes = project.scenes.map(s => s.id === sceneId ? {...s, duration: Math.max(1, dur)} : s);
    const scenes = recalculateSceneTimings(rawScenes);
    update(p => ({...p, scenes}));
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">✦</span><span>quizframe</span></div><p className="workspace">WORKSPACE</p>{nav.map(item => <button key={item} className={`nav-item ${page===item?'active':''}`} onClick={()=>setPage(item)}><span>{icon(item)}</span>{item}</button>)}<div className="sidebar-bottom"><div className="upgrade"><b>✦ Creator plan</b><small>Unlimited local projects</small><button>Manage plan</button></div><div className="profile"><div className="avatar">AM</div><span><b>Alex Morgan</b><small>Creator workspace</small></span><span>⌄</span></div></div></aside>
    <main>
      <header><div><span className="crumb">PROJECTS / </span><b>{project.title}</b><span className="saved">● Saved locally</span></div><div className="header-actions"><button className="ghost" onClick={()=>setPage('Publishing')}>↗ Publish</button><button className="primary" onClick={render}>✦ Render video</button></div></header>
      {notice && <div className="notice">{notice}<button onClick={()=>setNotice('')}>×</button></div>}
      {page === 'Editor' && <Editor project={project} total={total} activeScene={activeScene} activeQuestion={activeQuestion} selectedSceneId={selectedSceneId} selectScene={selectScene} selectQuestion={selectQuestion} addQuestion={addQuestion} deleteQuestion={deleteQuestion} playing={playing} setPlaying={setPlaying} time={time} setTime={setTime} sound={sound} setSound={setSound} showGuides={showGuides} setShowGuides={setShowGuides} update={update} editQuestion={editQuestion} updateSceneDuration={updateSceneDuration} job={job} render={render}/>} 
      {page === 'Dashboard' && <Dashboard project={project} total={total} onEdit={()=>setPage('Editor')} onCreate={()=>setPage('Create quiz')}/>} 
      {page === 'Create quiz' && <CreateQuiz onGenerate={generate}/>} 
      {page === 'Templates' && <Templates project={project} update={update}/>} 
      {page === 'Publishing' && <Publishing project={project}/>} 
      {page === 'Settings' && <Settings/>}
      {(page === 'My videos') && <MyVideos job={job}/>} 
    </main>
  </div>;
}

function Editor(p: any) {
  const [editorTab, setEditorTab] = useState<'questions' | 'scenes'>('questions');
  const q = p.activeQuestion as QuizQuestion | undefined;

  return <div className="editor">
    <section className="scene-panel">
      <div className="editor-tabs">
        <button className={`editor-tab ${editorTab==='questions'?'active':''}`} onClick={()=>setEditorTab('questions')}>
          ✦ Questions <i>{p.project.questions.length}</i>
        </button>
        <button className={`editor-tab ${editorTab==='scenes'?'active':''}`} onClick={()=>setEditorTab('scenes')}>
          ⏱ Scenes <i>{p.project.scenes.length}</i>
        </button>
      </div>

      {editorTab === 'questions' ? (
        <>
          <div className="question-list">
            {p.project.questions.map((question: QuizQuestion, i: number) => {
              const isSelected = p.activeQuestion?.id === question.id;
              return (
                <div
                  key={question.id}
                  className={`question-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => p.selectQuestion(question.id)}
                >
                  <div className="question-card-top">
                    <span className="question-badge">QUESTION {i + 1}</span>
                    <span className="question-category">{question.category || 'Trivia'}</span>
                    <button
                      className="question-card-delete"
                      title="Delete question"
                      onClick={(e) => { e.stopPropagation(); p.deleteQuestion(question.id); }}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="question-text-snippet">{question.question}</div>
                  <div className="question-pills-row">
                    {question.options.map((opt: string, optIdx: number) => (
                      <span
                        key={optIdx}
                        className={`q-pill ${optIdx === question.correctAnswerIndex ? 'correct' : ''}`}
                      >
                        {letters[optIdx]}: {opt.length > 12 ? opt.slice(0, 10) + '…' : opt}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="add-q-btn" onClick={p.addQuestion}>＋ Add Question</button>
        </>
      ) : (
        <>
          <div className="scene-list">
            {p.project.scenes.map((scene: any) => {
              const isSelected = p.activeScene?.id === scene.id;
              const relatedQ = scene.questionId ? p.project.questions.find((x: QuizQuestion) => x.id === scene.questionId) : null;
              const qNum = relatedQ ? p.project.questions.findIndex((x: QuizQuestion) => x.id === relatedQ.id) + 1 : 0;
              return (
                <button
                  key={scene.id}
                  onClick={() => p.selectScene(scene.id)}
                  className={`scene-row ${isSelected ? 'selected' : ''}`}
                >
                  <span className={`scene-icon ${scene.type}`}>
                    {scene.type === 'question' ? '?' : scene.type === 'reveal' ? '✓' : scene.type === 'hook' ? '✦' : scene.type === 'explanation' ? '💡' : '◆'}
                  </span>
                  <span>
                    <b>{sceneTitle[scene.type as SceneType]}{qNum ? ` ${qNum}` : ''}</b>
                    <small>{scene.duration}s</small>
                  </span>
                  <span className="drag">⠿</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="duration-card">
        <span>ESTIMATED DURATION</span>
        <strong>{p.total.toFixed(1)}s</strong>
        <small>Target 45 seconds <i>•</i> {p.total <= 50 ? 'Fits perfectly' : 'Longer format'}</small>
      </div>
    </section>

    <section className="stage">
      <div className="stage-top">
        <span>PREVIEW <i>•</i> 9:16</span>
        <label className="guide-toggle">
          <input checked={p.showGuides} onChange={e => p.setShowGuides(e.target.checked)} type="checkbox"/> Safe guides
        </label>
      </div>
      <PhonePreview project={p.project} scene={p.activeScene} question={q} time={p.time} guides={p.showGuides}/>
      <div className="player-controls">
        <button onClick={() => p.setTime(Math.max(0, p.time - 1))}>↶</button>
        <button className="play" onClick={() => p.setPlaying(!p.playing)}>{p.playing ? 'Ⅱ' : '▶'}</button>
        <button onClick={() => p.setTime(Math.min(p.total, p.time + 1))}>↷</button>
        <span>{fmt(p.time)} <i>/</i> {fmt(p.total)}</span>
        <button onClick={() => p.setSound(!p.sound)}>{p.sound ? '♬' : '♩'}</button>
        <button>⛶</button>
      </div>
    </section>

    <section className="properties">
      <div className="property-head"><span>PROPERTIES</span><button>•••</button></div>
      {p.activeScene.type === 'question' && q && (
        <QuestionProperties q={q} edit={p.editQuestion} project={p.project} update={p.update}/>
      )}
      {p.activeScene.type === 'reveal' && q && (
        <RevealProperties scene={p.activeScene} q={q} project={p.project} updateSceneDuration={p.updateSceneDuration} selectQuestion={p.selectQuestion}/>
      )}
      {p.activeScene.type === 'explanation' && q && (
        <ExplanationProperties scene={p.activeScene} q={q} edit={p.editQuestion} updateSceneDuration={p.updateSceneDuration}/>
      )}
      {p.activeScene.type === 'hook' && (
        <HookProperties scene={p.activeScene} project={p.project} update={p.update} updateSceneDuration={p.updateSceneDuration}/>
      )}
      {p.activeScene.type === 'score' && (
        <ScoreProperties scene={p.activeScene} project={p.project} updateSceneDuration={p.updateSceneDuration}/>
      )}
      {p.activeScene.type === 'cta' && (
        <CtaProperties scene={p.activeScene} project={p.project} update={p.update} updateSceneDuration={p.updateSceneDuration}/>
      )}
    </section>

    <Timeline project={p.project} activeScene={p.activeScene} time={p.time} total={p.total} onSelectScene={p.selectScene} onTime={p.setTime}/>
    <RenderPanel job={p.job} render={p.render}/>
  </div>;
}

function PhonePreview({project, scene, question, time, guides}:{project:Project;scene:any;question?:QuizQuestion;time:number;guides:boolean}) {
  const theme = project.theme;
  const elapsed = time - scene.startTime;
  const reveal = scene.type === 'reveal';
  const questionScene = scene.type === 'question';
  const remaining = Math.max(0, Math.ceil(scene.duration - elapsed));
  return (
    <div className="phone-wrap">
      <div className="phone" style={{'--bg':theme.background,'--primary':theme.primary,'--secondary':theme.secondary,'--card':theme.card,'--accent':theme.accent} as React.CSSProperties}>
        {guides && <><div className="safe safe-top">SAFE AREA</div><div className="safe safe-bottom">SAFE AREA</div></>}
        {scene.type === 'hook' && (
          <div className="hook-screen">
            <span>QUIZ TIME</span>
            <h1>{project.hook}</h1>
            <b>Ready? Let’s go.</b>
          </div>
        )}
        {(questionScene || reveal) && question && (
          <div className="question-screen">
            <div className="mini-brand">✦ quizframe <span>@quizmaster</span></div>
            <div className="counter">QUESTION {project.questions.findIndex(q => q.id === question.id) + 1} <i>/</i> {project.questions.length}</div>
            <h1 style={{fontSize: fit(question.question, 37)}}>{question.question}</h1>
            <div className={`countdown ${remaining <= 2 ? 'urgent' : ''}`}>
              {reveal ? 'TIME!' : String(remaining).padStart(2, '0')}
              <small>{reveal ? '' : 'SECONDS'}</small>
            </div>
            <div className="answers">
              {question.options.map((o, i) => (
                <div key={i} className={`answer ${reveal ? (i === question.correctAnswerIndex ? 'correct' : 'dim') : ''}`}>
                  <span>{letters[i]}</span>
                  {o}
                  {reveal && i === question.correctAnswerIndex && <b>✓</b>}
                </div>
              ))}
            </div>
          </div>
        )}
        {scene.type === 'explanation' && question && (
          <div className="explain">
            <span>DID YOU KNOW?</span>
            <h1>{question.explanation || 'The answer is revealed.'}</h1>
            <div className="fact-orb">✦</div>
          </div>
        )}
        {scene.type === 'score' && (
          <div className="score-screen">
            <span>QUIZ COMPLETE</span>
            <h1>YOUR SCORE</h1>
            <b>{project.questions.length} <i>/</i> {project.questions.length}</b>
            <strong>100%</strong>
            <p>Incredible! You nailed it.</p>
          </div>
        )}
        {scene.type === 'cta' && (
          <div className="cta-screen">
            <span>✦ YOU MADE IT!</span>
            <h1>{project.cta}</h1>
            <button>FOLLOW FOR MORE</button>
            <small>@quizmaster</small>
          </div>
        )}
      </div>
    </div>
  );
}

function QuestionProperties({q, edit, project, update}:{q:QuizQuestion;edit:(id:string,key:keyof QuizQuestion,value:any)=>void;project:Project;update:any}) {
  const qIndex = project.questions.findIndex(x => x.id === q.id);
  return (
    <div className="property-content">
      <span className="property-badge question">QUESTION {qIndex + 1}</span>
      <label>
        QUESTION PROMPT
        <textarea value={q.question} onChange={e => edit(q.id, 'question', e.target.value)}/>
        <small>{q.question.length}/110 characters</small>
      </label>
      <label>ANSWER OPTIONS & CORRECT ANSWER</label>
      {q.options.map((value, i) => (
        <label className={`option-edit ${q.correctAnswerIndex === i ? 'right' : ''}`} key={i}>
          <span>{letters[i]}</span>
          <input
            value={value}
            onChange={e => {
              const options = [...q.options];
              options[i] = e.target.value;
              edit(q.id, 'options', options);
            }}
          />
          <button title="Set as correct answer" onClick={() => edit(q.id, 'correctAnswerIndex', i)}>✓</button>
        </label>
      ))}
      <label>
        EXPLANATION / DID YOU KNOW?
        <textarea value={q.explanation || ''} onChange={e => edit(q.id, 'explanation', e.target.value)}/>
      </label>
      <label>
        TIMER PER QUESTION
        <div className="stepper">
          <button onClick={() => {
            const nextTimer = Math.max(2, project.timer - 1);
            update((old: Project) => ({...old, timer: nextTimer, scenes: buildScenes(old.questions, nextTimer)}));
          }}>−</button>
          <b>{project.timer}s</b>
          <button onClick={() => {
            const nextTimer = Math.min(15, project.timer + 1);
            update((old: Project) => ({...old, timer: nextTimer, scenes: buildScenes(old.questions, nextTimer)}));
          }}>＋</button>
        </div>
      </label>
    </div>
  );
}

function RevealProperties({scene, q, project, updateSceneDuration, selectQuestion}:{scene:any;q:QuizQuestion;project:Project;updateSceneDuration:(id:string,d:number)=>void;selectQuestion:(id:string)=>void}) {
  const qIndex = project.questions.findIndex(x => x.id === q.id);
  return (
    <div className="property-content">
      <span className="property-badge reveal">REVEAL SCENE</span>
      <div className="scene-type-card">
        <span>✓</span>
        <b>Reveal Answer for Question {qIndex + 1}</b>
        <small>Highlights correct answer on screen</small>
      </div>
      <div className="correct-answer-preview">
        <b>{letters[q.correctAnswerIndex]}:</b>
        <span>{q.options[q.correctAnswerIndex]}</span>
      </div>
      <label>
        REVEAL DURATION: {scene.duration}s
        <input type="range" min="1" max="5" step="0.5" value={scene.duration} onChange={e => updateSceneDuration(scene.id, +e.target.value)}/>
      </label>
      <button className="jump-btn" onClick={() => selectQuestion(q.id)}>Edit Question Text & Options →</button>
    </div>
  );
}

function ExplanationProperties({scene, q, edit, updateSceneDuration}:{scene:any;q:QuizQuestion;edit:(id:string,key:keyof QuizQuestion,val:any)=>void;updateSceneDuration:(id:string,d:number)=>void}) {
  return (
    <div className="property-content">
      <span className="property-badge explanation">EXPLANATION SCENE</span>
      <label>
        DID YOU KNOW FACT
        <textarea value={q.explanation || ''} onChange={e => edit(q.id, 'explanation', e.target.value)}/>
      </label>
      <label>
        EXPLANATION DURATION: {scene.duration}s
        <input type="range" min="1" max="8" step="0.5" value={scene.duration} onChange={e => updateSceneDuration(scene.id, +e.target.value)}/>
      </label>
    </div>
  );
}

function HookProperties({scene, project, update, updateSceneDuration}:{scene:any;project:Project;update:any;updateSceneDuration:(id:string,d:number)=>void}) {
  return (
    <div className="property-content">
      <span className="property-badge hook">HOOK SCENE</span>
      <label>
        HOOK HEADLINE
        <textarea value={project.hook} onChange={e => update((p: Project) => ({...p, hook: e.target.value}))}/>
      </label>
      <label>
        HOOK DURATION: {scene.duration}s
        <input type="range" min="1" max="6" step="0.5" value={scene.duration} onChange={e => updateSceneDuration(scene.id, +e.target.value)}/>
      </label>
    </div>
  );
}

function ScoreProperties({scene, project, updateSceneDuration}:{scene:any;project:Project;updateSceneDuration:(id:string,d:number)=>void}) {
  return (
    <div className="property-content">
      <span className="property-badge score">SCORE SCREEN</span>
      <div className="scene-type-card">
        <span>★</span>
        <b>Final Score Summary</b>
        <small>{project.questions.length} of {project.questions.length} questions completed</small>
      </div>
      <label>
        SCORE DURATION: {scene.duration}s
        <input type="range" min="1" max="6" step="0.5" value={scene.duration} onChange={e => updateSceneDuration(scene.id, +e.target.value)}/>
      </label>
    </div>
  );
}

function CtaProperties({scene, project, update, updateSceneDuration}:{scene:any;project:Project;update:any;updateSceneDuration:(id:string,d:number)=>void}) {
  return (
    <div className="property-content">
      <span className="property-badge cta">CALL TO ACTION</span>
      <label>
        CALL TO ACTION PROMPT
        <textarea value={project.cta} onChange={e => update((p: Project) => ({...p, cta: e.target.value}))}/>
      </label>
      <label>
        CTA DURATION: {scene.duration}s
        <input type="range" min="1" max="6" step="0.5" value={scene.duration} onChange={e => updateSceneDuration(scene.id, +e.target.value)}/>
      </label>
    </div>
  );
}

function Timeline({project, activeScene, time, total, onSelectScene, onTime}:{project:Project;activeScene:any;time:number;total:number;onSelectScene:(id:string)=>void;onTime:(n:number)=>void}) {
  return (
    <section className="timeline">
      <div className="timeline-head">
        <span>TIMELINE</span>
        <div><button>−</button><b>100%</b><button>＋</button><button>☰</button></div>
      </div>
      <div className="ruler">
        {[0,5,10,15,20,25,30,35,40,45].filter(n => n <= Math.ceil(total)).map(n => (
          <span key={n} style={{left:`${(n/total)*100}%`}}>{fmt(n)}</span>
        ))}
      </div>
      <div className="tracks">
        <div className="track-label">VIDEO</div>
        <div className="track-row">
          {project.scenes.map(s => {
            const isSelected = activeScene?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => onSelectScene(s.id)}
                className={`clip ${s.type} ${isSelected ? 'selected' : ''}`}
                style={{width:`${(s.duration/total)*100}%`}}
              >
                {sceneTitle[s.type as SceneType]}
              </button>
            );
          })}
        </div>
        <div className="track-label">AUDIO</div>
        <div className="track-row audio-track">
          <span style={{width:'100%'}}>♪ Quiz Show Suspense <i>Audio ducking ready</i></span>
        </div>
        <div className="playhead" style={{left:`${(time/total)*100}%`}}/>
      </div>
    </section>
  );
}

function RenderPanel({job,render}:{job:RenderJob;render:()=>void}) {
  if (job.status === 'idle') return null;
  const done = job.status === 'completed';
  return (
    <div className="render-overlay">
      <div className="render-modal">
        <button className="close" onClick={() => location.reload()}>×</button>
        <span className={`render-state ${done ? 'done' : ''}`}>{done ? '✓' : '✦'}</span>
        <h2>{done ? 'VIDEO READY' : 'Rendering video'}</h2>
        <p>{done ? 'Your high-fidelity local render is ready to review.' : job.currentStep || 'Preparing your project…'}</p>
        <div className="progress"><i style={{width: `${job.progress}%`}}/></div>
        <b>{job.progress}%</b>
        {done ? (
          <div className="render-result">
            <span>MP4 <small>1080 × 1920 · High definition render</small></span>
            <a href={job.videoId ? `${API}/videos/${job.videoId}/download` : '#'}>Download MP4</a>
          </div>
        ) : (
          <div className="render-steps">
            <span className={job.progress > 15 ? 'complete' : ''}>Preparing assets</span>
            <span className={job.progress > 35 ? 'complete' : ''}>Building composition</span>
            <span className={job.progress > 70 ? 'complete' : ''}>Rendering scenes</span>
            <span className={job.progress > 92 ? 'complete' : ''}>Finalizing</span>
          </div>
        )}
        {!done && <button className="cancel" onClick={render}>Start over</button>}
      </div>
    </div>
  );
}

function Dashboard({project,total,onEdit,onCreate}:{project:Project;total:number;onEdit:()=>void;onCreate:()=>void}) { return <div className="page dashboard"><div className="welcome"><div><p>MONDAY, SEPTEMBER 18</p><h1>Make something<br/><em>worth watching.</em></h1><span>Turn an idea into a polished short-form quiz in minutes.</span><div><button className="primary" onClick={onCreate}>✦ Create a quiz</button><button className="ghost" onClick={onEdit}>Open editor</button></div></div><div className="hero-art"><span>?</span><i>✓</i><b>5</b></div></div><div className="stat-grid"><Stat label="VIDEOS CREATED" value="12" meta="↗ 3 this week"/><Stat label="TOTAL PLAYS" value="48.2K" meta="↗ 18.4% this month"/><Stat label="AVERAGE COMPLETION" value="72%" meta="↗ 4.8% vs last month"/></div><div className="section-heading"><div><span>RECENT PROJECTS</span><h2>Pick up where you left off</h2></div><button className="text-button" onClick={onEdit}>View all →</button></div><div className="project-card"><div className="project-art">QUIZ<br/><b>TIME</b></div><div><b>{project.title}</b><small>Updated just now · {total.toFixed(1)} seconds</small><div className="tags"><span>{project.theme.name}</span><span>{project.questions.length} questions</span><span>9:16</span></div></div><button className="ghost" onClick={onEdit}>Open project →</button></div></div> }
function Stat({label,value,meta}:{label:string;value:string;meta:string}) { return <div className="stat"><span>{label}</span><b>{value}</b><small>{meta}</small></div> }
function CreateQuiz({onGenerate}:{onGenerate:(input:{topic:string;category:string;count:number;timer:number})=>void}) { const [topic,setTopic]=useState('Can you get 5/5 on these science questions?'); const [category,setCategory]=useState('Science'); const [count,setCount]=useState(5); const [timer,setTimer]=useState(5); const estimate=2+count*(timer+3.5)+4.5; return <div className="page create"><div className="page-intro"><span>NEW PROJECT</span><h1>Build a quiz they<br/>can’t <em>scroll past.</em></h1><p>Start with a topic. We’ll craft the questions, timing, and edit-ready video structure.</p></div><div className="create-grid"><section className="form-card"><label>QUIZ TITLE OR TOPIC<input value={topic} onChange={e=>setTopic(e.target.value)} placeholder="e.g. Can you get 5/5?"/></label><div className="form-row"><label>CATEGORY<select value={category} onChange={e=>setCategory(e.target.value)}>{['General Knowledge','Science','Geography','History','Technology','Animals','Space','Food'].map(x=><option key={x}>{x}</option>)}</select></label><label>DIFFICULTY<select><option>Mixed</option><option>Easy</option><option>Medium</option><option>Hard</option></select></label></div><label>NUMBER OF QUESTIONS<div className="segmented">{[3,5,10,15].map(n=><button onClick={()=>setCount(n)} className={count===n?'on':''} key={n}>{n}</button>)}</div></label><label>TIMER PER QUESTION<div className="segmented">{[3,5,7,10].map(n=><button onClick={()=>setTimer(n)} className={timer===n?'on':''} key={n}>{n}s</button>)}</div></label><label>VIDEO STYLE<div className="template-picks">{themes.map(t=><div key={t.name} className="template-mini" style={{background:t.background,borderColor:t.primary}}><span style={{color:t.primary}}>✦</span><b>{t.name}</b></div>)}</div></label><button className="primary wide" onClick={()=>onGenerate({topic,category,count,timer})}>✦ Generate quiz</button><small className="demo-note">Demo mode uses the built-in local quiz generator. No API key required.</small></section><aside className="estimate"><span>YOUR VIDEO PLAN</span><div className="estimate-chart"><b>{estimate.toFixed(0)}<small>sec</small></b><i/></div><div><span>Hook</span><b>2 sec</b></div><div><span>{count} questions + timer</span><b>{count*timer} sec</b></div><div><span>Reveals & explanations</span><b>{(count*3.5).toFixed(1)} sec</b></div><hr/><div><strong>ESTIMATED TOTAL</strong><strong>{estimate.toFixed(1)} sec</strong></div><p>Comfortably suited to a 45-second vertical short.</p></aside></div></div> }
function Templates({project,update}:{project:Project;update:any}) { return <div className="page templates"><div className="page-intro"><span>VISUAL SYSTEM</span><h1>Make it unmistakably<br/><em>yours.</em></h1><p>Templates are lightweight visual settings saved inside this browser.</p></div><div className="template-grid">{themes.map(theme=><button className={`theme-card ${project.theme.name===theme.name?'chosen':''}`} key={theme.name} onClick={()=>update((p:Project)=>({...p,theme}))}><div className="theme-preview" style={{background:theme.background}}><b style={{color:theme.primary}}>QUESTION</b><span style={{background:theme.card,borderColor:theme.accent}}>A&nbsp;&nbsp; Answer option</span><i style={{background:theme.secondary}}>05</i></div><div><strong>{theme.name}</strong><small>{theme.name==='Game show'?'Dramatic and energetic':theme.name==='Neon trivia'?'Electric, high contrast':'Bold and fast-paced'}</small></div>{project.theme.name===theme.name&&<em>✓ Active</em>}</button>)}</div><div className="brand-card"><div><span>BRANDING</span><h2>Make each video recognizably yours</h2><p>Your handle is applied subtly in the phone preview, staying clear of platform controls.</p></div><label>USERNAME<input defaultValue="@quizmaster"/></label><label>PRIMARY COLOUR<input type="color" value={project.theme.primary} onChange={e=>update((p:Project)=>({...p,theme:{...p.theme,primary:e.target.value}}))}/></label></div></div> }
function Publishing({project}:{project:Project}) { return <div className="page publishing"><div className="page-intro"><span>DISTRIBUTION</span><h1>Publish with clarity,<br/><em>not guesswork.</em></h1><p>Platform connections are intentionally isolated from the editor. No credentials are stored in your browser.</p></div><div className="publish-layout"><section className="metadata"><span>POST DETAILS</span><label>TITLE<input defaultValue={`${project.title} ✦`}/></label><label>DESCRIPTION<textarea defaultValue={'Think you can get every answer?\n\nTake the quiz and comment your score!'}/></label><label>HASHTAGS<input defaultValue="#quiz #trivia #generalknowledge #shorts"/></label><button className="primary wide">Queue demo publish</button><small>Demo publish only simulates a queue entry; it never uploads content.</small></section><section className="connections"><span>PLATFORM CONNECTIONS</span><Platform name="YouTube Shorts" state="Not connected" detail="OAuth connection required to publish."/><Platform name="Instagram Reels" state="Requires approval" detail="Publishing access depends on your Meta app permissions."/><Platform name="TikTok" state="Not connected" detail="OAuth connection required to publish."/><div className="publish-info">ⓘ Connect real accounts from Settings after you configure a verified integration.</div></section></div></div> }
function Platform({name,state,detail}:{name:string;state:string;detail:string}) { return <div className="platform"><div className="platform-logo">▶</div><div><b>{name}</b><small>{detail}</small></div><span>{state}</span><button className="ghost">Connect</button></div> }
function Settings() { return <div className="page settings"><div className="page-intro"><span>INTEGRATIONS</span><h1>Keep secrets on the<br/><em>server side.</em></h1><p>Set credentials in the local <code>.env</code> file. The interface reports status but never displays secret values.</p></div><div className="integration-grid"><Integration icon="✦" name="Quiz generation" status="Demo provider active" detail="Set AI_PROVIDER and AI_API_KEY to enable a supported server-side provider."/><Integration icon="♬" name="Voiceover" status="Demo provider active" detail="Set TTS_PROVIDER and TTS_API_KEY to generate server-side audio clips."/><Integration icon="▶" name="YouTube" status="Not connected" detail="Requires OAuth client ID and secret on the backend."/><Integration icon="◎" name="Instagram" status="Not configured" detail="Requires approved Meta publishing permissions."/></div><div className="security-note"><b>Security by design</b><span>Secrets are server-only · mock services are labeled · OAuth belongs to the backend · no permanent tokens in localStorage</span></div></div> }
function Integration({icon,name,status,detail}:{icon:string;name:string;status:string;detail:string}) { return <div className="integration"><i>{icon}</i><div><b>{name}</b><span>● {status}</span><small>{detail}</small></div><button className="ghost">Configure</button></div> }
function MyVideos({job}:{job:RenderJob}) { return <div className="page videos"><div className="page-intro"><span>LIBRARY</span><h1>Your finished<br/><em>stories.</em></h1><p>Local renders appear here. Generated media is intentionally excluded from source control.</p></div>{job.status==='completed'?<div className="video-ready"><div>QUIZ<br/><b>TIME</b></div><span><b>Quiz video render</b><small>1080 × 1920 · MP4 · completed just now</small></span><a className="primary" href={job.videoId?`${API}/videos/${job.videoId}/download`:'#'}>Download MP4</a></div>:<div className="empty-state"><span>▣</span><h2>No local renders yet</h2><p>Finish a quiz in the editor, then render it here.</p></div>}</div> }
function icon(item:string) { return ({Dashboard:'⊞','Create quiz':'＋',Editor:'▣',Templates:'◇','My videos':'▷',Publishing:'↗',Settings:'⚙'} as Record<string,string>)[item]; }
