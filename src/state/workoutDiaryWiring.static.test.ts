import { readFileSync } from 'fs';
import path from 'path';
const read=(name:string)=>readFileSync(path.join(__dirname,'..',name),'utf8');
it('gates debrief startup on diary completion and renders persisted diary in history',()=>{
 const coach=read('app/ai-coach.tsx');
 expect(coach).toContain('<WorkoutDiaryGate');
 expect(coach).toContain('debriefReadySession !== mode.sessionId');
 expect(coach).toMatch(/onComplete=\{\(\) => \{[\s\S]*?openDebrief\(mode\)/);
 const initial=coach.slice(coach.indexOf('useLayoutEffect(() =>'),coach.indexOf('const messages ='));
 expect(initial).not.toContain('openDebrief(mode)');
 const history=read('app/workout/[id].tsx');
 expect(history).toContain('<WorkoutDiarySummary');
 expect(history).toContain('debriefSessionId: id');
});
