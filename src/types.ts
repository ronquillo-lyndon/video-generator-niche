export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type SceneType = 'hook' | 'question' | 'reveal' | 'explanation' | 'score' | 'cta';
export type RenderStatus = 'idle' | 'queued' | 'preparing' | 'rendering' | 'encoding' | 'completed' | 'failed';

export interface QuizQuestion { id: string; question: string; options: string[]; correctAnswerIndex: number; explanation?: string; category: string; difficulty: Difficulty }
export interface VideoScene { id: string; type: SceneType; questionId?: string; duration: number; startTime: number }
export interface Theme { name: string; primary: string; secondary: string; background: string; card: string; accent: string }
export interface Project { id: string; title: string; category: string; difficulty: Difficulty; timer: number; hook: string; cta: string; questions: QuizQuestion[]; theme: Theme; scenes: VideoScene[]; updatedAt: string }
export interface RenderJob { jobId: string; status: RenderStatus; progress: number; currentStep: string; error?: string; demo?: boolean; videoId?: string }

export const themes: Theme[] = [
  {name: 'Game show', primary: '#ffd84d', secondary: '#ee5bff', background: '#0b1027', card: '#1b2758', accent: '#60e8ff'},
  {name: 'Neon trivia', primary: '#64f6e6', secondary: '#b76aff', background: '#100b20', card: '#261647', accent: '#fa61b5'},
  {name: 'Viral pop', primary: '#f9ff52', secondary: '#ff5f9e', background: '#19191e', card: '#292932', accent: '#ffffff'},
];

export function recalculateSceneTimings(scenes: VideoScene[]): VideoScene[] {
  let startTime = 0;
  return scenes.map((s) => {
    const dur = Math.max(0.5, Number(s.duration) || 1);
    const scene = { ...s, duration: dur, startTime: +startTime.toFixed(2) };
    startTime += dur;
    return scene;
  });
}

export function buildScenes(questions: QuizQuestion[], timer: number, explanation = true): VideoScene[] {
  const rows: Omit<VideoScene, 'startTime'>[] = [{id: 'hook', type: 'hook', duration: 2}];
  questions.forEach((q) => {
    rows.push({id: `q-${q.id}`, type: 'question', questionId: q.id, duration: timer});
    rows.push({id: `r-${q.id}`, type: 'reveal', questionId: q.id, duration: 1.5});
    if (explanation && q.explanation) rows.push({id: `e-${q.id}`, type: 'explanation', questionId: q.id, duration: 2});
  });
  rows.push({id: 'score', type: 'score', duration: 2.5}, {id: 'cta', type: 'cta', duration: 2});
  return recalculateSceneTimings(rows as VideoScene[]);
}

export const duration = (project: Project) => project.scenes.reduce((total, scene) => total + scene.duration, 0);

