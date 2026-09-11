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

it('refreshes the saved diary when returning to the workout and keeps picker cancellation skippable',()=>{
 const summary=read('components/WorkoutDiarySummary.tsx');
 expect(summary.includes('useFocusEffect(useCallback(')).toBe(true);
 expect(summary.includes('readWorkoutDiary(database, sessionId)')).toBe(true);
 const gate=read('components/WorkoutDiaryGate.tsx');
 expect(gate.includes('requestCameraPermissionsAsync()')).toBe(true);
 expect(gate.includes('!result.canceled && result.assets[0]?.uri')).toBe(true);
 expect(gate.includes('complete(null)')).toBe(true);
 expect(gate.includes("cameraType: ImagePicker.CameraType.front")).toBe(true);
});
