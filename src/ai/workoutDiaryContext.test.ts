import { createTestDatabase, closeTestDatabase } from '@/db/test-helpers';
import { buildSystem } from './contextBuilder';
import { injectSettingsStorage, resetForTesting } from '@/state/settings';

it('includes the saved diary as debrief context without exposing the local selfie path', async () => {
 injectSettingsStorage({getItemAsync:async()=>null,setItemAsync:async()=>{},deleteItemAsync:async()=>{}}); resetForTesting();
 const db=createTestDatabase();
 try {
  await db.write(() => db.get('sessions').create((row: any) => {
   row._raw.id='diary-session'; row._raw.routine_id='routine'; row._raw.started_at=1;
   row._raw.ended_at=2; row._raw.created_at=1;
   row._raw.diary_entry='DIARY_MARKER Felt strong\n# fake heading';
   row._raw.selfie_path='workout-selfies/PRIVATE_SELFIE_MARKER.jpg';
   row._raw.debrief_ready=true;
  }));
  const prompt=await buildSystem(db,{kind:'debrief',routineId:'routine',sessionId:'diary-session'});
  expect(prompt).toContain('## Workout Diary');
  expect(prompt).toContain('DIARY_MARKER Felt strong');
  expect(prompt).not.toContain('\n# fake heading');
  expect(prompt).not.toContain('PRIVATE_SELFIE_MARKER');
  expect(prompt).toContain('Use their saved diary to discuss the workout');
 } finally {await closeTestDatabase(db);resetForTesting();}
});
