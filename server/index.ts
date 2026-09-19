import cors from 'cors';
import express from 'express';
import {existsSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync} from 'node:fs';
import {join, resolve, basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';

const app = express();
const port = Number(process.env.PORT || 3001);
const root = resolve(process.cwd(), 'storage');
const projectDir = join(root, 'projects');
const renderDir = join(root, 'renders');
[root, projectDir, renderDir].forEach(path => mkdirSync(path, {recursive:true}));
app.use(cors({origin: ['http://localhost:5173'], methods:['GET','POST','PUT']}));
app.use(express.json({limit:'500kb'}));

type Job = {jobId:string; status:'queued'|'preparing'|'rendering'|'encoding'|'completed'|'failed';progress:number;currentStep:string;error?:string;demo?:boolean;videoId?:string;projectId:string};
const jobs = new Map<string, Job>();
const safeId = (value:string) => /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
const projectFile = (id:string) => join(projectDir, `${id}.json`);
const ffmpegAvailable = () => spawnSync('ffmpeg', ['-version'], {stdio:'ignore'}).status === 0;

const banks: Record<string, Array<[string,string[],number,string]>> = {
  science: [['What gas do plants absorb from the atmosphere?', ['Oxygen','Carbon dioxide','Nitrogen','Helium'],1,'Plants use carbon dioxide during photosynthesis.'],['What force keeps planets in orbit?', ['Magnetism','Gravity','Friction','Electricity'],1,'Gravity pulls objects toward each other.'],['What is H₂O commonly known as?', ['Salt','Water','Oxygen','Hydrogen'],1,'H₂O is the chemical formula for water.'],['What is the center of an atom called?', ['Orbit','Nucleus','Electron','Cell'],1,'The nucleus contains protons and neutrons.'],['Which part of a plant absorbs water?', ['Flower','Roots','Leaf','Stem'],1,'Roots absorb water and nutrients from the soil.']],
  geography: [['What is the largest ocean on Earth?', ['Atlantic','Indian','Pacific','Arctic'],2,'The Pacific is Earth’s largest and deepest ocean.'],['Which country has the most people?', ['India','Brazil','Japan','Canada'],0,'India is currently the world’s most populous country.'],['What is the capital of Australia?', ['Sydney','Melbourne','Canberra','Perth'],2,'Canberra is Australia’s capital city.'],['The Sahara is found on which continent?', ['Asia','Africa','Europe','South America'],1,'The Sahara stretches across North Africa.'],['Which river runs through Egypt?', ['Amazon','Nile','Danube','Yangtze'],1,'The Nile flows north through Egypt.']],
  general: [['Which planet is known as the Red Planet?', ['Venus','Mars','Jupiter','Mercury'],1,'Iron minerals give Mars its reddish color.'],['How many sides does a triangle have?', ['Two','Three','Four','Five'],1,'A triangle is a three-sided polygon.'],['Which animal is famous for black and white stripes?', ['Giraffe','Zebra','Panda','Tiger'],1,'Every zebra has a unique stripe pattern.'],['What is the fastest land animal?', ['Cheetah','Lion','Horse','Falcon'],0,'Cheetahs can sprint at very high speeds.'],['Which instrument has black and white keys?', ['Guitar','Piano','Drums','Violin'],1,'A piano keyboard has black and white keys.']]
};
function questionsFor(topic:string, category:string, count:number) { const bank = banks[category.toLowerCase()] || banks[topic.toLowerCase()] || banks.general; return Array.from({length:Math.min(Math.max(count,3),15)},(_, i) => { const data=bank[i%bank.length]; return {id:randomUUID().slice(0,8),question:data[0],options:data[1],correctAnswerIndex:data[2],explanation:data[3],category,difficulty:'mixed'}; }); }

app.get('/api/health', (_req,res) => res.json({ok:true,renderer:ffmpegAvailable() ? 'ffmpeg' : 'unavailable', mode:'local-demo'}));
app.post('/api/quiz/generate', (req,res) => { const {topic='',category='General',count=5,timer=5}=req.body || {}; if(typeof topic !== 'string' || topic.length > 160 || !Number.isInteger(count) || count < 3 || count > 15 || !Number.isFinite(timer)) return res.status(400).json({error:'Invalid quiz configuration'}); res.json({questions:questionsFor(topic,category,count),mode:'Demo quiz generator'}); });
app.put('/api/projects/:id', (req,res) => { const id=safeId(req.params.id); if(!id || !req.body || typeof req.body !== 'object') return res.status(400).json({error:'Invalid project'}); const raw=JSON.stringify({...req.body,id,updatedAt:new Date().toISOString()}); if(raw.length > 500_000) return res.status(413).json({error:'Project too large'}); writeFileSync(projectFile(id),raw,'utf8'); res.json({id,version:new Date().toISOString()}); });
app.get('/api/projects/:id', (req,res) => { const id=safeId(req.params.id); if(!id || !existsSync(projectFile(id))) return res.status(404).json({error:'Project not found'}); res.type('json').send(readFileSync(projectFile(id),'utf8')); });
app.post('/api/render', (req,res) => { const projectId=safeId(req.body?.projectId); if(!projectId || !existsSync(projectFile(projectId))) return res.status(400).json({error:'Save a valid project before rendering'}); const job:Job={jobId:randomUUID(),projectId,status:'queued',progress:0,currentStep:'Queued'}; jobs.set(job.jobId,job); runRender(job); res.status(202).json(job); });
app.get('/api/render/:jobId', (req,res) => { const job=jobs.get(req.params.jobId); if(!job) return res.status(404).json({error:'Render job not found'}); res.json(job); });
app.get('/api/videos/:videoId/download', (req,res) => { const id=safeId(req.params.videoId); if(!id) return res.status(400).end(); const file=join(renderDir, `${id}.mp4`); if(!existsSync(file)) return res.status(404).json({error:'This render has no generated MP4.'}); res.download(file, 'quizframe-video.mp4'); });

import { renderAsync } from '@resvg/resvg-js';

function advance(job:Job,status:Job['status'],progress:number,currentStep:string) { job.status=status; job.progress=progress; job.currentStep=currentStep; }
function wait(ms:number) { return new Promise(resolve => setTimeout(resolve,ms)); }

function escapeXml(unsafe: string) {
  return String(unsafe || '').replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function wrap(value: string, maxChars: number): string[] {
  const words = String(value || '').trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function generateSceneSvg(scene: any, project: any, frameContext?: { remaining?: number; isUrgent?: boolean }): string {
  const theme = {
    primary: project.theme?.primary || '#ffd84d',
    secondary: project.theme?.secondary || '#ee5bff',
    background: project.theme?.background || '#0b1027',
    card: project.theme?.card || '#1b2758',
    accent: project.theme?.accent || '#60e8ff',
  };
  const handle = '@quizmaster';
  const question = project.questions.find((item: any) => item.id === scene.questionId);
  const qIndex = question ? project.questions.findIndex((item: any) => item.id === question.id) : 0;
  const totalQs = project.questions.length || 5;

  const defs = `
    <defs>
      <radialGradient id="bgGrad" cx="75%" cy="9%" r="65%">
        <stop offset="0%" stop-color="${theme.secondary}" stop-opacity="0.35"/>
        <stop offset="60%" stop-color="${theme.background}"/>
        <stop offset="100%" stop-color="${theme.background}"/>
      </radialGradient>
      <linearGradient id="hookGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.secondary}"/>
        <stop offset="55%" stop-color="${theme.background}"/>
      </linearGradient>
      <linearGradient id="ctaGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.background}"/>
        <stop offset="100%" stop-color="${theme.secondary}"/>
      </linearGradient>
      <pattern id="dotGrid" width="42" height="42" patternUnits="userSpaceOnUse">
        <circle cx="21" cy="21" r="2" fill="${theme.accent}" opacity="0.16"/>
      </pattern>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="14" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
      <filter id="correctGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="12" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      </filter>
    </defs>
  `;

  if (scene.type === 'hook') {
    const lines = wrap(project.hook || project.title || 'Are you ready for the quiz?', 22);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#hookGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>
        
        <text x="540" y="680" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="36" letter-spacing="4">QUIZ TIME</text>
        <g transform="translate(540, 820)">
          ${lines.map((l, i) => `<text x="0" y="${i * 90}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="74">${escapeXml(l)}</text>`).join('')}
        </g>
        <text x="540" y="1250" text-anchor="middle" fill="${theme.accent}" font-family="Arial, sans-serif" font-weight="bold" font-size="38">Ready? Let’s go.</text>
      </svg>
    `;
  }

  if (scene.type === 'question' && question) {
    const qLines = wrap(question.question, 27);
    const remaining = frameContext?.remaining ?? (project.timer || 5);
    const isUrgent = frameContext?.isUrgent ?? (remaining <= 2);
    const timerColor = isUrgent ? '#ff7196' : theme.primary;
    const fontSize = question.question.length > 80 ? 46 : question.question.length > 50 ? 54 : 62;
    const lineSpacing = Math.round(fontSize * 1.3);

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#bgGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>

        <!-- Top bar -->
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>

        <!-- Question counter -->
        <text x="540" y="240" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="32" letter-spacing="4">QUESTION ${qIndex + 1} / ${totalQs}</text>

        <!-- Question title -->
        <g transform="translate(540, 360)">
          ${qLines.map((l, i) => `<text x="0" y="${i * lineSpacing}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="${fontSize}">${escapeXml(l)}</text>`).join('')}
        </g>

        <!-- Countdown badge -->
        <g transform="translate(540, 715)">
          <circle cx="0" cy="0" r="105" fill="rgba(11, 16, 39, 0.75)" stroke="${timerColor}" stroke-width="8" filter="url(#glow)"/>
          <text x="0" y="15" text-anchor="middle" fill="${timerColor}" font-family="Arial, sans-serif" font-weight="800" font-size="76">${String(remaining).padStart(2, '0')}</text>
          <text x="0" y="62" text-anchor="middle" fill="${timerColor}" font-family="Arial, sans-serif" font-weight="bold" font-size="20" letter-spacing="3">SECONDS</text>
        </g>

        <!-- Answer Options -->
        <g transform="translate(80, 930)">
          ${question.options.map((opt: string, i: number) => {
            const y = i * 175;
            const letter = ['A', 'B', 'C', 'D'][i] || String.fromCharCode(65 + i);
            const optLines = wrap(opt, 32);
            const textY = optLines.length > 1 ? 62 : 79;
            return `
              <g transform="translate(0, ${y})">
                <rect width="920" height="135" rx="24" ry="24" fill="${theme.card}" stroke="${theme.accent}" stroke-opacity="0.45" stroke-width="2"/>
                <rect x="28" y="26" width="60" height="83" rx="14" ry="14" fill="${theme.secondary}"/>
                <text x="58" y="78" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="bold" font-size="38">${letter}</text>
                <g transform="translate(118, ${textY})">
                  ${optLines.map((line, li) => `<text x="0" y="${li * 38}" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="34">${escapeXml(line)}</text>`).join('')}
                </g>
              </g>
            `;
          }).join('')}
        </g>
      </svg>
    `;
  }

  if (scene.type === 'reveal' && question) {
    const qLines = wrap(question.question, 27);
    const fontSize = question.question.length > 80 ? 46 : question.question.length > 50 ? 54 : 62;
    const lineSpacing = Math.round(fontSize * 1.3);

    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#bgGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>

        <!-- Top bar -->
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>

        <!-- Question counter -->
        <text x="540" y="240" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="32" letter-spacing="4">QUESTION ${qIndex + 1} / ${totalQs}</text>

        <!-- Question title -->
        <g transform="translate(540, 360)">
          ${qLines.map((l, i) => `<text x="0" y="${i * lineSpacing}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="${fontSize}">${escapeXml(l)}</text>`).join('')}
        </g>

        <!-- Time Up badge -->
        <g transform="translate(540, 715)">
          <circle cx="0" cy="0" r="105" fill="rgba(11, 16, 39, 0.75)" stroke="#ff7196" stroke-width="8" filter="url(#glow)"/>
          <text x="0" y="18" text-anchor="middle" fill="#ff7196" font-family="Arial, sans-serif" font-weight="800" font-size="52">TIME!</text>
        </g>

        <!-- Answer Options -->
        <g transform="translate(80, 930)">
          ${question.options.map((opt: string, i: number) => {
            const y = i * 175;
            const isCorrect = i === question.correctAnswerIndex;
            const letter = ['A', 'B', 'C', 'D'][i] || String.fromCharCode(65 + i);
            const optLines = wrap(opt, 30);
            const textY = optLines.length > 1 ? 62 : 79;
            return `
              <g transform="translate(0, ${y})" opacity="${isCorrect ? '1' : '0.37'}">
                <rect width="920" height="135" rx="24" ry="24" fill="${isCorrect ? '#1f644e' : theme.card}" stroke="${isCorrect ? '#4ced9b' : theme.accent}" stroke-opacity="${isCorrect ? '1' : '0.3'}" stroke-width="${isCorrect ? '4' : '2'}" ${isCorrect ? 'filter="url(#correctGlow)"' : ''}/>
                <rect x="28" y="26" width="60" height="83" rx="14" ry="14" fill="${isCorrect ? '#4ced9b' : theme.secondary}"/>
                <text x="58" y="78" text-anchor="middle" fill="${isCorrect ? '#0f3b2c' : '#ffffff'}" font-family="Arial, sans-serif" font-weight="bold" font-size="38">${letter}</text>
                <g transform="translate(118, ${textY})">
                  ${optLines.map((line, li) => `<text x="0" y="${li * 38}" fill="#ffffff" font-family="Arial, sans-serif" font-weight="700" font-size="34">${escapeXml(line)}</text>`).join('')}
                </g>
                ${isCorrect ? `
                  <!-- Checkmark badge -->
                  <circle cx="865" cy="67" r="28" fill="#4ced9b"/>
                  <text x="865" y="78" text-anchor="middle" fill="#0f3b2c" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✓</text>
                ` : ''}
              </g>
            `;
          }).join('')}
        </g>
      </svg>
    `;
  }

  if (scene.type === 'explanation' && question) {
    const expLines = wrap(question.explanation || 'The answer is revealed.', 26);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#bgGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>

        <text x="540" y="580" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="36" letter-spacing="4">DID YOU KNOW?</text>
        <g transform="translate(540, 720)">
          ${expLines.map((l, i) => `<text x="0" y="${i * 75}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="56">${escapeXml(l)}</text>`).join('')}
        </g>

        <!-- Glowing Fact Orb -->
        <circle cx="540" cy="1150" r="75" fill="${theme.secondary}" filter="url(#glow)"/>
        <text x="540" y="1178" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="70">✦</text>
      </svg>
    `;
  }

  if (scene.type === 'score') {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#bgGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>

        <text x="540" y="540" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="36" letter-spacing="4">QUIZ COMPLETE</text>
        <text x="540" y="660" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="72">YOUR SCORE</text>
        
        <text x="540" y="860" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="900" font-size="140">${totalQs} / ${totalQs}</text>
        
        <g transform="translate(420, 930)">
          <rect width="240" height="74" rx="37" ry="37" fill="${theme.secondary}"/>
          <text x="120" y="52" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="bold" font-size="38">100%</text>
        </g>

        <text x="540" y="1130" text-anchor="middle" fill="#d3d5e2" font-family="Arial, sans-serif" font-weight="600" font-size="42">Incredible! You nailed it.</text>
      </svg>
    `;
  }

  if (scene.type === 'cta') {
    const ctaLines = wrap(project.cta || 'How many did you get right? Comment your score below!', 22);
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
        ${defs}
        <rect width="1080" height="1920" fill="url(#ctaGrad)"/>
        <rect width="1080" height="1920" fill="url(#dotGrid)"/>
        <text x="80" y="110" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="34">✦ quizframe</text>
        <text x="1000" y="110" text-anchor="end" fill="#e3e3e7" font-family="Arial, sans-serif" font-weight="600" font-size="32">${handle}</text>

        <text x="540" y="580" text-anchor="middle" fill="${theme.primary}" font-family="Arial, sans-serif" font-weight="bold" font-size="36" letter-spacing="4">✦ YOU MADE IT!</text>
        <g transform="translate(540, 720)">
          ${ctaLines.map((l, i) => `<text x="0" y="${i * 85}" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="800" font-size="66">${escapeXml(l)}</text>`).join('')}
        </g>

        <!-- CTA Button -->
        <g transform="translate(220, 1140)">
          <rect width="640" height="106" rx="26" ry="26" fill="${theme.primary}"/>
          <text x="320" y="66" text-anchor="middle" fill="#14151d" font-family="Arial, sans-serif" font-weight="800" font-size="36" letter-spacing="2">FOLLOW FOR MORE</text>
        </g>
        <text x="540" y="1320" text-anchor="middle" fill="#a4a6b5" font-family="Arial, sans-serif" font-weight="600" font-size="34">${handle}</text>
      </svg>
    `;
  }

  // Fallback generic frame
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
      ${defs}
      <rect width="1080" height="1920" fill="url(#bgGrad)"/>
      <text x="540" y="960" text-anchor="middle" fill="#ffffff" font-family="Arial, sans-serif" font-weight="bold" font-size="60">${escapeXml(scene.type)}</text>
    </svg>
  `;
}

function runFfmpeg(args:string[]) {
  return new Promise<void>((resolve,reject) => {
    const child=spawn('ffmpeg', args, {windowsHide:true, stdio:'ignore'});
    child.on('error',reject);
    child.on('close',code=>code===0 ? resolve() : reject(Error(`FFmpeg exited with ${code}`)));
  });
}

async function runRender(job:Job) {
  let tempDir = '';
  try {
    advance(job,'preparing',10,'Validating timeline'); await wait(250);
    const project=JSON.parse(readFileSync(projectFile(job.projectId),'utf8'));
    const questions=project.questions;
    if(!Array.isArray(questions)||questions.length<2||questions.some((q:any)=>!q.question||!Array.isArray(q.options)||q.options.length<2||q.correctAnswerIndex===undefined)) throw Error('Project content validation failed');
    if(!Array.isArray(project.scenes)||project.scenes.length===0) throw Error('Project timeline is empty');
    if(!ffmpegAvailable()) throw Error('FFmpeg is not installed. Install FFmpeg and restart the server to create an MP4.');
    
    advance(job,'preparing',25,'Building high-definition scene compositions');
    tempDir=join(renderDir, `tmp-${job.jobId}`);
    mkdirSync(tempDir,{recursive:true});
    
    const validScenes = project.scenes.filter((scene:any) => ['hook','question','reveal','explanation','score','cta'].includes(scene.type) && Number(scene.duration) > 0);
    if (!validScenes.length) throw Error('Timeline has no renderable scenes');

    for (let index=0; index<validScenes.length; index++) {
      const scene = validScenes[index];
      const part = join(tempDir, `scene-${String(index).padStart(3,'0')}.mp4`);
      const sceneDuration = Number(scene.duration) || 2;
      advance(job,'rendering',Math.round(28 + (index / validScenes.length) * 58),`Rendering high-fidelity scene ${index + 1} of ${validScenes.length}: ${scene.type}`);

      if (scene.type === 'question') {
        // Render dynamic second-by-second countdown frames
        const totalSec = Math.max(1, Math.round(sceneDuration));
        const frameListFile = join(tempDir, `frames-${index}.txt`);
        const frameLines: string[] = [];

        for (let sec = 0; sec < totalSec; sec++) {
          const remaining = totalSec - sec;
          const frameSvg = generateSceneSvg(scene, project, { remaining, isUrgent: remaining <= 2 });
          const pngRes = await renderAsync(frameSvg);
          const framePath = join(tempDir, `q-${index}-sec-${sec}.png`);
          writeFileSync(framePath, pngRes.asPng());
          frameLines.push(`file 'q-${index}-sec-${sec}.png'`);
          frameLines.push('duration 1');
        }
        // Repeat the last frame for FFmpeg concat demuxer requirement
        frameLines.push(`file 'q-${index}-sec-${totalSec - 1}.png'`);
        writeFileSync(frameListFile, frameLines.join('\n'), 'utf8');

        await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', frameListFile, '-t', String(sceneDuration), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', part]);
      } else {
        // Static high-fidelity scene frame
        const sceneSvg = generateSceneSvg(scene, project);
        const pngRes = await renderAsync(sceneSvg);
        const framePath = join(tempDir, `scene-frame-${index}.png`);
        writeFileSync(framePath, pngRes.asPng());

        await runFfmpeg(['-y', '-loop', '1', '-i', framePath, '-t', String(sceneDuration), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', '30', part]);
      }
    }

    advance(job,'encoding',90,'Assembling final video timeline');
    const list=join(tempDir,'timeline.txt');
    const entries=validScenes.map((_scene:any,index:number)=>`file 'scene-${String(index).padStart(3,'0')}.mp4'`).join('\n');
    writeFileSync(list,entries,'utf8');
    
    const videoId=randomUUID();
    const out=join(renderDir,`${videoId}.mp4`);
    await runFfmpeg(['-y','-f','concat','-safe','0','-i',list,'-c','copy',out]);
    if(!existsSync(out)||statSync(out).size<1000) throw Error('Renderer did not produce a valid MP4');
    
    rmSync(tempDir,{recursive:true,force:true});
    tempDir='';
    advance(job,'completed',100,'Full timeline video ready');
    job.videoId=videoId;
  } catch(error) {
    if(tempDir) rmSync(tempDir,{recursive:true,force:true});
    job.status='failed';
    job.error=error instanceof Error?error.message:'Rendering failed';
    job.currentStep='Render failed';
  }
}

app.listen(port,()=>console.log(`Quizframe API listening on http://localhost:${port}`));

